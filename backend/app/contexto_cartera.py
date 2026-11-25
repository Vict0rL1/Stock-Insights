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


def agregar_lotes(lotes: list) -> dict | None:
    """Varios lotes abiertos del mismo símbolo, como UNA posición para decidir.

    - cantidad: la suma; coste: el medio ponderado;
    - stop: el MÁS PROTECTOR de los fijados (el más alto). Si un lote de 95 está
      perforado a 93, la posición tiene un stop perforado aunque otro lote no
      tenga stop guardado. Los lotes sin stop se cuentan y se dicen.
    """
    if not lotes:
        return None
    cantidad = sum(l.quantity for l in lotes)
    fijados = [l.stop for l in lotes if l.stop is not None]
    return {
        "quantity": cantidad,
        "cost_basis": sum(l.quantity * l.cost_basis for l in lotes) / cantidad if cantidad else None,
        "stop": max(fijados) if fijados else None,
        "lotes": len(lotes),
        "lotes_sin_stop": sum(1 for l in lotes if l.stop is None),
        "abierta_desde": iso_utc(min(l.opened_at for l in lotes)),
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


def posiciones_para_decidir(session: Session, ahora: datetime | None = None) -> dict[str, dict]:
    """{símbolo: posición agregada} de lo abierto en `ahora` (por defecto, hoy).

    Antes la lista diaria hacía un dict por símbolo sobre las filas de lotes y
    se quedaba con el último: con dos lotes, el coste y el stop del otro se
    perdían en silencio.
    """
    return {s: agregar_lotes(l) for s, l in lotes_abiertos(session, ahora).items()}


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


def senales_para_el_stop(lista: dict | None, estado: str | None) -> list[dict]:
    """Las señales de la lista, con su precio VIEJO si la lista es vieja.

    El repaso usa el último cierre de la lista como reserva y lo trata según su
    `estado`; en una lista caducada ese bloque seguía diciendo «valido» (lo era
    cuando se calculó) y un cierre de hace días por encima del stop habría dado
    «por encima». Viejo, el repaso lo deja `sin_comprobar`.

    Vivía en `pregunta_ia` y solo lo usaba la IA: Hoy, con la copia caducada que
    sirve `vencida=aceptar` (hasta 7 días), repasaba con el cierre «valido» y
    daba «por encima» con yfinance caído, STALE → PASS (revisión 15). Aquí, una
    vez, para todos los que repasan con una lista guardada."""
    senales = list((lista or {}).get("signals") or [])
    if estado != datos.Estado.VIEJO.value:
        return senales
    return [
        {**s, "price": {**(s.get("price") or {}), "estado": datos.Estado.VIEJO.value}} if s.get("price") else s
        for s in senales
    ]


def stops_de_la_cartera(session: Session, service, senales: list[dict]) -> dict:
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
    símbolo está perforado si lo está cualquiera de sus lotes, es decir, si lo
    está el de stop más alto, que es el que se sirve.

    El precio (`_precios_para_el_stop`), fail-safe: `perforado` si lo perfora
    cualquiera de los precios que haya (regla del motor, `stop_perforado`: en o
    por debajo); `por_encima` solo con todos los lotes con stop y un precio
    válido por encima; si no, `sin_comprobar` con su motivo (sin precio, un lote
    sin stop, o solo un precio viejo). Un precio viejo por encima del stop daba
    `por_encima` y la tarjeta, «nada urgente»: lo que no se puede comprobar
    pasaba por lo que está bien (revisión 13).

    Coste: una cotización por posición, de la caché de 60 s (la del Portafolio).
    Con las fuentes caídas, la primera petición paga los reintentos (tres por
    fuente, 3 s de espera por fuente y posición) y el fallo se recuerda un
    minuto (`cache.RECORDAR_FALLO`): las pasadas que encadena la pantalla no
    vuelven a llamar.
    """
    from app.analysis.decision import stop_perforado
    from app.formato import GUION, fmt_antiguedad
    from app.routers.portfolio import stop_del_lote

    ahora = datetime.now(timezone.utc)
    lotes = lotes_abiertos(session)
    por_simbolo = {s.get("symbol"): s for s in senales or []}
    monedas = dict(session.execute(
        select(Instrument.symbol, Instrument.currency).where(Instrument.symbol.in_(list(lotes)))
    ).all()) if lotes else {}
    filas = []
    for symbol, del_simbolo in lotes.items():
        senal = por_simbolo.get(symbol)
        precios, moneda_cotizada = _precios_para_el_stop(service, symbol, senal)
        stops = [stop_del_lote(service, symbol, lote.stop, lote.cost_basis) for lote in del_simbolo]
        con_stop = [s for s in stops if datos.precio(s["stop"]) is not None]
        # El más protector: si un lote está perforado, el del stop más alto también.
        mayor = max(con_stop, key=lambda s: (s["stop"], s["stop_fijado_al_abrir"])) if con_stop else None
        perforan = [p for p in precios if mayor and stop_perforado(p["precio"], mayor["stop"])]
        validos = [p for p in precios if p["estado"] == "valido"]
        motivo = None
        if perforan:
            estado, elegido = "perforado", perforan[0]
        elif not precios:
            estado, elegido = "sin_comprobar", None
            motivo = "sin precio (ninguna fuente dio su cotización)"
        elif len(con_stop) < len(stops):
            estado, elegido = "sin_comprobar", (validos or precios)[0]
            faltan = len(stops) - len(con_stop)
            motivo = ("sin stop" if len(stops) == 1 else f"{faltan} de sus {len(stops)} lotes sin stop") + (
                " (ni fijado al abrir ni coste con que calcularlo)")
        elif validos:
            estado, elegido = "por_encima", validos[0]
        else:
            estado, elegido = "sin_comprobar", precios[0]
            edad = fmt_antiguedad(elegido["fecha"], ahora)
            motivo = (f"solo hay un precio viejo ({FUENTES_DEL_PRECIO[elegido['fuente']]}, "
                      f"{'sin fecha' if edad == GUION else edad}): estaba por encima del stop, pero no se "
                      "puede afirmar que lo siga")
        filas.append({
            "symbol": symbol,
            "en_lista": senal is not None,
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
            "stop": datos.redondear_precio(mayor["stop"], hacia="abajo") if mayor else None,
            "stop_fijado_al_abrir": bool(mayor and mayor["stop_fijado_al_abrir"]),
            "stop_por_clase": bool(mayor and mayor["stop_por_clase"]),
            "lotes": len(stops),
            # Lotes sin stop guardado: el suyo se recalcula desde su coste, como en
            # el Portafolio, y sin histórico es el punto medio de su clase.
            "lotes_recalculados": sum(1 for s in con_stop if not s["stop_fijado_al_abrir"]),
            "lotes_por_clase": sum(1 for s in con_stop if s["stop_por_clase"]),
            "lotes_sin_stop": len(stops) - len(con_stop),
            "estado": estado,
            "motivo": motivo,
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
