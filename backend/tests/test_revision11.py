"""Undécima revisión adversarial (sobre 12c2d02): cada test reproduce un
hallazgo confirmado y falla sin su arreglo."""

from __future__ import annotations

from app.analysis import deep_dive
from app.routers.deep_dive import _narrative_prompt

# --- Informe a fondo: una sola lista de fronteras por cifra -------------------


def test_la_misma_cifra_se_escribe_igual_en_lectura_riesgos_veredicto_y_prompt():
    """Con 2,996 la lectura decía «Deuda/capital 3,00 … cobertura 3×», los
    riesgos «2,996» y el prompt de la IA «3,00» y «3,0»: cada sitio miraba solo
    sus propios umbrales."""
    d_e = cobertura = 2.996
    lectura = deep_dive._debt_reading(d_e, cobertura, None)
    riesgos = deep_dive.risks_section([], [{"debt_to_equity": d_e, "interest_coverage": cobertura}], None, {})
    veredicto = deep_dive.build_verdict(None, {}, {}, {"interest_coverage": cobertura}, {})
    prompt = _narrative_prompt("ACME", {"debt": {"debt_to_equity": d_e, "interest_coverage": cobertura}})

    assert "Deuda/capital 2,996 (apalancamiento alto)" in lectura
    assert "cobertura de intereses 2,996× — ajustada" in lectura
    assert {r["evidence"] for r in riesgos} == {"Deuda/capital de 2,996", "El EBIT cubre 2,996× los intereses"}
    assert "cobertura de intereses ajustada (2,996×)" in veredicto["summary"]
    assert "Deuda/capital: 2,996" in prompt
    assert "Cobertura de intereses: 2,996" in prompt


def test_el_prompt_escribe_el_altman_de_su_lado_de_su_zona():
    """2,9896 llegaba a la IA como «2,99 (zona gris)» y 2,9904 como «2,99 (zona
    segura)»; también con un informe de antes, sin `umbrales`."""
    for z in ({"score": 2.9896, "zone": "gris", "umbrales": [1.81, 2.99]}, {"score": 2.9896, "zone": "gris"}):
        prompt = _narrative_prompt("ACME", {"debt": {"altman_z": z}})
        assert "Altman Z: 2,9896 (zona gris)" in prompt


def test_margen_y_crecimiento_se_escriben_de_su_lado_de_su_nivel():
    """0,2496 y 0,2504 salían los dos «25,0 %», uno «sólidos» y otro «muy
    altos»; un CAGR de -0,0004 era «contracción (0,0 % anual)», también en el
    riesgo de severidad alta."""
    assert "24,96\u00a0%: márgenes sólidos" in deep_dive._margins_reading(0.2496, None)
    assert "25,04\u00a0%: márgenes muy altos" in deep_dive._margins_reading(0.2504, None)
    assert "crecimiento moderado (14,96\u00a0%" in deep_dive._growth_reading(0.1496, None, 5)
    assert "ingresos en contracción (-0,04\u00a0%" in deep_dive._growth_reading(-0.0004, None, 5)
    periodos = [{"fiscal_year": str(2020 + i), "revenue": 1000.0 * (1 - 0.0004) ** i} for i in range(6)]
    riesgos = deep_dive.risks_section(periodos, [], None, {})
    assert any(r["evidence"].startswith("CAGR de ingresos -0,04\u00a0%") for r in riesgos)
    veredicto = deep_dive.build_verdict(None, {}, {"revenue_cagr": 0.0804}, {}, {"current": {"operating_margin": 0.1504}})
    assert "ingresos creciendo al 8,04\u00a0% anual" in veredicto["positives"]
    # \u00abanual\u00bb desde la revisi\u00f3n 12: el informe lee ejercicios, no trimestres.
    assert "margen operativo anual del 15,04\u00a0%" in veredicto["positives"]


def test_el_informe_sirve_sus_fronteras():
    """La pantalla escribe la casilla con las mismas fronteras que la lectura."""
    informe = deep_dive.assemble("ACME", {}, {"periods": []}, {}, None, None, None, [], [], [], None)
    assert informe["umbrales"]["debt_to_equity"] == [1, 2, 3]
    assert informe["umbrales"]["interest_coverage"] == [1.5, 2, 3, 5, 8]
    assert informe["umbrales"]["fcf_conversion"] == [0.6, 1.1]


# --- Qué cambió: cada lado con los umbrales de su traza ------------------------

from app.analysis import cambios  # noqa: E402
from app.analysis.decision import decide  # noqa: E402

PRECIO = {"last": 110.0, "sma200": 100.0, "above_sma200": True, "daily_vol_pct": 1.2}


def test_que_cambio_escribe_cada_lado_con_los_umbrales_de_su_traza():
    """Al abrir una posición con 0,3496, la fila decía «+0,36 → +0,3496» con los
    umbrales de las dos trazas juntas, y las razones y la traza de ahora del
    mismo panel, «+0,35» (con posición solo cuenta el de vender)."""
    antes = decide({"symbol": "X", "score": 0.36}, PRECIO)
    pos = {"cost_basis": 100.0, "quantity": 10, "stop": 80.0}
    ahora = decide({"symbol": "X", "score": 0.3496}, PRECIO, pos)
    d = cambios.comparar_decisiones(antes, ahora, None, pos)
    assert d["umbrales_puntuacion_antes"] == [-0.35, 0.35]
    assert d["umbrales_puntuacion_ahora"] == [-0.35]
    # La explicación, igual: el de antes frente a los suyos, el de ahora frente a los suyos.
    d = cambios.comparar_decisiones(decide({"symbol": "X", "score": 0.3496}, PRECIO),
                                    decide({"symbol": "X", "score": -0.36}, PRECIO, pos), None, pos)
    assert any("+0,3496" in e and "-0,36" in e for e in d["explicacion"])


# --- Avisos ---------------------------------------------------------------------

import random  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

from app import analisis_empresa, oportunidad  # noqa: E402
from app.db.models import CashBalance, Instrument, Position  # noqa: E402
from tests.fakes_empresa import ServicioFalso, financieros_base  # noqa: E402


def test_la_nota_de_las_posiciones_sin_valorar_sigue_al_parentesis_que_las_nombra(session_factory, monkeypatch):
    """«…se revisaría primero AAA (lista de abajo). Esa posición abierta sin
    valorar no cuenta…»: el demostrativo se leía como AAA, que sí tiene precio;
    la que no lo tiene es XYZ, nombrada en el paréntesis del efectivo."""
    ahora = datetime.now(timezone.utc)
    original = oportunidad._lectura_congelada

    def lectura(session, symbol, ahora_):
        if symbol == "AAA":
            return {"accion": "vender", "tesis": "rota", "valoracion": "cara", "confianza": "baja",
                    "lectura_de": (ahora_ - timedelta(days=2)).isoformat()}
        return original(session, symbol, ahora_)

    monkeypatch.setattr(oportunidad, "_lectura_congelada", lectura)
    servicio = ServicioFalso(ahora).empresa("CCC", precio=104.0, score=0.6, periodos=financieros_base())
    servicio.empresa("AAA", precio=104.0, score=0.6, periodos=financieros_base())
    rnd, precio, barras = random.Random(7), 100.0, []
    for i in range(300):
        precio *= 1 + rnd.gauss(0, 0.003)
        barras.append({"ts": (ahora.date() - timedelta(days=300 - i)).isoformat(), "close": round(precio, 4)})
    servicio.cache.set("price_history_long", {"symbol": "AAA"}, {"symbol": "AAA", "bars": barras})
    with session_factory() as s:
        s.add(CashBalance(moneda="USD", importe=1000.0, as_of=ahora - timedelta(hours=1),
                          registrado_en=ahora - timedelta(hours=1)))
        for symbol, cantidad in (("AAA", 10), ("XYZ", 1000)):
            inst = Instrument(symbol=symbol, name=symbol, sector="Utilities", currency="USD")
            s.add(inst)
            s.flush()
            s.add(Position(instrument_id=inst.id, quantity=cantidad, cost_basis=100.0,
                           opened_at=ahora - timedelta(days=60)))
        s.commit()
        veredicto = analisis_empresa.analizar("CCC", servicio, s, con_pares=False)["coste_oportunidad"]["veredicto"]
    motivo = veredicto["motivo"]
    assert veredicto["si_no_hubiera_efectivo"] == "AAA"
    assert "(lista de abajo). Esa posición" not in motivo
    assert motivo.index("Esa posición abierta sin valorar") < motivo.index("se revisaría primero AAA")


from tests.test_sizing_wiring import _lista_corta_dimensionada, señal  # noqa: E402


def test_el_motivo_del_tipo_va_junto_a_no_se_pudo_pasar_a_dolares():
    """El paréntesis del tipo de cambio iba al final, tras «el tamaño puede
    quedarse corto o pasarse (…)», como si explicara eso; y un motivo con su
    punto final daba «….).»."""
    nota = _lista_corta_dimensionada(
        [señal("A", 1.2), señal("B", 0.2, last=50.0)], {"B": {"quantity": 10}, "BTC-USD": {"quantity": 1}},
        efectivo_motivo="efectivo en EUR sin tipo de cambio: no se supone 1:1.",
    )["sizing"]["nota"]
    assert "no se pudo pasar a dólares (efectivo en EUR sin tipo de cambio: no se supone 1:1), y con" in nota
    assert nota.endswith("puede quedarse corto o pasarse.")


# --- Cartera --------------------------------------------------------------------

from datetime import date  # noqa: E402

from app.analysis import fx as fx_mod  # noqa: E402
from app.analysis import risk_budget  # noqa: E402
from app.analysis.decision import _stop_pct, vol_diaria_pct  # noqa: E402
from app.cache.cache import CacheStore  # noqa: E402
from app.main import app  # noqa: E402
from app.providers.base import iso_utc  # noqa: E402
from tests.test_cartera_revision9 import Servicio, _cliente, _historico, _posicion  # noqa: E402
from tests.test_revision10 import _ServicioConLargo  # noqa: E402


def test_un_largo_de_dias_sin_copia_reciente_no_mide_el_stop_ni_el_estres(session_factory):
    """Sin la comprobación de antigüedad del largo pasaba toda la suite: el test
    de la décima siempre tenía una copia de un año más reciente que ganaba."""
    reloj = {"ahora": datetime.now(timezone.utc) - timedelta(days=6)}
    cache = CacheStore(session_factory, now=lambda: reloj["ahora"])
    cache.set("price_history_long", {"symbol": "AAPL"}, {"symbol": "AAPL", "bars": _historico(1, dias=400)})
    reloj["ahora"] = datetime.now(timezone.utc)
    _posicion(session_factory, "AAPL")
    c = _cliente(session_factory, Servicio(cache))
    try:
        r = c.get("/api/portfolio").json()
    finally:
        app.dependency_overrides.clear()
    assert r["positions"][0]["stop_por_clase"] is True
    assert "AAPL" in r["estres"]["sin_historico"]


class _Fred(Servicio):
    """FRED como el de verdad en lo que importa aquí: solo desde `start`."""

    def __init__(self, cache, puntos_fx):
        super().__init__(cache, puntos_fx=puntos_fx)
        self.inicios = []

    def get(self, data_type, **kw):
        if data_type == "macro":
            self.inicios.append(kw.get("start"))
            puntos = [p for p in self.puntos_fx if p["ts"] >= (kw.get("start") or "")]
            return {"source": "fake", "as_of": iso_utc(), "cached": False, "series_id": kw["series_id"], "points": puntos}
        return super().get(data_type, **kw)


def test_la_serie_de_cambio_llega_a_2008_tambien_dentro_de_un_ano(session_factory, monkeypatch):
    """Contada desde hoy, a partir del 5-10-2027 la serie de cambio dejaba de
    cubrir 2008 y el episodio se medía desde donde empezara, sin decirlo; y
    /riesgo pedía otra ventana que la Cartera (otra descarga por divisa y día)."""
    # Las ventanas largas, contadas como lo serán el 1-6-2028 (la de un mes, que
    # da el tipo de hoy, como hoy).
    original = fx_mod.inicio_de_ventana
    monkeypatch.setattr(fx_mod, "inicio_de_ventana", lambda hoy=None, dias=30: original(
        date(2028, 6, 1) if dias > 365 else hoy, dias))
    hoy = date.today()
    inicio = date(2006, 1, 2)
    dias = (hoy - inicio).days
    plano = [{"ts": f"{inicio + timedelta(days=i)} 00:00:00", "close": 137.0} for i in range(dias)]
    cache = CacheStore(session_factory)
    cache.set("price_history_long", {"symbol": "RY.TO"}, {"symbol": "RY.TO", "bars": plano})

    def tipo(d):
        if d < date(2007, 10, 9):
            return 0.95
        if d < date(2009, 3, 9):
            return 0.95 + 0.35 * (d - date(2007, 10, 9)).days / (date(2009, 3, 9) - date(2007, 10, 9)).days
        return 1.30
    puntos = [{"ts": (inicio + timedelta(days=i)).isoformat(), "value": f"{tipo(inicio + timedelta(days=i)):.4f}"}
              for i in range(0, dias, 7)]
    _posicion(session_factory, "RY.TO", moneda="CAD", coste=137.0)
    servicio = _Fred(cache, puntos)
    c = _cliente(session_factory, servicio)
    try:
        c.get("/api/portfolio")
        r = c.get("/api/portfolio/riesgo?descargar=false").json()
    finally:
        app.dependency_overrides.clear()
    crisis_2008 = next(x for x in r["estres"]["crisis"] if x["clave"] == "2008")
    assert crisis_2008["max_drawdown_pct"] is not None and crisis_2008["max_drawdown_pct"] < -20
    # Aparte del tipo de hoy (la ventana de un mes), una sola ventana larga.
    largas = set(servicio.inicios) - {original()}
    assert len(largas) == 1 and min(largas) <= "2007-10-09"


def test_una_apertura_de_hace_diez_meses_se_mide_con_la_ventana_entera(session_factory):
    """Con la apertura a 9-11 meses, el año dejaba entre 21 y 62 cierres antes de
    abrir y el stop se congelaba con esos: el largo solo se usaba si la
    volatilidad salía None."""
    largo = _historico(8, dias=700, sigma=0.01)
    apertura = date.today() - timedelta(days=230)
    # El año de histórico: los cierres de antes de abrir, en calma; los de
    # después, agitados (no deben contar).
    reciente = [dict(b) for b in largo[-252:]]
    c = _cliente(session_factory, _ServicioConLargo(CacheStore(session_factory), {"AAPL": reciente}, largo))
    try:
        r = c.post("/api/portfolio/positions", json={
            "symbol": "AAPL", "quantity": 1, "cost_basis": 100.0, "opened_at": f"{apertura.isoformat()}T15:00:00+00:00"})
        stop = c.get("/api/portfolio").json()["positions"][0]["stop"]
    finally:
        app.dependency_overrides.clear()
    antes = [b["close"] for b in largo if b["ts"][:10] < apertura.isoformat()]
    assert 21 <= len([b for b in reciente if b["ts"][:10] < apertura.isoformat()]) < 63
    assert r.json()["stop_por_clase"] is False
    assert stop == round(100 * (1 - _stop_pct(vol_diaria_pct(antes)) / 100), 2)


def test_el_riesgo_abierto_se_suma_sin_redondear():
    """Tres posiciones de 2,004 % daban «6,0 %, quedan 0,0 % de margen» y ningún
    aviso, con un 6,012 % en riesgo."""
    posiciones = [{"symbol": s, "sector": s, "market_value": 20040.0, "price": 100.0, "stop": 90.0}
                  for s in ("AAA", "BBB", "CCC")]
    r = risk_budget.presupuesto_de_riesgo(posiciones, 100000.0)
    assert r["riesgo_total_pct"] > risk_budget.HEAT_MAXIMO_PCT
    assert r["margen_pct"] == 0
    assert r["avisos"] and "un 6,01\u00a0%" in r["avisos"][0]


def test_opciones_la_realizada_sale_de_la_copia_reciente(session_factory):
    """El largo (7 días en la caché) se leía primero: con la copia de un año de
    hace 7 h al lado, la realizada de 30 días salía de cierres de hace 6 días y
    la prima, comparada con la IV de hoy, quedaba guardada."""
    from app.routers import options as options_router

    reloj = {"ahora": datetime.now(timezone.utc) - timedelta(days=6)}
    cache = CacheStore(session_factory, now=lambda: reloj["ahora"])
    largo = _historico(1, dias=700, hasta=date.today() - timedelta(days=6))
    cache.set("price_history_long", {"symbol": "AAPL"}, {"symbol": "AAPL", "bars": largo})
    reloj["ahora"] = datetime.now(timezone.utc) - timedelta(hours=7)
    reciente = _historico(2, sigma=0.03)
    cache.set("price_history", {"symbol": "AAPL", "interval": "1day", "outputsize": 252},
              {"symbol": "AAPL", "bars": reciente})
    reloj["ahora"] = datetime.now(timezone.utc)
    todos, recientes = options_router._cierres(Servicio(cache), "AAPL")
    assert recientes[-1] == (date.today(), reciente[-1]["close"])
    # El largo sigue dando lo anterior, para los resultados de hace dos años.
    assert todos[-1] == recientes[-1] and todos[0][0] == date.fromisoformat(largo[0]["ts"][:10])


def test_comparables_el_r2_y_el_intervalo_de_su_lado():
    """0,2996 era «R² = 0,30» junto a «explican poco», con el mínimo en 0,30; y
    22,44 fuera de 15,02–22,36 se leía «15,0–22,4. Cotiza a 22,4»."""
    from app.analysis import relative_value as rv

    assert "R² = 0,2996 con 12 pares" in rv._leer(False, 0.2996, 12, 9, False, {"multiplo": 22.44}, 18.7, (15.02, 22.36), "P/E")
    nota = rv._leer(True, 0.45, 12, 9, False, {"multiplo": 22.444}, 18.7, (15.021, 22.364), "P/E")
    assert "P/E de 15,02–22,36" in nota and "Cotiza a 22,44." in nota
