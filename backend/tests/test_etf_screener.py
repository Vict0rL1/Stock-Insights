"""Tests de solapamiento de ETFs y de la lógica del screener."""

import pytest

from app.analysis.etf import overlap_weight
from app.analysis.screener import DEFAULT_PRESETS, evaluate_filters


# ---------------------------------------------------------------------------
# Solapamiento de ETFs
# ---------------------------------------------------------------------------


def test_solapamiento_calculado_a_mano():
    # Comunes: AAPL min(0.07, 0.05)=0.05; MSFT min(0.06, 0.08)=0.06.
    # NVDA y AMZN no se comparten. Total = 0.11.
    a = [
        {"symbol": "AAPL", "weight": 0.07},
        {"symbol": "MSFT", "weight": 0.06},
        {"symbol": "NVDA", "weight": 0.05},
    ]
    b = [
        {"symbol": "AAPL", "weight": 0.05},
        {"symbol": "MSFT", "weight": 0.08},
        {"symbol": "AMZN", "weight": 0.04},
    ]
    result = overlap_weight(a, b)
    assert result["overlap_weight"] == pytest.approx(0.11)
    assert result["shared_count"] == 2
    # Ordenado por peso compartido descendente: MSFT (0.06) antes que AAPL (0.05).
    assert [c["symbol"] for c in result["common_holdings"]] == ["MSFT", "AAPL"]


def test_solapamiento_identico_es_suma_de_pesos():
    holdings = [{"symbol": "SPY", "weight": 0.5}, {"symbol": "QQQ", "weight": 0.3}]
    result = overlap_weight(holdings, holdings)
    assert result["overlap_weight"] == pytest.approx(0.8)


def test_sin_solapamiento():
    a = [{"symbol": "AAPL", "weight": 0.1}]
    b = [{"symbol": "XOM", "weight": 0.1}]
    result = overlap_weight(a, b)
    assert result["overlap_weight"] == 0.0
    assert result["common_holdings"] == []


def test_solapamiento_tolera_pesos_ausentes():
    a = [{"symbol": "AAPL", "weight": None}, {"symbol": "MSFT", "weight": 0.1}]
    b = [{"symbol": "AAPL", "weight": 0.2}, {"symbol": "MSFT", "weight": 0.05}]
    result = overlap_weight(a, b)
    assert result["overlap_weight"] == pytest.approx(0.05)  # AAPL cuenta como 0


# ---------------------------------------------------------------------------
# Screener
# ---------------------------------------------------------------------------


def test_filtros_gte_y_lte():
    metrics = {"pe_ttm": 15.0, "roe": 0.18}
    result = evaluate_filters(
        metrics, {"pe_ttm": {"op": "lte", "value": 18}, "roe": {"op": "gte", "value": 0.10}}
    )
    assert result["passes"] is True
    assert all(c["passed"] for c in result["checks"])


def test_un_filtro_fallido_reprueba_y_queda_registrado():
    metrics = {"pe_ttm": 30.0, "roe": 0.18}
    result = evaluate_filters(
        metrics, {"pe_ttm": {"op": "lte", "value": 18}, "roe": {"op": "gte", "value": 0.10}}
    )
    assert result["passes"] is False
    fallido = next(c for c in result["checks"] if c["metric"] == "pe_ttm")
    assert fallido["passed"] is False
    assert fallido["actual"] == 30.0  # la UI puede explicar POR QUÉ falló


def test_dato_ausente_nunca_aprueba():
    # Sin P/E no se puede afirmar que sea barata: el filtro falla, no se ignora.
    result = evaluate_filters({"roe": 0.20}, {"pe_ttm": {"op": "lte", "value": 18}})
    assert result["passes"] is False
    assert result["checks"][0]["actual"] is None


def test_un_dato_ausente_no_es_un_suspenso():
    """Revisión 12, visual: XOM (P/E 12, deuda/capital 0,4, ROE 19 %) salía
    «No pasa» con el ratio corriente en rojo solo porque faltaba ese dato. Sin
    dato no aprueba (`passes` False), pero tampoco suspende: queda sin comprobar."""
    preset = next(p for p in DEFAULT_PRESETS if p["name"].startswith("Value"))
    r = evaluate_filters({"pe_ttm": 12.0, "debt_to_equity": 0.4, "roe": 0.19}, preset["filters"])
    assert r["passes"] is False
    assert r["estado"] == "sin_comprobar"
    sin = next(c for c in r["checks"] if c["metric"] == "current_ratio")
    assert sin["estado"] == "sin_dato" and sin["passed"] is False and sin["actual"] is None
    assert {c["estado"] for c in r["checks"] if c["metric"] != "current_ratio"} == {"pasa"}
    # Un NaN tampoco es un dato: compararlo daba False y salía como suspenso.
    assert evaluate_filters({"pe_ttm": float("nan")}, {"pe_ttm": {"op": "lte", "value": 18}})["estado"] == "sin_comprobar"


def test_un_suspenso_con_dato_manda_aunque_falte_otro():
    """Con un filtro suspendido ya no puede pasar, le falte lo que le falte."""
    r = evaluate_filters({"pe_ttm": 30.0}, {"pe_ttm": {"op": "lte", "value": 18},
                                            "roe": {"op": "gte", "value": 0.10}})
    assert r["estado"] == "no_pasa" and r["passes"] is False
    assert [c["estado"] for c in r["checks"]] == ["no_pasa", "sin_dato"]


def test_el_recuento_separa_los_que_suspenden_de_los_que_no_se_pudieron_comprobar():
    """«0 de 8 pasan» no separaba unos de otros (revisión 12, visual)."""
    from datetime import datetime, timezone

    from app.routers.screener import ScreenRequest, run_screen
    from tests.fakes_empresa import ServicioFalso

    sv = ServicioFalso(datetime(2026, 9, 14, tzinfo=timezone.utc))
    for symbol, metrics in {"AAA": {"pe_ttm": 10.0, "roe": 0.2}, "BBB": {"pe_ttm": 40.0, "roe": 0.2},
                            "CCC": {"pe_ttm": 10.0, "roe": None}, "DDD": {"pe_ttm": None, "roe": 0.01}}.items():
        sv.fundamentales[symbol] = {"metrics": metrics, "source": "prueba"}
    filtros = {"pe_ttm": {"op": "lte", "value": 18}, "roe": {"op": "gte", "value": 0.10}}
    r = run_screen(ScreenRequest(symbols=["DDD", "CCC", "BBB", "AAA"], filters=filtros), sv)
    assert (r["passed"], r["no_pasan"], r["sin_comprobar"], r["evaluated"]) == (1, 2, 1, 4)
    # Las que pasan, luego las que no se pudieron comprobar, luego las que suspenden.
    assert [(f["symbol"], f["estado"]) for f in r["results"]] == [
        ("AAA", "pasa"), ("CCC", "sin_comprobar"), ("BBB", "no_pasa"), ("DDD", "no_pasa")]


def test_limites_inclusivos():
    assert evaluate_filters({"pe_ttm": 18.0}, {"pe_ttm": {"op": "lte", "value": 18}})["passes"]
    assert evaluate_filters({"roe": 0.10}, {"roe": {"op": "gte", "value": 0.10}})["passes"]


def test_sin_filtros_todo_pasa():
    assert evaluate_filters({"pe_ttm": 999.0}, {})["passes"] is True


def test_operador_invalido():
    with pytest.raises(ValueError, match="Operador inválido"):
        evaluate_filters({"pe_ttm": 10.0}, {"pe_ttm": {"op": "igual", "value": 10}})


def test_presets_integrados_documentan_su_logica():
    assert len(DEFAULT_PRESETS) == 3
    for preset in DEFAULT_PRESETS:
        assert preset["logic_md"], f"{preset['name']} debe documentar su lógica"
        assert preset["filters"], f"{preset['name']} debe tener filtros"
        for metric, spec in preset["filters"].items():
            assert spec["op"] in {"gte", "lte"}, metric


def test_preset_value_rechaza_empresa_endeudada():
    preset = next(p for p in DEFAULT_PRESETS if p["name"].startswith("Value"))
    barata_pero_endeudada = {
        "pe_ttm": 8.0, "debt_to_equity": 3.5, "current_ratio": 0.9, "roe": 0.11
    }
    assert evaluate_filters(barata_pero_endeudada, preset["filters"])["passes"] is False

    solida = {"pe_ttm": 14.0, "debt_to_equity": 0.4, "current_ratio": 1.8, "roe": 0.15}
    assert evaluate_filters(solida, preset["filters"])["passes"] is True
