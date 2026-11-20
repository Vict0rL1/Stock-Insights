import { fmtNum } from './formato'

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

/** Un número en un campo que una persona va a editar, escrito como lo escribe
 *  la app («8,1», «1.250.000») para que `leerNumero` lo lea de vuelta tal cual.
 *  Ausente, el campo vacío: «—» no se puede editar y un «0» sería un dato que
 *  nadie escribió. Los campos del DCF llevaban «8.1» (`toFixed`) junto a textos
 *  con «10,0 %», se leían con `parseFloat` («8,5» calculaba con 8 sin avisar) y
 *  el FCF de una empresa real salía como «108807000000» (revisión 12, visual). */
export function textoDeCampo(valor: number | null | undefined, decimales: number): string {
  return valor === null || valor === undefined || !Number.isFinite(valor) ? '' : fmtNum(valor, decimales)
}
