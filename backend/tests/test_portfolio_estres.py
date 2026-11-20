"""El peor escenario histórico sobre la cartera actual, servido de verdad.

`peor_ventana` y `con_caida_esperada` estaban escritas y probadas, y no las
llamaba ningún endpoint: existían en el repositorio y no en la aplicación. Un
número de riesgo que nadie ve no protege de nada, así que lo que estos tests
fijan es que el portafolio lo devuelva — y que cuando no pueda calcularlo lo
diga en vez de enseñar una rentabilidad a secas.
"""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.db.engine import get_session
from app.db.models import Instrument, Position
from app.deps import get_service
from app.main import app
from app.providers.base import iso_utc
from tests.test_scan import FakeCache


def _historico(semilla: int, dias: int = 252) -> list[dict]:
    """Barras diarias con la misma forma que devuelve el proveedor real."""
    rng = random.Random(semilla)
    inicio = date.today() - timedelta(days=dias)
    barras, p = [], 100.0
    for i in range(dias):
        p *= math.exp(rng.gauss(0.0002, 0.02))
        barras.append(
            {"ts": f"{inicio + timedelta(days=i)} 00:00:00", "close": round(p, 4)}
        )
    return barras


class FakeService:
    def __init__(self, con_historico=("AAPL", "MSFT"), con_largo=()):
        self.cache = FakeCache()
        for i, symbol in enumerate(con_historico):
            self.cache.set(
                "price_history",
                {"symbol": symbol, "interval": "1day", "outputsize": 252},
                {"symbol": symbol, "bars": _historico(i + 1)},
            )
        # El largo que baja Cartera, recién descargado (sin `fetched_at`: de ahora).
        for i, symbol in enumerate(con_largo):
            self.cache.set("price_history_long", {"symbol": symbol},
                           {"symbol": symbol, "bars": _historico(i + 10, dias=700)})

    def get(self, data_type, **kwargs):
        common = {"source": "fake", "as_of": iso_utc(), "cached": False}
        if data_type == "quote":
            return {**common, "symbol": kwargs["symbol"], "price": 120.0}
        if data_type == "profile":
            return {
                **common,
                "symbol": kwargs["symbol"],
                "name": "Fake Corp",
                "currency": "USD",
                "sector": "Tech",
            }
        raise AssertionError(f"tipo inesperado: {data_type}")


@pytest.fixture
def client(session_factory):
    def override_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    def _hacer(simbolos_con_historico=("AAPL", "MSFT"), con_largo=()):
        service = FakeService(simbolos_con_historico, con_largo)
        session = session_factory()
        for symbol in ("AAPL", "MSFT"):
            instrument = Instrument(symbol=symbol, name=symbol, sector="Tech")
            session.add(instrument)
            session.flush()
            session.add(
                Position(
                    instrument_id=instrument.id,
                    quantity=10,
                    cost_basis=100.0,
                    opened_at=datetime.now(timezone.utc),
                )
            )
        session.commit()
        session.close()

        app.dependency_overrides[get_service] = lambda: service
        app.dependency_overrides[get_session] = override_session
        return TestClient(app)

    yield _hacer
    app.dependency_overrides.clear()


def test_el_portafolio_estresa_la_cartera_actual_contra_el_historico(client):
    r = client().get("/api/portfolio").json()
    estres = r["estres"]
    assert estres["suficiente"] is True
    assert estres["max_drawdown_pct"] < 0
    assert estres["drawdown_desde"] < estres["drawdown_hasta"]
    assert estres["años_cubiertos"] > 0


def test_ninguna_rentabilidad_viaja_sin_su_caida_al_lado(client):
    """«+12 %» y «+12 % con un −45 % por el camino» son propuestas distintas."""
    resumen = client().get("/api/portfolio").json()["summary"]
    assert resumen["unrealized_pct"] is not None
    assert "max_drawdown_esperado_pct" in resumen
    assert resumen["max_drawdown_esperado_pct"] < 0
    assert "aviso_cobertura" in resumen


def test_el_aviso_nombra_las_crisis_que_el_historico_no_vio(client):
    """Un «peor caso» de un año no es el peor caso: es el peor de lo que dio
    tiempo a pasar."""
    aviso = client().get("/api/portfolio").json()["estres"]["aviso_cobertura"]
    assert "NO ha vivido" in aviso
    assert "2008" in aviso


def test_sin_historico_en_cache_se_dice_en_vez_de_enseñar_un_retorno_pelado(client):
    """No se descarga nada para esto: si el histórico no está guardado, la
    rentabilidad sale marcada como no interpretable, no acompañada de un cero."""
    r = client(simbolos_con_historico=()).get("/api/portfolio").json()
    assert r["estres"]["suficiente"] is False
    assert r["summary"]["max_drawdown_esperado_pct"] is None
    assert "no se puede interpretar" in r["summary"]["aviso_cobertura"]


def test_el_estres_nombra_lo_que_deja_fuera_y_cuanto_dinero_mide(client):
    """Revisión 8: `peor_ventana` repondera sobre las que tienen serie y la
    respuesta no decía qué faltaba: con media cartera sin histórico, la «peor
    caída» era la de la otra mitad, presentada como la de toda."""
    estres = client(simbolos_con_historico=("AAPL",)).get("/api/portfolio").json()["estres"]
    assert estres["sin_historico"] == ["MSFT"]
    assert estres["cobertura_peso"] == 0.5
    assert "MSFT" in estres["aviso_sin_historico"] and "50,0 %" in estres["aviso_sin_historico"]


def test_con_todo_el_historico_no_hay_aviso_de_cobertura(client):
    estres = client().get("/api/portfolio").json()["estres"]
    assert estres["sin_historico"] == [] and estres["aviso_sin_historico"] is None
    assert estres["cobertura_peso"] == 1.0


def test_con_el_largo_vigente_el_estres_mide_la_peor_ventana_de_12_meses(client):
    """Revisión 12, visual: el estrés leía como mucho 252 sesiones (el año del
    stop) y la ventana de 12 meses pide más de 252, así que «Peor 12 meses
    seguidos» no salía nunca, aunque Cartera tuviera dos años descargados."""
    estres = client(con_largo=("AAPL", "MSFT")).get("/api/portfolio").json()["estres"]
    assert estres["peor_ventana_pct"] is not None and estres["peor_ventana_nota"] is None
    assert estres["años_cubiertos"] > 1.5


def test_el_stop_y_el_minigrafico_siguen_con_su_ano():
    """El estrés usa el largo entero; el stop y el minigráfico, el último año."""
    from app.routers.portfolio import SESIONES_HISTORICO, _historico_cacheado, _series_cacheadas

    service = FakeService(con_historico=(), con_largo=("AAPL",))
    assert len(_historico_cacheado(service, "AAPL")) == SESIONES_HISTORICO
    series, sin_largo = _series_cacheadas(service, ["AAPL"])
    assert len(series["AAPL"]) == 700 and sin_largo == []


def test_sin_el_largo_la_nota_dice_con_que_ventana_mide_y_como_alargarla(client):
    """Revisión 12, visual: «el histórico común no llega a 12 meses» sin decir de
    qué sesiones salía ni por qué Cartera medía dos años de las mismas."""
    estres = client(con_largo=("AAPL",)).get("/api/portfolio").json()["estres"]
    nota = estres["peor_ventana_nota"]
    assert estres["peor_ventana_pct"] is None
    assert "252 sesiones" in nota and "pide más de 252" in nota
    # Nombra la que acorta el histórico común, no la que ya tiene el largo.
    assert "De MSFT solo hay guardado el último año" in nota and "AAPL" not in nota
    assert "Descargar histórico completo" in nota
