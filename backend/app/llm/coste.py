"""Cuánto cuesta una llamada al API de Claude: antes de hacerla y después.

Vivía en `routers/earnings.py`, el primer uso que enseñó el coste antes de
gastar. «Pregúntale a la IA» necesita la misma cuenta con la misma tarifa, y una
segunda copia en otro router acabaría con dos tarifas distintas para el mismo
modelo; ahora hay una, y el router de resultados la importa.
"""

from __future__ import annotations

from app.formato import fmt_num

# Tarifa del API de Claude en USD por millón de tokens (entrada, salida), para
# enseñar el coste ANTES de gastarlo. Antes era una sola, la de Opus 5, escrita
# a mano aunque el modelo fuera otro. Un modelo que no está aquí no tiene
# estimación: inventarle un precio sería peor que decir que no se sabe.
TARIFAS_USD_POR_MTOK = {
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
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


def coste_real(uso: dict | None, modelo: str | None) -> dict:
    """Lo que costó una respuesta, con los tokens que el API dice que gastó.

    Sin el recuento del API (un proveedor que no lo da) el coste queda `None` y
    se dice: «no se sabe» no es «gratis».
    """
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
