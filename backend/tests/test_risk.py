"""Tests de métricas de riesgo contra valores construidos a mano."""

import math

import pandas as pd
import pytest

from app.analysis.risk import annualized_volatility, beta, daily_returns, max_drawdown


def test_daily_returns_calculados_a_mano():
    closes = pd.Series([100.0, 110.0, 99.0])
    returns = daily_returns(closes)
    assert returns.iloc[0] == pytest.approx(0.10)
    assert returns.iloc[1] == pytest.approx(-0.10)


def test_beta_de_un_activo_apalancado_es_2():
    # El activo replica exactamente 2× el benchmark → beta = 2 por definición.
    bench = pd.Series([0.01, -0.02, 0.015, 0.005, -0.01] * 8)
    asset = bench * 2
    assert beta(asset, bench) == pytest.approx(2.0)


def test_beta_sin_datos_suficientes_es_none():
    assert beta(pd.Series([0.01] * 5), pd.Series([0.01] * 5)) is None


def test_volatilidad_anualizada_a_mano():
    returns = pd.Series([0.01, -0.01] * 15)  # 30 retornos alternos
    expected = returns.std(ddof=1) * math.sqrt(252)
    assert annualized_volatility(returns) == pytest.approx(float(expected))
    assert annualized_volatility(pd.Series([0.01] * 5)) is None  # muy pocos datos


def test_max_drawdown_calculado_a_mano():
    # Pico 120 → valle 84: drawdown = 84/120 − 1 = −30 %.
    closes = pd.Series(
        [100.0, 120.0, 110.0, 84.0, 95.0],
        index=["d1", "d2", "d3", "d4", "d5"],
    )
    result = max_drawdown(closes)
    assert result["max_drawdown"] == pytest.approx(-0.30)
    assert result["peak"] == "d2"
    assert result["trough"] == "d4"


def test_max_drawdown_serie_alcista_es_cero():
    closes = pd.Series([100.0, 101.0, 102.0])
    assert max_drawdown(closes)["max_drawdown"] == pytest.approx(0.0)


def test_max_drawdown_tolera_fechas_duplicadas():
    # Un proveedor puede devolver dos barras con la misma fecha. Con
    # indexación por etiqueta esto rompía el cálculo.
    closes = pd.Series(
        [100.0, 120.0, 80.0, 90.0], index=["d1", "d1", "d2", "d2"]
    )
    result = max_drawdown(closes)
    assert result["max_drawdown"] == pytest.approx(-1 / 3)  # 80/120 − 1


# --- Revisión 12, visual: la ventana de las métricas de riesgo ---------------
#
# El endpoint rotulaba «1Y (barras diarias)», fijo y en inglés: no decía desde
# cuándo había serie (la de ACME, desde el 26 dic 2025) ni marcaba «parcial» un
# histórico de menos de un año bajo beta y drawdown «(1A)».


def test_ventana_dice_cuantas_sesiones_hay_y_si_es_parcial():
    from app.analysis.risk import ventana

    closes = pd.Series([1.0, 2.0, 3.0], index=["2025-12-26", "2025-12-29", "2025-12-30"])
    assert ventana(closes, 252) == {
        "sesiones": 3, "pedidas": 252, "desde": "2025-12-26", "hasta": "2025-12-30", "parcial": True,
    }
    assert ventana(closes, 3)["parcial"] is False
    vacia = ventana(pd.Series([], dtype=float), 252)
    assert vacia["sesiones"] == 0 and vacia["desde"] is None and vacia["parcial"] is True


@pytest.mark.parametrize("n, sesiones, parcial", [(180, 180, True), (300, 252, False)])
def test_el_endpoint_de_riesgo_declara_la_ventana_medida(session_factory, n, sesiones, parcial):
    from datetime import timedelta

    from fastapi.testclient import TestClient

    from app.deps import get_service
    from app.main import app
    from tests.fakes_empresa import AHORA, ServicioFalso, barras

    servicio = ServicioFalso(AHORA).empresa("ACME")
    hasta = AHORA.date() - timedelta(days=1)
    servicio.historias["ACME"] = barras(hasta, n=n)
    app.dependency_overrides[get_service] = lambda: servicio
    try:
        r = TestClient(app).get("/api/stocks/ACME/risk").json()
    finally:
        app.dependency_overrides.clear()
    assert "window" not in r  # el rótulo fijo en inglés ya no viaja
    v = r["ventana"]
    assert (v["sesiones"], v["pedidas"], v["parcial"]) == (sesiones, 252, parcial)
    assert v["hasta"] == hasta.isoformat()
    assert v["desde"] == (hasta - timedelta(days=sesiones - 1)).isoformat()
