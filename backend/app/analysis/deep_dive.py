"""Ensamblado del informe de analista: todas las piezas en una estructura.

Función pura sobre datos ya descargados — sin llamadas a red, así que es
testeable de principio a fin. El router se encarga de traer los datos; este
módulo decide qué significan.

Cada sección incluye su propia lectura en texto derivada de los números, no
del LLM. La capa de IA (opcional) escribe encima la narrativa, pero el
informe es completo y honesto sin ella.
"""

from __future__ import annotations

from app.analysis.calidad_beneficios import FCF_NI_DEBIL, FCF_NI_FUERTE
from app.analysis.fundamentals import (
    cagr,
    derive_ratio_series,
    free_cash_flow,
    growth_summary,
    nota_deuda_parcial,
    total_debt,
)
from app.analysis.health import health_snapshot
from app.formato import fmt_frente, fmt_precio, plural

# Una sola lista de fronteras por cifra, con TODAS las que la clasifican en el
# informe: la lectura, los riesgos, el veredicto, el prompt de la IA y la
# pantalla escriben la cifra frente a la lista entera. Con una lista por sitio,
# una deuda/capital de 2,996 era «3,00 (apalancamiento alto)» en la lectura y
# «2,996» en los riesgos, y una cobertura de 4,996 salía «4,996× — ajustada» en
# la lectura y «5,0×» en la casilla de al lado (revisión 11). Se sirve en el
# informe (`umbrales`) para que la pantalla no tenga que copiarla.
UMBRALES = {
    "revenue_cagr": [0, 0.05, 0.08, 0.15],
    "operating_margin": [0.05, 0.15, 0.25],
    "debt_to_equity": [1, 2, 3],
    "interest_coverage": [1.5, 2, 3, 5, 8],
    "fcf_conversion": [FCF_NI_DEBIL, FCF_NI_FUERTE],
    "max_drawdown": [-0.35],
}


def frente(clave: str, valor) -> str:
    """La cifra `clave` del informe escrita frente a sus fronteras (`UMBRALES`).
    Ratios con «×» y conversión sin ceros a la derecha, como en la lectura."""
    pct = clave in ("revenue_cagr", "operating_margin", "fcf_conversion", "max_drawdown")
    ceros = clave not in ("interest_coverage", "fcf_conversion")
    return fmt_frente(valor, UMBRALES[clave], pct=pct, ceros=ceros)


def _trend(values: list[float | None]) -> str | None:
    """Dirección de una serie: compara la media de la primera mitad con la
    de la segunda. Robusto a un solo año raro."""
    clean = [v for v in values if v is not None]
    if len(clean) < 4:
        return None
    half = len(clean) // 2
    first = sum(clean[:half]) / half
    second = sum(clean[half:]) / len(clean[half:])
    if first == 0:
        return None
    change = (second - first) / abs(first)
    if change > 0.10:
        return "mejorando"
    if change < -0.10:
        return "deteriorándose"
    return "estable"


def business_section(periods: list[dict], profile: dict) -> dict:
    """Escala y trayectoria del negocio. No hay desglose por segmento: EDGAR
    no lo expone de forma estructurada en companyfacts."""
    revenues = [p.get("revenue") for p in periods]
    latest = periods[-1] if periods else {}
    years = len([r for r in revenues if r is not None])
    return {
        "name": profile.get("name"),
        "sector": profile.get("sector"),
        "country": profile.get("country"),
        "website": profile.get("website"),
        "market_cap": profile.get("market_cap"),
        "latest_revenue": latest.get("revenue"),
        "latest_fiscal_year": latest.get("fiscal_year"),
        "revenue_by_year": [
            {"year": p.get("fiscal_year"), "revenue": p.get("revenue")} for p in periods
        ],
        "years_of_history": years,
        "note": (
            "El desglose por segmento y la concentración de clientes no salen de "
            "companyfacts de EDGAR: para eso hay que leer el 10-K (enlace en la "
            "pestaña Filings)."
        ),
    }


# La ventana completa del crecimiento: `growth_summary` mira hasta 5 ejercicios.
VENTANA_NOMINAL = 5


def growth_section(periods: list[dict]) -> dict:
    """Crecimiento en la ventana disponible (hasta 5 años) y a 3, y si se acelera.

    La ventana es la que hay, no la nominal: con dos ejercicios el CAGR es de un
    año, y la etiqueta y la lectura lo dicen. Antes ponían «5 años» siempre
    (V18): «Ingresos 5A: 10 %» con dos ejercicios de historia."""
    summary = growth_summary(periods)
    usable = [p for p in periods if p.get("revenue") is not None]

    three_year = None
    if len(usable) >= 4:
        three_year = cagr(usable[-4].get("revenue"), usable[-1].get("revenue"), 3)

    yoy = []
    for prev, curr in zip(usable, usable[1:]):
        prev_rev, curr_rev = prev.get("revenue"), curr.get("revenue")
        yoy.append(
            {
                "year": curr.get("fiscal_year"),
                "growth": (curr_rev / prev_rev - 1) if prev_rev else None,
            }
        )

    acceleration = None
    # Solo con una ventana MÁS larga que 3 años: con 3 o menos se compararía un
    # tramo consigo mismo y saldría «estable» siempre.
    if three_year is not None and summary.get("revenue_cagr") is not None and summary.get("years", 0) > 3:
        diff = three_year - summary["revenue_cagr"]
        acceleration = "acelerando" if diff > 0.02 else "frenando" if diff < -0.02 else "estable"

    return {
        **summary,
        "revenue_cagr_3y": three_year,
        "yoy": yoy,
        "acceleration": acceleration,
        "ventana_nominal": VENTANA_NOMINAL,
        "reading": _growth_reading(summary.get("revenue_cagr"), acceleration, summary.get("years", 0)),
    }


def _anos(n: int) -> str:
    return f"{n} {plural(n, 'año', 'años')}"


def _growth_reading(cagr_5y: float | None, acceleration: str | None, years: int = VENTANA_NOMINAL) -> str:
    if cagr_5y is None:
        return "Sin histórico suficiente para medir el crecimiento."
    pace = (
        "crecimiento fuerte" if cagr_5y > 0.15
        else "crecimiento moderado" if cagr_5y > 0.05
        else "crecimiento plano" if cagr_5y > 0
        else "ingresos en contracción"
    )
    tail = f", y a 3 años viene {acceleration}" if acceleration else ""
    corta = f"; ventana corta: la completa es de {VENTANA_NOMINAL}" if years < VENTANA_NOMINAL else ""
    return f"Ingresos con {pace} ({frente('revenue_cagr', cagr_5y)} anual a {_anos(years)}{corta}){tail}."


def margins_section(ratios: list[dict]) -> dict:
    """Márgenes por año y su dirección — más informativo que el nivel actual."""
    gross = [r.get("gross_margin") for r in ratios]
    operating = [r.get("operating_margin") for r in ratios]
    net = [r.get("net_margin") for r in ratios]
    latest = ratios[-1] if ratios else {}

    trends = {
        "gross_margin": _trend(gross),
        "operating_margin": _trend(operating),
        "net_margin": _trend(net),
    }
    return {
        # El ejercicio de los márgenes de `current`: el informe lee ejercicios
        # anuales, y «margen operativo del 21,0 %» sin más se leía como el de hoy
        # mientras «Qué cambió» enseñaba un trimestre al 12,0 % (revisión 12, visual).
        "ejercicio": latest.get("fiscal_year"),
        "by_year": [
            {
                "year": r.get("fiscal_year"),
                "gross_margin": r.get("gross_margin"),
                "operating_margin": r.get("operating_margin"),
                "net_margin": r.get("net_margin"),
            }
            for r in ratios
        ],
        "current": {
            "gross_margin": latest.get("gross_margin"),
            "operating_margin": latest.get("operating_margin"),
            "net_margin": latest.get("net_margin"),
        },
        "trends": trends,
        "reading": _margins_reading(
            latest.get("operating_margin"), trends["operating_margin"], latest.get("fiscal_year")
        ),
    }


def _del_ejercicio(ejercicio) -> str:
    """« (ejercicio 2025)», o nada si no se sabe cuál."""
    return f" (ejercicio {ejercicio})" if ejercicio else ""


def _margins_reading(operating: float | None, trend: str | None, ejercicio=None) -> str:
    if operating is None:
        return "Sin datos de márgenes."
    level = (
        "márgenes muy altos" if operating > 0.25
        else "márgenes sólidos" if operating > 0.15
        else "márgenes ajustados" if operating > 0.05
        else "márgenes muy finos o negativos"
    )
    tail = f" y la tendencia va {trend}" if trend else ""
    return f"Margen operativo anual del {frente('operating_margin', operating)}{_del_ejercicio(ejercicio)}: {level}{tail}."


def debt_section(periods: list[dict], ratios: list[dict], market_cap: float | None) -> dict:
    """Endeudamiento, cobertura y su evolución."""
    health = health_snapshot(periods, market_cap)
    latest = periods[-1] if periods else {}
    debt_series = [
        {"year": p.get("fiscal_year"), "total_debt": total_debt(p), "cash": p.get("cash")}
        for p in periods
    ]
    leverage_trend = _trend([r.get("debt_to_equity") for r in ratios])
    latest_ratio = ratios[-1] if ratios else {}

    return {
        "net_debt": health.get("net_debt"),
        "total_debt": total_debt(latest),
        "cash": latest.get("cash"),
        "debt_to_equity": latest_ratio.get("debt_to_equity"),
        "interest_coverage": health.get("interest_coverage"),
        "altman_z": health.get("altman_z"),
        "piotroski_f": health.get("piotroski_f"),
        # Una pata de deuda ausente cuenta como cero (como en el análisis de la
        # Ronda 2): se dice cuál, y la lectura lo repite.
        "deuda_parcial": health.get("deuda_parcial"),
        "by_year": debt_series,
        "leverage_trend": leverage_trend,
        "reading": _debt_reading(
            latest_ratio.get("debt_to_equity"), health.get("interest_coverage"), leverage_trend,
            net_debt=health.get("net_debt"), altman=(health.get("altman_z") or {}).get("score"),
            deuda_parcial=health.get("deuda_parcial"),
        ),
    }


def _lista(nombres: list[str]) -> str:
    return nombres[0] if len(nombres) == 1 else ", ".join(nombres[:-1]) + " y " + nombres[-1]


def _debt_reading(d_e: float | None, coverage: float | None, trend: str | None, *,
                  net_debt: float | None = None, altman: float | None = None,
                  deuda_parcial: list[str] | None = None) -> str:
    """La lectura de «Deuda y solidez».

    Antes decía «Sin datos de endeudamiento» en cuanto faltaban deuda/capital y
    cobertura, aunque la misma sección enseñara la deuda neta al lado (V11): una
    contradicción en dos líneas. Ahora «sin datos» solo si faltan TODOS los datos
    de la sección; si no, dice lo que hay y nombra lo que falta."""
    campos = {"deuda neta": net_debt, "deuda/capital": d_e, "cobertura de intereses": coverage, "Altman Z": altman}
    faltan = [nombre for nombre, v in campos.items() if v is None]
    if len(faltan) == len(campos):
        return "Sin datos de endeudamiento."
    parts = []
    if d_e is not None:
        parts.append(
            # Cada cifra, de su lado de los umbrales que la clasifican: 2,004 y
            # 1,996 salían los dos «2,00», uno «alto» y otro «moderado»; 1,96 y 2,04,
            # «2,0× — frágil» y «2,0× — ajustada» (revisión 10).
            f"Deuda/capital {frente('debt_to_equity', d_e)}"
            + (
                " (apalancamiento alto)" if d_e > 2
                else " (moderado)" if d_e > 1
                else " (bajo)"
            )
        )
    if coverage is not None:
        parts.append(
            f"cobertura de intereses {frente('interest_coverage', coverage)}×"
            + (" — holgada" if coverage > 5 else " — ajustada" if coverage > 2 else " — frágil")
        )
    if trend:
        # El apalancamiento "mejorando" significa que la ratio sube, o sea peor.
        parts.append(
            "el apalancamiento viene subiendo" if trend == "mejorando"
            else "el apalancamiento viene bajando" if trend == "deteriorándose"
            else "estable en el tiempo"
        )
    if not parts:
        hay = [nombre for nombre, v in campos.items() if v is not None]
        parts.append(_lista(hay).capitalize() + (" disponible" if len(hay) == 1 else " disponibles"))
    lectura = ". ".join(parts)
    if faltan:
        lectura += ("; falta " if len(faltan) == 1 else "; faltan ") + _lista(faltan)
    lectura += "."
    if deuda_parcial:
        lectura += " " + nota_deuda_parcial(deuda_parcial)
    return lectura


def cash_flow_section(periods: list[dict], ratios: list[dict]) -> dict:
    """Caja: generación, intensidad de capital y calidad del beneficio."""
    rows = []
    for period, ratio in zip(periods, ratios):
        cfo = period.get("cfo")
        capex = period.get("capex")
        fcf = free_cash_flow(period)
        net_income = period.get("net_income")
        revenue = period.get("revenue")
        rows.append(
            {
                "year": period.get("fiscal_year"),
                "cfo": cfo,
                "capex": capex,
                "fcf": fcf,
                "fcf_margin": ratio.get("fcf_margin"),
                # Conversión: cuánto del beneficio contable llega a caja.
                "fcf_conversion": (fcf / net_income) if fcf is not None and net_income else None,
                "capex_intensity": (capex / revenue) if capex is not None and revenue else None,
            }
        )
    latest = rows[-1] if rows else {}
    return {
        "by_year": rows,
        "current": latest,
        "fcf_trend": _trend([r["fcf"] for r in rows]),
        "reading": _cash_reading(latest.get("fcf"), latest.get("fcf_conversion")),
    }


def _cash_reading(fcf: float | None, conversion: float | None) -> str:
    if fcf is None:
        return "Sin datos de flujo de caja."
    if fcf < 0:
        return "Flujo de caja libre negativo: el negocio consume caja."
    if conversion is None:
        return "Genera flujo de caja libre positivo."
    # De su lado de los dos umbrales: 0,596 y 0,604 salían «60 %», uno «solo» y el
    # otro «saludable» (revisión 10).
    if conversion > FCF_NI_FUERTE:
        return (
            f"Convierte el {frente('fcf_conversion', conversion)} del beneficio en caja: el "
            "beneficio contable subestima la generación real."
        )
    if conversion < FCF_NI_DEBIL:
        return (
            f"Solo el {frente('fcf_conversion', conversion)} del beneficio llega a caja libre. "
            "Conviene mirar si es capex de crecimiento o deterioro de la calidad "
            "del beneficio."
        )
    return f"Conversión de beneficio a caja del {frente('fcf_conversion', conversion)}: saludable."


# Lo que el riesgo y el veredicto miran y puede faltar, con el mismo nombre en
# los dos sitios.
_TENDENCIA_MARGEN = "tendencia del margen operativo"
_VALORACION_HISTORICA = "valoración frente a su historia"


def risks_section(
    periods: list[dict], ratios: list[dict], risk: dict | None, valuation: dict
) -> list[dict]:
    """Riesgos derivados de los datos, cada uno con su evidencia."""
    return _riesgos(periods, ratios, risk, valuation)[0]


def _riesgos(
    periods: list[dict], ratios: list[dict], risk: dict | None, valuation: dict
) -> tuple[list[dict], list[str]]:
    """Los riesgos y los umbrales que no se pudieron mirar por falta del dato.

    Sin la segunda lista, «Ninguno de los umbrales del modelo se dispara» salía con
    la deuda/capital, la cobertura y la valoración frente a su historia sin
    calcular: un umbral sin dato no se dispara, pero tampoco se ha comprobado
    (revisión 12, visual)."""
    risks = []
    sin_comprobar: list[str] = []
    latest_ratio = ratios[-1] if ratios else {}

    d_e = latest_ratio.get("debt_to_equity")
    if d_e is None:
        sin_comprobar.append("deuda/capital")
    if d_e is not None and d_e > 2:
        risks.append(
            {
                "type": "Apalancamiento",
                "severity": "alto" if d_e > 3 else "medio",
                "evidence": f"Deuda/capital de {frente('debt_to_equity', d_e)}",
                "why": "Una subida de tipos o una caída de resultados aprieta mucho más rápido.",
            }
        )

    coverage = latest_ratio.get("interest_coverage")
    if coverage is None:
        sin_comprobar.append("cobertura de intereses")
    if coverage is not None and coverage < 3:
        risks.append(
            {
                "type": "Cobertura de intereses",
                "severity": "alto" if coverage < 1.5 else "medio",
                "evidence": f"El EBIT cubre {frente('interest_coverage', coverage)}× los intereses",
                "why": "Poco margen para absorber un año malo sin tensiones financieras.",
            }
        )

    margin_trend = _trend([r.get("operating_margin") for r in ratios])
    if margin_trend is None:
        sin_comprobar.append(_TENDENCIA_MARGEN)
    if margin_trend == "deteriorándose":
        risks.append(
            {
                "type": "Compresión de márgenes",
                "severity": "medio",
                "evidence": "El margen operativo viene cayendo en el periodo analizado",
                "why": "Suele indicar presión competitiva o pérdida de poder de fijación de precios.",
            }
        )

    growth = growth_summary(periods)
    if growth.get("revenue_cagr") is None:
        sin_comprobar.append("crecimiento de los ingresos")
    if growth.get("revenue_cagr") is not None and growth["revenue_cagr"] < 0:
        risks.append(
            {
                "type": "Ingresos en contracción",
                "severity": "alto",
                "evidence": f"CAGR de ingresos {frente('revenue_cagr', growth['revenue_cagr'])} a {growth['years']} años",
                "why": "Un múltiplo bajo sobre un negocio que encoge no es una ganga.",
            }
        )

    cheapness = valuation.get("cheapness_score")
    if cheapness is None:
        sin_comprobar.append(_VALORACION_HISTORICA)
    if cheapness is not None and cheapness < 0.25:
        risks.append(
            {
                "type": "Valoración exigente",
                "severity": "medio",
                "evidence": "Cotiza en la parte alta de su rango histórico de múltiplos",
                "why": "Deja poco margen de error: exige que se cumpla el escenario optimista.",
            }
        )

    drawdown = ((risk or {}).get("max_drawdown") or {}).get("max_drawdown")
    if drawdown is None:
        sin_comprobar.append("máxima caída del último año")
    if drawdown is not None and drawdown < -0.35:
        risks.append(
            {
                "type": "Volatilidad histórica",
                "severity": "medio",
                "evidence": f"Máxima caída del {frente('max_drawdown', drawdown)} en el último año",
                "why": "Dimensiona la posición contando con que puede repetirse.",
            }
        )

    risks.sort(key=lambda r: 0 if r["severity"] == "alto" else 1)
    return risks, sin_comprobar


# El calendario de resultados se pide a estos días vista (`routers/deep_dive.py`)
# y los filings son los últimos PRESENTADOS: la lista no mira a 6-18 meses, que
# es lo que prometía su rótulo encima de unos resultados a 24 días (revisión 12,
# visual). Se sirve con la lista (`catalysts_note`) para que la pantalla diga lo
# que hay en vez de prometer un plazo.
VENTANA_RESULTADOS_DIAS = 120
MAX_RESULTADOS = 4
MAX_FILINGS = 3


def catalysts_note() -> str:
    return (
        f"Resultados previstos en los próximos {VENTANA_RESULTADOS_DIAS} días (calendario) "
        f"y los {MAX_FILINGS} últimos documentos presentados ante la SEC."
    )


def catalysts_section(
    earnings: list[dict], filings: list[dict], events: list[dict]
) -> list[dict]:
    """Fechas a vigilar sacadas de datos, no de opinión: los resultados previstos
    (`earnings`, ya acotados a `VENTANA_RESULTADOS_DIAS`) y los últimos filings."""
    catalysts = []
    for event in earnings[:MAX_RESULTADOS]:
        catalysts.append(
            {
                "type": "Resultados",
                "when": event.get("date"),
                "detail": (
                    # El BPA con los decimales de un precio: 0,0042 salía «0,00» (revisión 5).
                    f"Publicación de resultados"
                    + (f" · BPA estimado {fmt_precio(event['eps_estimate'])}" if event.get("eps_estimate") is not None else "")
                ),
                "source": "calendario",
            }
        )
    for filing in filings[:MAX_FILINGS]:
        catalysts.append(
            {
                "type": filing.get("type"),
                "when": filing.get("filed_at"),
                "detail": "Documento presentado ante la SEC",
                "source": "edgar",
                "url": filing.get("url"),
            }
        )
    for event in events[:5]:
        if event.get("category") == "irrelevante_para_la_tesis":
            continue
        catalysts.append(
            {
                "type": event.get("category", "").replace("_", " "),
                "when": None,
                "detail": event.get("headline"),
                "source": "noticias (clasificado por IA)",
            }
        )
    return catalysts


def build_verdict(
    signal: dict | None, valuation: dict, growth: dict, debt: dict, margins: dict
) -> dict:
    """Veredicto sintetizado: qué dicen los datos en conjunto.

    NO es una orden de compra. Es la lectura conjunta con sus condiciones y,
    sobre todo, con lo que la invalidaría — que es la parte que un informe de
    analista suele enterrar y aquí va explícita.
    """
    positives, negatives = [], []
    # Lo que la lectura mira y no pudo comprobar por falta del dato. Sin esto, la
    # lista de «en contra» vacía se escribía «sin señales de alarma en los datos»
    # con la valoración frente a su historia, la cobertura de intereses y el
    # Altman Z sin calcular: «no se pudo comprobar» se leía «nada en contra»
    # (revisión 12, visual). La postura sigue saliendo de lo comprobado.
    sin_comprobar: list[str] = []

    cheapness = valuation.get("cheapness_score")
    if cheapness is None:
        sin_comprobar.append(_VALORACION_HISTORICA)
    else:
        if cheapness >= 0.65:
            positives.append("cotiza por debajo de su valoración histórica habitual")
        elif cheapness <= 0.35:
            negatives.append("cotiza por encima de su valoración histórica habitual")

    revenue_cagr = growth.get("revenue_cagr")
    if revenue_cagr is None:
        sin_comprobar.append("crecimiento de los ingresos")
    else:
        if revenue_cagr > 0.08:
            positives.append(f"ingresos creciendo al {frente('revenue_cagr', revenue_cagr)} anual")
        elif revenue_cagr < 0:
            negatives.append("ingresos en contracción")

    operating = (margins.get("current") or {}).get("operating_margin")
    if operating is None:
        sin_comprobar.append("margen operativo")
    elif operating > 0.15:
        # Anual y de qué ejercicio: «margen operativo del 21,0 %» a secas se leía
        # como el de hoy junto a un trimestre al 12,0 % en «Qué cambió».
        positives.append(
            f"margen operativo anual del {frente('operating_margin', operating)}"
            f"{_del_ejercicio(margins.get('ejercicio'))}"
        )
    trend = (margins.get("trends") or {}).get("operating_margin")
    if trend is None and operating is not None:
        sin_comprobar.append(_TENDENCIA_MARGEN)
    if trend == "deteriorándose":
        negatives.append("márgenes en deterioro")

    coverage = debt.get("interest_coverage")
    if coverage is None:
        sin_comprobar.append("cobertura de intereses")
    else:
        if coverage > 8:
            positives.append("balance sin tensión por intereses")
        elif coverage < 3:
            negatives.append(f"cobertura de intereses ajustada ({frente('interest_coverage', coverage)}×)")

    zone = (debt.get("altman_z") or {}).get("zone")
    if zone is None:
        sin_comprobar.append("Altman Z")
    elif zone == "riesgo":
        negatives.append("Altman Z en zona de riesgo")

    stance = (
        "constructiva" if len(positives) > len(negatives) + 1
        else "cautelosa" if len(negatives) > len(positives) + 1
        else "mixta"
    )

    return {
        "stance": stance,
        "positives": positives,
        "negatives": negatives,
        "sin_comprobar": sin_comprobar,
        "quant_label": (signal or {}).get("label"),
        "quant_score": (signal or {}).get("score"),
        "summary": _verdict_summary(stance, positives, negatives, sin_comprobar),
        # De qué sale la lectura y qué no entra en ella: el informe lee ejercicios
        # anuales, y su recuadro verde convivía sin decirlo con un DCF muy por
        # debajo del precio y con un trimestre que invalidaba la tesis (revisión
        # 12, visual).
        "alcance": _alcance(margins.get("ejercicio")),
        "what_would_change_it": _invalidators(positives, negatives),
        "disclaimer": (
            "Lectura conjunta de los datos, no una recomendación de compra o "
            "venta. Qué hacer depende de tu cartera, horizonte y tolerancia al "
            "riesgo, que el modelo no conoce. Un informe favorable sobre una "
            "empresa excelente sigue pudiendo ser una mala compra al precio "
            "equivocado."
        ),
    }


def _verdict_summary(
    stance: str, positives: list[str], negatives: list[str], sin_comprobar: list[str] | None = None
) -> str:
    sin_comprobar = sin_comprobar or []
    falta = f" Sin comprobar por falta de datos: {_lista(sin_comprobar)}." if sin_comprobar else ""
    if not positives and not negatives:
        return "Datos insuficientes para una lectura conjunta." + falta
    pos = "; ".join(positives) or "sin factores claramente favorables"
    # «Sin señales de alarma» solo si se pudo mirar todo: con algo sin comprobar,
    # lo que se sabe es que nada de lo comprobado está en contra.
    neg = "; ".join(negatives) or (
        "nada entre lo que se pudo comprobar" if sin_comprobar else "sin señales de alarma en los datos"
    )
    frame = {
        "constructiva": "Los datos apuntan en dirección favorable",
        "cautelosa": "Los datos invitan a la cautela",
        "mixta": "Los datos dan una lectura mixta",
    }[stance]
    return f"{frame}. A favor: {pos}. En contra: {neg}.{falta}"


def _alcance(ejercicio) -> str:
    cual = f"ejercicio anual {ejercicio}" if ejercicio else "último ejercicio anual"
    return (
        f"Lectura del {cual} y de la valoración frente a su propia historia. No entran "
        "los trimestres publicados después ni el DCF precargado de más abajo."
    )


def _invalidators(positives: list[str], negatives: list[str]) -> list[str]:
    """Qué observaciones futuras romperían esta lectura."""
    checks = [
        "Dos trimestres seguidos de caída del margen operativo.",
        "Que el crecimiento de ingresos se vuelva negativo de forma sostenida.",
        "Un salto del apalancamiento o una caída de la cobertura de intereses por debajo de 3×.",
        "Que el flujo de caja libre pase a negativo sin una explicación de inversión clara.",
    ]
    if any("valoración histórica habitual" in p for p in positives):
        checks.append(
            "Que el múltiplo bajo se explique por un deterioro estructural del "
            "negocio y no por pesimismo temporal — el clásico value trap."
        )
    return checks


def assemble(
    symbol: str,
    profile: dict,
    financials: dict,
    valuation: dict,
    quote: dict | None,
    risk: dict | None,
    signal: dict | None,
    earnings: list[dict],
    filings: list[dict],
    events: list[dict],
    dcf: dict | None,
) -> dict:
    """Informe completo. Función pura: nada aquí toca la red."""
    periods = financials.get("periods", [])
    ratios = financials.get("ratios") or derive_ratio_series(periods)

    business = business_section(periods, profile)
    growth = growth_section(periods)
    margins = margins_section(ratios)
    debt = debt_section(periods, ratios, profile.get("market_cap"))
    cash_flow = cash_flow_section(periods, ratios)
    risks, riesgos_sin_comprobar = _riesgos(periods, ratios, risk, valuation)

    return {
        "symbol": symbol,
        "generated_at": None,  # lo pone el router
        "price": (quote or {}).get("price"),
        "business": business,
        "growth": growth,
        "margins": margins,
        "debt": debt,
        "cash_flow": cash_flow,
        "valuation": valuation,
        "dcf": dcf,
        "quant_signal": signal,
        "risk_metrics": risk,
        "risks": risks,
        "riesgos_sin_comprobar": riesgos_sin_comprobar,
        "catalysts": catalysts_section(earnings, filings, events),
        "catalysts_note": catalysts_note(),
        "verdict": build_verdict(signal, valuation, growth, debt, margins),
        # Las fronteras con que el informe escribe cada cifra (`UMBRALES`).
        "umbrales": {clave: list(lista) for clave, lista in UMBRALES.items()},
        "data_sources": {
            "financials": financials.get("source"),
            "quote": (quote or {}).get("source"),
            "as_of": financials.get("as_of"),
        },
        "computed_by": "app",  # todo lo anterior sale de cálculos, no del LLM
    }
