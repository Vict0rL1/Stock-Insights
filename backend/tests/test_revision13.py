"""Decimotercera revisión (sobre 86dbd6a): cada test reproduce un hallazgo
confirmado y falla sin su arreglo."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db.engine import get_session
from app.db.models import Instrument, Position
from app.deps import get_service
from app.main import app
from tests.test_portfolio_estres import FakeService, _historico

# --- Estrés del Portafolio: el largo vale mientras siga en la caché -----------


def _hace(horas: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=horas)).isoformat()


def _con_largo_de_hace(horas: float, con_historico=("AAPL", "MSFT")) -> FakeService:
    """El largo de «Descargar histórico completo», guardado hace `horas`."""
    sv = FakeService(con_historico=con_historico)
    for i, s in enumerate(("AAPL", "MSFT")):
        sv.cache.set("price_history_long", {"symbol": s},
                     {"symbol": s, "bars": _historico(i + 10, dias=700), "fetched_at": _hace(horas)})
    return sv


@pytest.fixture
def portafolio(session_factory):
    def override_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    def _hacer(service):
        with session_factory() as s:
            for symbol in ("AAPL", "MSFT"):
                inst = Instrument(symbol=symbol, name=symbol, sector="Tech")
                s.add(inst)
                s.flush()
                s.add(Position(instrument_id=inst.id, quantity=10, cost_basis=100.0,
                               opened_at=datetime.now(timezone.utc)))
            s.commit()
        app.dependency_overrides[get_service] = lambda: service
        app.dependency_overrides[get_session] = override_session
        return TestClient(app).get("/api/portfolio").json()["estres"]

    yield _hacer
    app.dependency_overrides.clear()


def test_un_dia_despues_de_descargar_el_largo_el_estres_sigue_midiendo_12_meses(portafolio):
    """Con el largo de hace 30 h, el Portafolio volvía a decir que el histórico
    no llega a 12 meses, perdía «Peor 12 meses» y la nota afirmaba «De AAPL,
    MSFT solo hay guardado el último año» con 700 sesiones guardadas, que
    Cartera seguía usando."""
    estres = portafolio(_con_largo_de_hace(30))
    assert estres["peor_ventana_pct"] is not None
    assert estres["años_cubiertos"] > 1.5
    assert "solo hay guardado el último año" not in (estres["peor_ventana_nota"] or "")


def test_el_tramo_final_del_estres_sale_de_la_copia_del_stop():
    """El largo de hace 6 días solo aporta lo anterior: el final es el de la copia
    de un año, la misma que mide el stop (revisión 10)."""
    from app.routers.portfolio import _historico_cacheado, _series_cacheadas

    sv = _con_largo_de_hace(24 * 6)
    series, sin_largo, motivos = _series_cacheadas(sv, ["AAPL"])
    ano = _historico_cacheado(sv, "AAPL")
    assert series["AAPL"][-1] == (date.fromisoformat(ano[-1]["ts"][:10]), ano[-1]["close"])
    assert len(series["AAPL"]) == 700 and sin_largo == [] and motivos == {}


def test_la_costura_no_inventa_un_salto_de_precio():
    """El largo de Yahoo viene ajustado por dividendos y el año puede venir de
    Twelve Data, sin ajustar; un split entre las dos descargas parte la serie
    por la mitad. Empalmadas tal cual, la costura era una caída del 50 % que no
    ocurrió."""
    from app.routers.portfolio import _cierres_empalmados

    sv = FakeService(con_historico=())
    largo = _historico(3, dias=700)
    sv.cache.set("price_history_long", {"symbol": "AAPL"},
                 {"symbol": "AAPL", "bars": largo, "fetched_at": _hace(48)})
    # Tras un split 2×1: la copia de un año, a la mitad de precio.
    sv.cache.set("price_history", {"symbol": "AAPL", "interval": "1day", "outputsize": 252},
                 {"symbol": "AAPL", "bars": [{**b, "close": b["close"] / 2} for b in largo[-252:]]})
    todos, recientes, con_largo = _cierres_empalmados(sv, "AAPL")
    assert con_largo and len(todos) == 700 and todos[-252:] == recientes
    costura = len(todos) - 252
    assert todos[costura][1] / todos[costura - 1][1] == pytest.approx(
        largo[costura]["close"] / largo[costura - 1]["close"])


def test_sin_copia_reciente_el_estres_dice_que_el_largo_acaba_hace_dias(portafolio):
    """El largo de hace 6 días sin ninguna copia de un año que valga: fuera del
    estrés (cortaría a las demás en su última fecha), pero no «sin histórico
    guardado» con 700 sesiones guardadas."""
    estres = portafolio(_con_largo_de_hace(24 * 6, con_historico=()))
    assert estres["sin_historico"] == ["AAPL", "MSFT"]
    aviso = estres["aviso_sin_historico"]
    assert "sin histórico guardado" not in aviso
    assert "su histórico largo guardado acaba el" in aviso and "se refresca al abrir su ficha" in aviso


def test_sin_ningun_largo_la_nota_dice_cuanto_vale_el_que_baja_cartera(portafolio):
    estres = portafolio(FakeService(con_historico=("AAPL", "MSFT")))
    nota = estres["peor_ventana_nota"]
    assert "De AAPL, MSFT solo hay guardado el último año" in nota
    assert "mientras siga guardado (7 días)" in nota and "menos de un día" not in nota


# --- Informe a fondo: lo que no se pudo comprobar llega a la IA ---------------

from app.analysis.deep_dive import assemble  # noqa: E402
from app.providers.router import AllProvidersFailedError  # noqa: E402
from app.routers.deep_dive import _narrative_prompt  # noqa: E402
from tests.fakes_empresa import AHORA, ServicioFalso, financieros_base  # noqa: E402
from tests.test_deep_dive import _periods  # noqa: E402


def _seccion(prompt: str, titulo: str) -> str:
    return prompt[prompt.index(titulo):].split("\n\n")[0]


def test_la_ia_no_recibe_ningun_riesgo_si_la_deuda_no_se_pudo_comprobar():
    """«RIESGOS DETECTADOS EN LOS DATOS — Ninguno relevante detectado» con la
    deuda/capital, la cobertura y la máxima caída sin calcular."""
    periodos = _periods(2)
    for p in periodos:
        for clave in ("long_term_debt", "short_term_debt", "interest_expense", "equity"):
            p.pop(clave, None)
    informe = assemble("ACME", {}, {"periods": periodos}, {"cheapness_score": None}, None, None, None, [], [], [], None)
    assert informe["risks"] == [] and "deuda/capital" in informe["riesgos_sin_comprobar"]
    riesgos = _seccion(_narrative_prompt("ACME", informe), "RIESGOS DETECTADOS")
    assert "Ninguno relevante detectado" not in riesgos
    assert "- Ninguno entre lo que se pudo comprobar" in riesgos
    assert "deuda/capital" in riesgos and "máxima caída del último año" in riesgos


def test_con_todo_comprobado_y_sin_riesgos_se_dice_ninguno():
    informe = assemble("ACME", {}, {"periods": _periods(8)}, {"cheapness_score": 0.5}, None,
                       {"max_drawdown": {"max_drawdown": -0.1}}, None, [], [], [], None)
    assert informe["riesgos_sin_comprobar"] == [] and informe["risks"] == []
    assert _seccion(_narrative_prompt("ACME", informe), "RIESGOS DETECTADOS").endswith("- Ninguno relevante detectado")


class _FuentesCaidas(ServicioFalso):
    caidas: set[str] = set()

    def get(self, tipo, **kw):
        if tipo in self.caidas:
            raise AllProvidersFailedError(tipo, {"finnhub": "límite de llamadas"})
        return super().get(tipo, **kw)


def _informe(caidas: set[str]) -> dict:
    sv = _FuentesCaidas(AHORA).empresa("ACME", periodos=financieros_base())
    sv.caidas = caidas
    app.dependency_overrides[get_service] = lambda: sv
    try:
        r = TestClient(app).get("/api/deep-dive/ACME")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200
    return r.json()


def test_con_el_calendario_caido_los_catalizadores_no_dicen_ninguno():
    """`_safe` devolvía None, el router pasaba una lista vacía y el informe decía
    «Resultados previstos en los próximos 120 días…» y el prompt «Ninguno
    identificado»: un fallo convertido en «ninguno»."""
    informe = _informe({"earnings_calendar"})
    assert informe["catalysts"] == []
    assert informe["catalysts_sin_comprobar"] == ["calendario de resultados"]
    assert not informe["catalysts_note"].startswith("Resultados previstos")
    assert "No se pudo consultar el calendario de resultados" in informe["catalysts_note"]
    catalizadores = _seccion(_narrative_prompt("ACME", informe), "CATALIZADORES")
    assert "Ninguno identificado" not in catalizadores
    assert "No se pudo consultar (no se sabe qué traen): calendario de resultados" in catalizadores


def test_con_el_calendario_y_los_filings_caidos_no_se_sabe_que_hay():
    informe = _informe({"earnings_calendar", "filings"})
    assert informe["catalysts_sin_comprobar"] == ["calendario de resultados", "documentos presentados ante la SEC"]
    assert informe["catalysts_note"].startswith("No se pudo consultar ni el calendario")


def test_un_calendario_que_responde_sin_eventos_sigue_siendo_ninguno():
    """Que la fuente diga que no hay es una lista vacía, no «sin comprobar»."""
    informe = _informe(set())
    assert informe["catalysts_sin_comprobar"] == []
    assert informe["catalysts_note"].startswith("Resultados previstos en los próximos 120 días")
    assert _seccion(_narrative_prompt("ACME", informe), "CATALIZADORES").endswith("- Ninguno identificado")


# --- Expectativas: el modelo corregido es otra fuente ---------------------------

from app import expectativas as svc  # noqa: E402
from app.db.models import EventActual, Expectation, Thesis, ThesisTrigger  # noqa: E402
from tests.fakes_empresa import trimestre  # noqa: E402

RECAPTURA = datetime(2026, 4, 20, tzinfo=timezone.utc)  # el 2026-Q1 aún sin publicar


def _hasta_2025() -> list[dict]:
    qs = []
    for ano in (2024, 2025):
        for q in (1, 2, 3, 4):
            base = 100.0 * (1.1 if ano == 2025 else 1.0) + q
            qs.append(trimestre(ano, q, f"{ano}-{q * 3 + 1:02d}-28" if q < 4 else f"{ano + 1}-02-10",
                                revenue=base, operating_income=base * 0.2, gross_profit=base * 0.45,
                                eps_diluted=base / 100))
    return qs


def _evento_con_fila_v1(s, objetivo: str):
    """El evento del 2026-Q2 con la fila de ingresos que dejó una captura v1."""
    e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q2", fecha_prevista="2026-07-30", ahora=RECAPTURA)
    s.add(Expectation(event_id=e.id, metrica="revenue", fuente_tipo="modelo_interno", fuente="app: modelo interno v1",
                      valor=105.0, unidad="USD", informacion_hasta=RECAPTURA, registrado_en=RECAPTURA,
                      detalle={"trimestre_objetivo_fin": objetivo}))
    s.commit()
    return e


def _servicio_2025() -> ServicioFalso:
    sv = ServicioFalso(RECAPTURA)
    sv.financials["AAPL"] = {"periods": [], "quarters": _hasta_2025(), "as_of": RECAPTURA.isoformat()}
    return sv


def test_recapturar_sobre_una_fila_v1_de_otro_trimestre_registra_la_corregida_y_lo_dice(session_factory):
    """La fila v1 (trimestre que cierra el 31 mar) bloqueaba por la restricción
    única la corregida (30 jun): la respuesta daba el trimestre nuevo y solo
    «ya_existian: 1», sin avisar, y la misma fuente quedaba con dos trimestres."""
    with session_factory() as s:
        e = _evento_con_fila_v1(s, "2026-03-31")
        cap = svc.capturar(s, _servicio_2025(), e, RECAPTURA)
        filas = s.query(Expectation).filter_by(fuente_tipo="modelo_interno", metrica="revenue").all()
        por_fuente = {f.fuente: f.detalle["trimestre_objetivo_fin"] for f in filas}
        # Ninguna fuente con dos trimestres en el evento.
        assert {f.fuente for f in s.query(Expectation).filter_by(fuente_tipo="modelo_interno")
                if f.detalle["trimestre_objetivo_fin"] == "2026-06-30"} == {svc.FUENTE_MODELO_INTERNO}
    assert cap["trimestre_objetivo_fin"] == "2026-06-30"
    assert por_fuente == {"app: modelo interno v1": "2026-03-31", svc.FUENTE_MODELO_INTERNO: "2026-06-30"}
    assert {"metrica": "revenue", "fuente_tipo": "modelo_interno", "fuente": svc.FUENTE_MODELO_INTERNO} in cap["registradas"]
    assert cap["ya_existian"] == 0
    aviso = next(m for m in cap["sin_fuente"] if m.startswith("modelo interno: la estimación de"))
    assert "31 mar 2026" in aviso and "30 jun 2026" in aviso and "se registra aparte" in aviso


def test_una_fila_v1_del_trimestre_correcto_no_se_duplica(session_factory):
    """La v1 con el trimestre bien elegido calculaba lo mismo: otra fila v2 haría
    contar dos veces el evento en la calibración del modelo interno."""
    with session_factory() as s:
        e = _evento_con_fila_v1(s, "2026-06-30")
        cap = svc.capturar(s, _servicio_2025(), e, RECAPTURA)
        filas = s.query(Expectation).filter_by(fuente_tipo="modelo_interno", metrica="revenue").all()
    assert [f.fuente for f in filas] == ["app: modelo interno v1"]
    assert cap["ya_existian"] == 1 and not any("revenue" == r["metrica"] for r in cap["registradas"]
                                                 if r["fuente_tipo"] == "modelo_interno")
    assert not any(m.startswith("modelo interno: la estimación de") for m in cap["sin_fuente"])


def test_la_calibracion_cuenta_la_corregida_una_vez_y_deja_fuera_la_v1(session_factory):
    with session_factory() as s:
        e = _evento_con_fila_v1(s, "2026-03-31")
        svc.capturar(s, _servicio_2025(), e, RECAPTURA)
        s.add(EventActual(event_id=e.id, metrica="revenue", valor=130.0, unidad="USD", fuente="edgar Q-2026-2",
                          publicado="2026-07-30", registrado_en=datetime(2026, 8, 3, tzinfo=timezone.utc),
                          detalle={"periodo": "2026-Q2", "periodo_fin": "2026-06-30"}))
        s.commit()
        c = svc.calibracion(s, "AAPL")
        lectura = svc.evaluar(s, e)
    assert c["por_fuente"]["modelo_interno"]["total"]["n"] == 1 and c["excluidos_otro_trimestre"] == 1
    ingresos = [x for x in lectura["por_fuente"]["modelo_interno"] if x["metrica"] == "revenue"]
    assert [x["lectura"] for x in ingresos] == ["desconocido", "supera"]
    assert lectura["no_comparables"] == []


def test_con_fecha_prevista_y_sin_otro_trimestre_cerrado_el_motivo_es_el_real(session_factory):
    """Decía «sin periodo legible ni fecha prevista» con la fecha prevista puesta:
    el evento del 5 mar llega antes de que cierre otro trimestre tras el 2025-Q4."""
    cuando = datetime(2026, 2, 15, tzinfo=timezone.utc)
    sv = ServicioFalso(cuando)
    sv.financials["AAPL"] = {"periods": [], "quarters": [q for q in _hasta_2025() if q["periodo"].startswith("2025-")],
                             "as_of": cuando.isoformat()}
    with session_factory() as s:
        e = svc.crear_evento(s, "AAPL", "earnings", fecha_prevista="2026-03-05", ahora=cuando)
        cap = svc.capturar(s, sv, e, cuando)
    assert cap["trimestre_objetivo_fin"] is None
    motivo = next(m for m in cap["sin_fuente"] if m.startswith("modelo interno"))
    assert "sin periodo legible ni fecha prevista" not in motivo
    assert "la fecha prevista (5 mar 2026)" in motivo and "2025-Q4, que cierra el 31 dic 2025" in motivo


# --- Expectativas: cada punto del impacto en la tesis, con su tesis y su id ------


def test_el_impacto_en_la_tesis_dice_de_que_tesis_y_de_que_punto_es(session_factory):
    """«Qué cambió» contaba dos veces el mismo punto cruzado (la vigilancia lo mira
    con el ejercicio y esto con el trimestre) y `_reglas_de_tesis` recorre todas
    las tesis del símbolo mientras la pantalla enseña la más reciente: sin ids no
    había con qué agruparlos ni filtrar."""
    cuando = datetime(2026, 4, 20, tzinfo=timezone.utc)
    with session_factory() as s:
        inst = Instrument(symbol="AAPL")
        s.add(inst)
        s.commit()
        ids = {}
        for n, titulo in enumerate(("vieja", "nueva")):
            creada = cuando - timedelta(days=60 - n)
            t = Thesis(instrument_id=inst.id, title=titulo, body_md="b", created_at=creada, updated_at=creada)
            s.add(t)
            s.commit()
            metrica = ThesisTrigger(thesis_id=t.id, kind="metrica", descripcion=f"margen operativo < 18 % ({titulo})",
                                    config={"metrica": "operating_margin", "op": "lt", "umbral": 0.18}, created_at=creada)
            noticia = ThesisTrigger(thesis_id=t.id, kind="noticia", descripcion=f"recall ({titulo})",
                                    config={"palabras": ["recall"]}, created_at=creada)
            s.add_all([metrica, noticia])
            s.commit()
            ids[titulo] = (t.id, metrica.id, noticia.id)
        e = svc.crear_evento(s, "AAPL", "earnings", periodo="2026-Q2", fecha_prevista="2026-07-30", ahora=cuando)
        svc.capturar(s, _servicio_2025(), e, cuando)
        s.add(EventActual(event_id=e.id, metrica="operating_margin", valor=0.15, unidad="fracción",
                          fuente="edgar Q-2026-2", publicado="2026-07-30",
                          registrado_en=datetime(2026, 8, 3, tzinfo=timezone.utc),
                          detalle={"periodo": "2026-Q2", "periodo_fin": "2026-06-30"}))
        s.commit()
        impacto = svc.evaluar(s, e)["impacto_en_tesis"]
    por_punto = {i["punto"]: (i["tesis_id"], i["disparador_id"], i["estado"]) for i in impacto}
    for titulo, (tesis_id, metrica_id, noticia_id) in ids.items():
        assert por_punto[f"margen operativo < 18 % ({titulo})"] == (tesis_id, metrica_id, "invalidado")
        assert por_punto[f"recall ({titulo})"] == (tesis_id, noticia_id, "sin_resolver")


def test_una_regla_guardada_sin_tesis_id_la_saca_de_su_punto():
    from app.analysis import expectativas as ev

    regla = {"metrica": "operating_margin", "operador": "gte", "valor": 0.18, "fuente_tipo": "reglas",
             "fuente": "tesis #4, punto #9", "detalle": {"descripcion": "margen", "trigger_id": 9}}
    i = ev.impacto_en_tesis([regla], {"operating_margin": {"valor": 0.2}},
                            [{"id": 9, "descripcion": "margen", "tesis_id": 4}])
    assert [(x["tesis_id"], x["disparador_id"]) for x in i] == [(4, 9)]


def test_que_cambio_lleva_los_ids_del_punto_tambien_desde_los_resultados():
    from app.analysis import cambios

    antes = {"id": 4, "disparadores": [{"id": 9, "descripcion": "margen", "salta": False, "medible": True}]}
    ahora = {"id": 4, "disparadores": [{"id": 9, "descripcion": "margen", "salta": True, "medible": True,
                                        "detalle": "15 %"}]}
    impacto = [{"punto": "margen", "estado": "invalidado", "tesis_id": 4, "disparador_id": 9, "periodo": "2026-Q2"}]
    invalidaciones = cambios.comparar_tesis(antes, ahora, impacto)["invalidaciones"]
    assert [(x["tesis_id"], x["disparador_id"]) for x in invalidaciones] == [(4, 9), (4, 9)]


# --- Qué cambió: «Sin datos → Mantener» dice qué reglas se evaluaron ------------

from app.analysis import cambios  # noqa: E402
from app.analysis.decision import decide  # noqa: E402


def test_sin_datos_a_mantener_no_acaba_en_dos_puntos():
    """Con posición y ninguna regla de venta cumplida, todas son «evaluada» y la
    explicación terminaba en «Ahora la acción sale de sus reglas:» sin nada."""
    precio = {"last": 110.0, "sma200": 100.0, "above_sma200": True, "daily_vol_pct": 1.2}
    pos = {"cost_basis": 100.0, "quantity": 10, "stop": 80.0}
    antes = decide({"symbol": "X", "score": None}, precio, pos)
    ahora = decide({"symbol": "X", "score": 0.1}, precio, pos)
    assert (antes["action"], ahora["action"]) == ("sin_datos", "mantener")
    explicacion = cambios.comparar_decisiones(antes, ahora, pos, pos)["explicacion"]
    assert explicacion[0].endswith("no se cumple ninguna de sus reglas y queda la acción por defecto:")
    assert "«Precio en o bajo el stop de la posición»: no se evaluaba → no cumple (110,00 frente a 80,00)." in explicacion
    assert len(explicacion) == 4


def test_sin_datos_a_mantener_con_una_regla_sin_comprobar_no_dice_que_ninguna_se_cumple():
    precio = {"last": 110.0, "sma200": None, "above_sma200": None, "daily_vol_pct": 1.2}
    pos = {"cost_basis": 100.0, "quantity": 10, "stop": 80.0}
    antes = decide({"symbol": "X", "score": None}, precio, pos)
    ahora = decide({"symbol": "X", "score": 0.1}, precio, pos)
    explicacion = cambios.comparar_decisiones(antes, ahora, pos, pos)["explicacion"]
    assert "alguna quedó sin comprobar" in explicacion[0]
    assert any(e.endswith("no se evaluaba → desconocido.") for e in explicacion[1:])


# --- Mercado: un calendario caído no es «ninguna empresa anuncia resultados» ----


class _Calendario:
    def __init__(self, eventos=None, falla=False):
        self.eventos, self.falla = eventos or [], falla

    def get(self, tipo, **kw):
        assert tipo == "earnings_calendar"
        if self.falla:
            raise AllProvidersFailedError("earnings_calendar", {"finnhub": "límite de llamadas"})
        return {"events": self.eventos, "source": "finnhub", "as_of": "2026-11-23T10:00:00+00:00"}


def _calendario(servicio) -> dict:
    app.dependency_overrides[get_service] = lambda: servicio
    try:
        return TestClient(app).get("/api/market/calendar").json()
    finally:
        app.dependency_overrides.clear()


def test_el_calendario_caido_no_se_sirve_como_lista_vacia():
    """Respondía 200 con `events: []` y la pantalla, que solo leía `events`,
    pintaba «Ninguna empresa anuncia resultados»: un ERROR como «nada»."""
    r = _calendario(_Calendario(falla=True))
    assert r["events"] is None and r["total"] is None
    # El motivo, para la pantalla: sin el código del tipo de dato.
    assert r["error"] == "ninguna fuente respondió (finnhub: límite de llamadas)"


def test_el_calendario_dice_cuantos_hay_antes_de_recortar():
    eventos = [{"symbol": f"S{i:03d}", "date": "2026-11-30"} for i in range(300)]
    r = _calendario(_Calendario(eventos))
    assert len(r["events"]) == 120 and r["total"] == 300 and r["error"] is None
