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
