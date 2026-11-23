"""El repaso de stops de Hoy dice lo mismo que el Portafolio (revisión 13).

La revisión encontró, y reprodujo, que el repaso de la duodécima miraba otra
cosa que el Portafolio: el último cierre de la lista en vez de la cotización,
un precio viejo como si fuera bueno, el stop agregado de los lotes en vez del
de cada uno, y una lista cacheada con otra cartera sin decirlo. Un test por
cada defecto; todos fallan sin el arreglo.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.cache.cache import CacheStore, MarketDataService
from app.contexto_cartera import stops_de_la_cartera
from app.db.models import CashBalance, Instrument, Position
from app.main import app
from app.providers.base import ProviderError, iso_utc
from app.providers.router import DataRouter, RateLimiter
from tests.fixtures import extremos as ex
from tests.test_cartera_revision9 import Servicio, _cliente
from tests.test_today import _completar, client  # noqa: F401 — `client` es un fixture

HOY = "/api/signals/today?market=us_sp500&budget=600"


def _cotiza(service, precios: dict[str, float], *, estado: str = "valido", hace_min: int = 0) -> None:
    """El doble de Hoy no cotiza nada: aquí sí, con fuente, fecha y estado."""
    original = service.get

    def get(data_type, **kw):
        if data_type == "quote" and kw.get("symbol") in precios:
            return {"symbol": kw["symbol"], "price": precios[kw["symbol"]], "currency": "USD", "source": "finnhub",
                    "as_of": iso_utc(datetime.now(timezone.utc) - timedelta(minutes=hace_min)), "estado": estado,
                    **({"antiguedad_segundos": hace_min * 60} if estado == "viejo" else {})}
        return original(data_type, **kw)

    service.get = get


def _fila(data: dict, symbol: str) -> dict:
    return next(p for p in data["cartera"]["posiciones"] if p["symbol"] == symbol)


def test_el_repaso_usa_la_cotizacion_como_el_portafolio_y_no_cambia_con_el_mercado(client, session_factory):
    """KO a 112 con el stop en 116: el Portafolio decía perforado y Hoy «por
    encima», con el último cierre de la lista (117, de hasta 12 h); en NASDAQ,
    donde KO no está, perforado. La misma posición, dos estados."""
    c, service = client
    ultimo = next(s for s in _completar(c)["signals"] if s["symbol"] == "KO")["price"]["last"]
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 10, ultimo + 5, ultimo - 1)
        s.commit()
    _cotiza(service, {"KO": ultimo - 5}, hace_min=2)

    ko = _fila(c.get(HOY).json(), "KO")
    assert ko["en_lista"] is True
    assert (ko["estado"], ko["precio"], ko["stop"]) == ("perforado", ultimo - 5, ultimo - 1)
    assert (ko["precio_fuente"], ko["precio_proveedor"], ko["precio_estado"]) == ("cotizacion", "finnhub", "valido")
    assert ko["precio_fecha"] and ko["precios"][1] == {
        "precio": ultimo, "fuente": "cierre_de_la_lista", "estado": "valido", "proveedor": "fake",
        "fecha": ko["precios"][1]["fecha"]}
    portafolio = next(p for p in c.get("/api/portfolio").json()["positions"] if p["symbol"] == "KO")
    assert portafolio["stop_perforado"] is True and portafolio["price"] == ko["precio"]
    otro = _fila(c.get("/api/signals/today?market=nasdaq&budget=600").json(), "KO")
    assert (otro["en_lista"], otro["estado"], otro["precio"]) == (False, "perforado", ko["precio"])


def test_fail_safe_lo_perfora_cualquiera_de_los_precios(session_factory):
    """La cotización (120) por encima del stop y el último cierre de la lista
    (117) en él o por debajo: se avisa, con el precio que lo perfora y los dos."""
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 10, 100.0, 118.0)
        s.commit()
    senal = {"symbol": "KO", "price": {"last": 117.0, "estado": "valido", "source": "yfinance", "as_of": iso_utc()},
             "decision": {"owned": True}}
    with session_factory() as s:
        ko = stops_de_la_cartera(s, Servicio(CacheStore(session_factory)), [senal])["posiciones"][0]
    assert (ko["estado"], ko["precio"], ko["precio_fuente"]) == ("perforado", 117.0, "cierre_de_la_lista")
    assert [(p["fuente"], p["precio"]) for p in ko["precios"]] == [("cotizacion", 120.0), ("cierre_de_la_lista", 117.0)]


def test_un_precio_viejo_por_encima_del_stop_no_es_nada_urgente(client, session_factory):
    """Rescatado de la caché hace 25 min, a 104 con el stop en 100: decía
    «por encima» y la tarjeta, «nada urgente». STALE no pasa por PASS. Por debajo
    del stop sí avisa (fail-safe), diciendo que es viejo."""
    c, service = client
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "STOP", "Technology"), 50, 90.0, 100.0)
        ex._posicion(s, ex._instrumento(s, "BAJO", "Technology"), 50, 90.0, 100.0)
        s.commit()
    _cotiza(service, {"STOP": 104.0, "BAJO": 99.0}, estado="viejo", hace_min=25)
    data = _completar(c)
    stop, bajo = _fila(data, "STOP"), _fila(data, "BAJO")
    assert (stop["estado"], stop["precio"], stop["precio_estado"]) == ("sin_comprobar", 104.0, "viejo")
    assert stop["motivo"].startswith("solo hay un precio viejo (la cotización, hace 25 min)")
    assert (bajo["estado"], bajo["precio_estado"]) == ("perforado", "viejo")


def test_con_varios_lotes_el_stop_es_el_de_cada_lote_como_en_el_portafolio(session_factory):
    """Un lote con stop fijado en 95 y otro viejo, sin stop y coste 150, a 120:
    el Portafolio da el segundo perforado (125,25, recalculado desde su coste) y
    Hoy decía «por encima» con el 95 del otro, el más alto de los FIJADOS."""
    with session_factory() as s:
        inst = Instrument(symbol="MIX", name="MIX", sector="Tech", currency="USD")
        s.add(inst)
        s.flush()
        for coste, stop in ((100.0, 95.0), (150.0, None)):
            s.add(Position(instrument_id=inst.id, quantity=10, cost_basis=coste, stop=stop,
                           opened_at=datetime.now(timezone.utc)))
        s.commit()
    service = Servicio(CacheStore(session_factory))
    c = _cliente(session_factory, service)
    try:
        lotes = c.get("/api/portfolio").json()["positions"]
    finally:
        app.dependency_overrides.clear()
    with session_factory() as s:
        mix = stops_de_la_cartera(s, service, [])["posiciones"][0]
    assert [lote["stop_perforado"] for lote in lotes] == [False, True]
    assert mix["estado"] == "perforado" and mix["stop"] == max(lote["stop"] for lote in lotes) == 125.25
    assert (mix["lotes"], mix["lotes_recalculados"], mix["lotes_por_clase"], mix["lotes_sin_stop"]) == (2, 1, 1, 0)
    assert (mix["stop_fijado_al_abrir"], mix["stop_por_clase"]) == (False, True)


def test_un_lote_de_la_lista_sin_stop_se_recalcula_desde_su_coste(session_factory):
    """En la lista, el repaso tomaba el stop de la decisión: sin `levels` (la que
    deja `_decision_segura` si el motor falla) decía «sin stop» con coste 120, y
    con ellos, `stop_por_clase` siempre False aunque fuera el punto medio."""
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 10, 120.0, None)
        s.commit()
    senal = {"symbol": "KO", "price": {"last": 130.0, "estado": "valido"},
             "decision": {"action": "sin_datos", "owned": True, "levels": None}}
    with session_factory() as s:
        ko = stops_de_la_cartera(s, Servicio(CacheStore(session_factory)), [senal])["posiciones"][0]
    assert (ko["estado"], ko["stop"], ko["motivo"]) == ("por_encima", 100.2, None)
    assert (ko["stop_fijado_al_abrir"], ko["stop_por_clase"], ko["lotes_recalculados"]) == (False, True, 1)


def test_con_las_fuentes_caidas_el_fallo_de_la_cotizacion_se_recuerda_un_minuto(session_factory):
    """Cada petición de Hoy repetía, por posición, tres intentos por fuente con
    3 s de espera por fuente: 27 llamadas y 27 s con tres posiciones, y la
    pantalla encadena hasta cinco peticiones por carga."""
    llamadas, esperas = [], []

    class Caido:
        capabilities = {"quote"}

        def fetch(self, data_type, **kw):
            llamadas.append(kw.get("symbol"))
            raise ProviderError("timeout")

    reloj = {"t": datetime(2026, 11, 23, 15, 0, tzinfo=timezone.utc)}
    store = CacheStore(session_factory, now=lambda: reloj["t"])
    router = DataRouter({n: Caido() for n in ("finnhub", "twelvedata", "yfinance")},
                        RateLimiter(session_factory), sleep=esperas.append)
    service = MarketDataService(router, store)
    with session_factory() as s:
        for symbol in ("STOP", "SHOP.TO", "VOD.L"):
            ex._posicion(s, ex._instrumento(s, symbol, "Technology"), 10, 100.0, 90.0)
        s.commit()

    def repasar():
        with session_factory() as s:
            return {p["symbol"]: p["estado"] for p in stops_de_la_cartera(s, service, [])["posiciones"]}

    assert set(repasar().values()) == {"sin_comprobar"}
    assert (len(llamadas), sum(esperas)) == (27, 27.0)
    # Las pasadas que siguen, dentro del minuto: ni una llamada, y sigue sin comprobar.
    reloj["t"] += timedelta(seconds=50)
    assert set(repasar().values()) == {"sin_comprobar"}
    assert (len(llamadas), sum(esperas)) == (27, 27.0)
    # Lo que haya llegado a la caché entretanto se sirve antes que el fallo recordado.
    store.set("quote", {"symbol": "STOP"}, {"symbol": "STOP", "price": 80.0, "currency": "USD", "source": "otra"})
    assert repasar()["STOP"] == "perforado" and len(llamadas) == 27
    # Pasado el minuto se vuelve a preguntar por las que no tienen copia (el
    # limitador de llamadas ya salta alguna fuente: no se cuentan exactas).
    reloj["t"] += timedelta(seconds=11)
    repasar()
    nuevas = llamadas[27:]
    assert nuevas and set(nuevas) == {"SHOP.TO", "VOD.L"}


def test_la_lista_cacheada_con_otra_cartera_lo_dice(client, session_factory):
    """La lista se cachea 6 h con la cartera de cuando se puntuó (M3, sin
    cambiar) y el repaso es de ahora: una posición abierta después no salía en
    «Mi cartera» ni en «Fuera de la lista», y la nota del tamaño decía «no tienes
    posiciones abiertas» junto a un repaso que sí las tenía. Ahora la lista
    guarda su huella y Hoy dice qué cambió desde entonces."""
    c, _ = client
    assert _completar(c)["lista_desfasada"] is None
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 300, 58.0, 50.0)
        s.commit()
    data = c.get(HOY).json()
    assert data["cached"] is True and _fila(data, "KO")["en_lista"] is True
    assert data["lista_desfasada"] == {"abiertas": ["KO"], "cerradas": [], "cambiadas": [], "efectivo": False}
    # La huella (cantidades y costes de cuando se puntuó) se queda en la caché:
    # la pantalla lee lo que cambió, y servirla solo engordaba la respuesta.
    assert "huella_cartera" not in data
    # Recalculada, ya es la de ahora.
    assert c.get(HOY + "&refresh=true").json()["lista_desfasada"] is None

    with session_factory() as s:
        lote = s.query(Position).one()
        lote.stop = 55.0
        s.add(CashBalance(moneda="USD", importe=1000.0, as_of=datetime.now(timezone.utc) - timedelta(minutes=1),
                          registrado_en=datetime.now(timezone.utc) - timedelta(minutes=1)))
        s.commit()
    cambios = c.get(HOY).json()["lista_desfasada"]
    assert (cambios["cambiadas"], cambios["efectivo"]) == (["KO"], True)
    with session_factory() as s:
        s.query(Position).one().closed_at = datetime.now(timezone.utc)
        s.commit()
    assert c.get(HOY).json()["lista_desfasada"]["cerradas"] == ["KO"]
