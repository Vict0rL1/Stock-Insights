import { describe, expect, it } from 'vitest'
import { leerNumero } from './entrada'

describe('leerNumero', () => {
  it('coma decimal y punto de miles, como escribe la app', () => {
    expect(leerNumero('12,5')).toBe(12.5)
    expect(leerNumero('1.250')).toBe(1250)
    expect(leerNumero('1.250,5')).toBe(1250.5)
    expect(leerNumero('1.250.000')).toBe(1250000)
    expect(leerNumero('-3')).toBe(-3)
  })

  it('punto decimal cuando no puede ser de miles', () => {
    expect(leerNumero(' 12.5 ')).toBe(12.5)
    expect(leerNumero('0.25')).toBe(0.25)
    expect(leerNumero('1234.5')).toBe(1234.5)
    // Un grupo de miles no empieza por 0 (tercera pasada: «0.125» daba 125).
    expect(leerNumero('0.125')).toBe(0.125)
    expect(leerNumero('-0.500')).toBe(-0.5)
    expect(leerNumero('.5')).toBe(0.5)
    expect(leerNumero(',5')).toBe(0.5)
  })

  it('lo que no es un número sin ambigüedad es null, no un número truncado ni un cero', () => {
    for (const t of ['', '  ', 'abc', '12,5 %', '1,2,3', '12abc', '1,234.5', '12.34.5']) expect(leerNumero(t)).toBeNull()
  })
})
