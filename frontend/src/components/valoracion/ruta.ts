import { RUTAS } from '../../lib/rutas'

/**
 * El enlace al módulo de valoración completo con una empresa ya elegida (ítem 3.3).
 *
 * La pestaña Valoración de la ficha y el informe enseñan un resumen del único
 * DCF y llevan al módulo con el símbolo, que lo valora al abrir. Un solo sitio
 * construye esa URL y uno solo la lee (`PARAM_SIMBOLO`, en `ValuationPage`): si
 * cambia el nombre del parámetro en uno y no en el otro, el módulo se abriría en
 * blanco sin que nada fallara.
 *
 * El módulo vive en `/avanzado/valoracion` (`RUTAS.valoracion`, `lib/rutas.ts`);
 * `/valoracion?…`, la ruta vieja, redirige ahí conservando la consulta.
 */
export const RUTA_VALORACION = RUTAS.valoracion

/** `?simbolo=ACME`: lo que el módulo lee para valorar al abrir. */
export const PARAM_SIMBOLO = 'simbolo'

export function rutaValoracion(symbol: string): string {
  return `${RUTA_VALORACION}?${new URLSearchParams({ [PARAM_SIMBOLO]: symbol.trim().toUpperCase() }).toString()}`
}
