"""Lógica del screener: filtros combinables sobre métricas fundamentales.

Filtros = {clave_métrica: {"op": "gte"|"lte", "value": float}}. Un dato
ausente NUNCA pasa el filtro que lo requiere — no filtrar por lo que no se
sabe — y el resultado detalla qué filtro falló para que la decisión sea
auditable.

Tampoco lo suspende: «sin dato» es su propio estado. Un ratio corriente que
faltaba se pintaba en rojo como un suspenso y la fila decía «No pasa»: XOM, con
P/E 12, deuda/capital 0,4 y ROE 19 %, salía igual que una empresa cara y
endeudada, y «0 de 8 pasan» no separaba las que suspenden de las que no se
pudieron comprobar (revisión 12, visual).
"""

from __future__ import annotations

from app import datos

VALID_OPS = {"gte", "lte"}

# El estado de cada comprobación y de cada empresa. `passed` y `passes` siguen
# siendo el booleano fail-safe (True solo si se comprobó y cumple); el estado
# dice por qué no: un suspenso con su dato, o un dato que falta.
PASA, NO_PASA, SIN_DATO, SIN_COMPROBAR = "pasa", "no_pasa", "sin_dato", "sin_comprobar"


def evaluate_filters(metrics: dict, filters: dict[str, dict]) -> dict:
    """-> {passes: bool, estado, checks: [{metric, op, value, actual, passed, estado}]}

    El `estado` de la empresa es «pasa» si cumple todos los filtros; «no_pasa»
    si suspende alguno con su dato, aunque le falte otro (ya no puede pasar), y
    «sin_comprobar» si no suspende ninguno pero falta el dato de alguno."""
    checks = []
    for metric, spec in filters.items():
        op = spec.get("op")
        if op not in VALID_OPS:
            raise ValueError(f"Operador inválido para {metric}: {op}")
        threshold = float(spec["value"])
        # Un NaN tampoco es un dato: compararlo da False y saldría como suspenso.
        actual = datos.numero(metrics.get(metric))
        if actual is None:
            estado = SIN_DATO  # sin dato no hay veredicto, ni a favor ni en contra
        elif op == "gte":
            estado = PASA if actual >= threshold else NO_PASA
        else:
            estado = PASA if actual <= threshold else NO_PASA
        checks.append({"metric": metric, "op": op, "value": threshold, "actual": actual,
                       "passed": estado == PASA, "estado": estado})
    estados = {c["estado"] for c in checks}
    estado = NO_PASA if NO_PASA in estados else SIN_COMPROBAR if SIN_DATO in estados else PASA
    return {"passes": estado == PASA, "estado": estado, "checks": checks}


# Presets iniciales. Cada uno documenta su lógica (requisito de la app):
# el screener no es una caja negra, la racionalidad viaja con el preset.
DEFAULT_PRESETS = [
    {
        "name": "Value con balance sólido",
        "logic_md": (
            "Busca empresas baratas por beneficios (P/E ≤ 18) que no dependan de "
            "deuda (deuda/capital ≤ 1) y con liquidez de corto plazo sana (ratio "
            "corriente ≥ 1,2) y rentabilidad real (ROE ≥ 10\u00a0%). La trampa clásica "
            "del value es comprar barato lo que está barato por algo: el balance "
            "filtra parte de esas trampas."
        ),
        "filters": {
            "pe_ttm": {"op": "lte", "value": 18},
            "debt_to_equity": {"op": "lte", "value": 1.0},
            "current_ratio": {"op": "gte", "value": 1.2},
            "roe": {"op": "gte", "value": 0.10},
        },
    },
    {
        "name": "Crecimiento a precio razonable (GARP)",
        "logic_md": (
            "Crecimiento de ingresos ≥ 8\u00a0% anual (5A) con ROE ≥ 12\u00a0%, pero sin "
            "pagar cualquier múltiplo: P/E ≤ 25. La idea de Lynch: crecimiento sí, "
            "pero comprado con disciplina de precio."
        ),
        "filters": {
            "revenue_growth_5y": {"op": "gte", "value": 0.08},
            "roe": {"op": "gte", "value": 0.12},
            "pe_ttm": {"op": "lte", "value": 25},
        },
    },
    {
        "name": "Dividendos sostenibles",
        "logic_md": (
            "Rentabilidad por dividendo ≥ 2,5\u00a0% respaldada por margen neto ≥ 8\u00a0% y "
            "deuda contenida (deuda/capital ≤ 1,5). Un dividendo alto sin margen ni "
            "balance detrás es un recorte anunciado."
        ),
        "filters": {
            "dividend_yield": {"op": "gte", "value": 0.025},
            "net_margin": {"op": "gte", "value": 0.08},
            "debt_to_equity": {"op": "lte", "value": 1.5},
        },
    },
]
