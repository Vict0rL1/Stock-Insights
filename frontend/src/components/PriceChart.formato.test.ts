/**
 * Revisión de la Fase 1 (D4): los ejes y la cruz del gráfico salían en formato
 * inglés («123.45», «1.2M»). El canvas usa los mismos formateadores que la app.
 */
import { describe, expect, it } from 'vitest'
import { FORMATO_RSI, FORMATO_VOLUMEN, formatoMacd, formatoPrecio, LOCALIZACION } from './PriceChart'

describe('formato del gráfico de precios', () => {
  it('precios con coma decimal y punto de miles', () => {
    expect(formatoPrecio(150).formatter(1234.5)).toBe('1.234,50')
    expect(FORMATO_RSI.formatter(70)).toBe('70,00')
  })

  // Revisión de A7: el `priceFormatter` global manda sobre el de cada serie, y
  // con él (dos decimales) una acción de 0,003 tenía todo el eje en «0,00».
  it('no hay formateador global: cada serie escribe sus cifras', () => {
    expect('priceFormatter' in LOCALIZACION).toBe(false)
    expect(formatoPrecio(0.003).formatter(0.0029)).toBe('0,0029')
    expect(formatoPrecio(0.003).minMove).toBeCloseTo(0.000001, 12)
    expect(formatoMacd(0.003).formatter(0.0000123)).toBe('0,0000123')
    expect(formatoMacd(150).formatter(0.1234)).toBe('0,12')
  })

  it('el volumen en M y mil M, nunca «B»', () => {
    expect(FORMATO_VOLUMEN.formatter(2_500_000_000)).toBe('2,5\u00a0mil\u00a0M')
  })

  it('una barra diaria (00:00 UTC) es de su día, también al oeste de Greenwich', () => {
    expect(LOCALIZACION.timeFormatter(Date.UTC(2026, 8, 12) / 1000)).toBe('12 sept 2026')
  })
})
