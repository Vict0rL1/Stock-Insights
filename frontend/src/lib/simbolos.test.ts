import { describe, expect, it } from 'vitest'
import { listaDeSimbolos, primerSimbolo } from './simbolos'

describe('listaDeSimbolos', () => {
  it('lo que no cabe se devuelve aparte para nombrarlo (revisión 12, visual)', () => {
    expect(listaDeSimbolos('voo, QQQ ,VTI, indx, TOTX', 4)).toEqual({
      simbolos: ['VOO', 'QQQ', 'VTI', 'INDX'], descartados: ['TOTX'],
    })
  })
  it('un repetido no ocupa el sitio de otro', () => {
    expect(listaDeSimbolos('VOO, voo, QQQ, , VTI', 2)).toEqual({ simbolos: ['VOO', 'QQQ'], descartados: ['VTI'] })
    expect(listaDeSimbolos(' , ', 4)).toEqual({ simbolos: [], descartados: [] })
  })
})

describe('primerSimbolo', () => {
  it('se queda con el primero de una lista', () => {
    expect(primerSimbolo('AAPL,MSFT')).toBe('AAPL')
    expect(primerSimbolo(' AAPL , MSFT ')).toBe('AAPL')
  })
  it('lo vacío no es un ticker', () => {
    expect(primerSimbolo('')).toBeNull()
    expect(primerSimbolo(' , ')).toBeNull()
    expect(primerSimbolo(null)).toBeNull()
    expect(primerSimbolo(undefined)).toBeNull()
  })
})
