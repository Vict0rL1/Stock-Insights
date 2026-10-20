"""Auditoría del 19 oct, hallazgo 1: el redondeo a dos decimales se comía el stop.

El stop de la posición se redondeaba a dos decimales ANTES de compararlo con el
precio. Con coste 0,005, stop guardado 0,004 y precio 0,003, la regla
preguntaba «0,003 ≤ 0,0» y la posición salía «mantener» con el stop perforado;
y su distancia, «−100 %». Lo mismo pasaba en la fuente (Yahoo servía el último
cierre redondeado: 0,003 era 0 y el motor decía «sin precio»), en los niveles de
compra (entrada 0,00–0,00, stop 0,00) y en el stop guardado al abrir (0,0 =
«sin stop»).

Ahora se compara con el valor sin redondear y solo se redondea lo que se sirve,
con `datos.redondear_precio` (dos decimales desde 1, cuatro cifras
significativas por debajo).
"""

from __future__ import annotations

import re

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import datos
from app.analysis.decision import decide
from app.db.engine import get_session
from app.db.models import Position
from app.deps import get_service
from app.formato import fmt_precio
from app.main import app
from app.providers.base import DataNotFoundError, iso_utc
from app.providers.yfinance_provider import _price_summary


def señal(score):
    return {"symbol": "CENT", "score": score}


def precio(last, sma200, vol=1.2):
    return {"last": last, "sma200": sma200, "above_sma200": last > sma200, "daily_vol_pct": vol}


def test_el_caso_de_la_auditoria_vende_con_el_stop_perforado():
    d = decide(señal(0.8), precio(0.003, 0.002), {"cost_basis": 0.005, "stop": 0.004})
    assert d["action"] == "vender"
    decisiva = next(r for r in d["reglas"] if r["papel"] == "decide")
    assert decisiva["id"] == "stop_perforado"
    assert decisiva["datos"]["umbral"] == 0.004
    # El stop está POR ENCIMA del precio: la distancia es positiva, no «−100 %».
    assert d["levels"]["stop"] == 0.004
    assert d["levels"]["stop_pct"] == pytest.approx(33.3)
    assert "Vender si cierra por debajo de 0,004" in d["triggers"]
    assert any("(0,003) perforó el stop de la posición (0,004)" in r for r in d["reasons"])
    distancias = [c["distancia"] for g in d["cambiaria"] for c in g["condiciones"] if c["regla"] == "stop_perforado"]
    assert distancias and all(x == pytest.approx(33.33) for x in distancias)


def test_un_stop_guardado_con_tres_decimales_tambien_se_compara_entero():
    # También por encima de 1: el stop de 92,004 redondeado era 92,00, y un
    # precio de 92,002 —ya por debajo del stop guardado— salía «mantener».
    d = decide(señal(0.8), precio(92.002, 60.0), {"cost_basis": 100.0, "stop": 92.004})
    assert d["action"] == "vender"


@pytest.mark.parametrize("p", [1e-8, 3e-5, 0.003, 0.25, 0.9, 1.0, 7.5, 150.0, 1e5])
def test_los_niveles_de_compra_son_positivos_y_ordenados_en_cualquier_magnitud(p):
    d = decide(señal(0.8), precio(p, p / 2))
    assert d["action"] == "comprar"
    n = d["levels"]
    assert 0 < n["stop"] < n["entrada_desde"] < n["entrada_hasta"] < n["objetivo"]
    # Los disparadores dicen esas mismas cifras, no «0,00».
    assert f"Comprar entre {fmt_precio(n['entrada_desde'])} y {fmt_precio(n['entrada_hasta'])}" in d["triggers"]
    assert not any(re.search(r"(?<![\d.])0,00(?!\d)", t) for t in d["triggers"])


@pytest.mark.parametrize("coste", [1e-8, 0.003, 0.5, 150.0])
def test_el_stop_recalculado_de_una_posicion_queda_bajo_el_coste_y_sobre_cero(coste):
    d = decide(señal(0.8), precio(coste * 1.5, coste), {"cost_basis": coste})
    n = d["levels"]
    assert 0 < n["stop"] < coste < n["objetivo"]
    assert d["action"] == "mantener"


def test_redondear_precio_da_lo_de_siempre_desde_1_y_cifras_significativas_debajo():
    assert datos.redondear_precio(150.126) == round(150.126, 2)
    assert datos.redondear_precio(0.0045678) == 0.004568
    assert datos.redondear_precio(1e-8) == 1e-8
    assert datos.redondear_precio(None) is None
    assert datos.redondear_precio(float("nan")) is None


def test_yahoo_no_convierte_en_cero_el_precio_de_una_accion_de_centimos():
    resumen = _price_summary(pd.Series([0.004, 0.0035] * 110 + [0.003], dtype="float64"))
    assert resumen["last"] == 0.003
    assert resumen["low_52w"] == 0.003 and resumen["high_52w"] == 0.004
    assert resumen["sma200"] is not None and resumen["sma200"] > 0
    assert all(v > 0 for v in resumen["spark"])


class _Servicio:
    """Lo justo para abrir una posición: cotización y perfil, sin histórico."""

    cache = None

    def get(self, data_type, **kw):
        if data_type == "quote":
            return {"source": "fake", "as_of": iso_utc(), "symbol": kw["symbol"], "price": 0.00006, "currency": "USD"}
        if data_type == "profile":
            return {"symbol": kw["symbol"], "name": "Céntimos SA", "sector": "Tech", "currency": "USD"}
        raise DataNotFoundError(f"sin {data_type}")


@pytest.fixture
def cliente(session_factory):
    def sesion():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_service] = lambda: _Servicio()
    app.dependency_overrides[get_session] = sesion
    yield TestClient(app), session_factory
    app.dependency_overrides.clear()


def test_el_stop_fijado_al_abrir_una_posicion_de_centimos_no_se_guarda_como_cero(cliente):
    # Con `round(…, 4)`, 0,00005 × (1 − 16,5 %) se guardaba como 0,0: la posición
    # quedaba «sin stop guardado» y se recalculaba cada día.
    c, factory = cliente
    r = c.post("/api/portfolio/positions", json={"symbol": "CENT", "quantity": 1000, "cost_basis": 0.00005})
    assert r.status_code == 200, r.text
    with factory() as s:
        stop = s.get(Position, r.json()["id"]).stop
    assert stop is not None and 0 < stop < 0.00005
    pos = c.get("/api/portfolio").json()["positions"][0]
    assert pos["stop"] == stop and pos["stop_fijado_al_abrir"] is True
