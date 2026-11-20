import { describe, expect, it } from 'vitest'
import { leerNumero, textoDeCampo } from './entrada'

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

describe('textoDeCampo', () => {
  it('escribe un campo editable como lo lee leerNumero, y lo ausente vacío', () => {
    // Revisión 12, visual: los campos del DCF llevaban «8.1» y «108807000000».
    expect(textoDeCampo(8.1, 1)).toBe('8,1')
    expect(textoDeCampo(11, 1)).toBe('11,0')
    expect(textoDeCampo(108_807_000_000, 0)).toBe('108.807.000.000')
    expect(textoDeCampo(-1250.5, 1)).toBe('-1.250,5')
    for (const [v, d] of [[8.1, 1], [0.5, 1], [1250, 0], [-12_345_000_000, 0], [1234.5, 1]] as const) {
      expect(leerNumero(textoDeCampo(v, d))).toBe(v)
    }
    expect(textoDeCampo(null, 1)).toBe('')
    expect(textoDeCampo(undefined, 0)).toBe('')
    expect(textoDeCampo(NaN, 0)).toBe('')
  })
})
