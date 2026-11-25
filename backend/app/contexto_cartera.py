"""La cartera como entrada de cálculo: pesos en moneda base y series convertidas.

La contribución al riesgo, el riesgo de añadir una idea y el coste de
oportunidad necesitan lo mismo: cada posición abierta con su peso sobre el
total (en dólares, al precio y al tipo que ya se conocían en la fecha del
cálculo; hoy, los últimos) y su histórico de cierres EN
DÓLARES (convertido con el tipo de CADA fecha: con el de hoy, el riesgo de
divisa de una acción canadiense desaparecería). Se construye aquí una vez, con
las reglas de la cartera:

- sin precio → sin peso, fuera, nombrada; no vale cero;
- sin moneda o sin tipo de cambio → fuera, nombrada; no se supone dólar;
- varios lotes del mismo símbolo → una posición.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import datos
from app import punto_en_el_tiempo as pit
from app.analysis import fx
from app.analysis import historial as hist
from app.db.models import Instrument, Position
from app.snapshots import iso_utc

INDICE_MERCADO = "SPY"


def agregar_lotes(lotes: list, stops: list[dict] | None = None) -> dict | None:
    """Varios lotes abiertos del mismo símbolo, como UNA posición para decidir.

    - cantidad: la suma; coste: el medio ponderado;
    - stop: el MÁS PROTECTOR de los fijados (el más alto). Si un lote de 95 está
      perforado a 93, la posición tiene un stop perforado aunque otro lote no
      tenga stop guardado. Los lotes sin stop se cuentan y se dicen.

    Con `stops` (el de cada lote, `portfolio.stop_del_lote`: el fijado o, sin él,
    el recalculado desde SU coste, el mismo que mira el repaso), y varios lotes
    con alguno sin stop guardado, el más protector de TODOS, y se marca
    (`stop_recalculado`) si es el de un lote sin stop guardado. Con solo los
    fijados, KO con un lote de coste 100 y stop 70 y otro viejo sin stop y coste
    130 decidía con 70 a 104: Inicio decía «KO bajó de tu límite de pérdida»
    (119,60, el del lote viejo) y la ficha «Mantener… ni ha llegado a tu stop»
    (revisión 15, costuras H1). Un solo lote sin stop no cambia: el motor lo
    recalcula desde su coste con su propia volatilidad.
    """
    if not lotes:
        return None
    cantidad = sum(l.quantity for l in lotes)
    fijados = [l.stop for l in lotes if l.stop is not None]
    stop = max(fijados) if fijados else None
    recalculado = False
    if stops is not None and len(lotes) > 1 and len(fijados) < len(lotes):
        con_stop = [s for s in stops if datos.precio(s["stop"]) is not None]
        if con_stop:
            mas = max(con_stop, key=lambda s: (s["stop"], s["stop_fijado_al_abrir"]))
            stop, recalculado = mas["stop"], not mas["stop_fijado_al_abrir"]
    return {
        "quantity": cantidad,
        "cost_basis": sum(l.quantity * l.cost_basis for l in lotes) / cantidad if cantidad else None,
        "stop": stop,
        "lotes": len(lotes),
        "lotes_sin_stop": sum(1 for l in lotes if l.stop is None),
        "abierta_desde": iso_utc(min(l.opened_at for l in lotes)),
        # Solo si lo es: sin la clave, la posición es la de antes (golden master).
        **({"stop_recalculado": True} if recalculado else {}),
    }


def lotes_abiertos(session: Session, ahora: datetime | None = None) -> dict[str, list[Position]]:
    """{símbolo: sus lotes} de lo abierto en `ahora` (por defecto, hoy)."""
    filas = session.execute(
        select(Position, Instrument.symbol).join(Instrument, Position.instrument_id == Instrument.id)
    ).all()
    por_simbolo: dict[str, list] = {}
    for lote, symbol in filas:
        if ahora is not None and pit.disponible_en(lote.opened_at, ahora) is False:
            continue
        cerrada = lote.closed_at is not None and (ahora is None or pit.disponible_en(lote.closed_at, ahora) is not False)
        if not cerrada:
            por_simbolo.setdefault(symbol, []).append(lote)
    return por_simbolo


def posiciones_para_decidir(session: Session, ahora: datetime | None = None, service=None) -> dict[str, dict]:
    """{símbolo: posición agregada} de lo abierto en `ahora` (por defecto, hoy).

    Antes la lista diaria hacía un dict por símbolo sobre las filas de lotes y
    se quedaba con el último: con dos lotes, el coste y el stop del otro se
    perdían en silencio.

    Con `service` y en vivo, el stop de los lotes sin stop guardado entra en el
    agregado (`agregar_lotes`, con `portfolio.stop_del_lote`, el del repaso). En
    una reconstrucción del pasado no: el recalculado usaría la volatilidad de la
    caché de hoy, información posterior a la fecha.
    """
    from app.routers.portfolio import stop_del_lote

    en_vivo = ahora is None or pit.descargado_a_tiempo(datetime.now(timezone.utc), ahora) is not False
    salida = {}
    for s, l in lotes_abiertos(session, ahora).items():
        stops = ([stop_del_lote(service, s, lote.stop, lote.cost_basis) for lote in l]
                 if service is not None and en_vivo and len(l) > 1 and any(lote.stop is None for lote in l) else None)
        salida[s] = agregar_lotes(l, stops)
    return salida


def huella_de_cartera(session: Session) -> dict:
    """Con qué cartera se calcula algo que después se guarda: lo abierto ahora
    por símbolo (cantidad, coste medio, stop y lotes, lo que lee el motor) y el
    efectivo anotado vigente (lo que lee el tamaño).

    La lista de Hoy se cachea 6 h con la cartera de cuando se puntuó (decisión
    abierta, M3), pero el repaso de stops es de ahora: una posición abierta
    después no salía en «Mi cartera» (su decisión no era de posición) ni en
    «Fuera de la lista» (sí está en ella), y la nota del tamaño decía «no tienes
    posiciones abiertas» junto a un repaso con dos (revisión 13). La lista
    guarda esta huella y Hoy la compara con la de ahora (`cambios_de_cartera`).
    """
    from app.oportunidad import _ultimas_anotaciones

    return {
        "posiciones": {
            s: {"cantidad": p["quantity"], "coste": p["cost_basis"], "stop": p["stop"], "lotes": p["lotes"]}
            for s, p in sorted(posiciones_para_decidir(session).items())
        },
        "efectivo": {
            c.moneda: {"importe": c.importe, "as_of": iso_utc(c.as_of)}
            for c in sorted(_ultimas_anotaciones(session, datetime.now(timezone.utc)), key=lambda c: c.moneda)
        },
    }


def cambios_de_cartera(antes: dict, ahora: dict) -> dict | None:
    """Qué cambió entre dos huellas (`huella_de_cartera`), o None si nada."""
    if antes == ahora:
        return None
    a, b = antes.get("posiciones") or {}, ahora.get("posiciones") or {}
    return {
        "abiertas": sorted(set(b) - set(a)),
        "cerradas": sorted(set(a) - set(b)),
        # Cantidad, coste medio, stop o número de lotes distintos: la decisión de
        # la lista y el tamaño de sus ideas son de antes.
        "cambiadas": sorted(s for s in set(a) & set(b) if a[s] != b[s]),
        "efectivo": (antes.get("efectivo") or {}) != (ahora.get("efectivo") or {}),
    }


# Lo urgente arriba; lo que no se sabe, antes que lo que está bien.
_ORDEN_DEL_STOP = {"perforado": 0, "sin_comprobar": 1, "por_encima": 2}

# De dónde sale cada precio con que se mira un stop (`precio_fuente`).
FUENTES_DEL_PRECIO = {"cotizacion": "la cotización", "cierre_de_la_lista": "el último cierre de la lista"}


def _precios_para_el_stop(service, symbol: str, senal: dict | None) -> tuple[list[dict], str | None]:
    """Los precios con que mirar el stop de `symbol`, el más reciente primero, y
    la moneda de la cotización.

    La cotización (`_cotizacion`, la misma de 60 s que usa el Portafolio) para
    todas, y el último cierre de la lista como reserva si la empresa está en ella.
    Con solo el de la lista, KO a 112 con el stop en 116 salía «por encima» en
    Hoy (el cierre de la descarga masiva, 117, de hasta 12 h: 6 de caché de la
    descarga y 6 de la lista) y perforada en el Portafolio; y en NASDAQ, donde KO
    no está, perforada también: la misma posición cambiaba de estado según el
    mercado elegido (revisión 13)."""
    from app.routers.portfolio import _cotizacion

    precios = []
    cotizado, moneda, estado = _cotizacion(service, symbol)
    if datos.precio(cotizado) is not None:
        precios.append({"precio": datos.precio(cotizado), "fuente": "cotizacion", "estado": estado["estado"],
                        "proveedor": estado.get("fuente"), "fecha": estado.get("publicado")})
    bloque = (senal or {}).get("price") or {}
    if datos.precio(bloque.get("last")) is not None:
        precios.append({"precio": datos.precio(bloque["last"]), "fuente": "cierre_de_la_lista",
                        "estado": bloque.get("estado") or "valido", "proveedor": bloque.get("source"),
                        "fecha": bloque.get("as_of")})
    return precios, moneda


def precios_del_lote(precios: list[dict], abierto_en) -> list[dict]:
    """De los precios de un símbolo, los que dicen algo del stop de UN lote: los
    de cuando ese lote ya existía (`punto_en_el_tiempo.descargado_a_tiempo`, con
    el margen de lo que se pide durante el cálculo: la cotización de la caché
    de 60 s pedida un momento antes de anotar la compra es la de ahora).

    El último cierre de la lista guardada (118) es de antes de comprar NVDA a 130
    con el stop en 119,60: perforaba el stop de un lote abierto hace una hora y Mi
    cartera, Inicio y la fila decían «Vender» por un precio de antes de tenerla,
    hasta 7 días con la lista caducada (revisión 15, cartera H4). Sin fecha no se
    puede probar que sea anterior: cuenta (fail-safe, un stop perforado no se
    calla por falta de un dato)."""
    return [p for p in precios if pit.descargado_a_tiempo(abierto_en, p.get("fecha")) is not False]


def _clave_del_stop(lote: dict) -> tuple:
    return (lote["stop"], lote["stop_fijado_al_abrir"])


def estado_del_stop(precios: list[dict], lotes: list[dict], ahora: datetime) -> dict:
    """El estado del stop de una posición (todos sus lotes) o de UN lote, con una
    sola regla para el repaso por símbolo y para la fila de cada lote.

    `precios`: los de `_precios_para_el_stop`, el más reciente primero. `lotes`:
    el stop de cada lote (`portfolio.stop_del_lote`) con su `abierto_en`.
    Devuelve `{estado, elegido, lote, motivo}`: el precio que decide el estado y
    el lote cuyo stop se sirve (el perforado más alto, o el más alto de todos).

    Fail-safe: `perforado` si algún precio de cuando el lote existía
    (`precios_del_lote`) está en o por debajo de su stop (regla del motor,
    `stop_perforado`); `por_encima` solo con todos los lotes con stop y, para
    cada uno, un precio VÁLIDO de cuando existía por encima; si no,
    `sin_comprobar` con su motivo.

    Con una cotización, aunque sea vieja, solo ella puede dar `por_encima`: el
    último cierre de la lista es de hace horas, y con la cotización rescatada de
    hace 20 min (`viejo`) el cierre de hace 10 h (`valido`: su reloj es el de la
    lista, 6 h) daba «por encima» con un precio más antiguo que el viejo; Inicio
    decía «Nada urgente» y la fila del mismo lote, «sin comprobar» (revisión 15,
    cartera H1). Perforar sí puede. Sin ninguna cotización, el cierre de la lista
    sigue dando `por_encima` (revisión 13): cambiarlo está pendiente de Victor.
    """
    from app.analysis.decision import stop_perforado
    from app.formato import GUION, fmt_antiguedad

    hay_cotizacion = any(p["fuente"] == "cotizacion" for p in precios)

    def prueban(ps: list[dict]) -> list[dict]:
        return [p for p in ps if p["estado"] == datos.Estado.VALIDO.value
                and (p["fuente"] == "cotizacion" or not hay_cotizacion)]

    por_lote = [(lote, precios_del_lote(precios, lote.get("abierto_en"))) for lote in lotes]
    con_stop = [(lote, ps) for lote, ps in por_lote if datos.precio(lote["stop"]) is not None]
    mayor = max((lote for lote, _ in con_stop), key=_clave_del_stop) if con_stop else None
    perforados = [
        (lote, perfora) for lote, ps in con_stop
        if (perfora := next((p for p in ps if stop_perforado(p["precio"], lote["stop"])), None)) is not None
    ]
    if perforados:
        lote, elegido = max(perforados, key=lambda x: _clave_del_stop(x[0]))
        return {"estado": "perforado", "elegido": elegido, "lote": lote, "motivo": None}
    if not precios:
        return {"estado": "sin_comprobar", "elegido": None, "lote": mayor,
                "motivo": "sin precio (ninguna fuente dio su cotización)"}
    if len(con_stop) < len(lotes):
        faltan = len(lotes) - len(con_stop)
        return {"estado": "sin_comprobar", "elegido": (prueban(precios) or precios)[0], "lote": mayor,
                "motivo": ("sin stop" if len(lotes) == 1 else f"{faltan} de sus {len(lotes)} lotes sin stop")
                + " (ni fijado al abrir ni coste con que calcularlo)"}
    sin_prueba = [(lote, ps) for lote, ps in con_stop if not prueban(ps)]
    if not sin_prueba:
        de_mayor = next(ps for lote, ps in con_stop if lote is mayor)
        return {"estado": "por_encima", "elegido": prueban(de_mayor)[0], "lote": mayor, "motivo": None}
    if all(not ps for _, ps in sin_prueba):
        # Todo lo que hay es de antes de abrirlo: el último cierre de la lista.
        cierre = precios[0]
        edad = fmt_antiguedad(cierre["fecha"], ahora)
        lotes_sin = "el lote" if len(lotes) == 1 else f"{len(sin_prueba)} de sus {len(lotes)} lotes"
        return {"estado": "sin_comprobar", "elegido": cierre, "lote": mayor,
                "motivo": f"sin precio desde que abriste {lotes_sin}: {FUENTES_DEL_PRECIO[cierre['fuente']]} "
                          f"({'sin fecha' if edad == GUION else edad}) es de antes de la compra"}
    elegido = precios[0]
    edad = fmt_antiguedad(elegido["fecha"], ahora)
    return {"estado": "sin_comprobar", "elegido": elegido, "lote": mayor,
            "motivo": (f"solo hay un precio viejo ({FUENTES_DEL_PRECIO[elegido['fuente']]}, "
                       f"{'sin fecha' if edad == GUION else edad}): estaba por encima del stop, pero no se "
                       "puede afirmar que lo siga")}


def pendientes_de_la_lista(lista: dict | None) -> set[str]:
    """Las empresas del mercado de una lista PARCIAL que aún no ha puntuado.

    La primera pasada del día puntúa 40 o 120 de 502: KO (Consumer Staples, el
    tercer sector) quedaba sin puntuar y el repaso la servía `en_lista: False`,
    como una de otro mercado; Explorar la pintaba «Fuera de EE. UU. — S&P 500» e
    Inicio afirmaba «la regla no manda vender ni reducir ninguna» de una empresa
    que la regla aún no había mirado (revisión 15, costuras H2). Vacío con la
    lista completa o sin lista: entonces lo que no está es de fuera o sin datos."""
    from app.analysis.markets import load_market

    if not lista or lista.get("complete") is not False:
        return set()
    try:
        mercado = load_market(lista.get("market_key") or lista.get("market") or "")
    except KeyError:
        return set()
    universo = {c["symbol"] for companias in mercado["sectors"].values() for c in companias}
    vistas = {s.get("symbol") for s in lista.get("signals") or []} | {
        u.get("symbol") for u in lista.get("unavailable") or []}
    return universo - vistas


def senales_para_el_stop(lista: dict | None, estado: str | None) -> list[dict]:
    """Las señales de la lista, con su precio VIEJO si la lista es vieja.

    El repaso usa el último cierre de la lista como reserva y lo trata según su
    `estado`; en una lista caducada ese bloque seguía diciendo «valido» (lo era
    cuando se calculó) y un cierre de hace días por encima del stop habría dado
    «por encima». Viejo, el repaso lo deja `sin_comprobar`.

    Vivía en `pregunta_ia` y solo lo usaba la IA: Hoy, con la copia caducada que
    sirve `vencida=aceptar` (hasta 7 días), repasaba con el cierre «valido» y
    daba «por encima» con yfinance caído, STALE → PASS (revisión 14). Aquí, una
    vez, para todos los que repasan con una lista guardada."""
    senales = list((lista or {}).get("signals") or [])
    if estado != datos.Estado.VIEJO.value:
        return senales
    return [
        {**s, "price": {**(s.get("price") or {}), "estado": datos.Estado.VIEJO.value}} if s.get("price") else s
        for s in senales
    ]


def stops_de_la_cartera(session: Session, service, senales: list[dict], *,
                        pendientes: set[str] | None = None, simbolos: set[str] | None = None) -> dict:
    """El stop de CADA posición abierta, esté o no en la lista del día.

    Hoy solo miraba las posiciones del mercado barrido: STOP (fuera del S&P 500,
    stop en 110 y cotizando a 104) salía como «sin valorar» en el aviso del
    tamaño, que no habla de stops, y la cabecera decía «Para vender 0 · nada
    urgente» y «1 en cartera» con tres abiertas (revisión 12, visual). Se calcula
    en cada petición y no viaja en la caché de la lista: una posición abierta o
    un stop subido después de calcularla también cuentan.

    El stop, el de CADA lote (`portfolio.stop_del_lote`, el mismo del
    Portafolio): el fijado al abrir o, sin él, el recalculado desde el coste de
    ese lote. Con el agregado de los lotes (el más alto de los fijados), un lote
    viejo sin stop y coste 130 estaba perforado a 104 en el Portafolio y Hoy
    decía «por encima» con el stop 70 del otro lote; y en la lista, sin
    `levels` en su decisión, «sin stop» aunque hubiera coste (revisión 13). El
    símbolo está perforado si lo está cualquiera de sus lotes; se sirve el stop
    del perforado más alto o, si ninguno lo está, el más alto de todos.

    El estado, con `estado_del_stop` (la misma regla que la fila de cada lote en
    `/api/portfolio`): fail-safe, con los precios de cuando cada lote existía;
    lo que no se puede comprobar es `sin_comprobar` con su motivo (sin precio, un
    lote sin stop, solo un precio viejo o solo precios de antes de la compra). Un
    precio viejo por encima del stop daba `por_encima` y la tarjeta, «nada
    urgente»: lo que no se puede comprobar pasaba por lo que está bien (revisión 13).

    `pendientes` (`pendientes_de_la_lista`): las del mercado que una lista parcial
    aún no ha puntuado; se marcan (`pendiente`) para no servirlas como de otro
    mercado (revisión 15, costuras H2). `simbolos`: solo esos (la ficha).

    Coste: una cotización por posición, de la caché de 60 s (la del Portafolio).
    Con las fuentes caídas, la primera petición paga los reintentos (tres por
    fuente, 3 s de espera por fuente y posición) y el fallo se recuerda un
    minuto (`cache.RECORDAR_FALLO`): las pasadas que encadena la pantalla no
    vuelven a llamar.
    """
    from app.routers.portfolio import stop_del_lote

    ahora = datetime.now(timezone.utc)
    lotes = lotes_abiertos(session)
    if simbolos is not None:
        lotes = {s: l for s, l in lotes.items() if s in simbolos}
    por_simbolo = {s.get("symbol"): s for s in senales or []}
    monedas = dict(session.execute(
        select(Instrument.symbol, Instrument.currency).where(Instrument.symbol.in_(list(lotes)))
    ).all()) if lotes else {}
    filas = []
    for symbol, del_simbolo in lotes.items():
        senal = por_simbolo.get(symbol)
        precios, moneda_cotizada = _precios_para_el_stop(service, symbol, senal)
        stops = [{**stop_del_lote(service, symbol, lote.stop, lote.cost_basis), "abierto_en": lote.opened_at}
                 for lote in del_simbolo]
        con_stop = [s for s in stops if datos.precio(s["stop"]) is not None]
        e = estado_del_stop(precios, stops, ahora)
        elegido, servido = e["elegido"], e["lote"]
        filas.append({
            "symbol": symbol,
            "en_lista": senal is not None,
            # Del mercado de la lista, pero la lista (parcial) aún no la ha puntuado.
            "pendiente": senal is None and symbol in (pendientes or set()),
            "precio": elegido["precio"] if elegido else None,
            "precio_estado": elegido["estado"] if elegido else "desconocido",
            # De dónde y de cuándo es ese precio, para escribirlo junto a la cifra.
            "precio_fuente": elegido["fuente"] if elegido else None,
            "precio_proveedor": elegido["proveedor"] if elegido else None,
            "precio_fecha": elegido["fecha"] if elegido else None,
            # Todos los que se miraron, el más reciente primero: perforada por el
            # cierre de la lista, la cotización de ahora puede estar por encima.
            "precios": precios,
            "moneda": moneda_cotizada or monedas.get(symbol),
            # Hacia abajo, como lo sirve el motor: es el umbral de «en o por debajo de».
            "stop": datos.redondear_precio(servido["stop"], hacia="abajo") if servido else None,
            "stop_fijado_al_abrir": bool(servido and servido["stop_fijado_al_abrir"]),
            "stop_por_clase": bool(servido and servido["stop_por_clase"]),
            "lotes": len(stops),
            # Lotes sin stop guardado: el suyo se recalcula desde su coste, como en
            # el Portafolio, y sin histórico es el punto medio de su clase.
            "lotes_recalculados": sum(1 for s in con_stop if not s["stop_fijado_al_abrir"]),
            "lotes_por_clase": sum(1 for s in con_stop if s["stop_por_clase"]),
            "lotes_sin_stop": len(stops) - len(con_stop),
            "estado": e["estado"],
            "motivo": e["motivo"],
        })
    filas.sort(key=lambda f: (_ORDEN_DEL_STOP[f["estado"]], f["symbol"]))
    return {
        "abiertas": len(lotes),
        "en_lista": sum(1 for f in filas if f["en_lista"]),
        "posiciones": filas,
    }


def convertir_serie(serie: list[tuple[date, float]], moneda: str | None, fx_series: dict) -> list[tuple[date, float]] | None:
    """Cierres en moneda local → en dólares, con el tipo vigente en cada fecha."""
    if moneda == fx.BASE:
        return serie
    tipos = fx.puntos_en_banda(moneda, fx_series.get(moneda))
    if not tipos:
        return None
    fechas, valores = [f for f, _ in sorted(tipos)], [v for _, v in sorted(tipos)]
    salida = []
    for d, p in serie:
        t = hist._vigente(fechas, valores, d)
        if t:
            salida.append((d, p / t))
    return salida or None


def construir(session: Session, service, *, descargar: bool = False, ahora: datetime | None = None) -> dict:
    """{posiciones, series (en USD), sin_peso, mercado, total_usd}. Nunca lanza
    por una posición: la que falla queda fuera con su motivo."""
    from app.routers.portfolio import _cotizacion, _fx_completo, _historico_largo, _resolver_divisa

    from app.oportunidad import _tipo_en, _ultimas_anotaciones

    ahora = ahora or datetime.now(timezone.utc)
    filas = session.execute(
        select(Position, Instrument).join(Instrument, Position.instrument_id == Instrument.id)
    ).all()
    agregadas: dict[str, dict] = {}
    for pos, inst in filas:
        if pit.disponible_en(pos.opened_at, ahora) is False:
            continue
        # Cerrada en `ahora`, con la misma regla que `posiciones_para_decidir`.
        # Antes se filtraba en SQL por `closed_at IS NULL`: en una reconstrucción,
        # una posición abierta ese día y cerrada después desaparecía del capital
        # y de los comparables, mientras el mismo análisis la daba por abierta
        # (revisión de A5).
        if pos.closed_at is not None and pit.disponible_en(pos.closed_at, ahora) is not False:
            continue
        a = agregadas.setdefault(inst.symbol, {"symbol": inst.symbol, "nombre": inst.name, "sector": inst.sector,
                                               "industria": inst.industry, "cantidad": 0.0, "coste": 0.0,
                                               "stops": [], "abierta_desde": pos.opened_at, "instrument": inst})
        a["cantidad"] += pos.quantity
        a["coste"] += pos.quantity * pos.cost_basis
        a["stops"].append(pos.stop)
        a["abierta_desde"] = min(a["abierta_desde"], pos.opened_at)

    # Las cotizaciones antes que el histórico largo: el margen de descarga va
    # anclado a `ahora`, y pedir primero el histórico de todas las posiciones lo
    # consumía (revisión de 2f8d84b).
    cotizaciones = {s: _cotizacion(service, s) for s in agregadas}
    crudas, fallos = _historico_largo(service, list(agregadas) + [INDICE_MERCADO], descargar)
    # ¿Se reconstruye el pasado? Con el margen de lo que tarda el propio cálculo,
    # para que un análisis en vivo que empezó hace unos segundos no lo parezca.
    reconstruccion = pit.descargado_a_tiempo(datetime.now(timezone.utc), ahora) is False
    sin_peso, valoradas = [], []
    monedas = set()
    for a in agregadas.values():
        precio, moneda, estado = cotizaciones[a["symbol"]]
        sin_precio = "sin precio: fuera de los pesos (no vale cero)"
        posterior = precio is not None and pit.descargado_a_tiempo(estado.get("publicado"), ahora) is False
        if posterior or (precio is None and reconstruccion):
            # Sin cotización de entonces, el último cierre que ya existía: un
            # precio viejo, y se dice, como en `seccion_mercado`. Una cotización
            # posterior a la fecha es información futura (la reconstrucción del
            # 12 pesaba cada posición con el precio del 15), y que hoy no haya
            # cotización no cambia lo que valía entonces (revisión de A5).
            # Solo al reconstruir: en vivo, sin cotización la posición queda
            # fuera y nombrada, como en /api/portfolio. Con el cierre viejo de la
            # caché entraba en los pesos, el coste de oportunidad y el tamaño sin
            # que nada lo dijera, y los dos totales no cuadraban (revisión 4).
            previos = [c for d, c in crudas.get(a["symbol"]) or [] if pit.barra_disponible(d, ahora)]
            if previos:
                precio, estado = previos[-1], {"estado": "viejo"}
            else:
                precio, estado = None, {"estado": "desconocido"}
                if posterior:
                    sin_precio = ("sin precio en esa fecha: la cotización es posterior y no hay un cierre "
                                  "anterior en caché (no vale cero)")
        cruda = _resolver_divisa(session, service, a["instrument"], moneda)
        # Una moneda en peniques (GBX) se sabe cuál es: decir «desconocida»
        # escondía el motivo (auditoría del 19 oct, hermano del 500 de la cartera).
        try:
            moneda, sin_moneda = fx.normalizar(cruda), "moneda desconocida: no se supone dólar"
        except fx.SinTipo as exc:
            moneda, sin_moneda = None, str(exc)
        a.update(precio=datos.precio(precio), moneda=moneda, precio_estado=estado.get("estado"))
        if a["precio"] is None:
            sin_peso.append({"symbol": a["symbol"], "motivo": sin_precio})
            continue
        if moneda is None:
            sin_peso.append({"symbol": a["symbol"], "motivo": sin_moneda})
            continue
        monedas.add(moneda)
        valoradas.append(a)

    # También las monedas del efectivo anotado: con toda la cartera en dólares y
    # efectivo en CAD, la ficha no tenía con qué convertirlo y lo daba por
    # desconocido mientras Hoy sí lo sumaba; dos tamaños para la misma idea
    # (revisión de M3).
    monedas_efectivo = {c.moneda for c in _ultimas_anotaciones(session, ahora)}
    _, fx_series, _ = _fx_completo(service, monedas | monedas_efectivo)
    for a in valoradas:
        # Con el tipo que ya se conocía en `ahora`, el mismo que usa el efectivo
        # (`oportunidad._tipo_en`). Con el último de la serie, una reconstrucción
        # del 12 convertía los CAD de la posición a 1,50 (el tipo del 14) y los
        # del efectivo a 1,30: dos tipos para la misma divisa en el mismo capital
        # (revisión de A2).
        motivo = f"sin tipo de cambio para {a['moneda']}"
        try:
            tipo = None if a["moneda"] == fx.BASE else _tipo_en(fx_series.get(a["moneda"]), ahora, a["moneda"])
        except fx.SinTipo as exc:
            tipo, motivo = None, str(exc)
        por_usd = 1.0 if a["moneda"] == fx.BASE else (tipo or {}).get("por_usd")
        a["valor_usd"] = a["precio"] * a["cantidad"] / por_usd if por_usd else None
        if a["valor_usd"] is None:
            sin_peso.append({"symbol": a["symbol"], "motivo": motivo})
    valoradas = [a for a in valoradas if a.get("valor_usd")]
    total = sum(a["valor_usd"] for a in valoradas)

    series = {}
    for a in valoradas:
        s = crudas.get(a["symbol"])
        conv = convertir_serie(s, a["moneda"], fx_series) if s else None
        if conv:
            series[a["symbol"]] = [(d, p) for d, p in conv if pit.barra_disponible(d, ahora)]

    posiciones = [
        {
            "symbol": a["symbol"], "nombre": a["nombre"], "sector": a["sector"], "industria": a["industria"],
            "moneda": a["moneda"], "peso": a["valor_usd"] / total if total else None,
            "valor_usd": round(a["valor_usd"], 2), "cantidad": a["cantidad"],
            "coste_medio": a["coste"] / a["cantidad"] if a["cantidad"] else None,
            "precio": a["precio"], "precio_estado": a["precio_estado"],
            "stop": max(a["stops"]) if a["stops"] and all(s is not None for s in a["stops"]) else None,
            "abierta_desde": iso_utc(a["abierta_desde"]),
            **({"motivo": f"sin histórico: {fallos.get(a['symbol'])}"} if a["symbol"] not in series else {}),
        }
        for a in valoradas
    ] + [{"symbol": x["symbol"], "peso": None, "motivo": x["motivo"]} for x in sin_peso]
    return {
        "posiciones": posiciones,
        "series": series,
        "mercado": crudas.get(INDICE_MERCADO),
        "total_usd": round(total, 2) if total else None,
        "sin_peso": sin_peso,
        "fx_series": fx_series,
    }
