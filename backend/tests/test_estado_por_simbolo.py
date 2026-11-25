"""Revisión 14: Inicio, Mi cartera y Explorar dicen lo mismo de cada posición.

La misma posición se juzgaba distinto según la pantalla: Explorar con el repaso
de stops (`contexto_cartera.stops_de_la_cartera`, que también mira el último
cierre de la lista) y las decisiones de la lista; Mi cartera e Inicio con
`stop_perforado` por lote y solo la cotización. Con KO en 118, la lista cerrada a
117 y la cotización a 120, Explorar decía «Vender» y las otras dos «en orden».
Ahora `/api/portfolio` sirve el MISMO repaso (`repaso`), con la lista guardada
que Explorar enseña al abrir; y la copia caducada se repasa con su cierre VIEJO
(`senales_para_el_stop`), también en Hoy.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import time_machine

from app.analysis.markets import parametros_lista_diaria
from app.cache.cache import CacheStore
from app.main import app
from app.providers.base import DataNotFoundError, iso_utc
from tests.fixtures import extremos as ex
from tests.test_cartera_revision9 import Servicio, _cliente
from tests.test_today import GUARDADA, _completar, con_reloj  # noqa: F401 — fixture

AHORA = datetime(2026, 11, 24, 15, 0, tzinfo=timezone.utc)
EXPLORAR = "/api/signals/today?market=us_sp500&vencida=aceptar"


def _lista(senales: list[dict]) -> dict:
    """Una lista del día guardada con la forma que Explorar acepta (`_PAYLOAD_KEYS`)."""
    return {"signals": senales, "shortlist": {"ideas": [], "sizing": {"recortes": []}}, "counts": {},
            "thresholds": {}, "sectors": [], "scored": len(senales), "requested": len(senales),
            "complete": True, "huella_cartera": None, "as_of": iso_utc(), "market": "us_sp500"}


def _senal(symbol: str, cierre: float, decision: dict) -> dict:
    return {"symbol": symbol, "price": {"last": cierre, "estado": "valido", "source": "yfinance", "as_of": iso_utc()},
            "decision": decision}


def _pedir(session_factory, service, *urls):
    c = _cliente(session_factory, service)
    try:
        return [c.get(u).json() for u in urls]
    finally:
        app.dependency_overrides.clear()


def test_mi_cartera_lee_el_mismo_repaso_que_explorar_y_la_fila_de_ko_esta_perforada(session_factory):
    # Coste 100, stop fijado en 118; la cotización (Servicio) es 120 y la lista
    # cerró a 117: perforada por el cierre de la lista (fail-safe).
    with time_machine.travel(AHORA, tick=False):
        with session_factory() as s:
            ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 10, 100.0, 118.0)
            s.commit()
        service = Servicio(CacheStore(session_factory))
        service.cache.set("daily_picks", parametros_lista_diaria("us_sp500"),
                          _lista([_senal("KO", 117.0, {"action": "mantener", "owned": True})]))
        cartera, explorar = _pedir(session_factory, service, "/api/portfolio", EXPLORAR)

    repaso = cartera["repaso"]
    # La misma fuente: lo que Explorar repasa es, campo a campo, lo que lee Mi cartera.
    assert repaso["posiciones"] == explorar["cartera"]["posiciones"]
    assert (repaso["abiertas"], repaso["en_lista"]) == (1, 1)
    assert repaso["posiciones"][0]["estado"] == "perforado"
    # Y la fila del lote dice lo mismo, con el precio que lo perfora.
    fila = cartera["positions"][0]
    assert (fila["price"], fila["stop"], fila["stop_perforado"]) == (120.0, 118.0, True)
    assert (fila["stop_perforado_por"]["fuente"], fila["stop_perforado_por"]["precio"]) == ("cierre_de_la_lista", 117.0)
    assert repaso["lista"] == {"mercado": "us_sp500", "as_of": iso_utc(AHORA), "estado": "valido",
                               "antiguedad_segundos": None}


def test_las_decisiones_de_la_lista_viajan_solo_para_lo_que_sigue_abierto(session_factory):
    """Una venta por puntuación (stop intacto) es «Vender» en Explorar: Mi cartera
    e Inicio necesitan la fila de la lista para decir lo mismo. Las de empresas
    que no tienes no viajan."""
    vender = {"action": "vender", "owned": True,
              "reglas": [{"id": "puntuacion_desfavorable", "resultado": "cumple", "efecto": "vender",
                          "papel": "decide", "datos": {"valor": -0.6, "umbral": -0.35}}]}
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 10, 100.0, 50.0)
        s.commit()
    service = Servicio(CacheStore(session_factory))
    service.cache.set("daily_picks", parametros_lista_diaria("us_sp500"), _lista([
        _senal("KO", 120.0, vender), _senal("PEP", 150.0, {"action": "comprar", "owned": False})]))
    (cartera,) = _pedir(session_factory, service, "/api/portfolio")

    repaso = cartera["repaso"]
    assert repaso["posiciones"][0]["estado"] == "por_encima"
    assert [(s["symbol"], s["decision"]["action"]) for s in repaso["senales"]] == [("KO", "vender")]
    assert cartera["positions"][0]["stop_perforado"] is False
    assert cartera["positions"][0]["stop_perforado_por"] is None


class SinCotizacion(Servicio):
    def get(self, data_type, **kw):
        if data_type == "quote":
            raise DataNotFoundError("quote")
        return super().get(data_type, **kw)


def test_con_la_lista_caducada_su_cierre_no_da_por_encima(session_factory):
    """Sin cotización y con la lista de hace 6 días (rescatada hasta 7), su
    cierre por encima del stop no dice que siga por encima: sin comprobar, en Mi
    cartera y en Explorar (`vencida=aceptar`). Antes Explorar decía «por encima»."""
    reloj = {"t": AHORA}
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 10, 110.0, 100.0)
        s.commit()
    service = SinCotizacion(CacheStore(session_factory, now=lambda: reloj["t"]))
    service.cache.set("daily_picks", parametros_lista_diaria("us_sp500"),
                      _lista([_senal("KO", 105.0, {"action": "mantener", "owned": True})]))
    reloj["t"] += timedelta(days=6)
    cartera, explorar = _pedir(session_factory, service, "/api/portfolio", EXPLORAR)

    assert explorar["estado"] == "viejo"
    for repaso in (cartera["repaso"], explorar["cartera"]):
        fila = repaso["posiciones"][0]
        assert (fila["estado"], fila["precio_estado"], fila["precio"]) == ("sin_comprobar", "viejo", 105.0)
    assert cartera["repaso"]["lista"]["estado"] == "viejo"
    # Sin cotización y sin un precio que lo perfore, la fila no sabe: None, no «intacto».
    assert cartera["positions"][0]["stop_perforado"] is None


def test_sin_lista_guardada_el_repaso_es_solo_con_la_cotizacion_y_lo_dice(session_factory):
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 10, 100.0, 118.0)
        s.commit()
    (cartera,) = _pedir(session_factory, Servicio(CacheStore(session_factory)), "/api/portfolio")
    repaso = cartera["repaso"]
    assert repaso["lista"] is None and repaso["senales"] == []
    assert (repaso["posiciones"][0]["estado"], repaso["posiciones"][0]["en_lista"]) == ("por_encima", False)


def test_un_fallo_del_repaso_no_cuesta_la_cartera_ni_se_calla(session_factory, monkeypatch):
    import app.contexto_cartera as cc

    def rompe(*_a, **_k):
        raise RuntimeError("caché ilegible")

    monkeypatch.setattr(cc, "stops_de_la_cartera", rompe)
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 10, 100.0, 118.0)
        s.commit()
    (cartera,) = _pedir(session_factory, Servicio(CacheStore(session_factory)), "/api/portfolio")
    assert cartera["repaso"]["abiertas"] is None and cartera["repaso"]["error"]
    # La fila sigue con su cotización: 120 por encima de 118.
    assert [p["symbol"] for p in cartera["positions"]] == ["KO"]
    assert cartera["positions"][0]["stop_perforado"] is False


def test_vencida_el_repaso_de_stops_no_da_por_encima_con_el_cierre_de_una_lista_de_hace_dias(con_reloj, session_factory):
    """La reproducción de la revisión 14 (carga, H1), en otro mercado: la lista
    guardada se servía con el bloque de precio de cuando se calculó, `valido`, y
    sin cotización el cierre de hace 6 días daba «por encima»."""
    c, service, reloj = con_reloj
    calculada = _completar(c, market="canada")
    senal = calculada["signals"][0]
    simbolo, cierre = senal["symbol"], senal["price"]["last"]
    with session_factory() as s:
        # Stop por debajo del cierre de la lista; el doble no da cotización.
        ex._posicion(s, ex._instrumento(s, simbolo, "Technology"), 10, cierre, cierre - 5)
        s.commit()

    reloj["t"] += timedelta(days=6)
    vieja = c.get(GUARDADA).json()
    assert vieja["estado"] == "viejo" and vieja["antiguedad_segundos"] == 6 * 24 * 3600
    fila = next(p for p in vieja["cartera"]["posiciones"] if p["symbol"] == simbolo)
    assert fila["estado"] == "sin_comprobar", (fila["estado"], fila["precio_estado"], fila["precio_fecha"])
