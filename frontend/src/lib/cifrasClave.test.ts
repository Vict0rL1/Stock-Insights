/**
 * «Cifras clave, explicadas»: cuatro cifras del análisis, cada una con su
 * frase y su fuente, sobre las respuestas REALES del backend (`fixtures/`,
 * exportadas del paquete de casos extremos). Una cifra que falta dice «—» y
 * por qué: nunca un cero.
 */
import { describe, expect, it } from 'vitest'
import type { AnalisisEmpresaResponse } from '../api/types'
import completa from '../test/fixtures/empresa_completa.json'
import vacia from '../test/fixtures/empresa_vacia.json'
import { cifrasClave } from './cifrasClave'

const NBSP = ' '
const analisis = (f: { symbol: string; rutas: Record<string, { json: unknown }> }) =>
  (f.rutas[`/api/empresa/${f.symbol}/analisis?congelar=false`].json as AnalisisEmpresaResponse).analisis

describe('cifras clave', () => {
  it('ventas, margen, PER y crecimiento que da por hecho el precio, cada una con su frase y su fuente', () => {
    const [ventas, margen, per, crecimiento] = cifrasClave(analisis(completa))
    expect(ventas).toMatchObject({
      titulo: 'Ventas del trimestre',
      valor: `+11,1${NBSP}%`,
      frase: `Vende un 11,1${NBSP}% más que en el mismo trimestre del año anterior (310${NBSP}USD en el trimestre cerrado el 30 jun 2026).`,
      fuente: 'EDGAR · presentado el 30 jul 2026',
    })
    // El del trimestre (el que cruzó el umbral de la tesis), junto al del ejercicio.
    expect(margen).toMatchObject({
      termino: 'margen_operativo',
      valor: `12,0${NBSP}%`,
      frase:
        'En el trimestre cerrado el 30 jun 2026, de cada 100 que vendió le quedaron 12 después de pagar los gastos del negocio; ' +
        `en todo el ejercicio 2025 fue del 21,0${NBSP}%.`,
    })
    expect(per).toMatchObject({ termino: 'per', titulo: 'PER (precio / beneficio)', valor: '55,8' })
    expect(per.frase).toBe(
      'Al precio de hoy pagas 55,8 veces lo que ganó por acción en su último ejercicio. Cuanto más alto, más crecimiento da por hecho el mercado.',
    )
    expect(per.fuente).toBe('precio de finnhub y BPA de EDGAR (ejercicio 2025)')
    expect(crecimiento).toMatchObject({ termino: 'crecimiento_implicito', valor: `30,1${NBSP}%` })
    // Con los supuestos con que se calcula: no es una previsión.
    expect(crecimiento.frase).toBe(
      `Para valer lo que cuesta hoy, su flujo de caja libre tendría que crecer un 30,1${NBSP}% al año durante 5 años, ` +
        `con un descuento del 9${NBSP}% anual. No es una previsión: es lo que el precio ya da por hecho.`,
    )
  })

  it('una empresa sin precio ni trimestres: cada cifra dice «—» y por qué, ninguna es un cero', () => {
    const cifras = cifrasClave(analisis(vacia))
    expect(cifras.map((c) => c.valor)).toEqual(['—', '—', '—', '—'])
    for (const c of cifras) {
      expect(c.frase).not.toMatch(/(?<![\d,])0(?:,0+)?(?![\d,])/)
      expect(c.frase.length).toBeGreaterThan(20)
    }
    expect(cifras[2].frase).toBe('Sin PER: falta el precio.')
    expect(cifras[3].frase).toBe('No se puede calcular: sin precio o sin acciones.')
  })

  it('un BPA negativo no da un PER: lo dice', () => {
    const a = structuredClone(analisis(completa))
    a.valoracion.pe = { ...a.valoracion.pe!, valor: null, entradas: { ...a.valoracion.pe!.entradas, bpa: { valor: -0.42 } } }
    expect(cifrasClave(a)[2].frase).toBe('Sin PER: en su último ejercicio no ganó dinero (BPA de -0,42), y un PER con pérdidas no significa nada.')
  })
})
