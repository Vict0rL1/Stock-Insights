"""Cuánto cuesta una llamada al API de Claude: antes de hacerla y después.

Vivía en `routers/earnings.py`, el primer uso que enseñó el coste antes de
gastar. «Pregúntale a la IA» necesita la misma cuenta con la misma tarifa, y una
segunda copia en otro router acabaría con dos tarifas distintas para el mismo
modelo; ahora hay una, y el router de resultados la importa.
"""

from __future__ import annotations

from app.formato import fmt_dinero, fmt_num, plural

# Tarifa del API de Claude en USD por millón de tokens (entrada, salida), para
# enseñar el coste ANTES de gastarlo. Antes era una sola, la de Opus 5, escrita
# a mano aunque el modelo fuera otro. Un modelo que no está aquí no tiene
# estimación: inventarle un precio sería peor que decir que no se sabe.
#
# Sonnet 5 y Opus 4.8 son los modelos de respaldo del servidor (`fallbacks:
# "default"`) de Sonnet 5.5 y de los Opus: sin su tarifa, toda respuesta servida
# por el respaldo con el modelo por defecto salía con `usd: None` (revisión 15,
# H5). Las cinco, de la tabla de precios oficial del API de Anthropic (consultada
# el 2026-11-25), no deducidas de otro modelo.
TARIFAS_USD_POR_MTOK = {
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4-8": (5.0, 25.0),
}


def _tarifa(entrada: float, salida: float) -> str:
    return (f"{fmt_num(entrada, 2, ceros=False)} USD/M entrada, "
            f"{fmt_num(salida, 2, ceros=False)} USD/M salida")


def coste_estimado(entrada: int | None, modelo: str | None, salida: int = 4000, motivo: str | None = None) -> dict:
    """El coste ANTES de llamar: tokens de entrada contados por el API y los de
    salida supuestos (`salida`), que el texto dice."""
    if entrada is None:
        return {
            "tokens_entrada": None,
            "usd_estimado": None,
            "nota": f"{motivo} El coste no se puede estimar de antemano." if motivo else
                    "No se pudieron contar los tokens; el coste no se puede estimar de antemano.",
        }
    tarifa = TARIFAS_USD_POR_MTOK.get(modelo or "")
    if tarifa is None:
        return {
            "tokens_entrada": entrada,
            "usd_estimado": None,
            "nota": (
                f"~{fmt_num(entrada, 0)} tokens de entrada. No hay tarifa conocida para el modelo "
                f"{modelo or 'configurado'}: el coste no se puede estimar de antemano."
            ),
        }
    usd = entrada / 1e6 * tarifa[0] + salida / 1e6 * tarifa[1]
    return {
        "tokens_entrada": entrada,
        "usd_estimado": round(usd, 4),
        "nota": (
            f"~{fmt_num(entrada, 0)} tokens de entrada. Estimación a la tarifa de {modelo} "
            f"({_tarifa(*tarifa)}), asumiendo ~{fmt_num(salida, 0)} tokens de salida."
        ),
    }


def _coste_por_intentos(intentos: list[dict], modelo: str | None) -> dict:
    """La respuesta que dio un modelo de respaldo: la suma de cada intento, a la
    tarifa del modelo que lo hizo (`anthropic_provider._uso`).

    Un intento que declinó ANTES de escribir nada (salida 0) solo se cobra en
    algunas categorías de rechazo, y la categoría no viaja en el recuento: se
    suma igual y se dice que el coste puede ser menor. Contar de más y decirlo es
    mejor que enseñar como «lo que costó» solo el último intento."""
    if any(i.get("entrada") is None or i.get("salida") is None for i in intentos):
        return {"tokens_entrada": None, "tokens_salida": None, "usd": None,
                "nota": "El API no dio el recuento de tokens de todos los intentos de esta respuesta "
                        "(contestó un modelo de respaldo): su coste no se conoce."}
    entrada = sum(i["entrada"] for i in intentos)
    salida = sum(i["salida"] for i in intentos)
    declinaron = [i for i in intentos if i.get("tipo") == "message"]
    quien = next((i.get("modelo") for i in intentos if i.get("tipo") == "fallback_message"), None) or modelo
    gasto = (f"{fmt_num(len(intentos), 0)} intentos, {fmt_num(entrada, 0)} tokens de entrada y "
             f"{fmt_num(salida, 0)} de salida en total")
    contexto = (
        f"Contestó el modelo de respaldo {quien or 'desconocido'} porque "
        f"{', '.join(i.get('modelo') or 'un modelo desconocido' for i in declinaron)} "
        f"{plural(len(declinaron), 'declinó', 'declinaron')} la petición"
        if declinaron else f"Contestó directamente el modelo de respaldo {quien or 'desconocido'}"
    )
    sin_tarifa = sorted({i.get("modelo") or "desconocido" for i in intentos
                         if TARIFAS_USD_POR_MTOK.get(i.get("modelo") or "") is None})
    if sin_tarifa:
        return {"tokens_entrada": entrada, "tokens_salida": salida, "usd": None,
                "nota": f"{contexto}: {gasto}. No hay tarifa conocida para {', '.join(sin_tarifa)}: "
                        "el coste en dólares no se puede calcular."}
    usd = sum(i["entrada"] / 1e6 * TARIFAS_USD_POR_MTOK[i["modelo"]][0]
              + i["salida"] / 1e6 * TARIFAS_USD_POR_MTOK[i["modelo"]][1] for i in intentos)
    sin_salida = sum(1 for i in declinaron if i["salida"] == 0)
    return {
        "tokens_entrada": entrada,
        "tokens_salida": salida,
        "usd": round(usd, 4),
        "nota": f"{contexto}: {gasto}, cada intento a la tarifa de su modelo."
        + (f" Incluye {plural(sin_salida, 'un intento', f'{fmt_num(sin_salida, 0)} intentos')} "
           f"{plural(sin_salida, 'declinado', 'declinados')} antes de escribir nada, que el API solo cobra "
           "en algunas categorías de rechazo: lo cobrado puede ser menos." if sin_salida else ""),
    }


def coste_real(uso: dict | None, modelo: str | None) -> dict:
    """Lo que costó una respuesta, con los tokens que el API dice que gastó.

    Sin el recuento del API (un proveedor que no lo da) el coste queda `None` y
    se dice: «no se sabe» no es «gratis». Si contestó un modelo de respaldo, el
    recuento de arriba es solo el de su intento: se suman todos (`intentos`).
    """
    if (uso or {}).get("intentos"):
        return _coste_por_intentos(uso["intentos"], modelo)
    entrada = (uso or {}).get("entrada")
    salida = (uso or {}).get("salida")
    if entrada is None or salida is None:
        return {"tokens_entrada": entrada, "tokens_salida": salida, "usd": None,
                "nota": "El API no dio el recuento de tokens de esta respuesta: su coste no se conoce."}
    tarifa = TARIFAS_USD_POR_MTOK.get(modelo or "")
    gasto = f"{fmt_num(entrada, 0)} tokens de entrada y {fmt_num(salida, 0)} de salida"
    if tarifa is None:
        return {"tokens_entrada": entrada, "tokens_salida": salida, "usd": None,
                "nota": f"{gasto}. No hay tarifa conocida para el modelo {modelo or 'configurado'}: "
                        "el coste en dólares no se puede calcular."}
    return {
        "tokens_entrada": entrada,
        "tokens_salida": salida,
        "usd": round(entrada / 1e6 * tarifa[0] + salida / 1e6 * tarifa[1], 4),
        "nota": f"{gasto}, a la tarifa de {modelo} ({_tarifa(*tarifa)}).",
    }


def coste_declinado(uso: dict | None, modelo: str | None) -> dict:
    """Lo que pudo costar una petición que el modelo declinó entera: el modelo
    pedido y, con el respaldo del servidor, también el de respaldo.

    Esa petición no trae respuesta, pero se paga: un intento que declina a mitad
    se cobra a tarifa normal, y uno que declina antes de escribir nada, en
    algunas categorías de rechazo. Antes el uso se tiraba con la respuesta y el
    502 decía solo «El modelo declinó…»: el coste estimado se había enseñado
    antes de enviar y el real desaparecía, y repetir la pregunta volvía a pagar
    sin aviso (revisión 15, H6). Se suma cada intento de `usage.iterations` a la
    tarifa de su modelo, como en `_coste_por_intentos`; sin recuento, `None` y
    que pudo cobrarse: «no se sabe» no es «gratis»."""
    uso = uso or {}
    intentos = uso.get("intentos") or [
        {"tipo": "message", "modelo": modelo, "entrada": uso.get("entrada"), "salida": uso.get("salida")}
    ]
    n = len(intentos)
    cuantos = plural(n, "un intento", f"{fmt_num(n, 0)} intentos")
    aviso = " Repetir la pregunta vuelve a gastar."
    if any(i.get("entrada") is None or i.get("salida") is None for i in intentos):
        return {"tokens_entrada": None, "tokens_salida": None, "usd": None,
                "nota": f"Pudo cobrarse ({cuantos}), pero el API no dio el recuento de tokens: no se sabe "
                        f"cuánto.{aviso}"}
    entrada = sum(i["entrada"] for i in intentos)
    salida = sum(i["salida"] for i in intentos)
    gasto = (f"{cuantos} ({', '.join(i.get('modelo') or 'un modelo desconocido' for i in intentos)}), "
             f"{fmt_num(entrada, 0)} tokens de entrada y {fmt_num(salida, 0)} de salida")
    sin_tarifa = sorted({i.get("modelo") or "desconocido" for i in intentos
                         if TARIFAS_USD_POR_MTOK.get(i.get("modelo") or "") is None})
    if sin_tarifa:
        return {"tokens_entrada": entrada, "tokens_salida": salida, "usd": None,
                "nota": f"Lo gastado en la petición declinada: {gasto}. No hay tarifa conocida para "
                        f"{', '.join(sin_tarifa)}: el coste en dólares no se puede calcular.{aviso}"}
    usd = sum(i["entrada"] / 1e6 * TARIFAS_USD_POR_MTOK[i["modelo"]][0]
              + i["salida"] / 1e6 * TARIFAS_USD_POR_MTOK[i["modelo"]][1] for i in intentos)
    sin_salida = sum(1 for i in intentos if i["salida"] == 0)
    return {
        "tokens_entrada": entrada,
        "tokens_salida": salida,
        "usd": round(usd, 4),
        "nota": f"Lo gastado en la petición declinada: {gasto}, {'como mucho ' if sin_salida else ''}"
                f"{fmt_dinero(usd, 'USD', 4)} a la tarifa de cada modelo."
        + (f" {plural(sin_salida, 'Un intento declinó', f'{fmt_num(sin_salida, 0)} intentos declinaron')} antes "
           "de escribir nada, y eso el API solo lo cobra en algunas categorías de rechazo: lo cobrado puede ser "
           "menos." if sin_salida else "")
        + aviso,
    }
