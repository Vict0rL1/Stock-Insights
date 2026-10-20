"""Auditoría del 19 oct: el efectivo y las lecturas del coste de oportunidad,
reconstruidos a una fecha, no pueden mirar el futuro.

A2: `efectivo_usd` convertía con el ÚLTIMO tipo de la serie, aunque fuera
posterior a la fecha de la decisión.

A4: una anotación de efectivo contaba en cuanto su saldo estaba fechado antes de
la decisión, aunque se hubiera escrito después; y mandaba la última FILA, así que
anotar un saldo antiguo tapaba el de hoy.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi.testclient import TestClient

from app.db.engine import get_session
from app.db.models import CashBalance
from app.main import app
from app.oportunidad import efectivo_usd
from app.routers.signals import _detalle_efectivo

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
