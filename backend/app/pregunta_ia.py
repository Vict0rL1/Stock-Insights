"""«Pregúntale a la IA» (Inicio): una pregunta libre, contestada con lo ya calculado.

El contexto sale SOLO de lo guardado —la caché y la base—, nunca de las fuentes:
preguntar no puede disparar la puntuación del universo (un par de minutos y
hasta 120 fundamentales, `DEFAULT_FETCH_BUDGET`) ni una descarga por posición.
Lo que no está guardado no se calcula: se dice que falta, y la IA lo dice.

- **La lista del día** del mercado, vigente (6 h) o, si caducó, la última copia
  guardada con su antigüedad (`get_vencido`, hasta 7 días), marcada como VIEJA.
- **Tu cartera**: las posiciones abiertas y el repaso de su stop con las mismas
  reglas de Inicio (`contexto_cartera.stops_de_la_cartera`), con los precios de
  la caché (`SoloLoGuardado`).
- **El mercado**: las cotizaciones guardadas de los índices del panel de Mercado.
- **La ficha** del símbolo, si se pide: su fila de la lista y su último análisis
  congelado (`snapshots`), sin precio objetivo.
- **Cómo compara la app los ETFs**: los umbrales de `analysis/etf_picks.py`.

Cada bloque viaja con su fuente, su fecha y su estado (`valido` o `viejo`), y la
respuesta los devuelve: lo que la IA vio se enseña aparte, como lo calculado que
es. La respuesta se guarda en `llm_outputs` por la huella de lo que la define
(`_huella`: la pregunta, los datos de cada bloque y el día, no la hora), como las
noticias: la misma pregunta con los mismos datos, el mismo día, no vuelve a gastar.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import datos
from app import snapshots as sn
from app.analysis.markets import DEFAULT_MARKET, MARKETS, parametros_lista_diaria
from app.db.models import Instrument, LlmOutput
from app.etiquetas import etiqueta
from app.formato import fmt_compacto, fmt_fecha, fmt_frente, fmt_num, fmt_pct, fmt_precio, plural
from app.llm.base import LLMProvider, LLMUnavailableError
from app.llm.coste import coste_estimado, coste_real
from app.llm.pregunta_llm import MAX_PREGUNTA, SYSTEM, ZONA_MERCADO, construir_prompt, limpiar_pregunta
from app.llm.signal_llm import FRONTERAS_ETIQUETA
from app.providers.base import DataNotFoundError
from app.registro import log

KIND = "pregunta_ia"

# Tokens de salida que se suponen al estimar: unas 250 palabras son ~600; el
# tope duro es el `max_tokens` de `interpret` (2048).
SALIDA_ESTIMADA = 1000

# Cuánto de cada lista entra en el contexto: lo que se ve en Inicio, no el
# universo entero (500 empresas serían ~100.000 tokens por pregunta).
MAX_IDEAS = 5
MAX_MEJORES = 5
MAX_EVITAR = 3
MAX_POSICIONES = 20
MAX_MOTIVOS = 3

AVISO = (
    "Respuesta generada por IA a partir de lo que la app ya había calculado (los datos de abajo, "
    "con su fecha). La IA no calculó ninguna cifra y puede equivocarse al leerlas. No es "
    "asesoramiento financiero: la decisión es tuya."
)


class SoloLoGuardado:
    """El servicio de datos sin las fuentes: lo que haya en la caché, y nada más.

    Con el servicio de verdad, el repaso de stops pedía una cotización por
    posición a los proveedores; aquí sale la guardada (vigente, o caducada
    dentro de su margen de rescate y marcada `viejo`, como hace el servicio
    cuando las fuentes caen). Sin copia, «no hay dato», y el repaso lo trata
    como tal: `sin_comprobar`, nunca «por encima».
    """

    def __init__(self, service):
        self.cache = getattr(service, "cache", None)

    def get(self, data_type: str, **kwargs) -> dict:
        params = {k: v for k, v in kwargs.items() if not k.startswith("_")}
        if self.cache is None:
            raise DataNotFoundError(f"{data_type}: no hay caché que leer")
        vigente = self.cache.get(data_type, params)
        if vigente is not None:
            return {**vigente, "estado": datos.Estado.VALIDO.value}
        vencido = getattr(self.cache, "get_vencido", None)
        copia = vencido(data_type, params) if vencido is not None else None
        if copia is not None:
            return {**copia, "estado": datos.Estado.VIEJO.value}
        raise DataNotFoundError(f"{data_type}: sin copia guardada")


def mercado_valido(mercado: str | None) -> str:
    """El mercado pedido o el de por defecto; uno desconocido es un ValueError."""
    if mercado is None or not mercado.strip():
        return DEFAULT_MARKET
    if mercado not in MARKETS:
        disponibles = ", ".join(f"«{clave}» ({m['name']})" for clave, m in MARKETS.items())
        raise ValueError(f"Mercado desconocido: «{mercado[:24]}». Los disponibles: {disponibles}.")
    return mercado


# --- La lista del día ----------------------------------------------------------

_CLAVES_LISTA = frozenset({"signals", "shortlist", "as_of"})


def lista_guardada(service, mercado: str) -> tuple[dict | None, str | None]:
    """(lista, estado): la vigente, la última caducada o ninguna. Nunca la calcula."""
    cache = getattr(service, "cache", None)
    if cache is None:
        return None, None
    params = parametros_lista_diaria(mercado)
    vigente = cache.get("daily_picks", params)
    if vigente is not None and _CLAVES_LISTA <= vigente.keys():
        return vigente, datos.Estado.VALIDO.value
    vencido = getattr(cache, "get_vencido", None)
    copia = vencido("daily_picks", params) if vencido is not None else None
    if copia is not None and _CLAVES_LISTA <= copia.keys():
        return copia, datos.Estado.VIEJO.value
    return None, None


def _fecha_dato(valor) -> str:
    return fmt_fecha(valor, hora=True, zona=ZONA_MERCADO) if valor else "sin fecha"


def _linea_senal(s: dict) -> str:
    """Una empresa de la lista en una línea: lo que dice la regla y por qué.

    Sin el «objetivo» de los niveles: es una salida de la regla, pero en boca de
    la IA se leería como un precio objetivo, que la app no da."""
    d = s.get("decision") or {}
    ctx = s.get("context") or {}
    precio = s.get("price") or {}
    niveles = d.get("levels") or {}
    partes = [
        f"{s.get('symbol')} ({ctx.get('name') or 'sin nombre'}; sector {ctx.get('sector_name') or 'sin sector'})",
        f"acción de la regla: {d.get('label') or etiqueta(d.get('action'))}",
        f"puntuación {fmt_frente(s.get('score'), FRONTERAS_ETIQUETA, signo=True)}"
        + (f" ({s['label']})" if s.get("label") else ""),
    ]
    if d.get("confidence"):
        partes.append(f"confianza {etiqueta(d['confidence'])}")
    if datos.precio(precio.get("last")) is not None:
        partes.append(
            f"último precio {fmt_precio(precio['last'])} ({precio.get('source') or 'sin fuente'}, "
            f"{_fecha_dato(precio.get('as_of'))})"
        )
    if datos.precio(niveles.get("stop")) is not None:
        partes.append(f"stop {fmt_precio(niveles['stop'])}")
    if datos.precio(niveles.get("entrada_desde")) is not None and datos.precio(niveles.get("entrada_hasta")) is not None:
        partes.append(f"zona de entrada {fmt_precio(niveles['entrada_desde'])}–{fmt_precio(niveles['entrada_hasta'])}")
    linea = "- " + "; ".join(partes) + "."
    motivos = [m for m in (d.get("reasons") or [])[:MAX_MOTIVOS] if m]
    if motivos:
        linea += " Motivos de la regla: " + " ".join(motivos)
    return linea


def _cuantas(n, singular: str, varias: str) -> str:
    """«1 favorable», «3 favorables»; sin recuento, «— favorables»: ausente ≠ cero."""
    return f"{fmt_num(n, 0)} {plural(n, singular, varias) if n is not None else varias}"


def _bloque_lista(lista: dict, estado: str, mercado: str) -> dict:
    corta = lista.get("shortlist") or {}
    ideas = (corta.get("ideas") or [])[:MAX_IDEAS]
    evitar = (corta.get("evitar") or [])[:MAX_EVITAR]
    en_ideas = {s.get("symbol") for s in ideas}
    mejores = [s for s in lista.get("signals") or [] if s.get("symbol") not in en_ideas][:MAX_MEJORES]
    counts = lista.get("counts") or {}

    lineas = [
        f"Puntuadas {fmt_num(lista.get('scored'), 0)} de {fmt_num(lista.get('requested'), 0)} empresas; "
        "cada una se compara con las de su propio sector."
        + ("" if lista.get("complete", True) else
           f" Lista INCOMPLETA: faltan {fmt_num(lista.get('pending'), 0)} por puntuar."),
        f"Recuento: {_cuantas(counts.get('favorables'), 'favorable', 'favorables')}, "
        f"{_cuantas(counts.get('neutrales'), 'neutral', 'neutrales')} y "
        f"{_cuantas(counts.get('desfavorables'), 'desfavorable', 'desfavorables')}.",
    ]
    if lista.get("solo_momentum"):
        lineas.append("En este mercado la puntuación sale SOLO del momentum (no hay estados financieros).")
    lineas.append("Ideas de compra de la lista corta, de más a menos convicción:")
    if ideas:
        lineas.extend(_linea_senal(s) for s in ideas)
    else:
        lineas.append("- Ninguna: hoy ninguna empresa pasa las reglas de compra.")
    if mejores:
        lineas.append("Las de mayor puntuación que no están en la lista corta:")
        lineas.extend(_linea_senal(s) for s in mejores)
    if evitar:
        lineas.append("Lo que la regla dice evitar:")
        lineas.extend(_linea_senal(s) for s in evitar)
    if lista.get("disclaimer"):
        lineas.append(f"Cómo leer la lista: {lista['disclaimer']}")
    return {
        "clave": "lista",
        "titulo": f"Lista del día · {etiqueta(mercado)}",
        "fuente": "lista calculada por la app con sus reglas de decisión",
        "fecha": lista.get("as_of"),
        "estado": estado,
        "antiguedad_segundos": lista.get("antiguedad_segundos") if estado == datos.Estado.VIEJO.value else None,
        "nota": (
            "Caducada (se recalcula cada 6 h): es la última copia guardada, no la de ahora."
            if estado == datos.Estado.VIEJO.value else None
        ),
        "texto": "\n".join(lineas),
    }


# --- Tu cartera ---------------------------------------------------------------


def _linea_posicion(fila: dict, posicion: dict | None, decision: dict | None) -> str:
    moneda = fila.get("moneda")
    partes = [fila["symbol"]]
    if posicion:
        partes.append(
            f"{fmt_num(posicion.get('quantity'), 4, ceros=False)} "
            f"{plural(posicion.get('quantity'), 'unidad', 'unidades')}, coste medio "
            f"{fmt_precio(posicion.get('cost_basis'), moneda)}"
        )
    precio = (
        f"precio {fmt_precio(fila['precio'], moneda)} ({etiqueta(fila.get('precio_fuente'))}"
        f"{', ' + fila['precio_proveedor'] if fila.get('precio_proveedor') else ''}, "
        f"{_fecha_dato(fila.get('precio_fecha'))}"
        f"{', VIEJO' if fila.get('precio_estado') == datos.Estado.VIEJO.value else ''})"
        if fila.get("precio") is not None else None
    )
    stop = f"stop {fmt_precio(fila['stop'], moneda)}" if fila.get("stop") is not None else "sin stop"
    if fila["estado"] == "perforado":
        estado = f"STOP PERFORADO: {precio}, en o por debajo del {stop}"
    elif fila["estado"] == "por_encima":
        estado = f"por encima del stop: {precio}, {stop}"
    elif fila.get("precio") is None:
        # El motivo del repaso dice «ninguna fuente dio su cotización», y aquí no
        # se le preguntó a ninguna: la IA lo contaba como una caída de las fuentes.
        estado = f"stop sin comprobar: no hay ningún precio guardado (para esta pregunta no se descarga nada), {stop}"
    else:
        estado = f"stop sin comprobar ({fila.get('motivo') or 'sin motivo'}): {precio}, {stop}"
    partes.append(estado)
    if decision and decision.get("owned"):
        partes.append(f"la regla de la lista dice: {decision.get('label') or etiqueta(decision.get('action'))}")
    return "- " + "; ".join(partes) + "."


def _bloque_cartera(session: Session, solo: SoloLoGuardado, lista: dict | None, estado_lista: str | None,
                    ahora: datetime) -> tuple[dict | None, dict | None]:
    """(bloque, ausente). Un fallo del repaso no se calla: sin él no se puede
    decir «nada urgente», y la IA tiene que saber que no se comprobó."""
    from app.contexto_cartera import posiciones_para_decidir, senales_para_el_stop, stops_de_la_cartera

    titulo = "Tu cartera y el repaso de sus stops"
    try:
        posiciones = posiciones_para_decidir(session)
        # Con el cierre VIEJO si la lista lo es (la misma regla que Hoy).
        senales = senales_para_el_stop(lista, estado_lista)
        repaso = stops_de_la_cartera(session, solo, senales) if posiciones else {"posiciones": []}
    except Exception:  # noqa: BLE001 — la pregunta sigue y lo dice
        log("llm").exception("Pregúntale a la IA: no se pudo repasar la cartera")
        return None, {"clave": "cartera", "titulo": titulo,
                      "motivo": "No se pudo leer tu cartera ni repasar sus stops: ninguna posición se ha "
                                "comprobado (el motivo está en el log del backend)."}
    filas = repaso.get("posiciones") or []
    decisiones = {s.get("symbol"): s.get("decision") for s in (lista or {}).get("signals") or []}
    if not filas:
        texto = "No hay posiciones abiertas anotadas en la app."
    else:
        urgentes = sum(1 for f in filas if f["estado"] == "perforado")
        sin = sum(1 for f in filas if f["estado"] == "sin_comprobar")
        texto = "\n".join(
            [f"{_cuantas(len(filas), 'posición abierta', 'posiciones abiertas')}; {fmt_num(urgentes, 0)} con el "
             f"stop perforado y {fmt_num(sin, 0)} sin comprobar."]
            + [_linea_posicion(f, posiciones.get(f["symbol"]), decisiones.get(f["symbol"]))
               for f in filas[:MAX_POSICIONES]]
            + ([plural(len(filas) - MAX_POSICIONES, "(y otra posición, que no se envía)",
                       f"(y otras {fmt_num(len(filas) - MAX_POSICIONES, 0)} posiciones, que no se envían)")]
               if len(filas) > MAX_POSICIONES else [])
        )
    return {
        "clave": "cartera",
        "titulo": titulo,
        "fuente": "posiciones anotadas en la app; precios de la caché, cada uno con su fuente",
        "fecha": ahora.isoformat(),
        "estado": datos.Estado.VALIDO.value,
        "antiguedad_segundos": None,
        "nota": "Los precios no se han vuelto a descargar: los que no estaban guardados dejan el stop sin comprobar."
        if filas else None,
        "texto": texto,
    }, None


# --- El mercado ---------------------------------------------------------------


def _bloque_mercado(solo: SoloLoGuardado) -> tuple[dict | None, dict | None]:
    from app.routers.market import INDEX_PROXIES

    lineas, fechas, viejas, edades = [], [], 0, []
    for symbol, nombre in INDEX_PROXIES:
        try:
            q = solo.get("quote", symbol=symbol)
        except DataNotFoundError:
            continue
        if datos.precio(q.get("price")) is None:
            continue
        vieja = q.get("estado") == datos.Estado.VIEJO.value
        viejas += vieja
        if q.get("antiguedad_segundos") is not None:
            edades.append(q["antiguedad_segundos"])
        if q.get("as_of"):
            fechas.append(q["as_of"])
        lineas.append(
            f"- {nombre}: {fmt_precio(q['price'], q.get('currency'))}, "
            f"{fmt_pct(q.get('change_pct'), 2, signo=True, en_puntos=True)} en el día "
            f"({q.get('source') or 'sin fuente'}, {_fecha_dato(q.get('as_of'))}{', VIEJO' if vieja else ''})."
        )
    titulo = "El mercado: índices"
    if not lineas:
        return None, {"clave": "mercado", "titulo": titulo,
                      "motivo": "No hay cotizaciones de los índices guardadas: se descargan al abrir el panel de "
                                "Mercado, y aquí no se descarga nada."}
    return {
        "clave": "mercado",
        "titulo": titulo,
        "fuente": "cotizaciones guardadas de los ETF que siguen a cada índice",
        "fecha": max(fechas) if fechas else None,
        "estado": datos.Estado.VIEJO.value if viejas else datos.Estado.VALIDO.value,
        "antiguedad_segundos": max(edades) if viejas and edades else None,
        "nota": "Algunas cotizaciones son la última copia guardada (marcadas VIEJO)." if viejas else None,
        "texto": "\n".join(lineas),
    }, None


# --- La ficha del símbolo -------------------------------------------------------


def _valor(m: dict | None):
    return (m or {}).get("valor") if (m or {}).get("estado", "valido") == "valido" else None


def _texto_analisis(a: dict) -> list[str]:
    """Lo que dice la ficha congelada, sin el precio objetivo de los niveles."""
    d = a.get("decision") or {}
    confianza = (a.get("confianza") or {}).get("nivel")
    lineas = [
        f"Decisión del motor: {d.get('label') or etiqueta(d.get('action'))}"
        + (f"; confianza {etiqueta(confianza)}" if confianza else "") + "."
    ]
    motivos = [m for m in (d.get("reasons") or [])[:MAX_MOTIVOS] if m]
    if motivos:
        lineas.append("Motivos de la regla: " + " ".join(motivos))
    for c in (d.get("cambiaria") or [])[:2]:
        condiciones = "; ".join(x.get("condicion") or "" for x in c.get("condiciones") or [] if x.get("condicion"))
        if condiciones:
            lineas.append(f"Qué la cambiaría hacia {c.get('hacia') or 'otra acción'}: {condiciones}.")

    mercado = a.get("mercado") or {}
    precio = mercado.get("precio") or {}
    moneda = precio.get("moneda")
    if datos.precio(precio.get("valor")) is not None:
        lineas.append(
            f"Precio: {fmt_precio(precio['valor'], moneda)} ({precio.get('fuente') or 'sin fuente'}, "
            f"{_fecha_dato(precio.get('publicado'))}"
            f"{', VIEJO' if precio.get('estado') == datos.Estado.VIEJO.value else ''})."
        )
    if datos.precio(mercado.get("sma200")) is not None:
        hist = mercado.get("historico") or {}
        lineas.append(
            f"Media de 200 sesiones: {fmt_precio(mercado['sma200'], moneda)} (cierres de "
            f"{hist.get('fuente') or 'sin fuente'} hasta el {fmt_fecha(hist.get('hasta'))})."
        )
    niveles = d.get("levels") or {}
    if datos.precio(niveles.get("stop")) is not None:
        lineas.append(f"Stop de la regla: {fmt_precio(niveles['stop'], moneda)}.")

    senal = a.get("senal") or {}
    if senal.get("score") is not None:
        lineas.append(f"Puntuación frente a sus comparables: {fmt_frente(senal['score'], FRONTERAS_ETIQUETA, signo=True)}.")
    elif senal.get("motivo"):
        lineas.append(f"Sin puntuación: {senal['motivo']}")

    fund = a.get("fundamentales") or {}
    m = fund.get("metricas") or {}
    if fund.get("estado") == "valido" and m:
        lineas.append(
            f"Fundamentales del ejercicio {fund.get('ejercicio') or 'sin año'} (fuente {fund.get('fuente') or 'sin fuente'}, "
            f"presentado el {fmt_fecha(fund.get('publicado'))}): ingresos {fmt_compacto(_valor(m.get('revenue')), 'USD')}, "
            f"crecimiento de ingresos {fmt_pct(_valor(m.get('revenue_growth')))}, margen bruto "
            f"{fmt_pct(_valor(m.get('gross_margin')))}, margen operativo {fmt_pct(_valor(m.get('operating_margin')))}, "
            f"margen neto {fmt_pct(_valor(m.get('net_margin')))}, flujo de caja libre "
            f"{fmt_compacto(_valor(m.get('fcf')), 'USD')}, deuda neta {fmt_compacto(_valor(m.get('deuda_neta')), 'USD')}, "
            f"BPA diluido {fmt_precio(_valor(m.get('eps_diluted')), 'USD')} (— = sin dato)."
        )
    val = a.get("valoracion") or {}
    if val.get("estado") == "valido":
        lineas.append(
            f"Valoración a ese precio: PER {fmt_num(_valor(val.get('pe')), 1)}, rentabilidad por flujo de caja "
            f"libre {fmt_pct(_valor(val.get('fcf_yield')))} (— = sin dato)."
        )
    if a.get("resultados_proximos"):
        lineas.append(f"Próximos resultados: {fmt_fecha(a['resultados_proximos'])}.")
    return lineas


def _bloque_ficha(session: Session, simbolo: str, lista: dict | None,
                  estado_lista: str | None = None) -> tuple[dict | None, dict | None]:
    """Su fila de la lista y su último análisis congelado.

    La fila de una lista caducada hereda su estado: el bloque de la lista iba
    VIEJO y la misma fila (precio, stop, zona de entrada), repetida aquí, iba
    `valido`, sin el aviso del prompt ni la marca en pantalla (revisión 15)."""
    titulo = f"Ficha de {simbolo}"
    en_lista = next((s for s in (lista or {}).get("signals") or [] if s.get("symbol") == simbolo), None)
    snap = sn.anterior_comparable(session, simbolo)
    if en_lista is None and snap is None:
        return None, {"clave": "ficha", "titulo": titulo,
                      "motivo": f"No hay ninguna ficha calculada de {simbolo} ni está en la lista del día: se "
                                "calcula al abrir su ficha en la app, y aquí no se calcula nada."}
    vieja = en_lista is not None and estado_lista == datos.Estado.VIEJO.value
    lineas = []
    if en_lista is not None:
        lineas.append("En la última lista guardada, caducada (VIEJA):" if vieja else "En la lista del día:")
        lineas.append(_linea_senal(en_lista))
    if snap is not None:
        lineas.append(f"Último análisis de su ficha (congelado el {_fecha_dato(sn.iso_utc(snap.creado_en))}):")
        lineas.extend(_texto_analisis((snap.contexto or {}).get("analisis") or {}))
    instrumento = session.execute(select(Instrument).where(Instrument.symbol == simbolo)).scalar_one_or_none()
    nombre = getattr(instrumento, "name", None)
    return {
        "clave": "ficha",
        "titulo": titulo + (f" ({nombre})" if nombre else ""),
        "fuente": "análisis de la app" + (" y lista del día" if en_lista is not None else ""),
        # Vieja, la fecha es la de la lista: la marca «VIEJO, hace X» se calcula
        # con ella, y la del análisis (quizá de hoy) la dejaría en «hace 5 min».
        # La del análisis va en su línea («congelado el …»).
        "fecha": sn.iso_utc(snap.creado_en) if snap is not None and not vieja else (lista or {}).get("as_of"),
        "estado": datos.Estado.VIEJO.value if vieja else datos.Estado.VALIDO.value,
        "antiguedad_segundos": (lista or {}).get("antiguedad_segundos") if vieja else None,
        "nota": " ".join(n for n in (
            "Su fila sale de la lista caducada (se recalcula cada 6 h): es la última copia guardada, "
            "no la de ahora." if vieja else None,
            "Es el análisis de cuando se abrió la ficha: no se ha recalculado para esta pregunta."
            if snap is not None else None,
        ) if n) or None,
        "texto": "\n".join(lineas),
    }, None


# --- Cómo compara la app los ETFs ---------------------------------------------


def _bloque_etfs() -> dict:
    from app.analysis import etf_picks as e

    return {
        "clave": "criterios_etf",
        "titulo": "Cómo compara la app los ETFs",
        "fuente": "reglas de la app (pantalla de ETFs)",
        "fecha": None,
        "estado": datos.Estado.VALIDO.value,
        "antiguedad_segundos": None,
        "nota": "Son los umbrales de la app, no datos de ningún ETF: la app no ha comparado ninguno para esta pregunta.",
        "texto": (
            "Criterios, por orden de solidez de la evidencia: 1) el coste anual (barato por debajo de "
            f"{fmt_pct(e.COSTE_BARATO, 2)}, caro por encima de {fmt_pct(e.COSTE_CARO, 2)}); 2) la tendencia, con la "
            "misma media de 200 sesiones que las acciones; 3) el tamaño (por debajo de "
            f"{fmt_compacto(e.AUM_MINIMO, 'USD')} hay riesgo real de cierre; desde {fmt_compacto(e.AUM_COMODO, 'USD')}, "
            f"sin dudas). Dos ETFs que comparten más del {fmt_pct(e.SOLAPAMIENTO_ALTO, 0)} de su cartera son una sola "
            "idea, no dos. La app no predice qué sector lo hará mejor: elegir entre un ETF de salud y uno de energía "
            "es una apuesta de la persona. Para comparar ETFs concretos está la pantalla de ETFs."
        ),
    }


# --- El conjunto ----------------------------------------------------------------


def reunir(session: Session, service, *, mercado: str, simbolo: str | None = None,
           ahora: datetime | None = None) -> dict:
    """{bloques, ausentes}: el contexto de la pregunta, solo con lo guardado."""
    ahora = ahora or datetime.now(timezone.utc)
    solo = SoloLoGuardado(service)
    bloques: list[dict] = []
    ausentes: list[dict] = []

    lista, estado = lista_guardada(service, mercado)
    if lista is not None:
        bloques.append(_bloque_lista(lista, estado, mercado))
    else:
        ausentes.append({"clave": "lista", "titulo": f"Lista del día · {etiqueta(mercado)}",
                         "motivo": "No hay ninguna lista guardada de este mercado: se calcula en Inicio, y aquí "
                                   "no se calcula para no descargar nada."})
    for bloque, ausente in (_bloque_cartera(session, solo, lista, estado, ahora), _bloque_mercado(solo)):
        if bloque is not None:
            bloques.append(bloque)
        if ausente is not None:
            ausentes.append(ausente)
    if simbolo:
        bloque, ausente = _bloque_ficha(session, simbolo, lista, estado)
        bloques.extend([bloque] if bloque else [])
        ausentes.extend([ausente] if ausente else [])
    bloques.append(_bloque_etfs())
    return {"bloques": bloques, "ausentes": ausentes}


def _publico(contexto: dict) -> dict:
    """Lo que se le pasó a la IA, sin el texto del prompt: para enseñarlo aparte."""
    return {
        "datos_usados": [{k: v for k, v in b.items() if k != "texto"} for b in contexto["bloques"]],
        "datos_ausentes": contexto["ausentes"],
    }


def estimar(llm: LLMProvider, pregunta: str, contexto: dict, ahora: datetime | None = None) -> dict:
    """El coste ANTES de enviar, sin llamar al modelo (`contar_tokens`)."""
    ahora = ahora or datetime.now(timezone.utc)
    prompt = construir_prompt(pregunta, contexto["bloques"], contexto["ausentes"], ahora)
    try:
        coste = coste_estimado(llm.contar_tokens(SYSTEM, prompt), llm.model, salida=SALIDA_ESTIMADA)
    except LLMUnavailableError as exc:
        coste = coste_estimado(None, llm.model, motivo=str(exc))
    if not limpiar_pregunta(pregunta) and coste["tokens_entrada"] is not None:
        coste["nota"] += (f" Sin contar tu pregunta, que añade pocos tokens más (como mucho "
                          f"{fmt_num(MAX_PREGUNTA, 0)} caracteres).")
    return {"coste": coste, **_publico(contexto), "max_caracteres": MAX_PREGUNTA}


# Los bloques cuya `fecha` es la de la consulta y no la de un dato: el repaso de
# la cartera es «de ahora», y lo que lo define es su texto (cada precio con la
# suya). En la huella, esa fecha haría distinta cada consulta.
_FECHA_DE_LA_CONSULTA = frozenset({"cartera"})


def _huella(modelo: str | None, pregunta: str, contexto: dict, ahora: datetime) -> str:
    """Lo que define la respuesta, para reconocer la misma pregunta con los mismos datos.

    Era la huella del prompt entero, y el prompt lleva el reloj: la hora de la
    consulta en el bloque de la cartera y el «hace X» de cada bloque. La caché
    solo acertaba dentro del mismo minuto, y «Resúmeme el día» dos veces con la
    misma lista volvía a cobrar (revisión 15). Ahora cuenta el modelo, las
    instrucciones, la pregunta limpia, el día de la consulta (el que dice el
    prompt: una respuesta no se reutiliza de un día para otro) y, de cada bloque,
    su fuente, la fecha del dato, su estado, su nota y su texto; y lo que falta.
    Una lista nueva, un precio nuevo o un dato que se vuelve viejo cambian la
    huella; que pasen dos minutos, no."""
    bloques = [
        {**{k: b.get(k) for k in ("clave", "titulo", "fuente", "estado", "nota", "texto")},
         "fecha": None if b.get("clave") in _FECHA_DE_LA_CONSULTA else b.get("fecha")}
        for b in contexto["bloques"]
    ]
    contenido = {
        "modelo": modelo, "system": SYSTEM, "pregunta": limpiar_pregunta(pregunta),
        "dia": fmt_fecha(ahora), "bloques": bloques, "ausentes": contexto["ausentes"],
    }
    canonico = json.dumps(contenido, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(canonico.encode()).hexdigest()[:48]


def responder(llm: LLMProvider, session: Session, pregunta: str, contexto: dict,
              ahora: datetime | None = None) -> dict:
    """La respuesta de la IA, guardada por la huella de lo que la define (`_huella`).

    La misma pregunta con los mismos datos sale de `llm_outputs` sin volver a
    llamar al modelo, como la interpretación de noticias. `LLMUnavailableError`
    sube tal cual: quien llama la convierte en un error que se pueda leer."""
    ahora = ahora or datetime.now(timezone.utc)
    prompt = construir_prompt(pregunta, contexto["bloques"], contexto["ausentes"], ahora)
    huella = _huella(llm.model, pregunta, contexto, ahora)
    guardada = session.execute(
        select(LlmOutput).where(LlmOutput.kind == KIND, LlmOutput.prompt_hash == huella)
        .order_by(LlmOutput.id.desc())
    ).scalars().first()
    if guardada is not None:
        content, model, creado, cached = guardada.content_md, guardada.model, guardada.created_at, True
        coste = {"tokens_entrada": None, "tokens_salida": None, "usd": 0.0,
                 "nota": "Respuesta guardada de la misma pregunta con los mismos datos, generada el "
                         f"{fmt_fecha(sn.iso_utc(creado), hora=True, zona=ZONA_MERCADO)}: no se ha vuelto a "
                         "llamar al modelo, sin coste nuevo. Si cita la antigüedad de un dato («hace 2 h»), "
                         "es la de entonces."}
    else:
        r = llm.interpret(SYSTEM, prompt)
        fila = LlmOutput(kind=KIND, prompt_hash=huella, content_md=r["content"], model=r["model"])
        session.add(fila)
        session.commit()
        content, model, creado, cached = r["content"], r["model"], fila.created_at, False
        coste = coste_real(r.get("usage"), r["model"])
    return {
        "generado_por": "ia",  # la UI lo marca como IA y lo separa de lo calculado
        "pregunta": limpiar_pregunta(pregunta),
        "content_md": content,
        "model": model,
        "cached": cached,
        "creado_en": sn.iso_utc(creado) if creado else None,
        "coste": coste,
        **_publico(contexto),
        "aviso": AVISO,
    }
