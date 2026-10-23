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


def posiciones_para_decidir(session: Session, ahora: datetime | None = None) -> dict[str, dict]:
    """{símbolo: posición agregada} de lo abierto en `ahora` (por defecto, hoy).

    Antes la lista diaria hacía un dict por símbolo sobre las filas de lotes y
    se quedaba con el último: con dos lotes, el coste y el stop del otro se
    perdían en silencio.
    """
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
    return {s: agregar_lotes(l) for s, l in por_simbolo.items()}


def convertir_serie(serie: list[tuple[date, float]], moneda: str | None, fx_series: dict) -> list[tuple[date, float]] | None:
    """Cierres en moneda local → en dólares, con el tipo vigente en cada fecha."""
    if moneda == fx.BASE:
        return serie
    tipos = fx_series.get(moneda) or []
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

    # El histórico va primero: con `ahora` en el pasado, el precio de cada
    # posición es el último cierre que ya existía, no la cotización de hoy.
    crudas, fallos = _historico_largo(service, list(agregadas) + [INDICE_MERCADO], descargar)
    sin_peso, valoradas = [], []
    monedas = set()
    for a in agregadas.values():
        precio, moneda, estado = _cotizacion(service, a["symbol"])
        if precio is not None and pit.descargado_a_tiempo(estado.get("publicado"), ahora) is False:
            # Una cotización posterior a la fecha es información futura, como en
            # `seccion_mercado`: la reconstrucción del 12 pesaba cada posición
            # con el precio del 15 (revisión de A5). Se valora con el último
            # cierre disponible entonces, que es un precio viejo y se dice.
            previos = [c for d, c in crudas.get(a["symbol"]) or [] if pit.barra_disponible(d, ahora)]
            precio, estado = (previos[-1], {"estado": "viejo"}) if previos else (None, {"estado": "desconocido"})
        cruda = _resolver_divisa(session, service, a["instrument"], moneda)
        # Una moneda en peniques (GBX) se sabe cuál es: decir «desconocida»
        # escondía el motivo (auditoría del 19 oct, hermano del 500 de la cartera).
        try:
            moneda, sin_moneda = fx.normalizar(cruda), "moneda desconocida: no se supone dólar"
        except fx.SinTipo as exc:
            moneda, sin_moneda = None, str(exc)
        a.update(precio=datos.precio(precio), moneda=moneda, precio_estado=estado.get("estado"))
        if a["precio"] is None:
            sin_peso.append({"symbol": a["symbol"], "motivo": "sin precio: fuera de los pesos (no vale cero)"})
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
        tipo = None if a["moneda"] == fx.BASE else _tipo_en(fx_series.get(a["moneda"]), ahora)
        por_usd = 1.0 if a["moneda"] == fx.BASE else (tipo or {}).get("por_usd")
        a["valor_usd"] = a["precio"] * a["cantidad"] / por_usd if por_usd else None
        if a["valor_usd"] is None:
            sin_peso.append({"symbol": a["symbol"], "motivo": f"sin tipo de cambio para {a['moneda']}"})
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
