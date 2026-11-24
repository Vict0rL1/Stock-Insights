"""Respuestas REALES de la API sobre el paquete de casos extremos, para los tests
del frontend (ítem 0.5).

Los componentes del frontend se prueban con lo que de verdad les manda el
backend, no con objetos escritos a mano que se desactualizan solos. Este módulo
levanta la app con el servicio falso, recorre unos escenarios con el reloj
congelado y guarda cada respuesta bajo la URL exacta que pide el cliente:

    frontend/src/test/fixtures/<escenario>.json  →  {"rutas": {url: {"status", "json"}}}

    python -m tests.fixtures.exportar_frontend            # escribe
    python -m tests.fixtures.exportar_frontend --comprobar  # ¿están al día?

`tests/test_fixtures_frontend.py` falla si los ficheros no coinciden con lo que
produce el backend hoy: un cambio de texto en el backend obliga a reexportar en
el mismo commit, y el frontend se prueba siempre contra la versión vigente.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import timedelta
from pathlib import Path

# Se ASIGNA, como en conftest.py: con DATABASE_PATH exportado en la shell, un
# `setdefault` dejaría al motor conectado a la base de verdad.
os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(prefix="export-"), "export.db")

import time_machine  # noqa: E402

from app.analysis.markets import parametros_lista_diaria  # noqa: E402
from tests.fakes_empresa import trimestre  # noqa: E402
from tests.fixtures import extremos as ex  # noqa: E402
from tests.fixtures.servicio_pantallas import ServicioPantallas  # noqa: E402
from tests.golden import motor  # noqa: E402

DESTINO = Path(__file__).resolve().parents[3] / "frontend" / "src" / "test" / "fixtures"
MAX_SENALES = 12


def _sesion():
    from app.db.engine import get_session
    from app.main import app

    return next(app.dependency_overrides[get_session]())


def _pedir(c, rutas: dict, url: str) -> dict:
    r = c.get(url)
    rutas[url] = {"status": r.status_code, "json": r.json()}
    return rutas[url]["json"]


def _publicar(c, rutas: dict, url: str, cuerpo: dict) -> dict:
    """Un POST que la pantalla hace al cargar (la valoración de la ficha, sin
    supuestos propios). El fetch falso del frontend sirve por URL, sin mirar el
    método ni el cuerpo: se guarda el del primer render."""
    r = c.post(url, json=cuerpo)
    rutas[url] = {"status": r.status_code, "json": r.json()}
    return rutas[url]["json"]


def _empresa(caso: str, cartera: str, con_historia: bool) -> dict:
    from app import expectativas as seg

    # Con las respuestas completas que piden las pantallas (frescura, velas…),
    # sin inventar nada que el paquete no defina.
    sv, symbol = ex.montar_empresa(caso, ServicioPantallas(ex.AHORA))
    rutas: dict = {}
    with motor._cliente(sv) as c:
        with _sesion() as s:
            ex.montar_cartera(cartera, s, sv)
            if con_historia:
                ex.tesis_con_punto(s, symbol)
        if con_historia:
            # Un análisis de hace dos meses; entre medias baja el precio,
            # desaparece la puntuación y sale un trimestre con el margen por
            # debajo del umbral de la tesis.
            antes = ex.AHORA - timedelta(days=60)
            sv.ahora = antes  # lo que el servicio falso fecha (cotización, calendario) es de entonces
            sv.quotes[symbol]["as_of"] = antes.isoformat()
            with time_machine.travel(antes, tick=False):
                c.get(f"/api/empresa/{symbol}/analisis")
                with _sesion() as s:
                    e = seg.crear_evento(s, symbol, "earnings", periodo="2026-Q2", fecha_prevista="2026-07-30",
                                         ahora=antes)
                    sv.calendario = [{"symbol": symbol, "date": "2026-07-30", "eps_estimate": 0.5,
                                      "revenue_estimate": 300.0, "eps_actual": None, "revenue_actual": None}]
                    seg.capturar(s, sv, e, antes)
            sv.ahora = ex.AHORA
            sv.quotes[symbol].update(price=92.0, as_of=ex.AHORA.isoformat())
            sv.cache.set("daily_picks", parametros_lista_diaria("us_sp500"), {"signals": [], "as_of": ex.AHORA.isoformat()})
            sv.financials[symbol]["quarters"].append(
                trimestre(2026, 2, "2026-07-30", revenue=310.0, operating_income=310.0 * 0.12, gross_profit=124.0,
                          net_income=31.0, eps_diluted=0.051, cfo=40.0, capex=15.0))
            with _sesion() as s:
                seg.registrar_reales(s, sv, s.get(type(e), e.id), ex.AHORA)
        _pedir(c, rutas, f"/api/empresa/{symbol}/analisis")
        historial = _pedir(c, rutas, f"/api/empresa/{symbol}/historial")
        for d in historial.get("decisiones") or []:
            _pedir(c, rutas, f"/api/snapshots/{d['id']}/replay")
        _pedir(c, rutas, f"/api/empresa/{symbol}/calidad")
        eventos = _pedir(c, rutas, f"/api/expectativas/eventos?symbol={symbol}")
        for e in eventos.get("eventos") or []:
            _pedir(c, rutas, f"/api/expectativas/eventos/{e['id']}")
        _pedir(c, rutas, f"/api/expectativas/calibracion?symbol={symbol}")
        _pedir(c, rutas, "/api/portfolio/contribucion?descargar=false")
        _pedir(c, rutas, "/api/portfolio/efectivo")
        # La cabecera de la ficha, el informe, la valoración y la cartera: lo que
        # pinta el test de fugas además de las secciones de arriba. La cabecera
        # pide los estados de EDGAR cuando faltan cotización, perfil y
        # fundamentales (VACIA), para no dar por inexistente a quien sí los tiene.
        for url in (f"/api/stocks/{symbol}/quote", f"/api/stocks/{symbol}/profile",
                    f"/api/stocks/{symbol}/fundamentals", f"/api/stocks/{symbol}/history?range=1Y",
                    f"/api/stocks/{symbol}/financials",
                    "/api/meta/llm", f"/api/deep-dive/{symbol}?history_years=10",
                    "/api/portfolio", "/api/portfolio/historial?descargar=false",
                    # «Qué dice la app», en la cabecera: el análisis sin congelar.
                    # El último, para no cambiar lo que responden los de arriba.
                    f"/api/empresa/{symbol}/analisis?congelar=false"):
            _pedir(c, rutas, url)
        # La pestaña Valoración: el resumen del único DCF (ítem 3.3), el mismo que
        # abre el módulo completo con el símbolo.
        _publicar(c, rutas, f"/api/valuation/{symbol}", {})
    return {"symbol": symbol, "rutas": rutas}


def _lista_de_la_vispera(caso: str, con_cartera: bool, cuando) -> dict:
    """La lista que guardó la API hace unas horas, con el mismo servicio falso y
    una base aparte: lo que Hoy enseña al momento (`vencida=aceptar`) mientras
    pide la de ahora. Tal como la guarda la caché (sin `cached`)."""
    sv = ex.servicio_lista(caso)
    with motor._cliente(sv) as c:
        if con_cartera:
            with _sesion() as s:
                ex.sembrar_cartera_lista(s)
        with time_machine.travel(cuando, tick=False):
            c.get("/api/signals/today?market=us_sp500")
    guardada = sv.cache.get("daily_picks", parametros_lista_diaria("us_sp500"))
    return {k: v for k, v in guardada.items() if k != "cached"}


def _hoy(caso: str, con_cartera: bool = False) -> dict:
    rutas: dict = {}
    # Un día normal: la lista de hace 9 h ya caducó (6 h) y la caché la rescata.
    # La pantalla la pide primero, y después la de ahora y sus pasadas.
    antes = ex.AHORA - timedelta(hours=9)
    vispera = _lista_de_la_vispera(caso, con_cartera, antes)
    sv = ex.servicio_lista(caso)
    sv.cache.guardar_vencida("daily_picks", parametros_lista_diaria("us_sp500"), vispera, antes, 9 * 3600)
    with motor._cliente(sv) as c:
        if con_cartera:
            with _sesion() as s:
                ex.sembrar_cartera_lista(s)
        _pedir(c, rutas, "/api/signals/markets")
        for url in ("/api/signals/today?market=us_sp500&vencida=aceptar", "/api/signals/today?market=us_sp500",
                    "/api/signals/today?market=us_sp500&refresh=true"):
            d = _pedir(c, rutas, url)
            # Las 502 filas pesan ~1 MB: se guardan las de la lista corta y las primeras.
            # Las cuentas (`scored`, `requested`, `counts`, sectores) siguen
            # describiendo el barrido entero: la respuesta queda recortada, no
            # inventada. Un test que cuadre totales contra la lista no puede usar
            # estos ficheros (el de fugas solo lee texto).
            corta = {i["symbol"] for i in (d.get("shortlist") or {}).get("ideas") or []}
            d["signals"] = [x for x in d["signals"] if x["symbol"] in corta] + \
                [x for x in d["signals"] if x["symbol"] not in corta][:MAX_SENALES]
    return {"rutas": rutas}


def _decisiones() -> dict:
    """Lo que el motor decide en cada caso que «Qué dice la app» cuenta con su
    frase (`frontend/src/lib/queDiceLaApp.ts`): la frase se prueba contra la
    traza de verdad, con los textos y los umbrales del motor, no contra una
    escrita a mano que se desactualiza sola."""
    from app.analysis.decision import decide

    def precio(last, sma200=94.78, **extra):
        return {"last": last, "sma200": sma200, "above_sma200": None if sma200 is None else last > sma200,
                "daily_vol_pct": 1.6, "drawdown_pct": -8.0, "estado": "valido", **extra}

    viejo = {"estado": "viejo", "antiguedad_segundos": 1200}
    posicion = {"cost_basis": 80.0, "quantity": 10, "stop": 70.0}
    casos = {
        # La maqueta aprobada: buena empresa con el precio bajo su media.
        "vigilar_bajo_la_media": decide({"score": 0.6}, precio(92.0)),
        "vigilar_dentro_de_la_banda": decide({"score": 0.6}, precio(95.5)),
        "vigilar_sin_media": decide({"score": 0.6}, precio(92.0, sma200=None)),
        "vigilar_por_resultados": decide({"score": 0.6}, precio(104.0), resultados_en="2026-09-15"),
        "vigilar_por_precio_viejo": decide({"score": 0.6}, precio(104.0, **viejo)),
        "comprar": decide({"score": 0.6}, precio(104.0)),
        "ninguna": decide({"score": 0.12}, precio(92.0)),
        "ninguna_con_resultados": decide({"score": 0.12}, precio(92.0), resultados_en="2026-09-15"),
        "evitar": decide({"score": -0.52}, precio(92.0)),
        "mantener": decide({"score": 0.4}, precio(100.0), posicion),
        "mantener_con_precio_viejo": decide({"score": 0.4}, precio(100.0, **viejo), posicion),
        # Recibidas en un spin-off: coste 0 y sin stop guardado, no hay con qué comparar.
        "mantener_sin_stop": decide({"score": 0.4}, precio(100.0), {"cost_basis": 0.0, "quantity": 10}),
        # La auditoría del 19 oct: una acción de céntimos con el stop en 0,004.
        "vender_por_stop": decide({"score": 0.4}, precio(0.003, sma200=0.0035),
                                  {"cost_basis": 0.005, "quantity": 1000, "stop": 0.004}),
        "vender_por_puntuacion_y_stop": decide({"score": -0.5}, precio(60.0), posicion),
        "reducir": decide({"score": 0.4}, precio(90.0), posicion),
        "sin_datos": decide({"score": None}, precio(92.0)),
        "sin_datos_ni_precio": decide({"score": None}, None),
    }
    # Y una decisión por cada combinación de papeles que el motor produce sobre
    # el universo del golden master (`tests/golden/motor.py`): si el motor
    # aprende una combinación nueva, el frontend se entera de que no tiene frase.
    from tests.golden import motor as golden

    combinaciones: dict[str, dict] = {}
    entradas = [(s, p, pos, {}) for s in golden.SCORES for p in golden.PRECIOS.values() for pos in golden.POSICIONES.values()]
    entradas += [(s, p, None, {"resultados_en": "2026-09-16"}) for s in golden.SCORES for p in golden.PRECIOS.values()]
    for s, p, pos, kw in entradas:
        d = golden._decide(s, p, pos, **kw)
        papeles = sorted(f"{r['id']}:{r['resultado']}:{r['papel']}" for r in d["reglas"] if r["papel"] != "evaluada")
        clave = "|".join([d["action"], "con_posicion" if d["owned"] else "sin_posicion", *papeles])
        texto = json.dumps(d, ensure_ascii=False)
        if clave not in combinaciones and "NaN" not in texto and "Infinity" not in texto:
            combinaciones[clave] = d
    return {"casos": casos, "combinaciones": combinaciones}


ESCENARIOS = {
    "empresa_completa": lambda: _empresa("completa", "una_posicion", con_historia=True),
    "empresa_vacia": lambda: _empresa("todo_ausente", "vacia", con_historia=False),
    "empresa_deuda_parcial": lambda: _empresa("deuda_parcial", "fx_invertido", con_historia=False),
    "hoy_completo": lambda: _hoy("dia_completo_502"),
    "hoy_sin_candidatas": lambda: _hoy("dia_sin_candidatas", con_cartera=True),
    "decisiones_motor": _decisiones,
}


def exportar() -> dict[str, str]:
    salida = {}
    with motor.reloj_fijo():
        for nombre, f in ESCENARIOS.items():
            salida[nombre] = json.dumps(f(), ensure_ascii=False, sort_keys=True, indent=1) + "\n"
    return salida


def main(argv: list[str]) -> int:
    import logging

    logging.disable(logging.WARNING)
    textos = exportar()
    if "--comprobar" in argv:
        malos = [n for n, t in textos.items()
                 if not (DESTINO / f"{n}.json").exists() or (DESTINO / f"{n}.json").read_text(encoding="utf-8") != t]
        print("desactualizados:", malos or "ninguno")
        return 1 if malos else 0
    DESTINO.mkdir(parents=True, exist_ok=True)
    for n, t in textos.items():
        (DESTINO / f"{n}.json").write_text(t, encoding="utf-8")
        print(f"escrito {n}.json ({len(t) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
