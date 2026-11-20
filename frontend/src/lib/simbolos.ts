/**
 * Finnhub puede mandar en `related` varios tickers separados por comas
 * («AAPL,MSFT»), o una cadena vacía. La API valida un solo ticker por campo,
 * así que mandar `related` tal cual convertía «¿Por qué importa?» en un 422.
 * Se manda el primero; si no hay ninguno, `null`.
 */
export function primerSimbolo(texto: string | null | undefined): string | null {
  return (texto ?? '').split(',').map((s) => s.trim()).find(Boolean) ?? null
}

/**
 * Los tickers de una lista escrita a mano, en mayúsculas, sin repetir y hasta
 * `max`; los que no caben, aparte, para decirlo. Antes un `.slice(0, 4)` los
 * descartaba sin avisar: con «VOO, QQQ, VTI» de valor inicial y tres más
 * tecleados, TOTX desaparecía y la pantalla no lo nombraba (revisión 12,
 * visual). Un repetido no ocupa sitio: dejaría fuera a otro distinto.
 */
export function listaDeSimbolos(texto: string, max: number): { simbolos: string[]; descartados: string[] } {
  const todos = [...new Set(texto.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))]
  return { simbolos: todos.slice(0, max), descartados: todos.slice(max) }
}
