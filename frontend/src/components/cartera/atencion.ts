import type { PortfolioPosition } from '../../api/types'

/** El estado del límite de pérdida (stop) de UN lote, con lo que ya sirve
 *  `/api/portfolio` (`stop_perforado`, la regla del motor: en o por debajo).
 *
 *  Fail-safe, con el mismo criterio que el repaso de stops de Hoy
 *  (`contexto_cartera.stops_de_la_cartera`): perforado si el precio lo perfora,
 *  aunque ese precio sea viejo; «en orden» solo con un precio válido por encima;
 *  todo lo demás, «sin comprobar» con su motivo. Un precio viejo por encima del
 *  stop no dice que siga por encima: en Hoy daba «nada urgente» (revisión 13), y
 *  la tabla del Portafolio lo pintaba como un stop intacto. Un `stop_perforado`
 *  que no llega tampoco es «intacto». */
export type EstadoDelStop =
  | { estado: 'perforado' }
  | { estado: 'en_orden' }
  | { estado: 'sin_comprobar'; motivo: string }

export function estadoDelStop(p: PortfolioPosition): EstadoDelStop {
  if (p.stop_perforado === true) return { estado: 'perforado' }
  if (p.stop === null || p.stop === undefined) {
    return { estado: 'sin_comprobar', motivo: 'no tiene límite de pérdida: ni fijado al anotar la compra ni coste con que calcularlo' }
  }
  if (p.stop_perforado !== false || p.price === null || p.precio_estado === 'desconocido') {
    return { estado: 'sin_comprobar', motivo: 'no hay precio con que comparar su límite de pérdida' }
  }
  if (p.precio_estado === 'viejo') {
    return {
      estado: 'sin_comprobar',
      motivo: 'solo hay un precio viejo: estaba por encima de su límite de pérdida, pero no se puede afirmar que lo siga',
    }
  }
  return { estado: 'en_orden' }
}

export type AvisoDePosicion = { symbol: string; estado: 'perforado' | 'sin_comprobar'; motivo: string }

/** Cuántas posiciones hay abiertas y cuáles necesitan atención, por SÍMBOLO:
 *  varios lotes del mismo símbolo son una posición (`docs/GLOSARIO.md`), como
 *  cuenta Hoy («3 en cartera»). Un símbolo está perforado si lo está cualquiera
 *  de sus lotes (el precio es el mismo y el lote de stop más alto es el primero
 *  en perforarse) y está sin comprobar si lo está alguno y ninguno está
 *  perforado. Los perforados, primero. */
export function atencionDeCartera(posiciones: PortfolioPosition[]): { abiertas: number; avisos: AvisoDePosicion[] } {
  const porSimbolo = new Map<string, EstadoDelStop[]>()
  for (const p of posiciones) porSimbolo.set(p.symbol, [...(porSimbolo.get(p.symbol) ?? []), estadoDelStop(p)])
  const avisos: AvisoDePosicion[] = []
  for (const [symbol, estados] of porSimbolo) {
    if (estados.some((e) => e.estado === 'perforado')) {
      avisos.push({ symbol, estado: 'perforado', motivo: 'el precio ha llegado a su límite de pérdida (stop)' })
      continue
    }
    const sinComprobar = estados.find(
      (e): e is Extract<EstadoDelStop, { estado: 'sin_comprobar' }> => e.estado === 'sin_comprobar',
    )
    if (sinComprobar) avisos.push({ symbol, estado: 'sin_comprobar', motivo: sinComprobar.motivo })
  }
  avisos.sort((a, b) => Number(b.estado === 'perforado') - Number(a.estado === 'perforado'))
  return { abiertas: porSimbolo.size, avisos }
}
