"""Revisión 10 (sobre ca24ed8): cifras de su lado de sus umbrales en «Qué
cambió», la IA, el informe a fondo, la salud y el riesgo abierto; distancias que
no se escriben como cero; la nota de la base con efectivo sin tipo de cambio; y
la lista de «qué se revisaría» solo cuando algo se revisaría."""

from __future__ import annotations

from app.analysis import cambios, coste_de_oportunidad, deep_dive, health, risk_budget
from app.analysis.decision import decide
from app.llm import signal_llm
from app.llm.base import LLMProvider

PRECIO = {"last": 110.0, "sma200": 100.0, "above_sma200": True, "daily_vol_pct": 1.2}


def test_que_cambio_sirve_los_umbrales_con_que_escribe_la_puntuacion():
    """La fila escribía el 0,3496 de antes con los umbrales de la traza de ahora
    (con posición, solo el de vender): «+0,35» en la fila y «+0,3496» en la
    explicación del mismo panel."""
    antes = decide({"symbol": "X", "score": 0.3496}, PRECIO)
    pos = {"cost_basis": 100.0, "quantity": 10, "stop": 80.0}
    ahora = decide({"symbol": "X", "score": -0.36}, PRECIO, pos)
    d = cambios.comparar_decisiones(antes, ahora, None, pos)
    assert d["umbrales_puntuacion"] == [-0.35, 0.35]


class _LLM(LLMProvider):
    name, model = "falso", "falso"

    def __init__(self):
        self.prompt = ""

    def interpret(self, system, prompt):
        self.prompt = prompt
        return {"content": "texto", "model": self.model}


def test_la_ia_recibe_la_puntuacion_de_su_lado_de_la_etiqueta():
    """Con 0,3496 recibía «+0,35 / neutral»; con 0,99996, «+1,00 / favorable»."""
    llm = _LLM()
    signal_llm.explain_signal(llm, {"symbol": "X", "score": 0.3496, "label": "neutral", "coverage": 1.0,
                                    "contributions": {}, "horizon": "6-12 meses"}, {})
    assert "Puntuación compuesta (z-score frente al universo): +0,3496" in llm.prompt


def test_el_objetivo_y_la_distancia_al_coste_no_se_escriben_como_cero():
    """«Objetivo 127,40 0,0 %» con el precio en 127,35, y «un 0,0 % bajo tu coste»
    con el coste medio en 100,03 y el stop en 100."""
    pos = {"cost_basis": 100.0, "quantity": 10, "stop": 80.0}
    objetivo = decide({"symbol": "X", "score": 0.6}, PRECIO, pos)["levels"]["objetivo"]
    cerca = decide({"symbol": "X", "score": 0.6}, {**PRECIO, "last": objetivo - 0.05}, pos)
    assert cerca["levels"]["objetivo_pct"] != 0 and abs(cerca["levels"]["objetivo_pct"]) < 0.05
    perforado = decide({"symbol": "X", "score": 0.6}, {**PRECIO, "last": 99.0},
                       {"cost_basis": 100.03, "quantity": 10, "stop": 100.0})
    razon = " ".join(perforado["reasons"])
    assert "bajo tu coste" in razon and "un 0,0 %" not in razon and "0,03" in razon


def test_la_lista_de_abajo_solo_si_algo_se_revisaria():
    """Con una sola posición en tenencia mínima, «la lista de abajo dice qué se
    revisaría primero» y no se revisaría nada."""
    cand = {"symbol": "IDEA", "accion": "comprar", "tesis": "intacta", "valoracion": "barata", "confianza": "alta"}
    p = {"symbol": "AAA", "peso": 0.5, "accion": "mantener", "tesis": "intacta", "valoracion": "razonable",
         "confianza": "media", "precio": 100.0, "coste_medio": 90.0, "dias_en_cartera": 5,
         "lectura_de": "2026-09-01T00:00:00+00:00"}
    r = coste_de_oportunidad.evaluar(cand, [p], tamano_maximo=0.04, efectivo=None, coste_por_lado_pct=0.1)
    assert r["veredicto"]["si_no_hubiera_efectivo"] is None
    assert "lista de abajo" not in r["veredicto"]["motivo"]


def test_el_informe_escribe_cada_ratio_de_su_lado_de_sus_umbrales():
    """0,596 y 0,604 salían «60 %», uno «solo» y otro «saludable»; la cobertura
    1,96 y 2,04, «2,0× — frágil» y «2,0× — ajustada»."""
    assert "59,6" in deep_dive._cash_reading(100, 0.596) and "60,4" in deep_dive._cash_reading(100, 0.604)
    assert "1,96×" in deep_dive._debt_reading(None, 1.96, None) and "2,04×" in deep_dive._debt_reading(None, 2.04, None)
    assert "2,004" in deep_dive._debt_reading(2.004, None, None)


def test_altman_sirve_las_fronteras_de_sus_zonas():
    """2,9904 y 2,9896 salían «2,99», uno «segura» y otro «gris»."""
    z = health.altman_z({}, None)
    assert z["umbrales"] == [health.ALTMAN_RIESGO, health.ALTMAN_SEGURA]


def test_el_riesgo_abierto_se_escribe_de_su_lado_del_tope():
    """Con 6,03 decía «un 6,0 % … por encima del 6 %»."""
    posicion = {"symbol": "AAA", "sector": "Tech", "market_value": 10000.0, "price": 100.0, "stop": 39.7}
    r = risk_budget.presupuesto_de_riesgo([posicion], 100000.0)
    assert r["riesgo_total_pct"] == 6.03
    assert "6,03" in r["avisos"][0]


# --- Cartera ------------------------------------------------------------------

from datetime import date, datetime, timedelta, timezone  # noqa: E402

from app.analysis.decision import _stop_pct, vol_diaria_pct  # noqa: E402
from app.cache.cache import CacheStore  # noqa: E402
from app.main import app  # noqa: E402
from tests.test_cartera_revision9 import Servicio, _cliente, _historico, _params, _posicion  # noqa: E402


def test_un_historico_largo_de_dias_no_mide_el_stop_ni_pisa_al_reciente(session_factory):
    """El largo vive 7 días en la caché y se servía antes que la copia de un año
    de hace 7 h: la Cartera daba el stop perforado y la ficha no."""
    reloj = {"ahora": datetime.now(timezone.utc) - timedelta(days=6)}
    cache = CacheStore(session_factory, now=lambda: reloj["ahora"])
    cache.set("price_history_long", {"symbol": "AAPL"}, {"symbol": "AAPL", "bars": _historico(1, sigma=0.005)})
    reloj["ahora"] = datetime.now(timezone.utc) - timedelta(hours=7)
    reciente = _historico(2, sigma=0.03)
    cache.set("price_history", _params("AAPL"), {"symbol": "AAPL", "bars": reciente})
    reloj["ahora"] = datetime.now(timezone.utc)
    _posicion(session_factory, "AAPL")
    c = _cliente(session_factory, Servicio(cache))
    try:
        p = c.get("/api/portfolio").json()["positions"][0]
    finally:
        app.dependency_overrides.clear()
    assert p["stop"] == round(100 * (1 - _stop_pct(vol_diaria_pct([b["close"] for b in reciente])) / 100), 2)


class _ServicioCaido(Servicio):
    """Las fuentes caídas: el histórico llega como rescate `viejo` de la caché."""

    def __init__(self, cache, bars, antiguedad):
        super().__init__(cache)
        self.bars, self.antiguedad = bars, antiguedad

    def get(self, data_type, **kw):
        if data_type == "price_history":
            return {"bars": self.bars, "estado": "viejo", "antiguedad_segundos": self.antiguedad, "as_of": None}
        return super().get(data_type, **kw)


def test_al_abrir_con_las_fuentes_caidas_vale_una_copia_de_horas(session_factory):
    """Se rechazaba cualquier `viejo` y se congelaba el punto medio de la clase,
    con una copia de 7 h que el listado sí da por buena."""
    barras = _historico(4)
    c = _cliente(session_factory, _ServicioCaido(CacheStore(session_factory), barras, 7 * 3600))
    try:
        r = c.post("/api/portfolio/positions", json={"symbol": "AAPL", "quantity": 1, "cost_basis": 100.0})
    finally:
        app.dependency_overrides.clear()
    assert r.json()["stop_por_clase"] is False


class _ServicioConLargo(Servicio):
    def __init__(self, cache, historias, largo):
        super().__init__(cache, historias)
        self.largo = largo

    def get(self, data_type, **kw):
        if data_type == "price_history_long":
            return {"bars": self.largo, "as_of": datetime.now(timezone.utc).isoformat()}
        return super().get(data_type, **kw)


def test_una_apertura_de_hace_mas_de_un_ano_se_mide_con_el_historico_largo(session_factory):
    """Con la apertura más allá del año de histórico quedaban menos de 21 cierres
    anteriores y siempre se congelaba el punto medio de la clase."""
    largo = _historico(6, dias=900, sigma=0.01)
    apertura = date.today() - timedelta(days=400)
    c = _cliente(session_factory, _ServicioConLargo(CacheStore(session_factory), {"AAPL": largo[-252:]}, largo))
    try:
        r = c.post("/api/portfolio/positions", json={
            "symbol": "AAPL", "quantity": 1, "cost_basis": 100.0, "opened_at": f"{apertura.isoformat()}T15:00:00+00:00"})
        stop = c.get("/api/portfolio").json()["positions"][0]["stop"]
    finally:
        app.dependency_overrides.clear()
    entonces = vol_diaria_pct([b["close"] for b in largo if b["ts"][:10] < apertura.isoformat()])
    assert r.json()["stop_por_clase"] is False
    assert stop == round(100 * (1 - _stop_pct(entonces) / 100), 2)


def test_el_estres_de_crisis_va_en_dolares(session_factory):
    """RY.TO plano en CAD de 2007 a hoy, con el CAD de 0,95 a 1,30: en 2008 «se
    habría quedado plana» y en dólares caía un 26,9 %."""
    hoy = date.today()
    inicio = date(2007, 1, 2)
    dias = (hoy - inicio).days
    plano = [{"ts": f"{inicio + timedelta(days=i)} 00:00:00", "close": 137.0} for i in range(0, dias, 1)]
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
    c = _cliente(session_factory, Servicio(cache, puntos_fx=puntos))
    try:
        r = c.get("/api/portfolio/riesgo?descargar=false").json()
    finally:
        app.dependency_overrides.clear()
    crisis_2008 = next(x for x in r["estres"]["crisis"] if x["clave"] == "2008")
    assert crisis_2008["max_drawdown_pct"] is not None and crisis_2008["max_drawdown_pct"] < -20
