"""Decimoquinta revisión (un solo DCF y la ficha en cuatro pestañas, sobre
4ca3352): cada test reproduce un hallazgo confirmado y falla sin su arreglo."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.analysis.valuation import CRECIMIENTO_MINIMO, escenarios_por_defecto, supuestos_con_procedencia
from app.db.engine import get_session
from app.deps import get_service
from app.main import app
from app.providers.router import AllProvidersFailedError
from tests.fakes_empresa import AHORA, ServicioFalso, financieros_base, periodo


def _cliente(session_factory, periodos, precio=20.0, servicio=None):
    servicio = servicio or ServicioFalso(AHORA)
    servicio.empresa("ACME", precio=precio, periodos=periodos, score=None)

    def sesion():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_service] = lambda: servicio
    app.dependency_overrides[get_session] = sesion
    return TestClient(app)


@pytest.fixture(autouse=True)
def _limpiar():
    yield
    app.dependency_overrides.clear()


def _un_ejercicio() -> list[dict]:
    """Un solo ejercicio: sin crecimiento medible, entra el 3 % supuesto."""
    return [
        periodo(2025, "2026-02-10", revenue=1100.0, cfo=250.0, capex=50.0, eps_diluted=1.65,
                shares_outstanding=100.0, cash=120.0, long_term_debt=300.0, short_term_debt=0.0),
    ]


def _fcf_que_cae(cfo_final: float, deuda: float = 600.0) -> list[dict]:
    """FCF de 1.000 a `cfo_final − 400` en un año."""
    return [
        periodo(2024, "2025-02-12", revenue=5000.0, cfo=1400.0, capex=400.0, eps_diluted=5.0,
                shares_outstanding=100.0, cash=100.0, long_term_debt=deuda, short_term_debt=0.0),
        periodo(2025, "2026-02-10", revenue=4800.0, cfo=cfo_final, capex=400.0, eps_diluted=3.0,
                shares_outstanding=100.0, cash=100.0, long_term_debt=deuda, short_term_debt=0.0),
    ]


# --- H2: con EDGAR caído, la pestaña Valoración decía «no presenta 10-K» ----------------


class _EdgarCaido(ServicioFalso):
    def get(self, tipo, **kw):
        if tipo == "financials":
            raise AllProvidersFailedError("financials", {"edgar": "HTTP 503"})
        return super().get(tipo, **kw)


def test_edgar_caido_en_la_valoracion_es_un_fallo_no_una_ausencia(session_factory):
    """La ficha usaba `/api/stocks/{s}/valuation/defaults` (502 si ninguna fuente
    responde) y ahora `/api/valuation/{s}`, que se tragaba el fallo: 404 «los ETFs
    no presentan 10-K», pintado como ausencia y sin «Reintentar». El informe
    completo, con el mismo EDGAR caído, ya daba 502 (segunda revisión del 2.1)."""
    c = _cliente(session_factory, _un_ejercicio(), servicio=_EdgarCaido(AHORA))
    assert c.get("/api/stocks/ACME/valuation/defaults").status_code == 502
    r = c.post("/api/valuation/ACME")
    assert r.status_code == 502, (r.status_code, r.json())
    assert "No se pudieron descargar los estados financieros de EDGAR" in r.json()["detail"]
    assert "10-K" not in r.json()["detail"]


def test_sin_estados_en_edgar_sigue_siendo_una_ausencia(session_factory):
    """Guarda (pasa también sin el arreglo): si EDGAR responde que no lo tiene,
    404, y la ficha lo dice como ausencia."""
    r = _cliente(session_factory, []).post("/api/valuation/ACME")
    assert r.status_code == 404
    assert "10-K" in r.json()["detail"]


# --- H3: el módulo proponía un crecimiento que él mismo rechazaba al recalcular ----------


def test_recalcular_con_los_supuestos_propuestos_no_da_422(session_factory):
    """FCF de 1.000 a 500 (−50 % medido): con el intercambio de M5 el bajista
    propuesto era −75 %, y «Recalcular con mis supuestos» sin tocar nada daba un
    422 de Pydantic que borraba la valoración."""
    c = _cliente(session_factory, _fcf_que_cae(900.0), precio=60.0)
    primero = c.post("/api/valuation/ACME")
    assert primero.status_code == 200
    propuestos = {k: v["supuestos"] for k, v in primero.json()["escenarios"].items()}
    assert propuestos["bajista"]["growth_rate"] == CRECIMIENTO_MINIMO
    segundo = c.post("/api/valuation/ACME", json={"escenarios": propuestos})
    assert segundo.status_code == 200, (propuestos["bajista"], segundo.json())


def test_el_suelo_se_declara_en_el_escenario_que_lo_toca():
    esc = escenarios_por_defecto({"fcf_cagr": -0.5})
    assert [esc[n]["growth_rate"] for n in ("bajista", "base", "alcista")] == [-0.5, -0.5, -0.2]
    # El bajista (−75 %) se acota y lo dice; el base (justo −50 %) no se acota.
    assert "se acota" in esc["bajista"]["motivo"] and "-75,0" in esc["bajista"]["motivo"]
    assert esc["base"]["motivo"] is None and esc["alcista"]["motivo"] is None
    assert not any(esc[n]["supuesto"] for n in esc)  # medido: no es el 3 % supuesto


def test_una_caida_de_mas_del_100_por_cien_no_da_un_rango_negativo_a_una_empresa_sin_deuda(session_factory):
    """Con una caída del FCF del 67 % o más, el bajista propuesto bajaba de −100 %:
    el FCF cambiaba de signo cada año y una empresa con FCF positivo y caja
    salía con un rango negativo (FCF CAGR −90 %: bajista −3,04…−2,5)."""
    c = _cliente(session_factory, _fcf_que_cae(500.0, deuda=0.0), precio=60.0)  # FCF 1.000 → 100, caja neta
    e = c.post("/api/valuation/ACME").json()["escenarios"]
    for nombre in ("bajista", "base", "alcista"):
        assert e[nombre]["supuestos"]["growth_rate"] >= CRECIMIENTO_MINIMO
        assert e[nombre]["rango"]["bajo"] > 0, (nombre, e[nombre]["rango"])
    assert "se acota" in e["bajista"]["procedencia"]["motivo"]
    assert e["bajista"]["procedencia"]["crecimiento_supuesto"] is False


def test_el_validador_admite_lo_mismo_que_se_propone(session_factory):
    """Guarda: lo que está por debajo del suelo se sigue rechazando (lo escrito a mano)."""
    c = _cliente(session_factory, _un_ejercicio())
    bajo = {"growth_rate": CRECIMIENTO_MINIMO - 0.01, "discount_rate": 0.1, "terminal_growth": 0.02}
    assert c.post("/api/valuation/ACME", json={"escenarios": {"base": bajo}}).status_code == 422
    justo = {**bajo, "growth_rate": CRECIMIENTO_MINIMO}
    assert c.post("/api/valuation/ACME", json={"escenarios": {"base": justo}}).status_code == 200


# --- H7: el 3 % supuesto dejaba de decirse al recalcular --------------------------------


def test_el_crecimiento_supuesto_se_sigue_diciendo_al_recalcular(session_factory):
    c = _cliente(session_factory, _un_ejercicio())
    primero = c.post("/api/valuation/ACME").json()
    assert primero["escenarios"]["base"]["procedencia"]["crecimiento_supuesto"] is True
    propuestos = {k: v["supuestos"] for k, v in primero["escenarios"].items()}
    # Escribe solo su deuda neta («Tus entradas») y recalcula: el 3 % sigue siendo
    # el de la app, no un dato ni una elección suya.
    segundo = c.post("/api/valuation/ACME", json={"escenarios": propuestos, "net_debt": 500.0}).json()
    base = segundo["escenarios"]["base"]
    assert base["supuestos"]["growth_rate"] == 0.03
    assert base["procedencia"]["crecimiento_supuesto"] is True, base
    assert "se SUPONE" in base["procedencia"]["motivo"]


def test_un_crecimiento_cambiado_ya_no_es_el_supuesto_de_la_app():
    """Guarda del arreglo de H7: solo hereda la procedencia lo que vuelve igual."""
    recibidos = {
        "base": {"growth_rate": 0.05, "discount_rate": 0.09, "terminal_growth": 0.025},
        "bajista": {"growth_rate": 0.012, "discount_rate": 0.12, "terminal_growth": 0.015},
    }
    s = supuestos_con_procedencia({}, recibidos)
    # El base lo cambiaste tú; el bajista es el propuesto (con otro WACC: el crecimiento sigue siendo el supuesto).
    assert (s["base"]["supuesto"], s["base"]["motivo"]) == (False, None)
    assert s["bajista"]["supuesto"] is True and "se SUPONE" in s["bajista"]["motivo"]
    assert s["bajista"]["discount_rate"] == 0.12
    # Un escenario que la app no propone no hereda nada.
    otro = supuestos_con_procedencia({}, {"propio": recibidos["base"]})
    assert (otro["propio"]["supuesto"], otro["propio"]["motivo"]) == (False, None)


def test_un_crecimiento_medido_no_se_vuelve_supuesto_al_recalcular():
    """Guarda: un 3 % medido no es el 3 % supuesto aunque coincida la cifra."""
    s = supuestos_con_procedencia({"fcf_cagr": 0.03}, {"base": {"growth_rate": 0.03, "discount_rate": 0.09,
                                                                 "terminal_growth": 0.025}})
    assert (s["base"]["supuesto"], s["base"]["motivo"]) == (False, None)


# --- H11: unas acciones «0» se cambiaban en silencio por las del filing ------------------


def test_acciones_cero_no_se_cambian_por_las_del_filing(session_factory):
    c = _cliente(session_factory, _un_ejercicio())
    r = c.post("/api/valuation/ACME", json={"shares_outstanding": 0})
    assert r.status_code == 422, r.json()
    assert r.json()["detail"][0]["loc"] == ["body", "shares_outstanding"]
    # Las tuyas, si son válidas, mandan.
    assert c.post("/api/valuation/ACME", json={"shares_outstanding": 50.0}).json()["entradas"]["shares_outstanding"] == 50.0


def test_sin_acciones_en_el_filing_se_dice(session_factory):
    """Guarda: sin `or`, unas acciones a cero en el filing siguen sin valorarse."""
    periodos = [{**p, "shares_outstanding": 0.0} for p in _un_ejercicio()]
    r = _cliente(session_factory, periodos).post("/api/valuation/ACME")
    assert r.status_code == 422
    assert "acciones en circulación" in r.json()["detail"]


# --- H6: «Crecimiento que da por hecho el precio» sin motivo cuando el 9 % se sale ------


def test_dcf_inverso_sin_valor_al_9_dice_por_que(session_factory):
    """Una acción cara (FCF 200, capitalización 25.000): al 7 y al 8 % hay
    crecimiento implícito, al 9 % no (haría falta más de un 60 % anual). La curva
    está «disponible», y el análisis servía crecimiento None con motivo None: la
    tarjeta de la ficha caía en «faltan las cuentas o el precio»."""
    from app.routers.empresa import analizar_y_congelar

    servicio = ServicioFalso(AHORA).empresa("ACME", precio=250.0, periodos=financieros_base(), score=0.6)
    r = analizar_y_congelar("ACME", servicio, session_factory(), ahora=AHORA, congelar=False, con_pares=False)
    inv = r["analisis"]["valoracion"]["dcf_inverso"]
    assert inv["estado"] == "valido" and inv["rango"] is not None
    assert inv["crecimiento_implicito"] is None, inv
    assert inv["motivo"] is not None and "60" in inv["motivo"], inv
