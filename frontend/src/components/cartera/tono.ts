import { signoLeido } from '../../lib/formato'

/** Verde, rojo o neutro según lo que se LEE: con `>= 0`, un «+0,00 USD» o un
 *  «0,0 %» salían en verde en la cartera, como una ganancia, cuando Hoy y
 *  Mercado ya seguían a `signoLeido` (revisión 13). El «—» de un dato ausente
 *  se lee cero: en neutro. Lo usan las posiciones y la lista de seguimiento. */
export function tonoLeido(escrito: string, sube: string, baja: string, neutro: string): string {
  const signo = signoLeido(escrito)
  return signo === 0 ? neutro : signo > 0 ? sube : baja
}
