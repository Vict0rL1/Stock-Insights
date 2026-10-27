import { etiqueta } from './etiquetas'
import { fmtCompacto, fmtNum, fmtPct, fmtPrecio } from './formato'

/**
 * Una métrica de los fundamentales, en su unidad. La usan «Qué cambió» y el
 * replay del historial: con una versión en cada sitio, el BPA de 0,0042 salía
 * «0,00» en el replay y «0,0042» en «Qué cambió» (revisión 4).
 */
export function fmtMetrica(v: number | string | null | undefined, unidad?: string): string {
  if (v === null || v === undefined) return 'desconocido'
  // Un valor de texto es un código (el estado de la tesis: «intacta →
  // sin_comprobar» salía en crudo; revisión de M1).
  if (typeof v === 'string') return etiqueta(v)
  if (unidad === 'fracción') return fmtPct(v, 1)
  if (unidad === 'USD') return fmtCompacto(v)
  // Un precio, con los decimales de un precio: «Precio 0,00 → 0,00» de una
  // acción de céntimos (revisión 3).
  if (unidad === 'moneda' || unidad === 'USD/acción') return fmtPrecio(v)
  // Sin unidad (instantáneas anteriores a que se guardara), un importe grande
  // en M o mil M.
  if (Math.abs(v) > 1e5) return fmtCompacto(v)
  return fmtNum(v, 2)
}
