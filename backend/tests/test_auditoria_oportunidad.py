"""Auditoría del 19 oct: el efectivo y las lecturas del coste de oportunidad,
reconstruidos a una fecha, no pueden mirar el futuro.

A2: `efectivo_usd` convertía con el ÚLTIMO tipo de la serie, aunque fuera
posterior a la fecha de la decisión.

A4: una anotación de efectivo contaba en cuanto su saldo estaba fechado antes de
la decisión, aunque se hubiera escrito después; y mandaba la última FILA, así que
anotar un saldo antiguo tapaba el de hoy.

A5: la lectura congelada de una posición era la más reciente de la base y, si
era posterior a la fecha pedida, no había lectura, aunque hubiera una anterior.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db.engine import get_session
from app.db.models import CashBalance
from app.main import app
from app.oportunidad import _lectura_congelada, efectivo_usd
from app.routers.empresa import analizar_y_congelar
from app.routers.signals import _detalle_efectivo
from tests.fakes_empresa import AHORA, ServicioFalso, financieros_base

DECISION = datetime(2026, 9, 12, 15, 0, tzinfo=timezone.utc)
ANOTADO = datetime(2026, 9, 11, 15, 0, tzinfo=timezone.utc)


def _cad(session_factory, serie, ahora=DECISION):
    with session_factory() as s:
        s.add(CashBalance(moneda="CAD", importe=130.0, as_of=ANOTADO, registrado_en=ANOTADO))
        s.commit()
        return efectivo_usd(s, {"fx_series": {"CAD": serie}}, ahora)


def test_el_caso_de_la_auditoria_convierte_con_el_tipo_de_entonces(session_factory):
    e = _cad(session_factory, [(date(2026, 9, 11), 1.30), (date(2026, 9, 14), 1.50)])
    assert e["estado"] == "valido"
    assert e["usd"] == 100.0
    assert e["detalle"][0]["tipo_fecha"] == "2026-09-11" and e["detalle"][0]["tipo_por_usd"] == 1.30


def test_el_tipo_fechado_el_mismo_dia_de_la_decision_no_se_conocia(session_factory):
    # FRED publica el tipo de un día después: a las 15:00 del 12 el del 12 no
    # estaba (regla común de `punto_en_el_tiempo`).
    e = _cad(session_factory, [(date(2026, 9, 11), 1.30), (date(2026, 9, 12), 1.50)])
    assert e["usd"] == 100.0


def test_sin_ningun_tipo_conocido_a_esa_fecha_el_efectivo_es_desconocido(session_factory):
    e = _cad(session_factory, [(date(2026, 9, 14), 1.50)])
    assert e["usd"] is None and e["estado"] == "desconocido"
    assert "sin tipo de cambio conocido a esa fecha" in e["motivo"]


def test_un_tipo_viejo_se_usa_pero_se_dice(session_factory):
    e = _cad(session_factory, [(date(2026, 8, 20), 1.30)])
    assert e["usd"] == 100.0
    assert e["estado"] == "viejo"
    assert "20 ago 2026" in e["motivo"]
    nota = _detalle_efectivo(e["detalle"])
    assert "al tipo de cambio del 20 ago 2026" in nota


def test_un_tipo_reciente_no_lleva_aviso(session_factory):
    e = _cad(session_factory, [(date(2026, 9, 10), 1.30)])
    assert e["estado"] == "valido" and "motivo" not in e
    assert "tipo de cambio" not in _detalle_efectivo(e["detalle"])


def _utc(mes, dia, hora=12):
    return datetime(2026, mes, dia, hora, 0, tzinfo=timezone.utc)


def _usd(session_factory, *anotaciones):
    with session_factory() as s:
        for importe, saldo_del, anotado_el in anotaciones:
            s.add(CashBalance(moneda="USD", importe=importe, as_of=saldo_del, registrado_en=anotado_el))
        s.commit()


def _vale(session_factory, ahora):
    with session_factory() as s:
        return efectivo_usd(s, {}, ahora)["usd"]


def test_un_saldo_anotado_hoy_con_fecha_atrasada_no_existia_antes_de_anotarlo(session_factory):
    _usd(session_factory, (5000.0, _utc(9, 1), _utc(10, 19)))
    assert _vale(session_factory, _utc(9, 12)) is None  # el 12 de septiembre nadie lo había escrito
    assert _vale(session_factory, _utc(10, 20)) == 5000.0


def test_manda_el_saldo_mas_reciente_no_la_ultima_fila(session_factory):
    # El 10 de octubre: 10.000. El 15 se anota, para la historia, que el 1 había 8.000.
    _usd(session_factory, (10000.0, _utc(10, 10), _utc(10, 10)), (8000.0, _utc(10, 1), _utc(10, 15)))
    assert _vale(session_factory, _utc(10, 20)) == 10000.0
    assert _vale(session_factory, _utc(10, 12)) == 10000.0
    assert _vale(session_factory, _utc(10, 5)) is None


def test_con_el_mismo_saldo_la_anotada_despues_corrige(session_factory):
    _usd(session_factory, (10000.0, _utc(10, 10), _utc(10, 10, 13)), (9500.0, _utc(10, 10), _utc(10, 11)))
    assert _vale(session_factory, _utc(10, 20)) == 9500.0
    assert _vale(session_factory, _utc(10, 10, 23)) == 10000.0


def test_la_pantalla_de_efectivo_ensena_el_mismo_saldo_que_usan_los_calculos(session_factory):
    _usd(session_factory, (10000.0, _utc(10, 10), _utc(10, 10)), (8000.0, _utc(10, 1), _utc(10, 15)))

    def sesion():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_session] = sesion
    try:
        saldos = TestClient(app).get("/api/portfolio/efectivo").json()["saldos"]
    finally:
        app.dependency_overrides.clear()
    assert [x["importe"] for x in saldos] == [10000.0]


def _cliente(session_factory):
    def sesion():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_session] = sesion
    return TestClient(app)


def _anotar(cliente, importe, as_of=None):
    cuerpo = {"moneda": "USD", "importe": importe} | ({"as_of": as_of} if as_of else {})
    r = cliente.post("/api/portfolio/efectivo", json=cuerpo)
    assert r.status_code == 200, r.text
    return r.json()


def test_un_saldo_de_hoy_anotado_solo_con_el_dia_manda(session_factory):
    # Revisión de A4: «2026-10-20» se guardaba como su medianoche y perdía contra
    # los 10.000 anotados esa mañana; el POST respondía 200 y seguían mandando.
    cliente = _cliente(session_factory)
    try:
        _anotar(cliente, 10000.0)
        nueva = _anotar(cliente, 1000.0, datetime.now(timezone.utc).date().isoformat())
        saldos = cliente.get("/api/portfolio/efectivo").json()["saldos"]
    finally:
        app.dependency_overrides.clear()
    assert nueva["vigente"] is True and nueva["nota"] is None
    assert [x["importe"] for x in saldos] == [1000.0]
    assert _vale(session_factory, datetime.now(timezone.utc)) == 1000.0


def test_un_saldo_de_un_dia_pasado_cuenta_al_final_de_ese_dia_y_avisa_si_no_manda(session_factory):
    cliente = _cliente(session_factory)
    ayer = datetime.now(timezone.utc).date() - timedelta(days=1)
    try:
        _anotar(cliente, 10000.0)
        vieja = _anotar(cliente, 1000.0, ayer.isoformat())
        saldos = cliente.get("/api/portfolio/efectivo").json()["saldos"]
    finally:
        app.dependency_overrides.clear()
    assert datetime.fromisoformat(vieja["as_of"]) == datetime.combine(ayer, datetime.max.time(), tzinfo=timezone.utc)
    assert vieja["vigente"] is False
    assert "no es el saldo vigente" in vieja["nota"] and "10.000,00\u00a0USD" in vieja["nota"]
    assert [x["importe"] for x in saldos] == [10000.0]


def test_un_saldo_unos_minutos_adelantado_se_ve_en_cuanto_se_anota(session_factory):
    # Revisión de A4: el margen de 5 minutos es por el reloj de quien llama;
    # guardado tal cual, la pantalla decía «Sin efectivo anotado» esos minutos.
    cliente = _cliente(session_factory)
    try:
        r = _anotar(cliente, 5000.0, (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat())
        efectivo = cliente.get("/api/portfolio/efectivo").json()
    finally:
        app.dependency_overrides.clear()
    assert datetime.fromisoformat(r["as_of"]) <= datetime.now(timezone.utc)
    assert [x["importe"] for x in efectivo["saldos"]] == [5000.0] and efectivo["nota"] is None


def test_una_fecha_que_no_es_fecha_se_rechaza(session_factory):
    cliente = _cliente(session_factory)
    try:
        malas = [cliente.post("/api/portfolio/efectivo", json={"importe": 1.0, "as_of": f}).status_code for f in ("ayer", "2026-13-01")]
        manana = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
        futura = cliente.post("/api/portfolio/efectivo", json={"importe": 1.0, "as_of": manana}).status_code
    finally:
        app.dependency_overrides.clear()
    assert malas == [422, 422] and futura == 422


def test_una_lectura_posterior_no_esconde_la_anterior_valida(session_factory):
    servicio = ServicioFalso(AHORA).empresa("AAPL", precio=104.0, score=0.6, periodos=financieros_base())
    antes, despues = AHORA - timedelta(days=2), AHORA + timedelta(days=3)
    with session_factory() as s:
        primera = analizar_y_congelar("AAPL", servicio, s, ahora=antes, con_pares=False)["instantanea"]
        segunda = analizar_y_congelar("AAPL", servicio, s, ahora=despues, con_pares=False)["instantanea"]
        assert primera["id"] != segunda["id"]
        entonces = _lectura_congelada(s, "AAPL", AHORA)
        luego = _lectura_congelada(s, "AAPL", despues + timedelta(hours=1))
        nunca = _lectura_congelada(s, "AAPL", antes - timedelta(days=1))
    assert entonces["lectura_de"] == primera["creado_en"]
    assert luego["lectura_de"] == segunda["creado_en"]
    assert nunca == {}


# --- Hermanos de A2 y A5: la cartera del contexto, reconstruida a una fecha --------


def _posicion(s, symbol, cantidad=10, coste=100.0, abierta=None, cerrada=None, moneda="USD"):
    from app.db.models import Instrument, Position

    inst = Instrument(symbol=symbol, name=symbol, sector="Tech", currency=moneda)
    s.add(inst)
    s.flush()
    s.add(Position(instrument_id=inst.id, quantity=cantidad, cost_basis=coste,
                   opened_at=abierta or AHORA - timedelta(days=60), closed_at=cerrada,
                   realized_pnl=0.0 if cerrada else None))
    s.commit()


def test_una_posicion_cerrada_despues_sigue_en_la_cartera_de_ese_dia(session_factory):
    # Revisión de A5: se filtraba en SQL por `closed_at IS NULL` y MSFT, abierta
    # el 12 y cerrada el 14, faltaba del capital y de los comparables del 12.
    from app import contexto_cartera

    servicio = ServicioFalso(AHORA).empresa("MSFT", precio=300.0, score=None)
    with session_factory() as s:
        _posicion(s, "MSFT", cerrada=AHORA + timedelta(days=2))
        entonces = contexto_cartera.construir(s, servicio, ahora=AHORA)
        luego = contexto_cartera.construir(s, servicio, ahora=AHORA + timedelta(days=3))
    assert [p["symbol"] for p in entonces["posiciones"]] == ["MSFT"]
    assert entonces["total_usd"] == 3000.0
    assert luego["posiciones"] == []


def test_la_reconstruccion_valora_con_el_cierre_de_entonces_no_con_la_cotizacion_de_hoy(session_factory):
    # Revisión de A5: la reconstrucción del 12 pesaba MSFT con la cotización
    # del 15 (300); entonces el último cierre conocido era el del 11.
    from app import contexto_cartera

    servicio = ServicioFalso(AHORA + timedelta(days=3)).empresa("MSFT", precio=300.0, score=None)
    servicio.cache.set("price_history_long", {"symbol": "MSFT"}, {"bars": [
        {"ts": "2026-09-10", "close": 200.0}, {"ts": "2026-09-11", "close": 210.0},
        {"ts": "2026-09-14", "close": 300.0}]})
    with session_factory() as s:
        _posicion(s, "MSFT")
        p = contexto_cartera.construir(s, servicio, ahora=AHORA)["posiciones"][0]
    assert p["precio"] == 210.0 and p["precio_estado"] == "viejo" and p["valor_usd"] == 2100.0


def test_la_posicion_y_el_efectivo_en_cad_se_convierten_con_el_mismo_tipo(session_factory):
    # Revisión de A2: la posición iba al último tipo de la serie (1,50, del 14) y
    # el efectivo al de entonces (1,30): dos tipos para el mismo CAD.
    from app import contexto_cartera

    servicio = ServicioFalso(AHORA).empresa("SHOP.TO", precio=130.0, score=None, moneda="CAD")
    servicio.macro["DEXCAUS"] = [{"ts": "2026-09-11", "value": "1.30"}, {"ts": "2026-09-14", "value": "1.50"}]
    with session_factory() as s:
        _posicion(s, "SHOP.TO", cantidad=1, moneda="CAD")
        s.add(CashBalance(moneda="CAD", importe=130.0, as_of=ANOTADO, registrado_en=ANOTADO))
        s.commit()
        ctx = contexto_cartera.construir(s, servicio, ahora=DECISION)
        efectivo = efectivo_usd(s, ctx, DECISION)
    assert ctx["posiciones"][0]["valor_usd"] == 100.0
    assert efectivo["usd"] == 100.0


def test_lo_descargado_durante_el_analisis_no_es_informacion_futura():
    # Una cotización pedida durante el análisis lleva la hora de la descarga,
    # posterior al `ahora` con que empezó: se tiraba como futura y se decidía
    # con el cierre de ayer, «viejo».
    from app.analisis_empresa import seccion_mercado

    servicio = ServicioFalso(AHORA).empresa("SHOP.TO", precio=100.0, score=None)
    servicio.quotes["SHOP.TO"]["as_of"] = (AHORA + timedelta(seconds=2)).isoformat()
    fresca, _ = seccion_mercado(servicio, "SHOP.TO", AHORA)
    servicio.quotes["SHOP.TO"]["as_of"] = (AHORA + timedelta(days=1)).isoformat()
    futura, _ = seccion_mercado(servicio, "SHOP.TO", AHORA)
    assert fresca["estado"] == "valido" and fresca["precio"]["valor"] == 100.0
    assert futura["estado"] == "viejo" and futura["precio"]["valor"] != 100.0


def test_una_instantanea_posterior_no_rompe_el_antiduplicado(session_factory):
    # Revisión de A5: el antiduplicado miraba la instantánea más reciente aunque
    # fuera posterior a `ahora`; con una del día siguiente en la base, cada
    # análisis igual congelaba una copia nueva, inmutable e imborrable.
    servicio = ServicioFalso(AHORA).empresa("AAPL", precio=104.0, score=0.6, periodos=financieros_base())
    with session_factory() as s:
        analizar_y_congelar("AAPL", servicio, s, ahora=AHORA + timedelta(days=1), con_pares=False)
        primera = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA, con_pares=False)
        segunda = analizar_y_congelar("AAPL", servicio, s, ahora=AHORA + timedelta(minutes=5), con_pares=False)
    assert primera["instantanea"]["nueva"] is True
    assert segunda["instantanea"]["nueva"] is False
    assert segunda["instantanea"]["id"] == primera["instantanea"]["id"]


def _idea_con_efectivo_en_cad(session_factory, serie):
    from app import oportunidad

    analisis = {"symbol": "IDEA", "sector": "Tech", "decision": {"action": "comprar", "levels": {"peso_bruto_pct": 4.0}},
                "mercado": {"vol_diaria_pct": 1.5, "precio": {"moneda": "USD"}}, "senal": {"score": 0.6}}
    ctx = {"posiciones": [], "series": {}, "total_usd": None, "mercado": None, "fx_series": {"CAD": serie}}
    with session_factory() as s:
        s.add(CashBalance(moneda="CAD", importe=130.0, as_of=ANOTADO, registrado_en=ANOTADO))
        s.commit()
        return oportunidad.evaluar(s, analisis, ctx, None, DECISION)


def test_un_efectivo_convertido_con_un_tipo_viejo_lo_dice_el_veredicto(session_factory):
    # Revisión de A2: el estado «viejo» se quedaba en `efectivo` y la ficha
    # decía «Hay efectivo… no hace falta vender nada» sin más.
    r = _idea_con_efectivo_en_cad(session_factory, [(date(2026, 8, 20), 1.30)])
    assert r["efectivo"]["estado"] == "viejo"
    assert r["veredicto"]["accion"] == "COMPRAR_CON_EFECTIVO"
    assert "Ojo con el efectivo" in r["veredicto"]["motivo"] and "20 ago 2026" in r["veredicto"]["motivo"]


def test_un_efectivo_anotado_sin_tipo_a_esa_fecha_no_pide_que_lo_anotes(session_factory):
    # Revisión de A2: con el efectivo anotado y la serie empezando después, el
    # veredicto pedía «Anota tu efectivo».
    r = _idea_con_efectivo_en_cad(session_factory, [(date(2026, 9, 14), 1.50)])
    assert r["efectivo"]["estado"] == "desconocido"
    assert "Anota tu efectivo" not in r["veredicto"]["motivo"]
    assert "sin tipo de cambio conocido a esa fecha" in r["veredicto"]["motivo"]


def test_sin_cotizacion_hoy_la_reconstruccion_usa_el_cierre_de_entonces(session_factory):
    # Revisión de 2f8d84b: el respaldo al último cierre solo entraba si HOY había
    # cotización; una posición deslistada salía «sin precio» en la reconstrucción.
    from app import contexto_cartera

    servicio = ServicioFalso(AHORA + timedelta(days=3))
    servicio.cache.set("price_history_long", {"symbol": "XYZ"}, {"bars": [
        {"ts": "2026-09-10", "close": 38.0}, {"ts": "2026-09-11", "close": 40.0}]})
    with session_factory() as s:
        _posicion(s, "XYZ", cerrada=AHORA + timedelta(days=2))
        p = contexto_cartera.construir(s, servicio, ahora=AHORA)["posiciones"][0]
    assert p["precio"] == 40.0 and p["precio_estado"] == "viejo" and p["valor_usd"] == 400.0


def test_una_cotizacion_posterior_sin_cierre_anterior_lo_dice(session_factory):
    from app import contexto_cartera

    servicio = ServicioFalso(AHORA + timedelta(days=3)).empresa("MSFT", precio=300.0, score=None)
    with session_factory() as s:
        _posicion(s, "MSFT")
        p = contexto_cartera.construir(s, servicio, ahora=AHORA)["posiciones"][0]
    assert p["peso"] is None and "la cotización es posterior" in p["motivo"]


def test_las_cotizaciones_se_piden_antes_que_el_historico_largo(session_factory):
    # Revisión de 2f8d84b: el histórico largo de todas las posiciones se pedía
    # primero y consumía el margen de descarga de las cotizaciones.
    from app import contexto_cartera

    servicio = ServicioFalso(AHORA).empresa("MSFT", precio=300.0, score=None)
    with session_factory() as s:
        _posicion(s, "MSFT")
        contexto_cartera.construir(s, servicio, ahora=AHORA, descargar=True)
    tipos = [t for t, _ in servicio.llamadas]
    assert tipos.index("quote") < tipos.index("price_history_long")


def test_un_tipo_de_cambio_fuera_de_banda_deja_fuera_la_posicion_y_el_efectivo(session_factory):
    # Revisión de 2f8d84b: la serie solo comprueba su mediana y `_tipo_en` no
    # miraba la banda: un último punto de 13 en vez de 1,30 daba 10 USD sin aviso.
    from app import contexto_cartera

    servicio = ServicioFalso(AHORA).empresa("SHOP.TO", precio=130.0, score=None, moneda="CAD")
    servicio.macro["DEXCAUS"] = [{"ts": f"2026-09-0{d}", "value": "1.30"} for d in range(1, 10)] + [
        {"ts": "2026-09-10", "value": "13.0"}]
    with session_factory() as s:
        _posicion(s, "SHOP.TO", cantidad=1, moneda="CAD")
        s.add(CashBalance(moneda="CAD", importe=130.0, as_of=ANOTADO, registrado_en=ANOTADO))
        s.commit()
        ctx = contexto_cartera.construir(s, servicio, ahora=DECISION)
        efectivo = efectivo_usd(s, ctx, DECISION)
    assert ctx["posiciones"][0]["peso"] is None and "leída del revés" in ctx["posiciones"][0]["motivo"]
    assert efectivo["usd"] is None and "leída del revés" in efectivo["motivo"]
