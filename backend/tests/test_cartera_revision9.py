"""Revisión 9: el stop y el estrés de Cartera leen el mismo histórico, el estrés
va en dólares, un lote atrasado mide su stop con lo que se sabía al abrirlo y un
lote de coste 0 no tiene stop. Montado sobre la API, con caché real."""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.analysis.decision import _stop_pct, vol_diaria_pct
from app.cache.cache import CacheStore
from app.db.engine import get_session
from app.db.models import Instrument, Position
from app.deps import get_service
from app.main import app
from app.providers.base import DataNotFoundError, iso_utc


def _historico(semilla, dias=252, sigma=0.02, hasta=None):
    rng = random.Random(semilla)
    hasta = hasta or date.today()
    inicio = hasta - timedelta(days=dias - 1)
    barras, p = [], 100.0
    for i in range(dias):
        p *= math.exp(rng.gauss(0.0002, sigma))
        barras.append({"ts": f"{inicio + timedelta(days=i)} 00:00:00", "close": round(p, 4)})
    return barras


def _params(symbol):
    return {"symbol": symbol, "interval": "1day", "outputsize": 252}


class Servicio:
    def __init__(self, cache, historias=None, puntos_fx=None):
        self.cache = cache
        self.historias = historias or {}
        self.puntos_fx = puntos_fx

    def get(self, data_type, **kw):
        comun = {"source": "fake", "as_of": iso_utc(), "cached": False}
        cad = kw.get("symbol") == "RY.TO"
        if data_type == "quote":
            return {**comun, "symbol": kw["symbol"], "price": 137.0 if cad else 120.0, "currency": "CAD" if cad else "USD"}
        if data_type == "profile":
            return {**comun, "symbol": kw["symbol"], "name": "X", "currency": "CAD" if cad else "USD", "sector": "Tech"}
        if data_type == "macro" and self.puntos_fx is not None:
            return {**comun, "series_id": kw["series_id"], "points": self.puntos_fx}
        if data_type == "price_history" and kw["symbol"] in self.historias:
            return {**comun, "bars": self.historias[kw["symbol"]]}
        raise DataNotFoundError(data_type)


def _cliente(session_factory, service):
    def override_session():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()
    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_session] = override_session
    return TestClient(app)


def _posicion(session_factory, symbol, moneda="USD", coste=100.0):
    with session_factory() as s:
        inst = Instrument(symbol=symbol, name=symbol, sector="Tech", currency=moneda)
        s.add(inst)
        s.flush()
        s.add(Position(instrument_id=inst.id, quantity=10, cost_basis=coste, opened_at=datetime.now(timezone.utc)))
        s.commit()


def test_el_estres_lee_el_mismo_historico_que_el_stop(session_factory):
    """Con el histórico de un año caducado hace una hora, el stop salía medido y
    el estrés decía «sin histórico en caché»."""
    reloj = {"ahora": datetime.now(timezone.utc) - timedelta(hours=7)}
    cache = CacheStore(session_factory, now=lambda: reloj["ahora"])
    for i, s in enumerate(("AAPL", "MSFT")):
        cache.set("price_history", _params(s), {"symbol": s, "bars": _historico(i + 1)})
        _posicion(session_factory, s)
    reloj["ahora"] = datetime.now(timezone.utc)
    c = _cliente(session_factory, Servicio(cache))
    try:
        r = c.get("/api/portfolio").json()
    finally:
        app.dependency_overrides.clear()
    assert all(not p["stop_por_clase"] for p in r["positions"])
    assert r["estres"]["suficiente"] is True and r["estres"]["sin_historico"] == []


def test_una_copia_de_hace_dias_no_mide_el_stop(session_factory):
    """El margen de rescate llega a 7 días: con la copia de hace 6, el stop de
    la cartera daba perforado y el de la ficha no."""
    reloj = {"ahora": datetime.now(timezone.utc) - timedelta(days=6)}
    cache = CacheStore(session_factory, now=lambda: reloj["ahora"])
    cache.set("price_history", _params("AAPL"), {"symbol": "AAPL", "bars": _historico(1)})
    _posicion(session_factory, "AAPL")
    reloj["ahora"] = datetime.now(timezone.utc)
    c = _cliente(session_factory, Servicio(cache))
    try:
        r = c.get("/api/portfolio").json()
    finally:
        app.dependency_overrides.clear()
    assert r["positions"][0]["stop_por_clase"] is True
    assert "AAPL" in r["estres"]["sin_historico"] and r["estres"]["aviso_sin_historico"].startswith("No mide ninguna")


def test_el_estres_va_en_dolares(session_factory):
    """RY.TO plano en CAD mientras el CAD pasaba de 1,30 a 1,70: en dólares cayó
    un 23,5 % y el estrés decía 0,0 %."""
    hoy = date.today()
    cache = CacheStore(session_factory)
    plano = [{"ts": f"{hoy - timedelta(days=251 - i)} 00:00:00", "close": 137.0} for i in range(252)]
    cache.set("price_history", _params("RY.TO"), {"symbol": "RY.TO", "bars": plano})
    puntos = [{"ts": (hoy - timedelta(days=400 - i)).isoformat(),
               "value": f"{1.30 + 0.40 * max(0, i - 148) / 252:.4f}"} for i in range(401)]
    _posicion(session_factory, "RY.TO", moneda="CAD", coste=137.0)
    c = _cliente(session_factory, Servicio(cache, puntos_fx=puntos))
    try:
        e = c.get("/api/portfolio").json()["estres"]
    finally:
        app.dependency_overrides.clear()
    assert e["suficiente"] is True and e["max_drawdown_pct"] < -20


def test_un_lote_atrasado_mide_su_stop_con_lo_que_se_sabia(session_factory):
    """Abierto hace 100 días en calma, recibía el stop de la agitación de
    después: 75,0 en vez de 92,0."""
    hoy = date.today()
    tranquila = _historico(3, dias=152, sigma=0.008, hasta=hoy - timedelta(days=100))
    rng, pr, agitada = random.Random(9), tranquila[-1]["close"], []
    for i in range(100):
        pr *= math.exp(rng.gauss(0, 0.04))
        agitada.append({"ts": f"{hoy - timedelta(days=99 - i)} 00:00:00", "close": round(pr, 4)})
    barras = tranquila + agitada
    apertura = hoy - timedelta(days=100)
    c = _cliente(session_factory, Servicio(CacheStore(session_factory), {"QQQ": barras}))
    try:
        r = c.post("/api/portfolio/positions", json={
            "symbol": "QQQ", "quantity": 1, "cost_basis": 100.0, "opened_at": f"{apertura.isoformat()}T15:00:00+00:00"})
        stop = c.get("/api/portfolio").json()["positions"][0]["stop"]
    finally:
        app.dependency_overrides.clear()
    v_entonces = vol_diaria_pct([b["close"] for b in barras if b["ts"][:10] < apertura.isoformat()])
    assert r.status_code == 200 and r.json()["stop_por_clase"] is False
    assert stop == round(100 * (1 - _stop_pct(v_entonces) / 100), 2)


def test_un_lote_de_coste_cero_no_tiene_stop(session_factory):
    """El listado servía «stop 0,0, punto medio de su clase»; al abrirlo ya no se
    fijaba ninguno."""
    c = _cliente(session_factory, Servicio(CacheStore(session_factory), {"SPIN": _historico(5)}))
    try:
        c.post("/api/portfolio/positions", json={"symbol": "SPIN", "quantity": 1, "cost_basis": 0})
        p = c.get("/api/portfolio").json()["positions"][0]
    finally:
        app.dependency_overrides.clear()
    assert p["stop"] is None and p["stop_por_clase"] is False
