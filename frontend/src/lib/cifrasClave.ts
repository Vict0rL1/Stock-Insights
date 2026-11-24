/**
 * «Cifras clave, explicadas»: cuatro cifras del análisis de la empresa, cada
 * una con una frase que dice qué significa y de dónde sale.
 *
 * Las cifras ya están calculadas en el backend (`app/analisis_empresa.py`, con
 * su linaje hasta el filing): aquí solo se escriben con `formato.ts` y se
 * cuentan con una plantilla. Una que falta no se rellena: la tarjeta dice «—»
 * y por qué falta (ausente ≠ cero).
 */
import type { AnalisisEmpresa } from '../api/types'
import type { ClaveGlosario } from './glosario'
import { fmtCompacto, fmtFecha, fmtNum, fmtPct, fmtPrecio, plural, signoLeido } from './formato'

export interface CifraClave {
  clave: 'ventas' | 'margen' | 'per' | 'crecimiento'
  titulo: string
  /** El término del glosario que explica el título, si lo hay. */
  termino?: ClaveGlosario
  valor: string
  frase: string
  fuente: string
}

/** «el trimestre cerrado el 30 jun 2026», o su nombre si no trae fecha de cierre. */
function trimestreDe(t: NonNullable<AnalisisEmpresa['fundamentales']['trimestre']>): string {
  return t.periodo_fin ? `el trimestre cerrado el ${fmtFecha(t.periodo_fin)}` : `el trimestre ${t.periodo ?? 'más reciente'}`
}

const presentado = (fecha: string | null | undefined) => (fecha ? ` · presentado el ${fmtFecha(fecha)}` : '')

// De cada 100 que vende: con un decimal como mucho, como el porcentaje de al lado.
const deCada100 = (fraccion: number) => fmtNum(Math.abs(fraccion) * 100, 1, { ceros: false })

function ventas(a: AnalisisEmpresa): CifraClave {
  const f = a.fundamentales
  const t = f.trimestre
  const moneda = f.metricas?.revenue?.unidad ?? null
  const yoy = t?.revenue_yoy?.valor ?? null
  const total = t?.revenue?.valor ?? null
  if (t && (yoy !== null || total !== null)) {
    const valor = yoy !== null ? fmtPct(yoy, 1, { signo: true }) : fmtCompacto(total, moneda)
    const cuanto = total !== null ? ` (${fmtCompacto(total, moneda)} en ${trimestreDe(t)})` : ` (${trimestreDe(t)})`
    const frase =
      yoy === null
        ? `Lo que vendió en ${trimestreDe(t)}. Falta el mismo trimestre del año anterior para saber si crece.`
        : signoLeido(valor) === 0
          ? `Vende lo mismo que un año antes${cuanto}.`
          : `Vende un ${fmtPct(Math.abs(yoy), 1)} ${yoy > 0 ? 'más' : 'menos'} que en el mismo trimestre del año anterior${cuanto}.`
    return { clave: 'ventas', titulo: 'Ventas del trimestre', valor, frase, fuente: `EDGAR${presentado(t.publicado)}` }
  }
  const crec = f.metricas?.revenue_growth?.valor ?? null
  if (crec !== null) {
    const valor = fmtPct(crec, 1, { signo: true })
    return {
      clave: 'ventas',
      titulo: 'Ventas del último ejercicio',
      valor,
      frase:
        signoLeido(valor) === 0
          ? `Vendió lo mismo que el ejercicio anterior.`
          : `Vendió un ${fmtPct(Math.abs(crec), 1)} ${crec > 0 ? 'más' : 'menos'} que el ejercicio anterior (${fmtCompacto(f.metricas.revenue?.valor ?? null, moneda)} en ${f.ejercicio ?? 'el último'}).`,
      fuente: `EDGAR · ejercicio ${f.ejercicio ?? '—'}${presentado(f.publicado)}`,
    }
  }
  return {
    clave: 'ventas',
    titulo: 'Ventas',
    valor: '—',
    frase: `Sin ventas que comparar: ${f.motivo ?? 'faltan los ingresos de dos periodos comparables'}.`,
    fuente: 'EDGAR',
  }
}

function margen(a: AnalisisEmpresa): CifraClave {
  const f = a.fundamentales
  const t = f.trimestre
  const delTrimestre = t?.operating_margin?.valor ?? null
  const delEjercicio = f.metricas?.operating_margin?.valor ?? null
  const v = delTrimestre ?? delEjercicio
  const base = { clave: 'margen' as const, titulo: 'Margen operativo', termino: 'margen_operativo' as const }
  if (v === null)
    return { ...base, valor: '—', frase: `Sin margen operativo: ${f.motivo ?? 'faltan el resultado operativo o los ingresos'}.`, fuente: 'EDGAR' }
  const valor = fmtPct(v, 1)
  const cuando = delTrimestre !== null && t ? `En ${trimestreDe(t)}` : `En el ejercicio ${f.ejercicio ?? '—'}`
  const cuenta =
    signoLeido(valor) < 0
      ? `${cuando} perdió ${deCada100(v)} de cada 100 que vendió, antes de intereses e impuestos`
      : `${cuando}, de cada 100 que vendió le quedaron ${deCada100(v)} después de pagar los gastos del negocio`
  const comparado =
    delTrimestre !== null && delEjercicio !== null ? `; en todo el ejercicio ${f.ejercicio ?? 'anterior'} fue del ${fmtPct(delEjercicio, 1)}` : ''
  return {
    ...base,
    valor,
    frase: `${cuenta}${comparado}.`,
    fuente: delTrimestre !== null && t ? `EDGAR${presentado(t.publicado)}` : `EDGAR · ejercicio ${f.ejercicio ?? '—'}${presentado(f.publicado)}`,
  }
}

function per(a: AnalisisEmpresa): CifraClave {
  const pe = a.valoracion.pe
  const precio = a.mercado.precio
  const base = { clave: 'per' as const, titulo: 'PER (precio / beneficio)', termino: 'per' as const }
  const fuente = `precio de ${precio.fuente ?? 'la cotización'} y BPA de EDGAR (ejercicio ${a.fundamentales.ejercicio ?? '—'})`
  if (pe?.valor !== null && pe?.valor !== undefined)
    return {
      ...base,
      valor: fmtNum(pe.valor, 1),
      frase: `Al precio de hoy pagas ${fmtNum(pe.valor, 1)} veces lo que ganó por acción en su último ejercicio. Cuanto más alto, más crecimiento da por hecho el mercado.`,
      fuente,
    }
  const bpa = pe?.entradas?.bpa?.valor ?? null
  const motivo =
    a.valoracion.estado !== 'valido' && !pe
      ? (a.fundamentales.motivo ?? 'sin estados financieros')
      : bpa !== null && bpa <= 0
        ? `en su último ejercicio no ganó dinero (BPA de ${fmtPrecio(bpa)}), y un PER con pérdidas no significa nada`
        : precio.valor === null
          ? 'falta el precio'
          : 'falta el BPA del último ejercicio'
  return { ...base, valor: '—', frase: `Sin PER: ${motivo}.`, fuente }
}

function crecimiento(a: AnalisisEmpresa): CifraClave {
  const inv = a.valoracion.dcf_inverso
  const g = inv?.crecimiento_implicito ?? null
  const base = {
    clave: 'crecimiento' as const,
    titulo: 'Crecimiento que da por hecho el precio',
    termino: 'crecimiento_implicito' as const,
    fuente: 'cálculo de la app con las cuentas de EDGAR y el precio de hoy',
  }
  if (g === null)
    return { ...base, valor: '—', frase: `No se puede calcular: ${inv?.motivo ?? 'faltan las cuentas o el precio'}.` }
  const s = inv?.supuestos
  const supuestos = s
    ? ` durante ${s.anos} ${plural(s.anos, 'año', 'años')}, con un descuento del ${fmtPct(s.descuento, 1, { ceros: false })} anual`
    : ''
  const valor = fmtPct(g, 1)
  const verbo = signoLeido(valor) < 0 ? 'podría caer' : 'tendría que crecer'
  return {
    ...base,
    valor,
    frase: `Para valer lo que cuesta hoy, su flujo de caja libre ${verbo} un ${fmtPct(Math.abs(g), 1)} al año${supuestos}. No es una previsión: es lo que el precio ya da por hecho.`,
  }
}

/** Las cuatro tarjetas, en el orden de la maqueta aprobada. */
export function cifrasClave(a: AnalisisEmpresa): CifraClave[] {
  return [ventas(a), margen(a), per(a), crecimiento(a)]
}
