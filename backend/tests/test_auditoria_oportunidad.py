"""Auditoría del 19 oct: el efectivo y las lecturas del coste de oportunidad,
reconstruidos a una fecha, no pueden mirar el futuro.

A2: `efectivo_usd` convertía con el ÚLTIMO tipo de la serie, aunque fuera
posterior a la fecha de la decisión.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from app.db.models import CashBalance
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
