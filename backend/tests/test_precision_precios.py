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
from app.formato import fmt_num, fmt_precio
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
    assert "Vender si cierra en o por debajo de 0,004" in d["triggers"]
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


def test_el_motor_compara_el_stop_con_el_cierre_entero_de_yahoo():
    # Revisión de A1: con el stop ya entero, el cierre seguía llegando redondeado
    # a dos decimales. Stop 1,8165 y cierre 1,8155 → Yahoo servía 1,82 y la
    # posición salía «mantener» con el stop perforado.
    resumen = _price_summary(pd.Series([1.70 + i * 0.0005 for i in range(220)] + [1.8155], dtype="float64"))
    d = decide(señal(0.8), resumen, {"cost_basis": 1.90, "stop": 1.8165})
    assert d["action"] == "vender"
    assert next(r for r in d["reglas"] if r["papel"] == "decide")["id"] == "stop_perforado"


def test_el_stop_servido_y_el_escrito_son_el_mismo():
    # Revisión de A1: `levels.stop` se servía con `round()` (2,675 → 2,67) y el
    # texto se escribía del valor entero con el formateador (2,68).
    d = decide(señal(0.8), precio(3.10, 2.0), {"cost_basis": 3.0, "stop": 2.675})
    servido = d["levels"]["stop"]
    escrito = fmt_precio(servido)
    assert f"Vender si cierra en o por debajo de {escrito}" in d["triggers"]
    condiciones = [c["condicion"] for g in d["cambiaria"] for c in g["condiciones"] if c["regla"] == "stop_perforado"]
    assert condiciones and all(f"precio > {escrito} (stop)" in c or f"precio ≤ {escrito} (stop)" in c for c in condiciones)


def test_las_medias_del_grafico_no_se_redondean_a_cero():
    # Revisión de A1: `/history` redondeaba las SMA a 4 decimales; a 0,00004 la
    # media salía 0,0 y a 0,00005, el doble del precio.
    from app.routers.stocks import _medias

    assert _medias(pd.Series([0.00004, float("nan")])) == [0.00004, None]
    assert _medias(pd.Series([0.00005])) == [0.00005]
    assert _medias(pd.Series([92.123456])) == [92.1235]  # desde 1, los 4 de siempre


def test_el_mensaje_de_no_bajar_el_stop_repite_las_cifras_de_centimos(cliente):
    # Revisión de A1: con `fmt_num(…, 4)` decía «No se puede bajar el stop de 0 a 0».
    c, factory = cliente
    r = c.post("/api/portfolio/positions", json={"symbol": "CENT", "quantity": 1000, "cost_basis": 0.00005})
    with factory() as s:
        stop = s.get(Position, r.json()["id"]).stop
    rechazo = c.post(f"/api/portfolio/positions/{r.json()['id']}/stop", json={"stop": 0.00003})
    assert rechazo.status_code == 409
    detalle = rechazo.json()["detail"]
    assert "de 0 a 0" not in detalle and "0,00003" in detalle
    assert fmt_num(stop, 12, ceros=False)[:7] in detalle


def test_el_minigrafico_de_la_cartera_no_aplana_una_accion_de_centimos():
    # Revisión de A1: `round(cierre, 2)` daba 32 ceros, una línea plana y verde.
    from app.routers.portfolio import _spark_cacheado

    class _Cache:
        def get(self, tipo, params):
            if tipo != "price_history_long":
                return None
            return {"bars": [{"close": 0.004 - i * 0.000004} for i in range(260)]}

    class _Sv:
        cache = _Cache()

    spark = _spark_cacheado(_Sv(), "CENT")
    assert spark[0] > spark[-1] > 0


def test_la_tendencia_se_mide_con_el_umbral_exacto_no_con_el_servido():
    """Revisión de A1: con la media en 1,0054 el umbral de entrada es 1,0255, y
    redondeado a 1,03 «Qué la cambiaría» pedía «precio ≥ 1,03» con 1,0256, una
    condición ya cumplida; lo único pendiente eran los resultados."""
    d = decide(señal(0.8), precio(1.0256, 1.0054), resultados_en="2026-09-14")
    assert d["action"] == "vigilar"
    tendencia = next(r for r in d["reglas"] if r["id"] == "tendencia_a_favor")
    assert tendencia["resultado"] == "cumple" and tendencia["datos"]["umbral"] == 1.03
    comprar = next(c for c in d["cambiaria"] if c["hacia"] == "comprar")
    assert [c["regla"] for c in comprar["condiciones"]] == ["resultados_proximos"]


def test_los_textos_de_una_alerta_y_del_intervalo_de_comparables_escriben_el_precio():
    """Revisión de A1, los hermanos: con dos decimales fijos (o ninguno), una
    acción de 0,003 con la alerta en 0,004 decía «a 0,00, por debajo de 0,00»,
    y el intervalo de comparables «da 0–0, y cotiza a 0»."""
    from app.analysis import alertas
    from app.analysis.relative_value import rango_de_precio_implicito

    alerta = {"symbol": "CENT", "active": True, "condition": {"op": "lt", "price": 0.004}}
    motivo = alertas.evaluar(alerta, 0.003)["motivo"]
    assert "0,003" in motivo and "0,004" in motivo
    r = rango_de_precio_implicito(10.0, 14.0, 0.0002, 0.003)
    assert r["precio_bajo"] == 0.002 and r["precio_alto"] == 0.0028
    assert "0,002–0,0028" in r["nota"] and "cotiza a 0,003" in r["nota"]


def test_el_prompt_del_analisis_ia_lleva_el_precio_entero():
    from app.routers.deep_dive import _narrative_prompt

    prompt = _narrative_prompt("CENT", {"price": 0.003, "business": {}, "growth": {}, "margins": {},
                                        "balance": {}, "valuation": {}, "catalysts": []})
    assert "Precio actual: 0,003" in prompt


def test_la_media_de_200_sesiones_llega_entera_al_motor():
    """Revisión 3: `_price_summary` servía la media redondeada (1,0054 → 1,01) y el
    umbral exacto no llegaba a producción: comprar pasaba a vigilar."""
    base = (1.0054 * 200 - 1.0256) / 199
    resumen = _price_summary(pd.Series([base] * 199 + [1.0256], dtype="float64"))
    assert resumen["sma200"] == pytest.approx(1.0054, abs=1e-9)
    assert decide(señal(0.8), resumen)["action"] == "comprar"


def test_a_un_paso_del_umbral_la_condicion_sigue_pendiente():
    """Revisión 3: a menos de 0,005 % del umbral la distancia redondeada salía 0,0,
    la condición se daba por cumplida y «→ Comprar si:» quedaba vacío."""
    d = decide(señal(0.8), precio(1.0255, 1.0054))
    assert d["action"] == "vigilar"
    comprar = next(c for c in d["cambiaria"] if c["hacia"] == "comprar")
    assert [c["regla"] for c in comprar["condiciones"]] == ["tendencia_a_favor"]


def test_vigilar_y_mantener_dicen_donde_esta_el_precio_frente_a_la_banda():
    """Revisión 3: dentro de la banda decía «cotiza bajo su media» estando encima y
    pedía «cierre por encima de 100,00» cuando la regla exige 102,00; «mantener»
    decía «precio sobre su media» sin media."""
    d = decide(señal(0.8), precio(101.5, 100.0))
    assert d["action"] == "vigilar"
    assert not any("bajo su media" in r for r in d["reasons"])
    assert any("dentro de la banda" in r for r in d["reasons"])
    assert d["triggers"][0].startswith("Comprar cuando cierre en o por encima de 102,00")
    m = decide(señal(0.8), {"last": 100.0, "sma200": None, "above_sma200": None, "daily_vol_pct": 1.2},
               {"cost_basis": 90.0, "quantity": 10, "stop": 80.0})
    assert m["action"] == "mantener"
    assert any("desconocida" in r for r in m["reasons"]) and not any("sobre su media" in r for r in m["reasons"])


# --- Revisión 4: lo que se escribe del umbral tiene que ser cierto ---------------


def test_redondear_hacia_un_lado_lleva_al_tick_sin_ruido_de_coma_flotante():
    assert datos.redondear_precio(102.00408, hacia="arriba") == 102.01
    assert datos.redondear_precio(98.99901, hacia="abajo") == 98.99
    # 1,1 × 100 es 110,00000000000001: el techo ingenuo daba 1,11.
    assert datos.redondear_precio(1.1, hacia="arriba") == 1.1
    assert datos.redondear_precio(0.0045671, hacia="arriba") == 0.004568
    assert datos.redondear_precio(0.0045679, hacia="abajo") == 0.004567
    assert datos.redondear_precio(102.00408) == 102.0


def test_el_umbral_de_entrada_se_escribe_hacia_arriba():
    """Con la media en 100,004 el umbral es 102,00408 y se escribía 102,00: con un
    cierre de 102,00, «vigilar» bajo «Comprar cuando cierre en o por encima de
    102,00» y la traza «102,00 frente a 102,00 ✗ no cumple»."""
    d = decide(señal(0.8), precio(102.0, 100.004))
    assert d["action"] == "vigilar"
    assert d["triggers"][0].startswith("Comprar cuando cierre en o por encima de 102,01 ")
    regla = next(r for r in d["reglas"] if r["id"] == "tendencia_a_favor")
    assert regla["datos"]["umbral"] == 102.01
    comprar = next(c for c in d["cambiaria"] if c["hacia"] == "comprar")
    assert comprar["condiciones"][0]["condicion"].startswith("precio ≥ 102,01 ")
    # Y un cierre en la cifra escrita sí compra.
    assert decide(señal(0.8), precio(102.01, 100.004))["action"] == "comprar"


def test_con_posicion_el_disparador_dice_el_umbral_de_reducir():
    """Con el precio dentro de la banda (99,5 con la media en 100) el motor dice
    «mantener», pero el disparador pedía «Revisar si pierde la media de 200
    sesiones»: algo que ya había pasado, sin nivel y con otro umbral."""
    pos = {"cost_basis": 90.0, "quantity": 10, "stop": 80.0}
    d = decide(señal(0.8), precio(99.5, 100.0), pos)
    assert d["action"] == "mantener"
    assert "Reducir si cierra en o por debajo de 99,00 (media 200 − 1\u00a0%)" in d["triggers"]
    assert not any("Revisar si pierde la media" in t for t in d["triggers"])
    # Hacia abajo: con la media en 100,0049 el umbral es 99,004851 y se escribe 99,00.
    d = decide(señal(0.8), precio(99.5, 100.0049), pos)
    assert "Reducir si cierra en o por debajo de 99,00 (media 200 − 1\u00a0%)" in d["triggers"]
    reducir = next(c for c in d["cambiaria"] if c["hacia"] == "reducir")
    assert reducir["condiciones"][0]["umbral"] == 99.0
    sin_media = decide(señal(0.8), {"last": 100.0, "sma200": None, "above_sma200": None, "daily_vol_pct": 1.2}, pos)
    assert any("cuando haya una media de 200 sesiones" in t for t in sin_media["triggers"])


def test_la_ficha_decide_con_la_media_entera_y_la_sirve_redondeada():
    """Revisión 4: el arreglo de la media entera se probaba en `_price_summary` y
    `decide` por separado; la línea de `seccion_mercado` que se la pasa al motor
    se podía cambiar por la redondeada (1,01) sin que fallara nada, y la ficha
    volvía a decir «vigilar» con el cierre por encima del umbral."""
    from datetime import timedelta

    from app.analisis_empresa import seccion_mercado
    from tests.fakes_empresa import AHORA, ServicioFalso

    servicio = ServicioFalso(AHORA).empresa("CENT", precio=1.0256, score=None)
    base = (1.0054 * 200 - 1.0256) / 199
    ayer = AHORA.date() - timedelta(days=1)
    servicio.historias["CENT"] = [{"ts": (ayer - timedelta(days=199 - i)).isoformat(),
                                   "close": base if i < 199 else 1.0256} for i in range(200)]
    seccion, bloque = seccion_mercado(servicio, "CENT", AHORA)
    assert bloque["sma200"] == pytest.approx(1.0054, abs=1e-9)
    assert seccion["sma200"] == 1.01
    assert decide(señal(0.8), bloque)["action"] == "comprar"


# --- Revisión 5: el redondeo hacia un lado, sin ruido, también en el stop --------


def test_un_cierre_justo_en_la_media_mas_la_banda_compra_y_se_escribe_bien():
    """14 × 1,02 es 14,280000000000001 en coma flotante: un cierre de 14,28 no
    compraba y la pantalla pedía «en o por encima de 14,28»."""
    assert decide(señal(0.8), precio(14.28, 14.0))["action"] == "comprar"
    vigilar = decide(señal(0.8), precio(14.27, 14.0))
    assert vigilar["action"] == "vigilar"
    assert vigilar["triggers"][0].startswith("Comprar cuando cierre en o por encima de 14,28 ")
    pos = {"cost_basis": 10.0, "quantity": 10, "stop": 5.0}
    assert decide(señal(0.8), precio(11.88, 12.0), pos)["action"] == "reducir"
    # Sin multiplicar en coma flotante: el ruido del umbral cuenta, el del redondeo no.
    assert datos.redondear_precio(14.280000000000001, hacia="arriba") == 14.29
    assert datos.redondear_precio(1.1, hacia="arriba") == 1.1


def test_el_stop_se_escribe_hacia_abajo_y_en_o_por_debajo():
    """Stop 92,006 servido 92,01: con un cierre de 92,01, «mantener» bajo «precio
    ≤ 92,01 (stop)» y la traza «92,01 frente a 92,01 ✗». Y «Vender si cierra por
    debajo de 95,00» con la regla vendiendo a 95,00."""
    d = decide(señal(0.8), precio(92.01, 80.0), {"cost_basis": 100.0, "stop": 92.006})
    assert d["action"] == "mantener"
    assert d["levels"]["stop"] == 92.0
    assert next(r for r in d["reglas"] if r["id"] == "stop_perforado")["datos"]["umbral"] == 92.0
    vender = next(g for g in d["cambiaria"] if g["hacia"] == "vender")
    assert any(c["condicion"] == "precio ≤ 92,00 (stop)" for c in vender["condiciones"])
    en_el_stop = decide(señal(0.8), precio(95.0, 80.0), {"cost_basis": 100.0, "stop": 95.0})
    assert en_el_stop["action"] == "vender"
    assert "Vender si cierra en o por debajo de 95,00" in en_el_stop["triggers"]
    compra = decide(señal(0.8), precio(110.0, 100.0))
    assert any(t.startswith("Salir si cierra en o por debajo de ") for t in compra["triggers"])


def test_sin_cifra_de_la_media_el_disparador_no_escribe_un_guion():
    pos = {"cost_basis": 90.0, "quantity": 10, "stop": 50.0}
    for bloque in ({"last": 100.0, "sma200": None, "above_sma200": False, "daily_vol_pct": 1.2},
                   {"last": 100.0, "sma200": 0.0, "above_sma200": True, "daily_vol_pct": 1.2}):
        d = decide(señal(0.8), bloque, pos)
        assert not any("—" in t for t in d["triggers"]), d["triggers"]


def test_la_distancia_se_mide_contra_el_umbral_escrito():
    """«precio ≥ 102,01 (ahora 102,00; falta 0,00 %)»: la distancia salía del exacto."""
    d = decide(señal(0.8), precio(102.0, 100.004))
    comprar = next(g for g in d["cambiaria"] if g["hacia"] == "comprar")
    c = next(c for c in comprar["condiciones"] if c["regla"] == "tendencia_a_favor")
    assert c["umbral"] == 102.01 and c["distancia"] == 0.01



def test_el_bpa_estimado_del_calendario_lleva_los_decimales_de_un_precio():
    # Revisión 5: «Publicación de resultados · BPA estimado 0,00» con 0,0042.
    from app.analysis.deep_dive import catalysts_section

    c = catalysts_section([{"date": "2026-10-30", "eps_estimate": 0.0042}], [], [])
    assert c[0]["detail"] == "Publicación de resultados · BPA estimado 0,0042"


def test_el_stop_recalculado_va_en_la_rejilla_como_en_la_cartera():
    """Revisión 6: sin stop guardado, 60 × (1 − 0,165) es 50,099999999999994; se
    escribía 50,09 hacia abajo (la cartera decía 50,10) y un cierre de 50,10
    salía «mantener»."""
    pos = {"cost_basis": 60.0, "quantity": 10}
    d = decide(señal(0.8), {"last": 50.10, "sma200": 40.0, "above_sma200": True, "daily_vol_pct": None}, pos)
    assert d["levels"]["stop"] == 50.1
    assert d["action"] == "vender"
    assert "Vender si cierra en o por debajo de 50,10" in d["triggers"]
