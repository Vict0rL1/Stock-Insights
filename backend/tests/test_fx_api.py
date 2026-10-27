"""La cartera con varias divisas, servida de verdad por `/api/portfolio`.

El módulo `fx` puede estar perfecto y no arreglar nada si el endpoint sigue
sumando los importes sin convertir. Lo que fijan estos tests es que el total que
llega a pantalla sea el convertido, y que lo que no se puede convertir quede
fuera y se diga.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.db.engine import get_session
from app.db.models import Instrument, Position
from app.deps import get_service
from app.main import app
from app.providers.base import DataNotFoundError, iso_utc
from tests.test_scan import FakeCache


class FakeService:
    def __init__(self, precios: dict[str, tuple[float, str]], con_fred=True):
        self.cache = FakeCache()
        self.precios = precios
        self.con_fred = con_fred
        self.llamadas: list[str] = []

    def get(self, data_type, **kw):
        self.llamadas.append(f"{data_type}:{kw.get('symbol') or kw.get('series_id', '')}")
        common = {"source": "fake", "as_of": iso_utc(), "cached": False}
        if data_type == "quote":
            sym = kw["symbol"]
            if sym not in self.precios:
                raise DataNotFoundError(f"sin cotización para {sym}")
            precio, moneda = self.precios[sym]
            return {**common, "symbol": sym, "price": precio, "currency": moneda,
                    "change": 0.0, "change_pct": 0.0, "prev_close": precio}
        if data_type == "macro":
            if not self.con_fred:
                raise DataNotFoundError("FRED no disponible")
            # DEXCAUS: dólares canadienses por UN dólar estadounidense.
            valores = {"DEXCAUS": "1.37", "DEXUSEU": "1.08"}
            sid = kw["series_id"]
            if sid not in valores:
                raise DataNotFoundError(f"serie {sid} no simulada")
            return {**common, "series_id": sid,
                    "points": [{"ts": "2026-09-11", "value": valores[sid]}]}
        if data_type == "profile":
            return {**common, "symbol": kw["symbol"], "name": kw["symbol"], "sector": "Tech"}
        raise AssertionError(f"tipo inesperado: {data_type}")


@pytest.fixture
def client(session_factory):
    def override_session():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    def _hacer(posiciones, **kw):
        service = FakeService(**kw)
        session = session_factory()
        for symbol, cantidad, coste in posiciones:
            inst = Instrument(symbol=symbol, name=symbol, sector="Tech")
            session.add(inst)
            session.flush()
            session.add(Position(instrument_id=inst.id, quantity=cantidad,
                                 cost_basis=coste, opened_at=datetime.now(timezone.utc)))
        session.commit()
        session.close()
        app.dependency_overrides[get_service] = lambda: service
        app.dependency_overrides[get_session] = override_session
        return TestClient(app), service

    yield _hacer
    app.dependency_overrides.clear()


def test_una_cartera_mezclada_ya_no_suma_manzanas_con_peras(client):
    """El bug entero: 100 USD + 137 CAD son 200 USD, no 237."""
    c, _ = client(
        [("AAPL", 1, 80.0), ("SHOP", 1, 100.0)],
        precios={"AAPL": (100.0, "USD"), "SHOP": (137.0, "CAD")},
    )
    r = c.get("/api/portfolio").json()

    assert r["summary"]["total_market_value"] == pytest.approx(200.0)
    assert r["summary"]["total_market_value"] != pytest.approx(237.0)
    assert r["divisas"]["mezcla_de_divisas"] is True
    assert r["divisas"]["base"] == "USD"


def test_los_pesos_tambien_salen_de_los_importes_convertidos(client):
    """De un total mal calculado cuelgan los pesos, la concentración y el
    presupuesto de riesgo: arreglar solo el total no arreglaba nada."""
    c, _ = client(
        [("AAPL", 1, 80.0), ("SHOP", 1, 100.0)],
        precios={"AAPL": (100.0, "USD"), "SHOP": (137.0, "CAD")},
    )
    pesos = {p["label"]: p["weight"] for p in c.get("/api/portfolio").json()["allocation_by_position"]}
    # 100 USD y 100 USD: mitad y mitad. Sin convertir daría 42 % / 58 %.
    assert pesos["AAPL"] == pytest.approx(0.5, abs=0.001)
    assert pesos["SHOP"] == pytest.approx(0.5, abs=0.001)


def test_una_cartera_de_una_sola_divisa_no_cambia_de_comportamiento(client):
    c, service = client(
        [("AAPL", 2, 80.0), ("MSFT", 1, 300.0)],
        precios={"AAPL": (100.0, "USD"), "MSFT": (400.0, "USD")},
    )
    r = c.get("/api/portfolio").json()
    assert r["summary"]["total_market_value"] == pytest.approx(600.0)
    assert r["divisas"]["mezcla_de_divisas"] is False
    # Y no se ha pedido ni un tipo de cambio: no hay nada que convertir.
    assert not [x for x in service.llamadas if x.startswith("macro")]


def test_sin_tipo_de_cambio_la_posicion_queda_fuera_del_total_y_se_dice(client):
    """Inventar una paridad sería exactamente el error que esto evita."""
    c, _ = client(
        [("AAPL", 1, 80.0), ("SHOP", 1, 100.0)],
        precios={"AAPL": (100.0, "USD"), "SHOP": (137.0, "CAD")},
        con_fred=False,
    )
    r = c.get("/api/portfolio").json()

    assert r["summary"]["total_market_value"] == pytest.approx(100.0)
    assert r["divisas"]["sin_convertir"][0]["symbol"] == "SHOP"
    assert "1 posición queda FUERA del total" in r["note"]
    # Pero la posición sigue visible en la tabla, con su motivo.
    shop = next(p for p in r["positions"] if p["symbol"] == "SHOP")
    assert shop["market_value_base"] is None
    assert "SHOP" not in [p["label"] for p in r["allocation_by_position"]]


def test_solo_se_pide_un_tipo_por_divisa_presente(client):
    """FRED es gratis, pero pedir series que nadie usa sigue siendo ruido."""
    c, service = client(
        [("AAPL", 1, 80.0), ("SHOP", 1, 100.0), ("BB", 1, 5.0)],
        precios={"AAPL": (100.0, "USD"), "SHOP": (137.0, "CAD"), "BB": (10.0, "CAD")},
    )
    c.get("/api/portfolio")
    macros = [x for x in service.llamadas if x.startswith("macro")]
    assert macros == ["macro:DEXCAUS"], f"esperaba una sola serie, hubo {macros}"


def test_la_nota_dice_que_divisas_hay_y_cuanto_pesa_cada_una(client):
    c, _ = client(
        [("AAPL", 1, 80.0), ("SHOP", 2, 100.0)],
        precios={"AAPL": (100.0, "USD"), "SHOP": (137.0, "CAD")},
    )
    d = c.get("/api/portfolio").json()["divisas"]
    assert d["monedas"] == {"CAD": 200.0, "USD": 100.0}
    assert d["tipos_usados"]["CAD"]["serie"] == "DEXCAUS"
    assert d["tipos_usados"]["CAD"]["por_usd"] == pytest.approx(1.37)


def test_una_posicion_en_peniques_no_tumba_la_cartera_y_queda_fuera_del_total(client):
    """Auditoría del 19 oct: `fx.normalizar("GBX")` lanzaba al reunir las monedas
    y `/api/portfolio` daba un 500. La fila se ve, fuera del total, con su motivo;
    no se supone que un penique sea una libra."""
    c, service = client(
        [("VOD.L", 100, 70.0), ("AAPL", 10, 90.0)],
        precios={"VOD.L": (72.0, "GBX"), "AAPL": (100.0, "USD")},
    )
    r = c.get("/api/portfolio")
    assert r.status_code == 200, r.text
    d = r.json()
    fila = next(p for p in d["positions"] if p["symbol"] == "VOD.L")
    assert fila["market_value_base"] is None and "céntimos" in fila["sin_convertir"]
    assert d["summary"]["total_market_value"] == pytest.approx(1000.0)
    assert not [x for x in service.llamadas if x.startswith("macro")]


def test_el_contexto_de_cartera_dice_que_son_peniques_no_moneda_desconocida(client, session_factory):
    from app import contexto_cartera

    _, service = client([("VOD.L", 100, 70.0)], precios={"VOD.L": (72.0, "GBX")})
    with session_factory() as s:
        ctx = contexto_cartera.construir(s, service)
    assert ctx["total_usd"] is None
    assert "céntimos" in ctx["sin_peso"][0]["motivo"]


def _dos_lotes(session_factory, symbol, lotes, cerrada=None, moneda=None):
    """Varios lotes del mismo símbolo (un solo instrumento) y, si se pide, una
    cerrada `(cantidad, coste, pnl)`. `moneda`, la que el instrumento aprendió
    de las cotizaciones mientras estuvo abierto."""
    with session_factory() as s:
        inst = Instrument(symbol=symbol, name=symbol, sector="Tech", currency=moneda)
        s.add(inst)
        s.flush()
        for cantidad, coste in lotes:
            s.add(Position(instrument_id=inst.id, quantity=cantidad, cost_basis=coste,
                           opened_at=datetime.now(timezone.utc)))
        if cerrada:
            cantidad, coste, pnl = cerrada
            s.add(Position(instrument_id=inst.id, quantity=cantidad, cost_basis=coste, realized_pnl=pnl,
                           opened_at=datetime(2026, 1, 5, tzinfo=timezone.utc),
                           closed_at=datetime(2026, 6, 1, tzinfo=timezone.utc)))
        s.commit()


def test_el_gbp_de_yahoo_son_peniques_no_libras(client, session_factory):
    """Revisión de A3: yfinance da «GBp» para Londres; pasado a mayúsculas era
    «GBP» y la posición se convertía como libras, cien veces su valor."""
    from app import validacion

    assert validacion.validar("quote", {"price": 72.0, "currency": "GBp"})["currency"] == "GBX"
    assert validacion.validar("quote", {"price": 72.0, "currency": " gbp "})["currency"] == "GBP"
    c, _ = client([("VOD.L", 100, 70.0), ("AAPL", 10, 90.0)],
                  precios={"VOD.L": (72.0, "GBp"), "AAPL": (100.0, "USD")})
    d = c.get("/api/portfolio").json()
    fila = next(p for p in d["positions"] if p["symbol"] == "VOD.L")
    assert fila["currency"] == "GBX" and "céntimos de GBP" in fila["sin_convertir"]
    assert d["summary"]["total_market_value"] == pytest.approx(1000.0)
    with session_factory() as s:
        assert s.query(Instrument).filter_by(symbol="VOD.L").one().currency == "GBX"


def test_una_fila_en_peniques_cuenta_como_otra_divisa(client):
    """Revisión de A3: sin su código en `sin_convertir`, la nota decía «Toda la
    cartera está en USD» y los importes en peniques salían sin código."""
    c, _ = client([("VOD.L", 100, 70.0), ("AAPL", 10, 90.0)],
                  precios={"VOD.L": (72.0, "GBX"), "AAPL": (100.0, "USD")})
    d = c.get("/api/portfolio").json()["divisas"]
    assert d["mezcla_de_divisas"] is True
    assert d["sin_convertir"][0]["moneda"] == "GBX"
    assert not d["nota"].startswith("Toda la cartera")


def test_dos_lotes_en_peniques_salen_los_dos_una_vez(client, session_factory):
    """Revisión de A3: las filas sin convertir se reponían por símbolo, así que
    el primer lote salía dos veces y el segundo no se podía cerrar."""
    c, _ = client([], precios={"VOD.L": (72.0, "GBX")})
    _dos_lotes(session_factory, "VOD.L", [(100, 70.0), (50, 71.0)])
    filas = [p for p in c.get("/api/portfolio").json()["positions"] if p["symbol"] == "VOD.L"]
    assert len({p["id"] for p in filas}) == 2
    assert sorted(p["quantity"] for p in filas) == [50, 100]


def test_una_cerrada_en_peniques_dice_por_que_no_entra(client, session_factory):
    """Revisión de A3: salía «moneda desconocida», cuando se sabe que es GBX."""
    c, service = client([], precios={"VOD.L": (72.0, "GBX")})
    _dos_lotes(session_factory, "VOD.L", [], cerrada=(100, 70.0, 200.0), moneda="GBX")
    d = c.get("/api/portfolio").json()
    cerrada = d["closed_positions"][0]
    assert cerrada["currency"] == "GBX" and "céntimos" in cerrada["sin_convertir"]
    assert d["summary"]["realizado_sin_convertir"] == ["VOD.L"]
    assert not [x for x in service.llamadas if x.startswith("macro")]


def test_el_motivo_no_pide_una_correccion_que_la_app_no_permite():
    from app.analysis import fx

    with pytest.raises(fx.SinTipo) as exc:
        fx.normalizar("GBX")
    assert "Corrige" not in str(exc.value) and "fuera de los totales" in str(exc.value)


def test_con_toda_la_cartera_en_peniques_riesgo_y_curva_dicen_por_que(client):
    """Revisión 3: Riesgo decía «Ninguna posición tiene precio» y la curva pedía
    descargar histórico, cuando lo que pasa es que no se pueden convertir."""
    from app.analysis.historial import historial
    from datetime import date

    c, _ = client([("VOD.L", 100, 70.0)], precios={"VOD.L": (72.0, "GBp")})
    r = c.get("/api/portfolio/riesgo").json()
    assert r["disponible"] is False and "céntimos de GBP" in r["nota"] and "tiene precio" not in r["nota"]
    assert r["sin_convertir"][0]["symbol"] == "VOD.L"
    curva = historial([{"symbol": "VOD.L", "quantity": 100, "cost_basis": 70.0, "currency": "GBX",
                        "opened_at": date(2026, 1, 2), "closed_at": None}],
                      {"VOD.L": [(date(2026, 1, 2), 70.0), (date(2026, 1, 5), 71.0)]}, hoy=date(2026, 1, 6))
    assert "en céntimos (GBX)" in curva["nota"] and "Descargar histórico" not in curva["nota"]
