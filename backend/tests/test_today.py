"""Tests de la lista diaria por mercado (/api/signals/today)."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.analysis.markets import MARKETS, list_markets, load_market
from app.db.engine import get_session
from app.deps import get_llm, get_service
from app.main import app
from app.providers.base import DataNotFoundError, iso_utc
from tests.test_scan import FakeCache


# ---------------------------------------------------------------------------
# Datos de los universos
# ---------------------------------------------------------------------------


def test_los_mercados_cargan_y_traen_sector():
    for key in MARKETS:
        market = load_market(key)
        assert market["companies"], key
        for company in market["companies"]:
            assert company["symbol"] and company["name"] and company["sector"], company
        # Agrupar por sector debe cubrir a todas, sin perder ni duplicar.
        agrupadas = sum(len(v) for v in market["sectors"].values())
        assert agrupadas == len(market["companies"])


def test_el_sp500_tiene_tamano_y_sectores_plausibles():
    market = load_market("us_sp500")
    assert 480 <= len(market["companies"]) <= 520
    # Los 11 sectores GICS.
    assert len(market["sectors"]) == 11
    simbolos = [c["symbol"] for c in market["companies"]]
    assert len(simbolos) == len(set(simbolos))  # sin duplicados


def test_nasdaq_se_solapa_con_el_sp500_a_proposito():
    """Los mercados son vistas, no particiones: el solapamiento es correcto.

    Una empresa puntúa distinto en cada lista porque cambia con quién se la
    compara, y eso es justamente lo que aporta mirar las dos.
    """
    nasdaq = load_market("nasdaq")
    assert 200 <= len(nasdaq["companies"]) <= 450
    assert len(nasdaq["sectors"]) == 11
    simbolos = [c["symbol"] for c in nasdaq["companies"]]
    assert len(simbolos) == len(set(simbolos))  # sin duplicados dentro del mercado

    sp500 = {c["symbol"] for c in load_market("us_sp500")["companies"]}
    solapan = set(simbolos) & sp500
    assert len(solapan) > 50, "se esperaba solapamiento con el S&P 500"
    assert set(simbolos) - sp500, "el NASDAQ debe aportar empresas propias"


def test_el_nasdaq_no_se_presenta_como_el_indice_nasdaq_100():
    """No hay fuente automatizable del índice: la UI no debe afirmar que lo es."""
    nasdaq = load_market("nasdaq")
    assert "Nasdaq-100" not in nasdaq["name"]
    assert "no es el índice nasdaq-100" in nasdaq["description"].lower()


def test_canada_usa_tickers_estadounidenses_y_no_duplica_el_sp500():
    """Se usan los tickers de NYSE/NASDAQ para que EDGAR siga cubriéndolas."""
    canada = load_market("canada")
    assert 20 <= len(canada["companies"]) <= 80
    sp500 = {c["symbol"] for c in load_market("us_sp500")["companies"]}
    solapan = {c["symbol"] for c in canada["companies"]} & sp500
    assert not solapan, f"empresas duplicadas entre mercados: {solapan}"
    # Tickers estadounidenses: sin sufijo de bolsa extranjera (.TO, .MC…).
    for company in canada["companies"]:
        assert "." not in company["symbol"], company


def test_listado_de_mercados_cuenta_empresas_y_sectores():
    for entry in list_markets():
        market = load_market(entry["key"])
        assert entry["companies"] == len(market["companies"])
        assert entry["sectors"] == len(market["sectors"])


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


class MarketService:
    """Servicio simulado con fundamentales deterministas por símbolo."""

    def __init__(self, failing: set[str] | None = None):
        self.failing = failing or set()
        self.bulk_calls = 0
        self.profile_calls = 0
        self.fundamental_calls = 0
        self.cache = FakeCache()

    def get(self, data_type, **kwargs):
        common = {"source": "fake", "as_of": iso_utc(), "cached": False}
        if data_type == "bulk_momentum":
            self.bulk_calls += 1
            symbols = kwargs["symbols"]
            # Simula el rescate de caché: todas las fuentes cayeron y la
            # descarga llega marcada como vieja.
            if getattr(self, "bulk_viejo", False):
                common = {**common, "estado": "viejo", "antiguedad_segundos": 1800}
            return {
                **common,
                "momentum": {s: (i % 7) / 10 - 0.3 for i, s in enumerate(symbols)},
                # La descarga real trae un año de cierres; el doble devuelve el
                # resumen que el proveedor deriva de ellos.
                "prices": {
                    s: {
                        "last": 100.0 + i,
                        "change_pct": (i % 5) - 2.0,
                        "low_52w": 80.0 + i,
                        "high_52w": 130.0 + i,
                        "range_position": 0.4,
                        "spark": [90.0 + i, 95.0 + i, 100.0 + i],
                        "points": 251,
                    }
                    for i, s in enumerate(symbols)
                },
            }
        symbol = kwargs.get("symbol", "")
        if symbol in self.failing:
            raise DataNotFoundError(f"sin datos para {symbol}")
        if data_type == "fundamentals":
            self.fundamental_calls += 1
            seed = sum(ord(c) for c in symbol)
            payload = {
                **common,
                "symbol": symbol,
                "period": "ttm",
                "metrics": {
                    "pe_ttm": 8 + seed % 30,
                    "pb": 1 + (seed % 60) / 10,
                    "roe": (seed % 25) / 100,
                    "operating_margin": (seed % 35) / 100,
                    "debt_to_equity": (seed % 30) / 10,
                    "market_cap": 1e9 + seed * 1e7,
                },
            }
            # El servicio real cachea lo que descarga; el presupuesto depende
            # de ello, así que el doble tiene que hacer lo mismo.
            self.cache.set("fundamentals", {"symbol": symbol}, payload)
            return payload
        if data_type == "profile":
            self.profile_calls += 1
            return {**common, "symbol": symbol, "name": f"{symbol} Inc", "sector": "Tech"}
        raise DataNotFoundError(f"tipo no simulado: {data_type}")


@pytest.fixture
def client(session_factory):
    service = MarketService()

    def override_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_llm] = lambda: None
    with TestClient(app) as c:
        yield c, service
    app.dependency_overrides.clear()


def _completar(c, market="us_sp500", vueltas=10):
    """Repite hasta que no queden pendientes (o se agoten las vueltas)."""
    data = c.get(f"/api/signals/today?market={market}&budget=600").json()
    for _ in range(vueltas):
        if data["complete"]:
            break
        data = c.get(
            f"/api/signals/today?market={market}&budget=600&refresh=true"
        ).json()
    return data


def test_endpoint_de_mercados(client):
    c, _ = client
    data = c.get("/api/signals/markets").json()
    claves = {m["key"] for m in data["markets"]}
    assert claves == set(MARKETS)
    # La procedencia de los datos viaja con ellos.
    assert data["meta"]["retrieved_at"]
    assert data["meta"]["markets"]["us_sp500"]["source"].startswith("https://")


def test_mercado_desconocido_da_404(client):
    c, _ = client
    assert c.get("/api/signals/today?market=marte").status_code == 404


def test_lista_del_sp500_ordenada_y_numerada(client):
    c, _ = client
    data = _completar(c)

    assert data["market_key"] == "us_sp500"
    assert data["scored"] > 400
    scores = [s["score"] for s in data["signals"]]
    assert scores == sorted(scores, reverse=True)
    assert [s["rank"] for s in data["signals"]] == list(range(1, len(scores) + 1))
    # Los 11 sectores GICS entran en juego, no uno solo.
    sectores = {s["context"]["sector_name"] for s in data["signals"]}
    assert len(sectores) == 11


def test_canada_se_puntua_por_separado(client):
    c, _ = client
    data = _completar(c, market="canada")
    assert data["market_key"] == "canada"
    assert data["scored"] >= 20
    # Sectores con menos de 3 comparables se descartan enteros.
    descartados = [s for s in data["sectors"] if not s["usable"]]
    assert all(s["scored"] < 3 for s in descartados)
    nombres_usables = {s["name"] for s in data["sectors"] if s["usable"]}
    assert {s["context"]["sector_name"] for s in data["signals"]} == nombres_usables


def test_los_nombres_salen_del_universo_sin_gastar_llamadas(client):
    """Pedir el perfil de 500 empresas costaría 500 llamadas por cosmética."""
    c, service = client
    data = _completar(c)
    assert service.profile_calls == 0
    assert all(s["context"]["name"] for s in data["signals"])


def test_el_presupuesto_limita_las_descargas_nuevas(client):
    c, service = client
    c.get("/api/signals/today?budget=50")
    assert service.fundamental_calls == 50


def test_la_cobertura_se_acumula_entre_peticiones(client):
    """Cada pasada avanza un trozo; lo ya cacheado no vuelve a costar."""
    c, service = client
    primera = c.get("/api/signals/today?budget=100").json()
    assert primera["complete"] is False
    assert primera["pending"] > 0
    assert primera["fetched_now"] == 100

    segunda = c.get("/api/signals/today?budget=100&refresh=true").json()
    # Descargó 100 nuevas, no repitió las 100 anteriores.
    assert service.fundamental_calls == 200
    assert segunda["scored"] > primera["scored"]
    assert segunda["pending"] < primera["pending"]


def test_al_completar_no_quedan_pendientes(client):
    c, _ = client
    data = _completar(c)
    assert data["complete"] is True
    assert data["pending"] == 0
    assert data["scored"] + len(data["unavailable"]) == data["requested"]


def test_los_recuentos_cuadran_con_los_umbrales(client):
    c, _ = client
    data = _completar(c)
    fav = data["thresholds"]["favorable"]
    des = data["thresholds"]["desfavorable"]

    assert data["counts"]["favorables"] == sum(
        1 for s in data["signals"] if s["score"] >= fav
    )
    assert data["counts"]["desfavorables"] == sum(
        1 for s in data["signals"] if s["score"] <= des
    )
    assert sum(data["counts"].values()) == data["scored"]


def test_la_franja_neutral_viaja_en_la_respuesta(client):
    """Regresión: antes solo viajaban los dos extremos.

    Casi la mitad del índice cae en la franja neutral. Si no viaja, buscar una
    empresa concreta y no encontrarla parece que el modelo no la cubre, cuando
    en realidad la ha puntuado y ha salido del montón.
    """
    c, _ = client
    data = _completar(c)
    fav = data["thresholds"]["favorable"]
    des = data["thresholds"]["desfavorable"]

    neutrales = [s for s in data["signals"] if des < s["score"] < fav]
    assert len(neutrales) == data["counts"]["neutrales"]
    assert neutrales, "se esperaba franja neutral en un universo de 500"
    # Toda empresa puntuada es alcanzable desde la respuesta.
    assert len(data["signals"]) == data["scored"]


def test_toda_empresa_del_universo_esta_puntuada_o_justificada(client):
    """Nada desaparece en silencio: o se puntúa, o consta por qué no."""
    c, _ = client
    data = _completar(c)
    en_lista = {s["symbol"] for s in data["signals"]}
    sin_datos = {u["symbol"] for u in data["unavailable"]}

    del_universo = {c_["symbol"] for c_ in load_market("us_sp500")["companies"]}
    descartados = {
        c_["symbol"]
        for s in data["sectors"]
        if not s["usable"]
        for c_ in load_market("us_sp500")["sectors"][s["name"]]
    }
    assert del_universo == en_lista | sin_datos | descartados


def test_se_sirve_de_cache_en_la_segunda_llamada(client):
    c, service = client
    c.get("/api/signals/today?budget=600")
    llamadas = service.bulk_calls
    data = c.get("/api/signals/today").json()
    assert data["cached"] is True
    assert service.bulk_calls == llamadas


def test_cada_mercado_tiene_su_propia_cache(client):
    c, _ = client
    c.get("/api/signals/today?market=us_sp500&budget=600")
    data = c.get("/api/signals/today?market=canada&budget=600").json()
    # No devuelve la lista del S&P por error de clave de caché.
    assert data["market_key"] == "canada"
    assert data["scored"] < 100


def test_la_lista_dice_que_sus_reglas_no_estan_validadas(client):
    """La app ya sí dice qué comprar; lo que no puede es fingir que acierta.

    Antes este test exigía «NO es una lista de compra». Esa promesa se retiró a
    propósito al añadir el motor de decisión, pero la garantía honesta que la
    sustituye es más exigente: mientras no haya backtest con muestra, hay que
    decirlo en pantalla y no publicar ninguna probabilidad.
    """
    c, _ = client
    data = _completar(c)
    assert "no están validadas" in data["disclaimer"]
    assert "backtest" in data["disclaimer"]
    # Y no vende la señal como predicción.
    assert "no que vaya a subir" in data["disclaimer"]

    assert data["calibrated"] is False
    for signal in data["signals"]:
        assert signal["probability"] is None
        assert signal["decision"]["confidence"] != "calibrada"


def test_una_respuesta_cacheada_con_forma_antigua_se_descarta(client):
    """Regresión: servirla dejaba la pantalla en blanco.

    Al cambiar la forma de la respuesta, lo guardado por la versión anterior
    seguía en caché y la UI lo leía mal. No basta con subir la versión de la
    clave — hay que olvidarse de subirla y que aun así no rompa.
    """
    c, service = client
    data = _completar(c)
    assert data["complete"] is True

    # Simula lo guardado por una versión anterior: sin los campos nuevos.
    clave = {"v": 3, "market": "us_sp500"}
    viejo = {k: v for k, v in data.items() if k not in {"signals", "counts", "thresholds"}}
    viejo["favorables"] = []
    service.cache.set("daily_picks", clave, viejo)

    # La siguiente petición ignora ese cacheado y devuelve la forma buena.
    de_nuevo = c.get("/api/signals/today").json()
    assert "signals" in de_nuevo
    assert "thresholds" in de_nuevo
    assert de_nuevo["counts"]["favorables"] >= 0


def test_el_precio_viaja_con_cada_senal_y_con_su_procedencia(client):
    c, _ = client
    data = _completar(c)
    con_precio = [s for s in data["signals"] if s["price"]]
    assert len(con_precio) == data["scored"]
    for signal in con_precio[:5]:
        precio = signal["price"]
        assert precio["last"] > 0
        assert precio["low_52w"] <= precio["last"] <= precio["high_52w"]
        assert len(precio["spark"]) >= 2
        # Ninguna cifra se enseña sin decir de dónde sale y de cuándo es.
        assert precio["source"]
        assert precio["as_of"]


def test_el_precio_no_cuesta_ninguna_llamada_adicional(client):
    """Sale de la descarga masiva que el momentum ya hacía.

    Es la razón por la que se puede mostrar en 500 filas: pedir una cotización
    por empresa serían 500 llamadas contra un tier de 60/min.
    """
    c, service = client
    c.get("/api/signals/today?market=canada&budget=600")
    # Una descarga masiva por sector y ni una llamada de cotización o perfil.
    sectores_usables = len(load_market("canada")["sectors"])
    assert service.bulk_calls == sectores_usables
    assert service.profile_calls == 0


# ---------------------------------------------------------------------------
# Fallos: legibles y acotados
# ---------------------------------------------------------------------------


def test_un_fallo_inesperado_explica_la_causa_en_vez_de_un_500_vacio(client, monkeypatch):
    """Un 500 sin cuerpo dejaba la pantalla diciendo solo «Error HTTP 500».

    El frontend ya sabe leer `detail`; lo que faltaba era que el backend lo
    escribiera. Sin esto, un fallo real es indistinguible de cualquier otro y
    no hay por dónde empezar a arreglarlo.
    """
    c, _ = client
    from app.routers import signals as S

    def explota(*args, **kwargs):
        raise ValueError("algo muy concreto se rompió")

    monkeypatch.setattr(S, "_today", explota)
    resp = c.get("/api/signals/today?market=us_sp500")
    assert resp.status_code == 500
    detail = resp.json()["detail"]
    assert "ValueError" in detail
    assert "algo muy concreto se rompió" in detail


def test_una_empresa_con_datos_raros_no_tumba_la_lista_entera(client, monkeypatch):
    """500 empresas no pueden depender de que las 500 sean decidibles."""
    c, _ = client
    from app.routers import signals as S

    original = S.decide
    llamadas = {"n": 0}

    def falla_la_primera(signal, price, position=None, **kwargs):
        llamadas["n"] += 1
        if llamadas["n"] == 1:
            raise ZeroDivisionError("coste cero")
        return original(signal, price, position, **kwargs)

    monkeypatch.setattr(S, "decide", falla_la_primera)
    data = _completar(c)
    assert data["scored"] > 100, "las demás empresas deben seguir puntuadas"

    rotas = [s for s in data["signals"] if s["decision"]["action"] == "sin_datos"]
    assert len(rotas) == 1
    assert "ZeroDivisionError" in rotas[0]["decision"]["reasons"][0]
    # Y sigue teniendo la forma que la UI espera, no un hueco.
    assert rotas[0]["decision"]["levels"] is None
    assert rotas[0]["decision"]["owned"] is False


def test_una_descarga_cacheada_sin_precios_se_tira_y_se_repide(client):
    """La caché de momentum dura 6 h y no lleva versión.

    Tras actualizar la app, una entrada guardada por la versión anterior —sin
    `prices`— seguiría vigente y daría una lista sin precio ni minigráfico
    durante horas, sin decir por qué. Se detecta la forma vieja y se repide.
    """
    c, service = client
    market = load_market("us_sp500")
    symbols = [s["symbol"] for s in next(iter(market["sectors"].values()))]

    # Forma antigua: momentum sí, precios no.
    service.cache.set(
        "bulk_momentum",
        {"symbols": symbols},
        {"momentum": {s: 0.1 for s in symbols}, "as_of": iso_utc(), "source": "fake"},
    )
    antes = service.bulk_calls
    data = _completar(c)

    assert service.bulk_calls > antes, "debía volver a pedir la descarga"
    con_precio = [s for s in data["signals"] if s.get("price")]
    assert con_precio, "la lista no puede quedarse sin precios por caché vieja"


def test_la_lista_diaria_recoge_el_backtest_de_reglas_guardado(client, session_factory):
    """Sin esto, ejecutar el backtest no cambiaría nada en la pantalla que usas.

    Es la conexión que hace útil al backtest: si las reglas se probaron y
    perdieron dinero, cada fila tiene que decirlo.
    """
    import json

    from app.db.models import LlmOutput

    c, _ = client
    with session_factory() as session:
        session.add(
            LlmOutput(
                kind="rule_backtest",
                # Con su partición: desde el RC1, un backtest guardado sin ella
                # (calculado mirando el holdout) no valida nada.
                content_md=json.dumps(
                    {"fiable": True, "esperanza_pct": -1.2, "ventaja_pct": -3.4,
                     "particion": {"corte": "2024-01-01", "holdout_mirado": False}}
                ),
                model="reglas/6a",
            )
        )
        session.commit()

    data = _completar(c)
    decididas = [
        s for s in data["signals"] if s["decision"]["action"] not in {"sin_datos"}
    ]
    assert decididas, "hacen falta filas decididas para comprobar la confianza"
    assert all(s["decision"]["confidence"] == "refutada" for s in decididas)


def test_puntuar_el_indice_no_gasta_la_cuota_cara(session_factory):
    """La palanca de coste más grande de la app, fijada como garantía.

    `fundamentals` iba a Finnhub (60 llamadas/min): puntuar 502 empresas
    gastaba la cuota entera en los primeros 60 símbolos, dejaba el resto sin
    puntuar y secaba lo que necesitan noticias, calendario y cotizaciones.
    EDGAR da lo mismo gratis. Si alguien vuelve a invertir ese orden, esto
    tiene que romperse.
    """
    class ConEdgar(MarketService):
        def __init__(self):
            super().__init__()
            self.financial_calls = 0

        def get(self, data_type, **kwargs):
            if data_type == "financials":
                self.financial_calls += 1
                return {
                    "source": "edgar",
                    "as_of": iso_utc(),
                    "periods": [
                        {
                            "end_date": "2024-12-31",
                            "eps_diluted": 5.0,
                            "equity": 1000.0,
                            "revenue": 8000.0,
                            "net_income": 500.0,
                            "operating_income": 900.0,
                            "interest_expense": 40.0,
                            "shares_outstanding": 100.0,
                            "cfo": 800.0,
                            "capex": -150.0,
                        }
                    ],
                }
            return super().get(data_type, **kwargs)

    service = ConEdgar()

    def override_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_llm] = lambda: None
    try:
        with TestClient(app) as c:
            data = _completar(c)
    finally:
        app.dependency_overrides.clear()

    assert data["scored"] > 400, "EDGAR debe cubrir el índice casi entero"
    assert service.financial_calls > 400
    # Y lo importante: ni una sola llamada al proveedor con cuota escasa.
    assert service.fundamental_calls == 0


def test_la_lista_diaria_congela_lo_accionable(client, session_factory):
    """Cada cálculo deja registro: sin esto no hay forward testing posible."""
    from app.db.models import DecisionSnapshot

    c, _ = client
    data = _completar(c)
    assert data["instantaneas"]["error"] is None
    n_ideas = len(data["shortlist"]["ideas"]) + len(data["shortlist"]["evitar"])
    with session_factory() as s:
        congeladas = s.query(DecisionSnapshot).all()
    assert len(congeladas) >= n_ideas > 0
    assert all(x.origen == "hoy:us_sp500" for x in congeladas)
    # Recalcular el mismo día no duplica nada.
    c.get("/api/signals/today?market=us_sp500&budget=600&refresh=true")
    with session_factory() as s:
        assert s.query(DecisionSnapshot).count() == len(congeladas)


def test_con_precios_viejos_la_lista_no_recomienda_comprar(client, session_factory):
    """Si la descarga masiva llega del rescate, ningún precio del barrido es de
    ahora. La lista puede opinar, pero no fijar zonas de compra — y lo que
    congela lo registra como viejo."""
    from app import snapshots as sn
    from app.db.models import DecisionSnapshot

    c, service = client
    service.bulk_viejo = True
    data = _completar(c)
    con_precio = [s for s in data["signals"] if s.get("price")]
    assert con_precio and all(s["price"]["estado"] == "viejo" for s in con_precio)
    assert not [s for s in data["signals"] if s["decision"]["action"] == "comprar"]
    with session_factory() as s:
        for snap in s.query(DecisionSnapshot):
            assert sn.reconstruir(snap)["precio"]["estado"] == "viejo"


def test_varios_lotes_del_mismo_simbolo_cuentan_todos(session_factory):
    """La lista diaria indexaba las posiciones por símbolo con un dict: con dos
    lotes abiertos de la misma empresa solo quedaba el ÚLTIMO, con su coste y
    su stop. Si el stop perforado era el del otro lote, no avisaba nadie."""
    from datetime import datetime, timezone

    from app.contexto_cartera import posiciones_para_decidir
    from app.db.models import Instrument, Position

    with session_factory() as s:
        inst = Instrument(symbol="AAPL")
        s.add(inst)
        s.commit()
        cuando = datetime(2026, 1, 5, tzinfo=timezone.utc)
        s.add(Position(instrument_id=inst.id, quantity=10, cost_basis=100.0, stop=95.0, opened_at=cuando))
        s.add(Position(instrument_id=inst.id, quantity=30, cost_basis=80.0, stop=None, opened_at=cuando))
        s.commit()
        p = posiciones_para_decidir(s)["AAPL"]
    assert p["quantity"] == 40
    assert p["cost_basis"] == pytest.approx((10 * 100 + 30 * 80) / 40)
    # El stop más protector de los fijados manda: a 93, el lote de 95 está perforado.
    assert p["stop"] == 95.0 and p["lotes"] == 2 and p["lotes_sin_stop"] == 1

    from app.analysis.decision import decide

    d = decide({"score": 0.5}, {"last": 93.0, "sma200": 90.0}, p)
    assert d["action"] == "vender"
    assert any("2 lotes" in r and "1 sin stop" in r for r in d["reasons"])


def test_si_no_se_puntua_nada_se_dice_por_que_y_no_se_adivina(session_factory):
    """V13: el error decía «Revisa que FINNHUB_API_KEY esté en .env» aunque la
    puntuación sale de EDGAR; ahora cuenta los motivos reales de cada empresa."""
    todos = {c["symbol"] for c in load_market("canada")["companies"]}
    service = MarketService(failing=todos)

    def override_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_llm] = lambda: None
    try:
        with TestClient(app) as c:
            r = c.get("/api/signals/today?market=canada&budget=600")
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 502
    detalle = r.json()["detail"]
    assert "FINNHUB_API_KEY" not in detalle
    assert f"{len(todos)} sin fundamentales en ninguna fuente" in detalle
    assert "cuota" not in detalle  # nadie habló de cuota: no se adivina


def test_el_motivo_sin_fundamentales_es_el_que_dio_el_router():
    """Revisión de la Fase 1: «sin fundamentales o cuota agotada» para todo."""
    from app.providers.router import AllProvidersFailedError
    from app.routers.signals import _por_que_sin_fundamentales

    cuota = AllProvidersFailedError("fundamentals", {"edgar": "límite de llamadas agotado en esta ventana",
                                                     "finnhub": "no configurado (falta API key o credencial en .env)"})
    caida = AllProvidersFailedError("fundamentals", {"edgar": "HTTP 503", "fmp": "límite de llamadas agotado en esta ventana"})
    nada = AllProvidersFailedError("fundamentals", {"finnhub": "no configurado (falta API key o credencial en .env)"})
    assert _por_que_sin_fundamentales(cuota) == "sin cuota en las fuentes de fundamentales"
    assert _por_que_sin_fundamentales(caida) == "con las fuentes de fundamentales fallando"
    assert _por_que_sin_fundamentales(nada) == "sin ninguna fuente de fundamentales configurada"


def test_hoy_repasa_el_stop_de_toda_la_cartera_y_no_desde_la_cache(client, session_factory):
    """Revisión 12, visual: con STOP fuera del S&P 500 (stop en 110, cotizando a
    104), Hoy decía «Para vender 0 · nada urgente» y «1 en cartera» con tres
    posiciones abiertas: solo miraba las del mercado barrido. Ahora repasa el
    stop de todas, con la regla del motor, y lo que no puede comprobar lo dice."""
    from tests.fixtures import extremos as ex

    c, service = client
    original = service.get
    cotizaciones = {"STOP": 104.0, "ROZA": 110.0}  # CHIP: sin cotización en ninguna fuente

    def con_cotizaciones(data_type, **kw):
        if data_type == "quote" and kw.get("symbol") in cotizaciones:
            return {"symbol": kw["symbol"], "price": cotizaciones[kw["symbol"]], "currency": "USD",
                    "as_of": iso_utc(), "estado": "valido"}
        return original(data_type, **kw)

    service.get = con_cotizaciones
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "KO", "Consumer Staples"), 300, 58.0, 50.0)
        ex._posicion(s, ex._instrumento(s, "STOP", "Technology"), 50, 90.0, 110.0)
        ex._posicion(s, ex._instrumento(s, "CHIP", "Technology"), 200, 20.0, 18.0)
        s.commit()

    data = _completar(c)
    cartera = data["cartera"]
    assert cartera["abiertas"] == 3 and cartera["en_lista"] == 1
    assert [p["symbol"] for p in cartera["posiciones"]] == ["STOP", "CHIP", "KO"]  # lo urgente arriba
    stop, chip, ko = cartera["posiciones"]
    assert (stop["estado"], stop["en_lista"], stop["precio"], stop["stop"], stop["moneda"], stop["motivo"]) == (
        "perforado", False, 104.0, 110.0, "USD", None)
    assert chip["estado"] == "sin_comprobar" and chip["motivo"].startswith("sin precio")
    senal_ko = next(x for x in data["signals"] if x["symbol"] == "KO")
    assert ko["en_lista"] and ko["precio"] == senal_ko["price"]["last"] and ko["estado"] == "por_encima"

    # En el stop exacto también está perforado («en o por debajo», como el motor).
    # Y se repasa en cada petición: la lista sale de la caché, la cartera no.
    with session_factory() as s:
        ex._posicion(s, ex._instrumento(s, "ROZA", "Technology"), 10, 100.0, 110.0)
        s.commit()
    otra = c.get("/api/signals/today?market=us_sp500&budget=600").json()
    assert otra["cached"] is not False
    roza = next(p for p in otra["cartera"]["posiciones"] if p["symbol"] == "ROZA")
    assert roza["estado"] == "perforado" and otra["cartera"]["abiertas"] == 4


def test_un_fallo_al_repasar_los_stops_no_cuesta_la_lista_ni_se_calla(client, monkeypatch):
    from app import contexto_cartera

    def revienta(*a, **k):
        raise RuntimeError("caído")

    monkeypatch.setattr(contexto_cartera, "stops_de_la_cartera", revienta)
    c, _ = client
    data = c.get("/api/signals/today?market=us_sp500&budget=600").json()
    assert data["signals"]
    assert data["cartera"]["abiertas"] is None and "ninguna se ha comprobado" in data["cartera"]["error"]


# ---------------------------------------------------------------------------
# La primera carga, sin bloquear (`vencida=aceptar`, docs/PLAN_NAVEGACION.md)
# ---------------------------------------------------------------------------


@pytest.fixture
def con_reloj(session_factory):
    """El doble de siempre con la caché DE VERDAD y un reloj que se adelanta a mano:
    la lista caduca a las 6 h y `get_vencido` la rescata durante una semana."""
    from app.cache.cache import CacheStore

    reloj = {"t": datetime(2026, 11, 23, 15, 0, tzinfo=timezone.utc)}
    service = MarketService()
    service.cache = CacheStore(session_factory, now=lambda: reloj["t"])

    def override_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_llm] = lambda: None
    with TestClient(app) as c:
        yield c, service, reloj
    app.dependency_overrides.clear()


GUARDADA = "/api/signals/today?market=canada&vencida=aceptar"


def test_sin_lista_vigente_la_guardada_se_sirve_al_momento_con_su_edad(con_reloj):
    """Sin lista vigente (6 h), Hoy se quedaba en «Puntuando el universo…» los
    minutos de una pasada. Ahora la copia caducada sale al momento, marcada como
    vieja y con su antigüedad, sin recalcular nada; la normal la sustituye después."""
    c, service, reloj = con_reloj
    calculada = _completar(c, market="canada")
    descargas = service.bulk_calls
    reloj["t"] += timedelta(hours=9)

    r = c.get(GUARDADA)
    assert r.status_code == 200
    vieja = r.json()
    assert vieja["estado"] == "viejo" and vieja["antiguedad_segundos"] == 9 * 3600
    assert vieja["cached"] is True and vieja["as_of"] == calculada["as_of"]
    assert [s["symbol"] for s in vieja["signals"]] == [s["symbol"] for s in calculada["signals"]]
    assert service.bulk_calls == descargas, "servir la copia no puede volver a puntuar"
    # El repaso de stops y la comparación con la cartera siguen siendo de ahora.
    assert vieja["cartera"]["abiertas"] == 0 and vieja["lista_desfasada"] is None
    assert "huella_cartera" not in vieja

    # La normal, después, sí recalcula, y no viene marcada.
    nueva = c.get("/api/signals/today?market=canada").json()
    assert "estado" not in nueva and nueva["cached"] is False
    assert service.bulk_calls > descargas


def test_la_lista_guardada_no_congela_instantaneas(con_reloj, monkeypatch):
    """Una lista servida es la decisión de cuando se calculó, y ya se congeló
    entonces: congelarla al servirla la fecharía como de hoy."""
    from app.routers import signals as S

    c, _, reloj = con_reloj
    _completar(c, market="canada")
    congeladas = []
    monkeypatch.setattr(S.snapshots, "congelar_lista_diaria", lambda *a, **k: congeladas.append(a) or {"error": None})
    reloj["t"] += timedelta(hours=9)
    assert c.get(GUARDADA).json()["estado"] == "viejo"
    assert congeladas == []


def test_sin_ninguna_lista_guardada_da_404_y_lo_dice(con_reloj):
    """Sin copia no hay nada que enseñar al momento: la pantalla espera a la normal
    (y la pide con un presupuesto corto). Más de una semana es «ninguna»."""
    c, service, reloj = con_reloj
    r = c.get(GUARDADA)
    assert r.status_code == 404
    assert "No hay ninguna lista de Canadá" in r.json()["detail"]
    assert service.bulk_calls == 0, "pedir la guardada no puede ponerse a puntuar"

    _completar(c, market="canada")
    reloj["t"] += timedelta(days=8)
    assert c.get(GUARDADA).status_code == 404
    assert c.get("/api/signals/today?market=marte&vencida=aceptar").json()["detail"] == "Mercado desconocido: marte"


def test_con_lista_vigente_la_guardada_es_la_de_siempre(con_reloj):
    c, service, _ = con_reloj
    calculada = _completar(c, market="canada")
    descargas = service.bulk_calls
    guardada = c.get(GUARDADA).json()
    assert "estado" not in guardada and "antiguedad_segundos" not in guardada
    assert guardada["cached"] is True and guardada["as_of"] == calculada["as_of"]
    assert service.bulk_calls == descargas
    # Solo vale «aceptar», y no se combina con recalcular: una de las dos se
    # perdería en silencio.
    assert c.get("/api/signals/today?market=canada&vencida=si").status_code == 422
    r = c.get("/api/signals/today?market=canada&vencida=aceptar&refresh=true")
    assert r.status_code == 422 and "no se pueden pedir las dos" in r.json()["detail"]


def test_servir_la_guardada_no_marca_la_copia_de_la_cache(client):
    """Con una caché que devuelve su propia referencia (como la falsa de
    `tests/fakes_empresa.py`), marcar la copia en su sitio la dejaba «vieja»
    para siempre."""
    c, service = client

    class PorReferencia(FakeCache):
        def get_vencido(self, data_type, params):
            return self.vencidas.get(f"{data_type}|{self._key(params)}")

    cache = PorReferencia()
    cache.store, cache.vencidas = service.cache.store, {}
    service.cache = cache
    c.get("/api/signals/today?market=canada&budget=600")
    clave = next(k for k in cache.store if k.startswith("daily_picks|"))
    guardada = {**cache.store.pop(clave), "cached": True, "antiguedad_segundos": 3600}
    cache.vencidas[clave] = guardada

    servida = c.get(GUARDADA).json()
    assert servida["estado"] == "viejo" and servida["antiguedad_segundos"] == 3600
    assert "estado" not in guardada and "cartera" not in guardada


def test_el_presupuesto_cuenta_tambien_las_descargas_de_edgar(session_factory):
    """El presupuesto solo acotaba el respaldo de Finnhub: la primera pasada
    descargaba los ~500 companyfacts de EDGAR de una vez y tardaba minutos, así
    que pedirla con un presupuesto menor no la acortaba en nada. Ahora cada
    empresa que descarga algo cuenta una vez, y lo ya guardado sigue gratis."""

    class EdgarQueGuarda(MarketService):
        def __init__(self):
            super().__init__()
            self.financial_calls = 0

        def get(self, data_type, **kwargs):
            if data_type == "financials":
                # Como el servicio real: lo guardado sale de la caché sin descargar.
                guardado = self.cache.get("financials", {"symbol": kwargs["symbol"]})
                if guardado is not None:
                    return guardado
                self.financial_calls += 1
                payload = {"source": "edgar", "as_of": iso_utc(), "periods": [{
                    "end_date": "2024-12-31", "eps_diluted": 5.0, "equity": 1000.0, "revenue": 8000.0,
                    "net_income": 500.0, "operating_income": 900.0, "interest_expense": 40.0,
                    "shares_outstanding": 100.0, "cfo": 800.0, "capex": -150.0}]}
                # Como el servicio real: lo descargado queda en la caché 24 h.
                self.cache.set("financials", {"symbol": kwargs["symbol"]}, payload)
                return payload
            return super().get(data_type, **kwargs)

    service = EdgarQueGuarda()

    def override_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_llm] = lambda: None
    try:
        with TestClient(app) as c:
            primera = c.get("/api/signals/today?market=us_sp500&budget=40").json()
            assert service.financial_calls == 40 and primera["fetched_now"] == 40
            assert primera["pending"] > 0 and primera["complete"] is False
            segunda = c.get("/api/signals/today?market=us_sp500&budget=40&refresh=true").json()
    finally:
        app.dependency_overrides.clear()
    # Las 40 de la primera salen de la caché: la segunda descarga otras 40.
    assert service.financial_calls == 80 and segunda["scored"] > primera["scored"]
    assert service.fundamental_calls == 0


# ---------------------------------------------------------------------------
# Revisión 14: la primera pasada corta, el presupuesto y lo que no existe
# ---------------------------------------------------------------------------


class _EdgarQueGuarda(MarketService):
    """EDGAR que guarda lo descargado (como el servicio real) y cuenta cada
    companyfacts que de verdad baja. Los estados varían por empresa para que el
    z-score dependa de con quién se compara."""

    def __init__(self):
        super().__init__()
        self.financial_calls = 0

    def get(self, data_type, **kwargs):
        if data_type == "financials":
            simbolo = kwargs["symbol"]
            guardado = self.cache.get("financials", {"symbol": simbolo})
            if guardado is not None:
                return guardado
            self.financial_calls += 1
            seed = sum(ord(ch) * (i + 1) for i, ch in enumerate(simbolo))
            payload = {"source": "edgar", "as_of": iso_utc(), "periods": [{
                "end_date": "2024-12-31", "eps_diluted": 1.0 + seed % 9, "equity": 500.0 + seed % 700,
                "revenue": 8000.0, "net_income": 100.0 + seed % 600, "operating_income": 200.0 + seed % 900,
                "interest_expense": 40.0, "shares_outstanding": 100.0, "cfo": 300.0 + seed % 800,
                "capex": -150.0}]}
            self.cache.set("financials", {"symbol": simbolo}, payload)
            return payload
        return super().get(data_type, **kwargs)


def _cliente_con(service, session_factory) -> TestClient:
    def override_session():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_service] = lambda: service
    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_llm] = lambda: None
    return TestClient(app)


@pytest.mark.parametrize("consulta", ["&budget=40", ""], ids=["primera_pasada_40", "normal_120"])
def test_solo_se_congela_la_lista_que_cubre_el_mercado(session_factory, consulta):
    """La primera pasada del día es corta (`PRIMERA_PASADA = 40`, o la normal de
    120 detrás de la copia caducada) y el presupuesto cuenta EDGAR: congelaba
    como «la decisión del día», inmutable y la primera gana, lo que decía una
    lista de 40 de 502, con el segundo sector puntuado contra una parte de sí
    mismo. F y GM quedaban como «evitar» con una puntuación que la lista
    completa no da. Ahora solo congela la lista completa, y lo congelado es lo
    que dice ella."""
    from app.db.models import DecisionSnapshot

    try:
        with _cliente_con(_EdgarQueGuarda(), session_factory) as c:
            primera = c.get(f"/api/signals/today?market=us_sp500{consulta}").json()
            assert primera["complete"] is False
            with session_factory() as s:
                assert s.query(DecisionSnapshot).count() == 0
            inst = primera["instantaneas"]
            assert inst["guardadas"] == 0 and inst["error"] is None
            assert "Lista parcial" in inst["sin_congelar"] and "cubra el mercado entero" in inst["sin_congelar"]

            completa = primera
            for _ in range(6):
                if completa["complete"]:
                    break
                completa = c.get("/api/signals/today?market=us_sp500&budget=600&refresh=true").json()
    finally:
        app.dependency_overrides.clear()
    assert completa["complete"] is True
    assert completa["instantaneas"]["sin_congelar"] is None and completa["instantaneas"]["guardadas"] > 0

    accion = {x["symbol"]: x["decision"]["action"] for x in completa["signals"]}
    puntuacion = {x["symbol"]: x["score"] for x in completa["signals"]}
    corta = completa["shortlist"]
    esperadas = {(x["symbol"], "comprar") for x in corta["ideas"]} | {(x["symbol"], "evitar") for x in corta["evitar"]}
    with session_factory() as s:
        congeladas = s.query(DecisionSnapshot).all()
        assert {(x.symbol, x.accion) for x in congeladas} == esperadas
        for x in congeladas:
            assert accion[x.symbol] == x.accion and x.score == pytest.approx(puntuacion[x.symbol])
            assert x.contexto["mercado"]["completo"] is True


def test_con_finnhub_guardado_no_vuelve_a_bajar_edgar_sin_contarlo(session_factory):
    """La empresa con los fundamentales de Finnhub guardados salía gratis
    («EDGAR no la tiene»), pero se volvía a pedir su companyfacts: si EDGAR solo
    había fallado un rato, esa descarga no la contaba nadie. Con 40 de
    presupuesto se bajaban 80."""
    from app.providers.router import AllProvidersFailedError

    service = _EdgarQueGuarda()
    original = service.get
    edgar = {"caido": True}

    def get(data_type, **kw):
        if data_type == "financials" and edgar["caido"]:
            raise AllProvidersFailedError("financials", {"edgar": "HTTP 503"})
        return original(data_type, **kw)

    service.get = get
    try:
        with _cliente_con(service, session_factory) as c:
            # EDGAR cae en la primera pasada: las 40 van a Finnhub y se guardan.
            primera = c.get("/api/signals/today?market=us_sp500&budget=40").json()
            edgar["caido"] = False
            antes = service.financial_calls
            segunda = c.get("/api/signals/today?market=us_sp500&budget=40&refresh=true").json()
    finally:
        app.dependency_overrides.clear()
    assert primera["fetched_now"] == 40 and service.fundamental_calls == 40
    # Las 40 de Finnhub salen gratis y con su fuente; las 40 nuevas, de EDGAR.
    assert service.financial_calls - antes == segunda["fetched_now"] == 40
    fuentes = Counter(x["context"]["source"] for x in segunda["signals"])
    assert fuentes["fake"] == 40 and fuentes["edgar"] > 0
    assert service.fundamental_calls == 40


def test_lo_que_ninguna_fuente_tiene_no_gasta_presupuesto_en_cada_pasada(session_factory):
    """«40 + 4 × 120 = 520 ≥ 502»: el margen son 18 unidades, y una empresa que
    ni EDGAR ni Finnhub tienen no guarda nada, así que gastaba una unidad (y una
    llamada a Finnhub) en CADA pasada. Con cinco así, las pasadas automáticas no
    cubrían el S&P 500. Ahora el «no existe» se recuerda 24 h."""
    from app.routers.signals import SIN_FUNDAMENTALES

    primeras = [x["symbol"] for x in next(iter(load_market("us_sp500")["sectors"].values()))][:5]
    service = _EdgarQueGuarda()
    original = service.get
    pedidas: Counter = Counter()

    def get(data_type, **kw):
        if data_type in ("financials", "fundamentals") and kw.get("symbol") in primeras:
            pedidas[data_type] += 1
            raise DataNotFoundError(f"{kw['symbol']}: ni EDGAR ni Finnhub")
        return original(data_type, **kw)

    service.get = get
    try:
        with _cliente_con(service, session_factory) as c:
            # Lo que pide `useListaDiaria` sin lista guardada: la primera corta y 4 pasadas.
            d = c.get("/api/signals/today?market=us_sp500&budget=40").json()
            for _ in range(4):
                d = c.get("/api/signals/today?market=us_sp500&refresh=true").json()
    finally:
        app.dependency_overrides.clear()
    assert d["complete"] is True, f"tras las 5 pasadas: {d['scored']} puntuadas, {d['pending']} pendientes"
    # Se preguntó una vez a cada fuente, no una por pasada, y se dice por qué faltan.
    assert pedidas == {"financials": 5, "fundamentals": 5}
    assert all(service.cache.get(SIN_FUNDAMENTALES, {"symbol": s}) is not None for s in primeras)
    motivos = {x["symbol"]: x["reason"] for x in d["unavailable"]}
    assert all(motivos[s] == "sin fundamentales en ninguna fuente" for s in primeras)


def test_un_fallo_de_las_fuentes_no_se_recuerda_como_que_no_existe(session_factory):
    """Lo que se recuerda es la RESPUESTA «no la tengo» de las dos fuentes: con
    EDGAR caído (sin cuota, un 503), la empresa se vuelve a intentar en la
    pasada siguiente. Recordarlo 24 h la dejaría fuera el día entero."""
    from app.providers.router import AllProvidersFailedError
    from app.routers.signals import SIN_FUNDAMENTALES

    service = _EdgarQueGuarda()
    original = service.get

    def get(data_type, **kw):
        if kw.get("symbol") == "AAPL":
            if data_type == "financials":
                raise AllProvidersFailedError("financials", {"edgar": "HTTP 503"})
            if data_type == "fundamentals":
                raise DataNotFoundError("finnhub: sin datos de AAPL")
        return original(data_type, **kw)

    service.get = get
    try:
        with _cliente_con(service, session_factory) as c:
            d = c.get("/api/signals/today?market=us_sp500&budget=600").json()
    finally:
        app.dependency_overrides.clear()
    assert any(x["symbol"] == "AAPL" for x in d["unavailable"])
    assert service.cache.get(SIN_FUNDAMENTALES, {"symbol": "AAPL"}) is None


def test_la_vigencia_de_la_lista_es_la_misma_en_el_frontend():
    """`useListaDiaria` marca vieja la lista que tiene en memoria al pasar su
    vigencia (`VIGENCIA_LISTA_HORAS`). Si no fuera la de la caché del backend, la
    pantalla presentaría como de ahora una lista que el backend ya no sirve como
    vigente, o al revés."""
    import re
    from pathlib import Path

    from app.config import CACHE_TTL_SECONDS

    hook = Path(__file__).resolve().parents[2] / "frontend/src/hooks/useListaDiaria.ts"
    horas = re.search(r"export const VIGENCIA_LISTA_HORAS = (\d+)\b", hook.read_text(encoding="utf-8"))
    assert horas is not None, "VIGENCIA_LISTA_HORAS ya no está en useListaDiaria.ts"
    assert int(horas.group(1)) * 3600 == CACHE_TTL_SECONDS["daily_picks"]
