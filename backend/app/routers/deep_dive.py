"""Informe de analista completo sobre una empresa.

Coste de API: la mayor parte del informe sale de EDGAR (gratis) y de datos ya
cacheados. La narrativa del LLM es opcional y va bajo botón aparte, para que
puedas leer el informe entero sin gastar nada en Claude.
"""

from __future__ import annotations

from app import datos
from app.formato import fmt_compacto, fmt_fecha, fmt_frente, fmt_num, fmt_pct, fmt_precio
from app.llm.signal_llm import FRONTERAS_ETIQUETA
from app.routers.valuation import CRECIMIENTO_SUPUESTO

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.analysis.deep_dive import VENTANA_RESULTADOS_DIAS, assemble, frente
from app.analysis.health import ALTMAN_RIESGO, ALTMAN_SEGURA
from app.analysis.factors import build_raw_factors, composite_score, family_scores, zscores
from app.analysis.fundamentals import derive_ratio_series, growth_summary
from app.analysis.signal import build_signal
from app.analysis.valuation_history import valuation_vs_history
from app.cache.cache import MarketDataService
from app.db.engine import get_session
from app.db.models import LlmOutput
from app.deps import get_llm, get_service
from app.llm.base import LLMProvider, LLMUnavailableError
from app.providers.base import DataNotFoundError
from app.providers.router import AllProvidersFailedError
from app.simbolos import SimboloRuta, validar_simbolo

router = APIRouter(prefix="/api/deep-dive", tags=["deep-dive"])


# «Qué vigilar», sin plazo: con «(6-18 meses)» la IA colocaba ahí unos
# resultados a 24 días, lo mismo que el rótulo de la lista calculada (revisión
# 12, visual).
NARRATIVE_SYSTEM = """Eres un analista de renta variable escribiendo para un \
estudiante de finanzas. Recibes un informe YA CALCULADO con cifras reales.

Reglas estrictas:
- NUNCA inventes, redondees ni ajustes cifras: usa exactamente las que te doy.
- Si un dato falta, dilo; no lo estimes.
- NUNCA des precio objetivo ni digas "comprar"/"vender".
- Explica el NEGOCIO detrás de los números: qué implica un margen así en este \
sector, qué significa esa conversión de caja, por qué importa ese apalancamiento.
- Sé concreto sobre la principal debilidad del análisis (cobertura de datos, \
años de historia, factores ausentes).
- Estructura en secciones cortas con estos encabezados exactos:
  ## El negocio
  ## Lo que dicen los números
  ## Valoración
  ## Qué vigilar
  ## Lectura final
- En "Lectura final", sintetiza sin recomendar: di qué tendría que ser cierto \
para que la tesis alcista funcione y qué la rompería.
- Español, máximo 600 palabras, Markdown."""



def _piotroski(f: dict | None) -> str:
    """«7/9»; sin puntuación, «sin datos» (el prompt decía «None/9» y «zona None»)."""
    f = f or {}
    if f.get("score") is None:
        return "sin datos"
    return f"{f['score']}/{f.get('max_possible', 9)}"


def _safe(service: MarketDataService, data_type: str, **kwargs):
    try:
        return service.get(data_type, **kwargs)
    except (DataNotFoundError, AllProvidersFailedError):
        return None


def _consultar(service: MarketDataService, data_type: str, **kwargs) -> tuple[dict | None, bool]:
    """(respuesta, si la fuente no respondió). `_safe` junta «no lo tiene» con
    «no respondió», y con el calendario caído la lista de catalizadores decía
    «Resultados previstos en los próximos 120 días» sobre algo que nadie había
    podido mirar (revisión 13). Que la fuente diga que no hay es una lista
    vacía; que no conteste, «no se pudo comprobar»."""
    try:
        return service.get(data_type, **kwargs), False
    except DataNotFoundError:
        return None, False
    except AllProvidersFailedError:
        return None, True


def _peer_signal(service: MarketDataService, symbol: str, metrics: dict) -> dict | None:
    """Puntúa la empresa contra sus pares para incluir la señal cuantitativa."""
    peers_payload = _safe(service, "peers", symbol=symbol)
    if not peers_payload:
        return None
    universe = [symbol, *peers_payload["peers"][:6]]

    raw: dict[str, dict] = {}
    for sym in universe:
        fundamentals = _safe(service, "fundamentals", symbol=sym)
        if fundamentals is None:
            continue
        raw[sym] = build_raw_factors(
            dict(fundamentals["metrics"]) if sym != symbol else metrics, None, None
        )
    if len(raw) < 3:
        return None

    factor_names = {f for values in raw.values() for f in values}
    factor_z = {
        factor: zscores({s: values.get(factor) for s, values in raw.items()})
        for factor in factor_names
    }
    families = family_scores(factor_z)
    composite = composite_score({f: families[f].get(symbol) for f in families})
    signal = build_signal(symbol, composite, None, horizon="6-12 meses")
    signal["peer_group"] = list(raw)
    return signal


@router.get("/{symbol}")
def deep_dive(
    symbol: SimboloRuta,
    history_years: int = Query(10, ge=3, le=15),
    service: MarketDataService = Depends(get_service),
):
    """Informe completo: negocio, financieros, valoración, riesgos y veredicto.

    Todo calculado a partir de datos. La narrativa del LLM va aparte.
    """
    symbol = validar_simbolo(symbol)

    # 404 solo si EDGAR no lo tiene; si no respondió, 502. Antes `_safe` se
    # tragaba los dos y un EDGAR caído se leía como «no registrada en la SEC»,
    # así que la ficha no podía tratar el 404 como ausencia (segunda revisión
    # del 2.1).
    try:
        financials = service.get("financials", symbol=symbol)
    except DataNotFoundError as exc:
        financials, motivo = None, str(exc)
    except AllProvidersFailedError as exc:
        raise HTTPException(
            status_code=502, detail=f"No se pudieron descargar los estados financieros de EDGAR: {exc}"
        ) from exc
    else:
        motivo = "sin ejercicios anuales"
    if financials is None or not financials.get("periods"):
        raise HTTPException(
            status_code=404,
            detail=(
                f"Sin estados financieros para {symbol} en SEC EDGAR ({motivo}). El informe "
                "necesita histórico auditado; EDGAR solo cubre empresas "
                "registradas en la SEC (no aplica a cotizadas extranjeras sin ADR)."
            ),
        )
    periods = financials["periods"]
    financials = {**financials, "ratios": derive_ratio_series(periods)}

    profile = _safe(service, "profile", symbol=symbol) or {"symbol": symbol}
    quote = _safe(service, "quote", symbol=symbol)
    history = _safe(service, "price_history", symbol=symbol, interval="1day", outputsize=5000)
    filings_payload, filings_caidos = _consultar(service, "filings", symbol=symbol)
    filings_payload = filings_payload or {}

    valuation = valuation_vs_history(
        periods,
        filings_payload.get("filings", []),
        (history or {}).get("bars", []),
        (quote or {}).get("price"),
        years=history_years,
    )

    # Riesgo de mercado desde el histórico ya descargado (coste cero).
    risk = None
    if history and history.get("bars"):
        import pandas as pd

        from app.analysis.risk import annualized_volatility, daily_returns, max_drawdown

        closes = pd.Series(
            [b["close"] for b in history["bars"][-252:]],
            index=[b["ts"][:10] for b in history["bars"][-252:]],
        )
        risk = {
            "annualized_volatility": annualized_volatility(daily_returns(closes)),
            "max_drawdown": max_drawdown(closes),
        }

    fundamentals = _safe(service, "fundamentals", symbol=symbol)
    signal = (
        _peer_signal(service, symbol, dict(fundamentals["metrics"]))
        if fundamentals
        else None
    )

    today = datetime.now(timezone.utc).date()
    calendar, calendario_caido = _consultar(
        service,
        "earnings_calendar",
        start=today.isoformat(),
        end=(today + timedelta(days=VENTANA_RESULTADOS_DIAS)).isoformat(),
    )
    # None, no []: «no se pudo consultar» no es «no hay ninguno».
    earnings = None if calendario_caido else [
        e for e in (calendar or {}).get("events", []) if e.get("symbol") == symbol
    ]

    report = assemble(
        symbol=symbol,
        profile=profile,
        financials=financials,
        valuation=valuation,
        quote=quote,
        risk=risk,
        signal=signal,
        earnings=earnings,
        filings=None if filings_caidos else filings_payload.get("filings", []),
        events=[],
        dcf=_dcf_defaults(periods, quote),
    )
    report["generated_at"] = datetime.now(timezone.utc).isoformat()
    return report


def _dcf_defaults(periods: list[dict], quote: dict | None) -> dict | None:
    """Punto de partida del DCF con los datos del informe, para no obligar a
    ir a otra pestaña a calcularlo."""
    from app.analysis.fundamentals import free_cash_flow, total_debt
    from app.analysis.valuation import scenario_set

    latest = periods[-1]
    fcf = free_cash_flow(latest)
    shares = latest.get("shares_outstanding")
    if fcf is None or fcf <= 0 or not shares:
        return None

    growth = growth_summary(periods)
    # Misma pareja de fallos que en `routers/valuation.py`: el `or` encadenado
    # convertía la ausencia en un supuesto no declarado, y un crecimiento real
    # de 0.0 en ese mismo supuesto por ser *falsy*.
    medido = datos.numero(growth.get("fcf_cagr"))
    if medido is None:
        medido = datos.numero(growth.get("revenue_cagr"))
    crecimiento_supuesto = medido is None
    base_growth = min(CRECIMIENTO_SUPUESTO if crecimiento_supuesto else medido, 0.15)

    # Y la deuda: sin ella no hay valor por acción. `scenario_set` propaga el
    # `indeterminado` de `dcf`, así que se le pasa None y la respuesta dice que
    # falta, en vez de valorar la empresa como si no debiera nada.
    debt = total_debt(latest)
    net_debt = (
        debt - (datos.numero(latest.get("cash")) or 0.0)
        if datos.numero(debt) is not None
        else None
    )

    scenarios = scenario_set(
        {
            "bear": {"growth_rate": max(base_growth - 0.04, -0.02), "discount_rate": 0.12, "terminal_growth": 0.015},
            "base": {"growth_rate": base_growth, "discount_rate": 0.10, "terminal_growth": 0.025},
            "bull": {"growth_rate": base_growth + 0.04, "discount_rate": 0.09, "terminal_growth": 0.03},
        },
        base_fcf=fcf,
        years=5,
        net_debt=net_debt,
        shares_outstanding=shares,
    )
    return {
        "scenarios": scenarios,
        "base_fcf": fcf,
        "net_debt": net_debt,
        "shares_outstanding": shares,
        "current_price": (quote or {}).get("price"),
        "note": (
            "Supuestos de partida derivados del histórico, acotados al 15\u00a0% de "
            "crecimiento. Edítalos en la pestaña Valoración: el resultado es muy "
            "sensible a la tasa de descuento y al crecimiento terminal."
        ),
    }


@router.post("/{symbol}/narrative")
def narrative(
    symbol: SimboloRuta,
    report: dict = Body(...),
    llm: LLMProvider | None = Depends(get_llm),
    session: Session = Depends(get_session),
):
    """Narrativa del informe escrita por Claude sobre las cifras calculadas."""
    symbol = validar_simbolo(symbol)
    if llm is None:
        raise HTTPException(
            status_code=503,
            detail="Capa de IA no configurada: añade ANTHROPIC_API_KEY en .env",
        )

    prompt = _narrative_prompt(symbol, report)
    try:
        result = llm.interpret(NARRATIVE_SYSTEM, prompt)
    except LLMUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    session.add(
        LlmOutput(
            kind="deep_dive_narrative",
            content_md=result["content"],
            model=result["model"],
        )
    )
    session.commit()
    return {
        "generated_by": "llm",
        "content_md": result["content"],
        "model": result["model"],
        "disclaimer": (
            "Narrativa generada por IA sobre cifras calculadas por la app. La IA "
            "no produjo ningún número; puede malinterpretar el contexto del "
            "negocio o del sector."
        ),
    }


def _narrative_prompt(symbol: str, report: dict) -> str:
    """Resume el informe en texto compacto para el modelo (acota tokens)."""
    business = report.get("business", {})
    growth = report.get("growth", {})
    # La ventana real del CAGR (V18): con dos ejercicios es de un año, no de cinco.
    anos = growth.get("years")
    ventana = f"{anos}A" if anos else "sin ventana"
    margins = report.get("margins", {})
    debt = report.get("debt", {})
    cash = report.get("cash_flow", {})
    valuation = report.get("valuation", {})
    verdict = report.get("verdict", {})

    def pct(v):
        return fmt_pct(v) if isinstance(v, (int, float)) else "sin dato"

    multiples = valuation.get("multiples", {})
    val_lines = []
    for key, label in (("pe", "P/E"), ("pb", "P/B"), ("fcf_yield", "Rentabilidad por FCF")):
        entry = multiples.get(key, {})
        if entry.get("available"):
            val_lines.append(
                f"- {label}: actual {fmt_num(entry.get('current'))}, mediana histórica "
                f"{fmt_num(entry.get('median'))}, rango {fmt_num(entry.get('min'))}–{fmt_num(entry.get('max'))} "
                f"(percentil {pct(entry.get('percentile'))}, {entry.get('n')} observaciones)"
            )

    risks = "\n".join(
        f"- [{r['severity']}] {r['type']}: {r['evidence']}" for r in report.get("risks", [])
    )
    # Lo que no se pudo mirar, con su nombre: la IA recibía «Ninguno relevante
    # detectado» con la deuda/capital y la máxima caída sin calcular, y escribía
    # un balance sin riesgos que nadie había comprobado (revisión 13). Un
    # informe sin la lista (de antes de la revisión 12) no dice si faltó algo.
    riesgos_sin = report.get("riesgos_sin_comprobar")
    if riesgos_sin:
        risks = (risks + "\n" if risks else "- Ninguno entre lo que se pudo comprobar\n") + (
            f"- Sin comprobar por falta de datos (no es que no haya riesgo): {'; '.join(riesgos_sin)}"
        )
    elif not risks:
        risks = "- Ninguno relevante detectado" if riesgos_sin is not None else (
            "- Ninguno detectado (el informe no dice qué quedó sin comprobar)")
    # Previsto o ya presentado: la IA recibía los dos bajo «catalizadores
    # próximos» y un 10-Q del mes pasado pasaba por un catalizador por venir
    # (revisión 12, visual).
    def cuando(c: dict) -> str:
        if not c.get("when"):
            return "sin fecha"
        verbo = "presentado" if c.get("source") == "edgar" else "previsto"
        return f"{verbo} el {fmt_fecha(c['when'])}"

    catalysts = "\n".join(
        f"- {c['type']} ({cuando(c)}): {c.get('detail')}"
        for c in report.get("catalysts", [])[:6]
    )
    # Con el calendario o los filings caídos llegaba «Ninguno identificado»: un
    # fallo convertido en «ninguno» (revisión 13).
    catalizadores_sin = report.get("catalysts_sin_comprobar") or []
    if catalizadores_sin:
        catalysts = (catalysts + "\n" if catalysts else "- Ninguno entre lo que se pudo consultar\n") + (
            f"- No se pudo consultar (no se sabe qué traen): {'; '.join(catalizadores_sin)}"
        )

    return f"""EMPRESA: {symbol} — {business.get('name') or 'sin nombre'}
Sector: {business.get('sector') or 'desconocido'}
Ingresos último ejercicio ({business.get('latest_fiscal_year')}): {fmt_compacto(business.get('latest_revenue'))}
Años de histórico disponibles: {business.get('years_of_history')}
Precio actual: {fmt_precio(report.get('price'))}

CRECIMIENTO
CAGR ingresos {ventana}: {frente('revenue_cagr', growth.get('revenue_cagr'))} | 3A: {pct(growth.get('revenue_cagr_3y'))}
CAGR BPA {ventana}: {pct(growth.get('eps_cagr'))} | CAGR FCF {ventana}: {pct(growth.get('fcf_cagr'))}
Tendencia: {growth.get('acceleration') or 'sin determinar'}

MÁRGENES
Bruto {pct(margins.get('current', {}).get('gross_margin'))} | Operativo {frente('operating_margin', margins.get('current', {}).get('operating_margin'))} | Neto {pct(margins.get('current', {}).get('net_margin'))}
Tendencia del margen operativo: {margins.get('trends', {}).get('operating_margin') or 'sin determinar'}

DEUDA
Deuda neta: {fmt_compacto(debt.get('net_debt'))} | Deuda/capital: {frente('debt_to_equity', debt.get('debt_to_equity'))}
Cobertura de intereses: {frente('interest_coverage', debt.get('interest_coverage'))}
Altman Z: {fmt_frente((debt.get('altman_z') or {}).get('score'), (debt.get('altman_z') or {}).get('umbrales') or [ALTMAN_RIESGO, ALTMAN_SEGURA])} (zona {(debt.get('altman_z') or {}).get('zone') or 'sin determinar'})
Piotroski F: {_piotroski(debt.get('piotroski_f'))}

CAJA
FCF último ejercicio: {fmt_compacto(cash.get('current', {}).get('fcf'))}
Conversión beneficio→caja: {frente('fcf_conversion', cash.get('current', {}).get('fcf_conversion'))}
Intensidad de capex: {pct(cash.get('current', {}).get('capex_intensity'))}
Tendencia del FCF: {cash.get('fcf_trend') or 'sin determinar'}

VALORACIÓN FRENTE A SU PROPIA HISTORIA ({valuation.get('years_covered')} años)
{chr(10).join(val_lines) or '- Sin histórico suficiente'}
Lectura: {valuation.get('reading')}

SEÑAL CUANTITATIVA (frente a sus pares)
{(report.get('quant_signal') or {}).get('label', 'no disponible')} · z-score {fmt_frente((report.get('quant_signal') or {}).get('score'), FRONTERAS_ETIQUETA, signo=True)}

RIESGOS DETECTADOS EN LOS DATOS
{risks}

CATALIZADORES ({report.get('catalysts_note') or 'fechas sacadas de los datos'})
{catalysts or '- Ninguno identificado'}

VEREDICTO CALCULADO: postura {verdict.get('stance')}
A favor: {'; '.join(verdict.get('positives', [])) or 'ninguno'}
En contra: {'; '.join(verdict.get('negatives', [])) or 'ninguno'}
Sin comprobar por falta de datos (no cuentan ni a favor ni en contra): {'; '.join(verdict.get('sin_comprobar') or []) or 'nada'}
Alcance: {verdict.get('alcance') or 'sin indicar'}

Escribe el informe."""
