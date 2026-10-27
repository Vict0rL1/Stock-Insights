import { describe, expect, it } from 'vitest'
import { fmtMetrica } from './metricas'

describe('fmtMetrica', () => {
  it('un valor por acción lleva los decimales de un precio', () => {
    // Revisión 4: el replay del historial escribía el BPA de 0,0042 como «0,00».
    expect(fmtMetrica(0.0042, 'USD/acción')).toBe('0,0042')
    expect(fmtMetrica(0.003, 'moneda')).toBe('0,003')
    expect(fmtMetrica(5.1, 'USD/acción')).toBe('5,10')
  })

  it('cada unidad en su forma, y lo ausente se dice', () => {
    expect(fmtMetrica(0.213, 'fracción')).toBe('21,3 %')
    expect(fmtMetrica(2_500_000_000, 'USD')).toBe(fmtMetrica(2_500_000_000))
    expect(fmtMetrica(null, 'USD')).toBe('desconocido')
    expect(fmtMetrica(1.234)).toBe('1,23')
  })
})
