"""Repaso de seguridad (ítem 0.9 del plan), convertido en guardas.

- Un ticker se valida en la frontera de TODA la API con el mismo patrón
  (`app/simbolos.py`). Se recorre el esquema OpenAPI entero —no una lista
  escrita a mano, que es como se quedaron seis rutas sin validar— y se exige el
  patrón en cada parámetro o campo con «symbol» en el nombre. Y se prueba el
  comportamiento: un símbolo malicioso es un 422 en español y NUNCA una llamada
  a un proveedor.
- El backend solo escucha en 127.0.0.1; CORS solo admite el Vite local; y solo
  atiende a una cabecera `Host` de esta máquina (auditoría del 19 oct, A6).
- `.env` no se versiona y `.env.example` no lleva claves; ningún fichero
  versionado contiene algo con forma de clave.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.simbolos import PATRON_LISTA_SIMBOLOS, PATRON_SIMBOLO

RAIZ = Path(__file__).resolve().parents[2]
MALOS = ["AAPL;DROP", "A" * 13, "AA PL", "AAPL$", "..", "<b>"]


@pytest.fixture(scope="module")
def esquema():
    from app.main import app

    return app.openapi()


def _con_simbolo(esquema):
    """(método, ruta, dónde, nombre, esquema del campo) de cada símbolo de la API."""
    componentes = esquema.get("components", {}).get("schemas", {})

    def resolver(s):
        while "$ref" in s:
            s = componentes[s["$ref"].split("/")[-1]]
        return s

    for ruta, ops in esquema["paths"].items():
        for metodo, op in ops.items():
            for p in op.get("parameters", []):
                if "symbol" in p["name"]:
                    yield metodo, ruta, p["in"], p["name"], p.get("schema", {})
            cuerpo = (((op.get("requestBody") or {}).get("content") or {}).get("application/json") or {})
            if "schema" in cuerpo:
                for nombre, campo in (resolver(cuerpo["schema"]).get("properties") or {}).items():
                    if "symbol" in nombre:
                        yield metodo, ruta, "body", nombre, campo


def _patrones(campo: dict) -> set[str]:
    """Los patrones que impone un campo, mirando dentro de anyOf (opcionales) y de listas."""
    salida = set()
    for alternativa in campo.get("anyOf", [campo]):
        if alternativa.get("type") == "null":
            continue
        objetivo = alternativa.get("items", alternativa) if alternativa.get("type") == "array" else alternativa
        salida.add(objetivo.get("pattern"))
    return salida


def test_todo_simbolo_de_la_api_lleva_el_patron_comun(esquema):
    campos = list(_con_simbolo(esquema))
    assert len(campos) >= 40, "el recorrido no encontró las rutas: ¿cambió la forma del esquema?"
    sin_patron = [f"{m.upper()} {r} ({d}: {n})" for m, r, d, n, c in campos
                  if not _patrones(c) <= {PATRON_SIMBOLO, PATRON_LISTA_SIMBOLOS} or None in _patrones(c)]
    assert not sin_patron, "Símbolos sin validar en la frontera:\n  " + "\n  ".join(sin_patron)


class _ServicioEspia:
    """Cuenta cualquier intento de pedir datos: con un símbolo malo no puede haber ninguno."""

    def __init__(self):
        self.llamadas = []

        class _Cache:
            def get(self, *a, **k):
                return None

            def set(self, *a, **k):
                pass

        self.cache = _Cache()

    def get(self, tipo, **kw):
        from app.providers.base import DataNotFoundError

        self.llamadas.append((tipo, kw))
        raise DataNotFoundError("espía")


@pytest.fixture
def cliente(session_factory):
    from app.db.engine import get_session
    from app.deps import get_llm, get_service
    from app.main import app

    espia = _ServicioEspia()

    def sesion():
        s = session_factory()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides.update({get_service: lambda: espia, get_session: sesion, get_llm: lambda: None})
    try:
        yield TestClient(app, raise_server_exceptions=False), espia
    finally:
        app.dependency_overrides.clear()


def test_un_simbolo_malicioso_es_un_422_en_espanol_y_nunca_una_llamada(esquema, cliente):
    c, espia = cliente
    probadas = 0
    for metodo, ruta, donde, nombre, _ in _con_simbolo(esquema):
        if donde == "body":
            continue
        # «..» en una RUTA lo normaliza el propio cliente HTTP («/a/../b» → «/b»): la
        # petición que llega es otra, legítima. Se prueba en queries y cuerpos.
        for malo in [m for m in MALOS if not (donde == "path" and m == "..")]:
            espia.llamadas.clear()
            url = re.sub(r"\{symbol\}", malo, ruta)
            url = re.sub(r"\{[a-z_]+\}", "1", url)  # otros parámetros de ruta: cualquier valor válido
            params = {nombre: malo} if donde == "query" else {}
            r = c.request(metodo.upper(), url, params=params, json={} if metodo != "get" else None)
            # Un 422 y en español: antes se aceptaba también un 404, que habría
            # dejado pasar una ruta que no valida y encima no encuentra nada.
            assert r.status_code == 422, (metodo, ruta, malo, r.status_code)
            assert not espia.llamadas, f"{metodo.upper()} {ruta} con «{malo}» llegó al proveedor"
            assert "Símbolo inválido" in r.text, (ruta, r.text[:200])
        probadas += 1
    assert probadas >= 35


@pytest.mark.parametrize("ruta,cuerpo", [
    ("/api/portfolio/positions", {"symbol": "AAPL;DROP", "quantity": 1, "cost_basis": 1}),
    ("/api/watchlist", {"symbol": "AA PL"}),
    ("/api/theses", {"symbol": "A" * 13, "title": "t", "body_md": "b"}),
    ("/api/screener/run", {"symbols": ["AAPL", "MSFT;X"], "filters": []}),
    ("/api/signals/score", {"symbols": ["AAPL", "MSFT", "<b>"]}),
    ("/api/news/interpret", {"headline": "x", "symbol": "AAPL$"}),
    ("/api/expectativas/eventos", {"symbol": "..", "tipo": "earnings"}),
])
def test_un_simbolo_malicioso_en_un_cuerpo_tambien(cliente, ruta, cuerpo):
    c, espia = cliente
    r = c.post(ruta, json=cuerpo)
    assert r.status_code == 422 and "Símbolo inválido" in r.text, (ruta, r.status_code, r.text[:200])
    assert not espia.llamadas


def test_los_simbolos_buenos_siguen_pasando(cliente):
    c, espia = cliente
    for bueno in ("AAPL", "BRK-B", "RY.TO", "BTC-USD", "aapl"):
        r = c.get(f"/api/stocks/{bueno}/quote")
        assert r.status_code != 422, (bueno, r.text[:200])


def test_los_simbolos_buenos_pasan_tambien_por_query_lista_y_cuerpo_y_llegan_en_mayusculas(cliente):
    """La revisión de la Fase 0 vio que solo se probaba la ruta. Y que la
    validación común había cambiado el contrato: un `?symbol=` vacío o con
    espacios pasó a 422, cuando antes era «sin filtro» o se recortaba."""
    c, espia = cliente
    c.get("/api/news", params={"symbol": " aapl "})
    c.get("/api/etfs/recomendar", params={"symbols": "spy , qqq"})
    pedidos = {kw.get("symbol") for _, kw in espia.llamadas}
    assert {"AAPL", "SPY", "QQQ"} <= pedidos, pedidos
    r = c.post("/api/watchlist", json={"symbol": " brk-b "})
    assert r.status_code != 422 and r.json().get("symbol", "BRK-B") == "BRK-B", r.text[:200]
    # Lo vacío sigue siendo «sin filtro» en todas las queries opcionales con símbolo.
    for url in ("/api/expectativas/eventos", "/api/snapshots", "/api/theses/decisiones", "/api/news"):
        for vacio in ("", "  "):
            r = c.get(url, params={"symbol": vacio})
            assert r.status_code != 422, (url, repr(vacio), r.text[:200])


def test_un_cuerpo_con_symbol_vacio_opcional_no_es_un_ticker_malo(cliente):
    c, _ = cliente
    r = c.post("/api/news/interpret", json={"headline": "x", "symbol": ""})
    assert r.status_code != 422, r.text[:200]


def test_el_backend_solo_escucha_en_local_y_cors_solo_admite_el_vite_local(cliente):
    from app.config import settings

    start = (RAIZ / "start.sh").read_text(encoding="utf-8")
    assert "--host 127.0.0.1" in start and "0.0.0.0" not in start
    assert "0.0.0.0" not in (RAIZ / "frontend" / "vite.config.ts").read_text(encoding="utf-8")
    assert set(settings.cors_origins) <= {"http://localhost:5173", "http://127.0.0.1:5173"}
    c, _ = cliente
    ajena = c.options("/api/meta/health", headers={"Origin": "https://malicioso.example",
                                                   "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in {k.lower() for k in ajena.headers}
    local = c.options("/api/meta/health", headers={"Origin": "http://localhost:5173",
                                                   "Access-Control-Request-Method": "GET"})
    assert local.headers.get("access-control-allow-origin") == "http://localhost:5173"


@pytest.mark.parametrize("host", ["malicioso.example", "malicioso.example:8000", "192.168.1.20:8000",
                                  "localhost.malicioso.example", "", "::1"])
def test_un_host_ajeno_es_un_400_en_espanol_y_no_llega_a_la_api(cliente, host):
    # Escuchar en 127.0.0.1 no basta: con DNS rebinding, una web hace que su
    # dominio resuelva a 127.0.0.1 y llama a la API con `Host: su-dominio`.
    c, espia = cliente
    r = c.get("/api/stocks/AAPL/quote", headers={"host": host})
    assert r.status_code == 400
    assert r.json()["detail"].startswith("Cabecera Host no permitida")
    assert espia.llamadas == []


@pytest.mark.parametrize("host", ["localhost:5173", "127.0.0.1:8000", "[::1]:8000", "LocalHost:5173", "localhost"])
def test_los_hosts_de_esta_maquina_pasan(cliente, host):
    c, _ = cliente
    assert c.get("/api/meta/health", headers={"host": host}).status_code == 200


@pytest.mark.parametrize("cabeceras", [
    {"origin": "https://malicioso.example"},
    {"origin": "http://localhost:3000"},  # otra web local: mismo sitio, otro origen
    {"origin": "null"},
    {"sec-fetch-site": "cross-site"},  # un <img> o un formulario sin Origin
    {"sec-fetch-site": "same-site"},
])
def test_una_peticion_de_otra_web_es_un_403_y_no_llega_a_la_api(cliente, cabeceras):
    # Revisión de A6: con `Host: 127.0.0.1:8000`, el de verdad, una web ajena
    # congelaba una instantánea con un <img> y gastaba cuota con un POST sin
    # cuerpo: CORS solo impide leer la respuesta, no que se ejecute.
    c, espia = cliente
    for metodo, ruta in (("get", "/api/empresa/AAPL/analisis?pares=false"),
                         ("post", "/api/expectativas/AAPL/proximos-resultados"),
                         ("post", "/api/earnings/AAPL/analizar")):
        r = getattr(c, metodo)(ruta, headers={"host": "127.0.0.1:8000", **cabeceras})
        assert r.status_code == 403, (ruta, r.text[:200])
        assert r.json()["detail"].startswith("Petición de otra web")
    assert espia.llamadas == []


@pytest.mark.parametrize("cabeceras", [
    {"origin": "http://localhost:5173"},  # la interfaz, por el proxy de Vite
    {"origin": "http://127.0.0.1:5173", "sec-fetch-site": "same-origin"},
    {"origin": "http://127.0.0.1:8000"},  # el propio backend (/docs)
    {"sec-fetch-site": "same-origin"},
    {"sec-fetch-site": "none"},  # escrita en la barra de direcciones
])
def test_la_interfaz_y_el_propio_backend_pasan(cliente, cabeceras):
    c, _ = cliente
    assert c.get("/api/meta/health", headers={"host": "127.0.0.1:8000", **cabeceras}).status_code == 200


def test_la_interfaz_en_otro_puerto_pasa_por_el_proxy_y_el_403_dice_como_arreglarlo(cliente):
    # Revisión 3: `npm run preview` (4173) o `npm run dev` con el 5173 ocupado
    # (5174) recibían 403 en todo POST; el navegador marca same-origin.
    c, _ = cliente
    r = c.get("/api/meta/health", headers={"host": "localhost:8000", "origin": "http://localhost:5174",
                                           "sec-fetch-site": "same-origin"})
    assert r.status_code == 200
    ajena = c.get("/api/meta/health", headers={"host": "localhost:8000", "origin": "http://localhost:5174"})
    assert ajena.status_code == 403 and "CORS_ORIGINS" in ajena.json()["detail"]


def test_sin_fetch_metadata_ni_origin_se_mira_el_referer(cliente):
    # Revisión 3: a un nombre de ALLOWED_HOSTS en http el navegador no manda
    # Fetch Metadata, y un <img> de otra web pasaba.
    c, espia = cliente
    r = c.get("/api/empresa/AAPL/analisis?pares=false",
              headers={"host": "127.0.0.1:8000", "referer": "https://malicioso.example/pagina"})
    assert r.status_code == 403 and "Referer" in r.json()["detail"]
    assert espia.llamadas == []
    propio = c.get("/api/meta/health", headers={"host": "127.0.0.1:8000", "referer": "http://localhost:5173/hoy"})
    assert propio.status_code == 200


def test_la_interfaz_con_un_nombre_de_allowed_hosts_pasa():
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route

    from app.main import HostDeConfianza

    interna = Starlette(routes=[Route("/", lambda _: PlainTextResponse("ok"))])
    c = TestClient(HostDeConfianza(interna, ["localhost", "mi-mac.local"], ["http://localhost:5173"]))
    assert c.get("/", headers={"host": "mi-mac.local:8000", "origin": "http://mi-mac.local:5173"}).status_code == 200
    assert c.get("/", headers={"host": "mi-mac.local:8000", "origin": "http://mi-mac.local:3000"}).status_code == 403


def test_con_un_nombre_de_allowed_hosts_otro_puerto_de_vite_va_en_cors_origins():
    # Revisión 4: .env.example prometía «cualquier puerto» también aquí. Por http
    # el navegador no manda Fetch Metadata, el proxy deja pasar el Referer y un
    # Vite en el 5174 recibía 403 hasta en las lecturas. Lo dice la documentación.
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route

    from app.main import HostDeConfianza

    interna = Starlette(routes=[Route("/", lambda _: PlainTextResponse("ok"))])
    lectura = {"host": "localhost:8000", "referer": "http://mi-mac.local:5174/hoy"}
    por_defecto = TestClient(HostDeConfianza(interna, ["localhost", "mi-mac.local"], ["http://localhost:5173"]))
    r = por_defecto.get("/", headers=lectura)
    assert r.status_code == 403 and "CORS_ORIGINS" in r.json()["detail"]
    anadido = TestClient(HostDeConfianza(interna, ["localhost", "mi-mac.local"],
                                         ["http://localhost:5173", "http://mi-mac.local:5174"]))
    assert anadido.get("/", headers=lectura).status_code == 200


def test_allowed_hosts_anade_nombres_y_no_quita_los_de_esta_maquina(tmp_path):
    # Revisión de A6: la lista sustituía a la de por defecto y, con
    # ALLOWED_HOSTS='["mi-mac.local"]', el proxy de Vite (que llama como
    # localhost:8000) recibía un 400 en toda la interfaz.
    codigo = (
        "from fastapi.testclient import TestClient\n"
        "from app.main import app\n"
        "c = TestClient(app)\n"
        "print(c.get('/api/meta/health', headers={'host': 'localhost:8000'}).status_code,"
        " c.get('/api/meta/health', headers={'host': 'mi-mac.local:8000'}).status_code,"
        " c.get('/api/meta/health', headers={'host': 'otra.example'}).status_code)\n"
    )
    entorno = {**os.environ, "ALLOWED_HOSTS": '["mi-mac.local"]',
               "DATABASE_PATH": str(tmp_path / "t.db")}
    salida = subprocess.run([sys.executable, "-c", codigo], cwd=RAIZ / "backend", env=entorno,
                            capture_output=True, text=True, timeout=120)
    assert salida.stdout.split() == ["200", "200", "400"], salida.stderr[-500:]


def test_start_sh_no_da_por_arrancado_un_backend_que_responde_con_error():
    # `curl -s` termina bien ante un 400: «Todo listo» con la API rechazándolo todo.
    start = (RAIZ / "start.sh").read_text(encoding="utf-8")
    sondas = re.findall(r"curl -\w+ http://localhost:8000\S*", start)
    assert sondas and all(s.startswith("curl -sf ") for s in sondas), sondas


def test_fuera_de_los_tests_testserver_no_esta_permitido():
    from app.config import Settings

    assert Settings.model_fields["allowed_hosts"].default == ["localhost", "127.0.0.1", "[::1]"]


def test_env_no_se_versiona_y_la_plantilla_no_lleva_claves():
    assert re.search(r"^\.env$", (RAIZ / ".gitignore").read_text(encoding="utf-8"), re.M)
    for linea in (RAIZ / ".env.example").read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Z_]+_API_KEY)=(.*)$", linea)
        if m:
            assert m.group(2).strip() == "", f"{m.group(1)} lleva un valor en .env.example"


def test_ningun_fichero_versionado_contiene_algo_con_forma_de_clave():
    try:
        ficheros = subprocess.run(["git", "ls-files"], cwd=RAIZ, capture_output=True, text=True, check=True).stdout.split()
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("sin git")
    patron = re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}|(?:API_KEY|apikey|token)=[A-Za-z0-9]{16,}")
    sospechosos = []
    for f in ficheros:
        ruta = RAIZ / f
        if ruta.suffix in {".png", ".gz", ".ico", ".db"} or not ruta.is_file() or ruta.stat().st_size > 2_000_000:
            continue
        try:
            texto = ruta.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        sospechosos += [f"{f}: {m.group(0)[:12]}…" for m in patron.finditer(texto)]
    assert not sospechosos, sospechosos


def test_las_rutas_fijas_no_las_tapa_una_ruta_con_parametro(cliente):
    """Encontrado por el sondeo de símbolos: «/api/etfs/{symbol}» iba antes que
    «/api/etfs/recomendar» y se la quedaba. La recomendación de ETFs nunca se
    ejecutaba: devolvía la ficha del «ETF» RECOMENDAR."""
    c, espia = cliente
    c.get("/api/etfs/recomendar", params={"symbols": "SPY,QQQ"})
    pedidos = {kw.get("symbol") for _, kw in espia.llamadas}
    assert "RECOMENDAR" not in pedidos and {"SPY", "QQQ"} & pedidos, pedidos


def test_ninguna_ruta_con_parametro_tapa_a_una_fija_declarada_despues():
    """La forma general del fallo de /api/etfs/recomendar, en todos los routers."""
    import ast

    tapadas = []
    for f in sorted((RAIZ / "backend" / "app" / "routers").glob("*.py")):
        rutas = []
        for n in ast.parse(f.read_text(encoding="utf-8")).body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for d in n.decorator_list:
                    if (isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.args
                            and isinstance(d.args[0], ast.Constant) and d.func.attr in ("get", "post", "put", "delete", "patch")):
                        rutas.append((d.func.attr, d.args[0].value))
        for i, (m1, p1) in enumerate(rutas):
            patron = "^" + re.sub(r"\{[^}]+\}", "[^/]+", p1) + "$"
            tapadas += [f"{f.name}: {m1.upper()} {p1} tapa a {p2}" for m2, p2 in rutas[i + 1:]
                        if m1 == m2 and p1 != p2 and "{" in p1 and re.match(patron, p2)]
    assert not tapadas, tapadas


def test_ninguna_ruta_tapa_a_otra_en_toda_la_app():
    """Lo mismo, con el orden REAL de registro: los `include_router` de `main.py`
    y, dentro de cada router, el orden de declaración. El test anterior solo
    comparaba rutas de un mismo fichero; dos routers con el mismo prefijo
    podían taparse sin que nada lo dijera."""
    import ast
    import importlib

    principal = ast.parse((RAIZ / "backend" / "app" / "main.py").read_text(encoding="utf-8"))
    incluidos = [n.args[0] for n in ast.walk(principal) if isinstance(n, ast.Call)
                 and isinstance(n.func, ast.Attribute) and n.func.attr == "include_router" and n.args]
    rutas = []
    for arg in incluidos:
        modulo, atributo = arg.value.id, arg.attr  # stocks.router, portfolio.watchlist_router…
        router = getattr(importlib.import_module(f"app.routers.{modulo}"), atributo)
        rutas += [(m, r.path) for r in router.routes for m in sorted(getattr(r, "methods", None) or [])]
    # Todas las operaciones del esquema tienen que estar en la lista reconstruida.
    from app.main import app

    esquema = {(m.upper(), r) for r, ops in app.openapi()["paths"].items() for m in ops}
    assert esquema <= set(rutas), f"rutas sin reconstruir: {sorted(esquema - set(rutas))[:5]}"
    tapadas = []
    for i, (m1, p1) in enumerate(rutas):
        if "{" not in p1:
            continue
        patron = "^" + re.sub(r"\{[^}]+\}", "[^/]+", p1) + "$"
        tapadas += [f"{m1} {p1} tapa a {p2}" for m2, p2 in rutas[i + 1:]
                    if m1 == m2 and p1 != p2 and re.match(patron, p2)]
    assert not tapadas, tapadas
