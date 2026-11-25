"""Valoración por DCF con supuestos explícitos y análisis de sensibilidad.

Principio rector de la app aplicado al código: el DCF nunca devuelve "el
precio objetivo"; devuelve un RANGO por escenario con TODOS los supuestos de
entrada visibles, y dice qué supuesto mueve más el resultado. La falsa
precisión es el enemigo.

Es el ÚNICO DCF de la app (ítem 3.3). Había tres, cada uno con sus supuestos:
el módulo Valoración, la pestaña Valoración de la ficha (supuestos escritos en
el frontend) y el «precargado» del informe completo. Ahora los tres leen de aquí
(`cimientos`, `escenarios_por_defecto`, `escenarios_con_rango`, `rango_global`)
y por eso dan los mismos rangos. La comparación de supuestos está en el README,
«Un solo DCF». `scenario_set` y `sensitivity_grid` solo los usa ya el alias
obsoleto `POST /api/stocks/{s}/valuation/dcf`, que se retira en la versión
siguiente.
"""

from __future__ import annotations

import math

from app import datos
from app.analysis.fundamentals import deuda_total, free_cash_flow, growth_summary
from app.formato import fmt_num, fmt_pct, fmt_valor_redondo


def dcf(
    base_fcf: float,
    growth_rate: float,
    discount_rate: float,
    terminal_growth: float,
    years: int = 5,
    net_debt: float = 0.0,
    shares_outstanding: float | None = None,
) -> dict:
    """DCF de dos etapas: crecimiento constante `years` años + valor terminal
    (Gordon). Devuelve el detalle completo de la proyección.

    Restricciones: discount_rate > terminal_growth (si no, el valor terminal
    diverge — error clásico) y years >= 1.
    """
    if years < 1:
        raise ValueError("years debe ser >= 1")
    if discount_rate <= terminal_growth:
        raise ValueError(
            "La tasa de descuento debe ser mayor que el crecimiento terminal "
            "(si no, el valor terminal es infinito)"
        )

    projections = []
    pv_sum = 0.0
    fcf = base_fcf
    for year in range(1, years + 1):
        fcf = fcf * (1 + growth_rate)
        pv = fcf / (1 + discount_rate) ** year
        pv_sum += pv
        projections.append({"year": year, "fcf": fcf, "present_value": pv})

    terminal_fcf = fcf * (1 + terminal_growth)
    terminal_value = terminal_fcf / (discount_rate - terminal_growth)
    pv_terminal = terminal_value / (1 + discount_rate) ** years

    enterprise_value = pv_sum + pv_terminal

    # La deuda neta NO puede darse por cero cuando no se conoce.
    #
    # `equity = enterprise_value − net_debt`, así que suponer cero es suponer
    # una empresa sin deuda: el supuesto más optimista posible, aplicado justo
    # cuando menos se sabe. Con 8.000 M de deuda neta sobre este mismo flujo,
    # la diferencia son 83,95 $/acción frente a 163,95 $: un 95 % de valoración
    # regalado por un dato que falta.
    #
    # Ojo con el cero: una empresa SIN deuda existe, y `net_debt=0.0` es un dato
    # legítimo. Lo que no vale es que el desconocimiento se disfrace de cero.
    deuda = datos.numero(net_debt)
    acciones = datos.numero(shares_outstanding)
    faltan = []
    if deuda is None:
        faltan.append("deuda neta")
    if acciones is None or acciones <= 0:
        faltan.append("acciones en circulación")

    equity_value = enterprise_value - deuda if deuda is not None else None
    per_share = (
        equity_value / acciones
        if equity_value is not None and acciones and acciones > 0
        else None
    )
    if faltan:
        return {
            **datos.indeterminado(faltan, "esta empresa"),
            "assumptions": {
                "base_fcf": base_fcf,
                "growth_rate": growth_rate,
                "discount_rate": discount_rate,
                "terminal_growth": terminal_growth,
                "years": years,
                "net_debt": deuda,
                "shares_outstanding": acciones,
            },
            "projections": projections,
            "terminal_value": terminal_value,
            "pv_terminal": pv_terminal,
            "pv_explicit": pv_sum,
            "terminal_weight": pv_terminal / enterprise_value if enterprise_value else None,
            # El valor de empresa SÍ se puede calcular sin saber la deuda: no
            # depende de ella. Se entrega, porque es información real; lo que no
            # se entrega es el salto de ahí al valor por acción.
            "enterprise_value": enterprise_value,
            "equity_value": equity_value,
            "value_per_share": None,
        }

    return {
        "assumptions": {
            "base_fcf": base_fcf,
            "growth_rate": growth_rate,
            "discount_rate": discount_rate,
            "terminal_growth": terminal_growth,
            "years": years,
            "net_debt": net_debt,
            "shares_outstanding": shares_outstanding,
        },
        "projections": projections,
        "terminal_value": terminal_value,
        "pv_terminal": pv_terminal,
        "pv_explicit": pv_sum,
        "terminal_weight": pv_terminal / enterprise_value if enterprise_value else None,
        "enterprise_value": enterprise_value,
        "equity_value": equity_value,
        "value_per_share": per_share,
    }


def sensitivity_grid(
    base_fcf: float,
    growth_rate: float,
    discount_rate: float,
    terminal_growth: float,
    years: int = 5,
    net_debt: float = 0.0,
    shares_outstanding: float | None = None,
    step: float = 0.01,
) -> dict:
    """Matriz de valor/acción variando WACC (filas) y crecimiento (columnas)
    en ±2 puntos. Enseña qué tan sensible es el resultado a cada supuesto —
    si la matriz se mueve mucho, el número central vale poco."""
    rates = [round(discount_rate + i * step, 6) for i in range(-2, 3)]
    growths = [round(growth_rate + i * step, 6) for i in range(-2, 3)]
    rows = []
    for r in rates:
        cells: list[float | None] = []
        for g in growths:
            if r <= terminal_growth:
                cells.append(None)  # combinación inválida: terminal diverge
                continue
            result = dcf(
                base_fcf, g, r, terminal_growth, years, net_debt, shares_outstanding
            )
            # Solo valor por acción. Con `value_per_share or equity_value`, sin
            # acciones la matriz «valor/acción» se llenaba con el valor total de
            # la empresa, en miles de millones (M4, hermano de P0-9); y un 0,0
            # por acción, *falsy*, también saltaba al total.
            cells.append(result["value_per_share"])
        rows.append({"discount_rate": r, "values": cells})
    return {"growth_rates": growths, "rows": rows}


def scenario_set(
    scenarios: dict[str, dict],
    base_fcf: float,
    years: int,
    net_debt: float,
    shares_outstanding: float | None,
) -> dict:
    """Evalúa bajista/base/alcista con un DCF por escenario. `scenarios` mapea
    nombre -> {growth_rate, discount_rate, terminal_growth}."""
    out = {}
    for name, assumptions in scenarios.items():
        result = dcf(
            base_fcf=base_fcf,
            growth_rate=assumptions["growth_rate"],
            discount_rate=assumptions["discount_rate"],
            terminal_growth=assumptions["terminal_growth"],
            years=years,
            net_debt=net_debt,
            shares_outstanding=shares_outstanding,
        )
        out[name] = {
            "assumptions": result["assumptions"],
            "value_per_share": result["value_per_share"],
            "equity_value": result["equity_value"],
            "terminal_weight": result["terminal_weight"],
            # Si no hay valor por acción, el porqué viaja con el hueco. Un «—»
            # sin motivo se lee como fallo de la app; con motivo, como lo que es.
            "indeterminado": bool(result.get("indeterminado")),
            "faltan": result.get("faltan", []),
            "motivo": result.get("motivo"),
        }
    return out


# ---------------------------------------------------------------------------
# Rangos, no números
# ---------------------------------------------------------------------------
#
# El docstring de este módulo decía que el DCF «nunca devuelve el precio
# objetivo, devuelve un valor por escenario». Eso era hacer trampa con las
# palabras: tres escenarios con un valor puntual cada uno son TRES precios
# objetivo, no un rango. Y un «147,32 $» comunica una precisión que el método no
# tiene ni de lejos — mover el WACC un cuarto de punto lo cambia más que esos
# céntimos.
#
# Así que aquí un escenario produce un RANGO, construido perturbando sus propios
# supuestos dentro de una banda declarada, y los números se redondean a las
# cifras significativas que el método aguanta.

BANDA_CRECIMIENTO = 0.02   # ±2 puntos porcentuales
BANDA_DESCUENTO = 0.01     # ±1 punto porcentual
CIFRAS_SIGNIFICATIVAS = 3


def redondear(valor: float | None, cifras: int = CIFRAS_SIGNIFICATIVAS) -> float | None:
    """Redondea a cifras significativas, no a decimales.

    Un DCF que imprime «147,32 $» finge una precisión de céntimos sobre un
    método donde mover el WACC un cuarto de punto cambia el resultado en varios
    euros. Redondear a tres cifras significativas —147 $, o 1.470 $ si es una
    empresa cara— es decir la verdad sobre lo que se sabe.
    """
    if valor is None or valor == 0:
        return valor
    return float(f"%.{cifras}g" % valor)


def rango_de_valor(
    base_fcf: float,
    growth_rate: float,
    discount_rate: float,
    terminal_growth: float,
    years: int = 5,
    net_debt: float = 0.0,
    shares_outstanding: float | None = None,
    banda_crecimiento: float = BANDA_CRECIMIENTO,
    banda_descuento: float = BANDA_DESCUENTO,
) -> dict:
    """El rango de valor compatible con estos supuestos, no un punto.

    Se evalúan las esquinas de la banda alrededor de los supuestos centrales.
    El resultado dice, además, **cuánto de ancho** es el rango respecto a su
    centro: un rango de ±40 % no es una valoración, es un aviso de que el
    método no discrimina en este caso, y merece leerse como tal.
    """
    # Sin deuda o sin acciones no hay valor por acción, y NO se sustituye por
    # el valor total del equity. Antes se hacía (`valor or equity_value`), y el
    # «rango» salía en miles de millones en los mismos campos que normalmente
    # llevan dólares por acción: una mezcla de unidades sin aviso.
    faltan = datos.faltantes({"deuda neta": net_debt, "acciones en circulación": shares_outstanding})
    if not faltan and (datos.numero(shares_outstanding) or 0) <= 0:
        faltan = ["acciones en circulación"]
    if faltan:
        return {"disponible": False, "faltan": faltan,
                "nota": datos.indeterminado(faltan, "un valor por acción")["motivo"]}

    combinaciones = []
    for g in (growth_rate - banda_crecimiento, growth_rate, growth_rate + banda_crecimiento):
        for r in (
            discount_rate - banda_descuento,
            discount_rate,
            discount_rate + banda_descuento,
        ):
            if r <= terminal_growth:
                continue  # el valor terminal diverge: combinación sin sentido
            resultado = dcf(
                base_fcf, g, r, terminal_growth, years, net_debt, shares_outstanding
            )
            if resultado["value_per_share"] is not None:
                combinaciones.append(resultado["value_per_share"])

    # El centro se comprueba aparte, y no es redundante: la banda puede tener
    # esquinas válidas mientras el punto central NO lo es (descuento 3 % con
    # terminal 3,5 %: la esquina de +1 pp sí vale, el centro no). Calcularlo sin
    # mirar reventaba con un ValueError desde dentro del `dcf` en vez de decir
    # qué supuesto estaba mal.
    if not combinaciones or discount_rate <= terminal_growth:
        return {
            "disponible": False,
            "nota": (
                f"La tasa de descuento ({fmt_pct(discount_rate)}) no supera al "
                f"crecimiento a perpetuidad ({fmt_pct(terminal_growth)}), así que "
                "el valor terminal sería infinito. No es un fallo de cálculo: es un "
                "supuesto que dice que la empresa crece más rápido que el coste del "
                "dinero para siempre."
            ),
        }

    centro = dcf(
        base_fcf, growth_rate, discount_rate, terminal_growth, years, net_debt,
        shares_outstanding,
    )
    valor_centro = centro["value_per_share"]
    bajo, alto = min(combinaciones), max(combinaciones)
    amplitud = (alto - bajo) / valor_centro if valor_centro else None

    return {
        "disponible": True,
        "bajo": redondear(bajo),
        "centro": redondear(valor_centro),
        "alto": redondear(alto),
        "amplitud_pct": round(amplitud * 100, 1) if amplitud is not None else None,
        "banda": {
            "crecimiento_pp": round(banda_crecimiento * 100, 2),
            "descuento_pp": round(banda_descuento * 100, 2),
        },
        "peso_terminal": (
            round(centro["terminal_weight"], 3) if centro["terminal_weight"] else None
        ),
        "nota": _leer_amplitud(amplitud, centro["terminal_weight"]),
    }


def _leer_amplitud(amplitud: float | None, peso_terminal: float | None) -> str:
    partes = []
    if amplitud is not None:
        if amplitud > 0.6:
            partes.append(
                f"El rango abarca un {fmt_pct(amplitud, 0)} del valor central: con "
                "esta sensibilidad el DCF no discrimina entre «cara» y «barata». "
                "Sirve para entender el negocio, no para decidir el precio."
            )
        elif amplitud > 0.3:
            partes.append(
                f"El rango abarca un {fmt_pct(amplitud, 0)} del valor central. Es "
                "lo normal en un DCF; el número del medio no es más cierto que "
                "los extremos."
            )
        else:
            partes.append(
                f"Rango estrecho ({fmt_pct(amplitud, 0)} del centro), lo que suele "
                "significar que el peso del valor terminal es bajo o que la banda "
                "de supuestos es corta."
            )
    if peso_terminal and peso_terminal > 0.7:
        partes.append(
            f"El {fmt_pct(peso_terminal, 0)} del valor está en el valor terminal, "
            "o sea en lo que pasa después del horizonte proyectado. Esto no es "
            "una valoración de los próximos años: es una apuesta sobre la "
            "perpetuidad con unos años de detalle delante."
        )
    return " ".join(partes)


# ---------------------------------------------------------------------------
# Qué supuesto mueve más el resultado
# ---------------------------------------------------------------------------

# Cuánto se perturba cada supuesto para medir su influencia. Son magnitudes
# COMPARABLES a propósito —un punto porcentual de WACC contra un punto de
# crecimiento— para que el orden signifique algo. Perturbar cada uno un 10 % de
# su valor daría un orden distinto y engañoso: un 10 % de un WACC del 9 % es
# 0,9 pp, y un 10 % de un crecimiento del 3 % es 0,3 pp.
PERTURBACIONES = {
    "growth_rate": (0.01, "Crecimiento del FCF (+/- 1 pp)"),
    "discount_rate": (0.01, "Tasa de descuento / WACC (+/- 1 pp)"),
    "terminal_growth": (0.005, "Crecimiento a perpetuidad (+/- 0,5 pp)"),
    "base_fcf": (None, "Flujo de caja de partida (+/- 10\u00a0%)"),
}


def sensibilidad_ordenada(
    base_fcf: float,
    growth_rate: float,
    discount_rate: float,
    terminal_growth: float,
    years: int = 5,
    net_debt: float = 0.0,
    shares_outstanding: float | None = None,
) -> dict:
    """Qué supuesto mueve más el resultado, ordenado de mayor a menor.

    La matriz de sensibilidad clásica cruza dos supuestos y deja fuera al
    resto — entre ellos el crecimiento a perpetuidad, que en muchas empresas es
    el que más manda porque el valor terminal se lleva tres cuartas partes del
    total. Esto los perturba de uno en uno y los ordena.

    Se perturba **arriba y abajo** y se reporta el recorrido completo: un
    supuesto puede mover mucho hacia un lado y poco hacia el otro, y quedarse
    con una sola dirección esconde precisamente esa asimetría.
    """
    supuestos = {
        "base_fcf": base_fcf,
        "growth_rate": growth_rate,
        "discount_rate": discount_rate,
        "terminal_growth": terminal_growth,
    }

    def valorar(**cambios) -> float | None:
        s = {**supuestos, **cambios}
        if s["discount_rate"] <= s["terminal_growth"]:
            return None
        r = dcf(
            s["base_fcf"], s["growth_rate"], s["discount_rate"], s["terminal_growth"],
            years, net_debt, shares_outstanding,
        )
        # Por acción o nada, como la matriz de arriba (M4): el `or equity_value`
        # mezclaba unidades sin acciones y con un 0,0 por acción.
        return r["value_per_share"]

    centro = valorar()
    if centro is None or centro == 0:
        return {"disponible": False, "nota": "Los supuestos centrales no producen un valor."}

    filas = []
    for clave, (delta, etiqueta) in PERTURBACIONES.items():
        paso = delta if delta is not None else supuestos[clave] * 0.10
        if paso == 0:
            continue
        abajo = valorar(**{clave: supuestos[clave] - paso})
        arriba = valorar(**{clave: supuestos[clave] + paso})
        if abajo is None and arriba is None:
            continue
        valores = [v for v in (abajo, arriba) if v is not None]
        recorrido = max(valores) - min(valores) if len(valores) > 1 else abs(valores[0] - centro)
        filas.append(
            {
                "supuesto": clave,
                "etiqueta": etiqueta,
                "valor_actual": supuestos[clave],
                "perturbacion": paso,
                "valor_abajo": redondear(abajo),
                "valor_arriba": redondear(arriba),
                "recorrido": redondear(recorrido),
                "recorrido_pct": round(recorrido / centro * 100, 1),
                # La asimetría importa: si bajar el crecimiento un punto quita
                # 30 $ y subirlo solo añade 18 $, el riesgo no es simétrico y el
                # escenario central está más cerca del techo que del suelo.
                "asimetrico": (
                    abs((arriba - centro) - (centro - abajo)) / recorrido > 0.25
                    if abajo is not None and arriba is not None and recorrido
                    else None
                ),
            }
        )

    filas.sort(key=lambda f: -f["recorrido_pct"])
    dominante = filas[0] if filas else None
    return {
        "disponible": True,
        "centro": redondear(centro),
        "supuestos": filas,
        "dominante": dominante["supuesto"] if dominante else None,
        "nota": (
            f"El supuesto que más mueve el resultado es «{dominante['etiqueta']}»: "
            f"su banda cambia el valor un {fmt_pct(dominante['recorrido_pct'], 0, en_puntos=True)}. "
            "Es donde merece la pena discutir, y donde una tesis se sostiene o se "
            "cae — no en el segundo decimal del resultado."
            if dominante
            else "No se pudo medir la sensibilidad de ningún supuesto."
        ),
    }


# ---------------------------------------------------------------------------
# El DCF de la app: cimientos, supuestos de partida, escenarios y rango global
# ---------------------------------------------------------------------------
#
# Antes vivía en `routers/valuation.py`, y el informe completo importaba de un
# router el supuesto del 3 % para hacerse su propio DCF con otros WACC. Aquí lo
# leen el módulo Valoración, el resumen de la ficha y el informe (ítem 3.3).

# Supuestos de partida de cada escenario. Son un PUNTO DE ARRANQUE editable, no
# una opinión de la app: el crecimiento sale del histórico de la propia empresa y
# los WACC son el rango habitual para una cotizada grande. Todo esto viaja en la
# respuesta para que se pueda discutir y cambiar.
FACTOR_CRECIMIENTO = {"bajista": 0.4, "base": 1.0, "alcista": 1.5}
DESCUENTO = {"bajista": 0.11, "base": 0.09, "alcista": 0.08}
TERMINAL = {"bajista": 0.015, "base": 0.025, "alcista": 0.030}
# Lo que se supone cuando no hay crecimiento histórico utilizable. Viaja
# SIEMPRE declarado como supuesto: es el parámetro que más mueve un DCF.
CRECIMIENTO_SUPUESTO = 0.03
CRECIMIENTO_MAXIMO = 0.15  # el pasado no se extrapola alegremente
# Lo mínimo que se propone, y lo mínimo que admite «Recalcular» (el validador
# del módulo lee esta misma constante). Sin suelo, un FCF que cae a la mitad en
# un año (−50 % medido) proponía un bajista del −75 % que el propio módulo
# rechazaba con un 422 al recalcular sin tocar nada; y por debajo de −100 % el
# FCF cambia de signo cada año, y una empresa con caja y sin deuda salía con un
# rango negativo (revisión 15, H3).
CRECIMIENTO_MINIMO = -0.5
ANOS = 5
ESCENARIOS = ("bajista", "base", "alcista")


def cimientos(periodos: list[dict]) -> dict:
    """Las entradas del DCF que salen del último ejercicio, con lo que falta dicho.

    Una sola versión para el módulo y el informe: el informe sumaba la deuda con
    `total_debt` y no decía que fuera parcial (M5).
    """
    ultimo = periodos[-1]
    deuda_d = deuda_total(ultimo)
    deuda = deuda_d["valor"]
    return {
        "base_fcf": free_cash_flow(ultimo),
        # Deuda desconocida viaja como None, NUNCA como 0.0: con cero, una
        # empresa sobre la que no sabemos la deuda se valoraba como si no debiera
        # nada (+95 % en el caso de la auditoría). La caja ausente sí se toma
        # como cero, porque ese error va en dirección prudente: sube la deuda
        # neta y BAJA el valor.
        "net_debt": (deuda - (datos.numero(ultimo.get("cash")) or 0.0)) if deuda is not None else None,
        # Con una sola pata de deuda, la otra cuenta como cero: se dice.
        "deuda_parcial": deuda_d["falta"] if deuda_d["parcial"] else None,
        "shares_outstanding": ultimo.get("shares_outstanding"),
        "revenue": ultimo.get("revenue"),
        "eps": ultimo.get("eps_diluted"),
        "crecimiento": growth_summary(periodos),
        "fiscal_year": ultimo.get("fiscal_year"),
    }


def escenarios_por_defecto(crecimiento: dict) -> dict[str, dict]:
    """Propone bajista/base/alcista desde el crecimiento histórico real.

    Se acota al 15 %: extrapolar a perpetuidad el mejor quinquenio de una empresa
    es el error más común del DCF casero, y el que más caro sale.
    """
    # Dos fallos vivían en el `or` encadenado que había aquí.
    #
    # Uno: un crecimiento ausente se convertía en un 3 % que nunca se declaraba
    # como supuesto, así que en pantalla no había forma de distinguir «crece al
    # 3 % según sus cuentas» de «no sabemos cuánto crece y hemos puesto un 3 %».
    #
    # Dos, y más sutil: `0.0` es *falsy*, así que una empresa con crecimiento
    # real de cero caía también en el 3 %. Justo la empresa estancada —el caso
    # en que el DCF más se equivoca— se valoraba como si creciera.
    medido = datos.numero(crecimiento.get("fcf_cagr"))
    if medido is None:
        medido = datos.numero(crecimiento.get("revenue_cagr"))
    supuesto = medido is None
    historico = CRECIMIENTO_SUPUESTO if supuesto else medido

    # El suelo en 0 se mantiene solo para el escenario base hacia arriba: un
    # crecimiento negativo medido SÍ se respeta, porque una empresa en
    # contracción es un dato, no un error que haya que corregir.
    base = min(historico, CRECIMIENTO_MAXIMO)
    # Con un crecimiento negativo los factores van al revés: el bajista es el
    # que MÁS encoge. Aplicados tal cual, un −5 % medido daba un bajista del
    # −2 % y un alcista del −7,5 %: los nombres invertidos (M5).
    factores = (
        FACTOR_CRECIMIENTO if base >= 0
        else {**FACTOR_CRECIMIENTO, "bajista": FACTOR_CRECIMIENTO["alcista"],
              "alcista": FACTOR_CRECIMIENTO["bajista"]}
    )
    motivo = (
        f"No hay crecimiento histórico utilizable (ni FCF ni ingresos): se SUPONE "
        f"un {fmt_pct(CRECIMIENTO_SUPUESTO, 0)} anual. Es un supuesto, no un dato "
        "de la empresa, y mueve el valor más que casi ningún otro."
        if supuesto
        else None
    )
    salida = {}
    for nombre in ESCENARIOS:
        propuesto = base * factores[nombre]
        # El suelo se declara en `procedencia` del escenario que lo toca: el
        # crecimiento que se ve ya no es el medido por su factor, y eso se dice.
        acotado = propuesto < CRECIMIENTO_MINIMO
        salida[nombre] = {
            "growth_rate": round(min(max(propuesto, CRECIMIENTO_MINIMO), CRECIMIENTO_MAXIMO), 4),
            "discount_rate": DESCUENTO[nombre],
            "terminal_growth": TERMINAL[nombre],
            "supuesto": supuesto,
            "motivo": (
                f"Con el crecimiento medido ({fmt_pct(historico)} anual) este escenario "
                f"propondría un {fmt_pct(propuesto)}: se acota al {fmt_pct(CRECIMIENTO_MINIMO, 0)}, "
                "lo mínimo que admite el cálculo. Una caída así, sostenida, suele decir más "
                "del FCF de partida (un año malo) que del negocio."
                if acotado
                else motivo
            ),
        }
    return salida


def supuestos_con_procedencia(
    crecimiento: dict, recibidos: dict[str, dict] | None = None
) -> dict[str, dict]:
    """Los supuestos con que se valora, cada uno con la procedencia de su crecimiento.

    Sin `recibidos`, los que propone la app. Con ellos mandan los recibidos (es
    tu tesis, no la suya), pero un crecimiento que la app SUPUSO a falta de
    histórico sigue siendo un supuesto aunque vuelva en el cuerpo: «Recalcular
    con mis supuestos» reenvía los propuestos, y en cuanto se escribía la deuda
    neta en «Tus entradas» el 3 % dejaba de decirse y volvía a tener cara de
    dato (revisión 15, H7). Lo mismo con el suelo del −50 %: si el escenario
    vuelve con el crecimiento acotado, se sigue diciendo por qué.
    """
    propuestos = escenarios_por_defecto(crecimiento)
    if not recibidos:
        return propuestos
    salida = {}
    for nombre, s in recibidos.items():
        p = propuestos.get(nombre)
        mismo = p is not None and math.isclose(s["growth_rate"], p["growth_rate"], rel_tol=0.0, abs_tol=1e-9)
        salida[nombre] = {
            **s,
            "supuesto": bool(mismo and p["supuesto"]),
            "motivo": p["motivo"] if mismo else None,
        }
    return salida


def escenarios_con_rango(
    supuestos: dict[str, dict],
    base_fcf: float,
    net_debt: float | None,
    acciones: float | None,
    years: int = ANOS,
) -> dict[str, dict]:
    """Cada escenario con su RANGO (`rango_de_valor`), no un valor puntual.

    El caso «descuento por debajo del terminal» lo resuelve `rango_de_valor`, y
    aquí no se repite: había un guardián duplicado con su propio texto, más
    pobre, que además ganaba por llegar antes. Dos sitios explicando lo mismo
    con palabras distintas es como acaban diciendo cosas distintas.
    """
    # `supuesto`/`motivo` describen DE DÓNDE sale el crecimiento, no son
    # parámetros del DCF. Viajan al lado, en `procedencia`, para que la pantalla
    # pueda distinguir «crece al 3 % según sus cuentas» de «no sabemos cuánto
    # crece y hemos puesto un 3 %» — que es la diferencia que importa.
    meta = ("supuesto", "motivo")
    return {
        nombre: {
            "supuestos": {k: v for k, v in s.items() if k not in meta},
            "procedencia": {
                "crecimiento_supuesto": bool(s.get("supuesto")),
                "motivo": s.get("motivo"),
            },
            "rango": rango_de_valor(
                base_fcf, s["growth_rate"], s["discount_rate"], s["terminal_growth"],
                years, net_debt, acciones,
            ),
        }
        for nombre, s in supuestos.items()
    }


def rango_global(escenarios: dict[str, dict], precio: float | None) -> dict | None:
    """De lo más bajo de lo más pesimista a lo más alto de lo más optimista.

    Es el número que se enseña primero, y es un intervalo.
    """
    todos = [
        e["rango"] for e in escenarios.values()
        if e["rango"].get("disponible") and e["rango"].get("bajo") is not None
    ]
    if not todos:
        return None
    global_ = {
        "bajo": redondear(min(r["bajo"] for r in todos)),
        "alto": redondear(max(r["alto"] for r in todos)),
        "precio_actual": precio,
    }
    # La anchura del rango global es tan informativa como el rango. Tres
    # escenarios que van de 133 a 577 no dicen «vale entre 133 y 577»: dicen
    # que con estos supuestos el método no distingue, y eso hay que leerlo
    # antes que los números, no después.
    factor = global_["alto"] / global_["bajo"] if global_["bajo"] else None
    global_["factor"] = round(factor, 2) if factor else None
    global_["nota"] = (
        f"Del escenario más pesimista al más optimista hay un factor de "
        f"{fmt_num(factor, 1)}×. Un rango así no sirve para decidir un precio de "
        "entrada; sirve para ver qué supuestos lo abren tanto — mira abajo "
        "cuál manda. Estrecharlo exige defender supuestos más ceñidos, no "
        "quedarse con el del medio."
        if factor and factor >= 2
        else (
            f"El rango va de {fmt_valor_redondo(global_['bajo'])} a {fmt_valor_redondo(global_['alto'])} (factor "
            f"{fmt_num(factor, 1)}×). Ningún punto de dentro es más cierto que otro."
            if factor
            else ""
        )
    )
    if precio:
        global_["posicion"] = (
            "dentro" if global_["bajo"] <= precio <= global_["alto"]
            else "por encima" if precio > global_["alto"]
            else "por debajo"
        )
    return global_
