/** Un número escrito por una persona, con la convención de la app: coma
 *  decimal y punto de miles («1.250,5»), o punto decimal si no hay duda
 *  («12.5»). Lo que no sea un número sin ambigüedad es `null`, nunca un número
 *  a medias: `parseFloat('12,5')` daba 12 y «1.250» se guardaba como 1,25 sin
 *  aviso, y `Number('')` daba 0 y un umbral vacío se guardaba como «0 %»
 *  (segunda revisión del 2.1). */
export function leerNumero(texto: string): number | null {
  const t = texto.trim()
  const signo = t.startsWith('-') ? -1 : 1
  const s = t.replace(/^-/, '')
  // Coma decimal, con o sin puntos de miles bien agrupados: «12,5», «,5»,
  // «1.250,5», «1.250». Un grupo de miles no empieza por 0: «0.125» no son
  // ciento veinticinco (lo eran, tercera pasada).
  if (/^\d*,\d+$/.test(s) || /^\d+$/.test(s) || /^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s)) {
    return signo * Number(s.replace(/\./g, '').replace(',', '.'))
  }
  // Punto decimal: «12.5», «.5», «0.125». («12.500» ya se leyó arriba como
  // miles, como la app lo escribe.)
  if (/^\d*\.\d+$/.test(s)) return signo * Number(s)
  return null
}
