"""Un stop perforado se ve donde se mira la cartera (revisión 12, visual).

STOP cotizaba a 104 con el stop en 110: Hoy decía «nada urgente» (está fuera
del S&P 500, ver `test_today`) y el Portafolio pintaba su fila en verde, sin
columna de stop. La regla es una sola —la del motor, en o por debajo del stop—
y el Portafolio la sirve en cada fila.
"""

from __future__ import annotations

import pytest

from app.analysis.decision import stop_perforado
from app.analysis.risk_budget import riesgo_de_posicion
from app.cache.cache import CacheStore
from app.db.models import Instrument, Position
from app.main import app
from tests.test_cartera_revision9 import Servicio, _cliente


@pytest.mark.parametrize("precio,stop,esperado", [
    (104.0, 110.0, True), (110.0, 110.0, True), (110.01, 110.0, False),
    (None, 110.0, None), (104.0, None, None), (104.0, 0.0, None), (float("nan"), 110.0, None),
])
def test_la_regla_del_stop_es_una_sola(precio, stop, esperado):
    """El motor, el riesgo abierto y el repaso de Hoy preguntan lo mismo. Sin
    precio o sin stop, no se sabe: no es «intacto»."""
    assert stop_perforado(precio, stop) is esperado
    if esperado is not None:
        r = riesgo_de_posicion({"symbol": "X", "market_value": 1000.0, "stop": stop, "price": precio}, 10000.0)
        assert (r["nota"] is not None) is esperado


def test_cada_fila_del_portafolio_dice_si_su_stop_esta_perforado(session_factory):
    from datetime import datetime, timezone

    # El servicio cotiza a 120 en dólares: un stop en 125 está perforado, uno en
    # 120 también (en el stop exacto) y uno en 100 no. Sin stop ni coste, no se sabe.
    with session_factory() as s:
        for symbol, coste, stop in (("ALTO", 110.0, 125.0), ("JUSTO", 110.0, 120.0), ("BAJO", 110.0, 100.0),
                                    ("SPIN", 0.0, None)):
            inst = Instrument(symbol=symbol, name=symbol, sector="Tech", currency="USD")
            s.add(inst)
            s.flush()
            s.add(Position(instrument_id=inst.id, quantity=10, cost_basis=coste, stop=stop,
                           opened_at=datetime.now(timezone.utc)))
        s.commit()
    c = _cliente(session_factory, Servicio(CacheStore(session_factory)))
    try:
        filas = {p["symbol"]: p for p in c.get("/api/portfolio").json()["positions"]}
    finally:
        app.dependency_overrides.clear()
    assert {s: p["stop_perforado"] for s, p in filas.items()} == {
        "ALTO": True, "JUSTO": True, "BAJO": False, "SPIN": None}
