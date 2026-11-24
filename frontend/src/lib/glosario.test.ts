/**
 * Las definiciones que la ficha enseña al tocar un término (`glosario.ts`), en
 * un solo sitio y completas. Que sus palabras sean las de `docs/GLOSARIO.md`
 * (cada entrada, el término de su fila; ninguna, una palabra de «Nunca») lo
 * comprueba `backend/tests/test_glosario.py`, que ya lee el documento y el
 * frontend: Vite no deja leer aquí lo que está fuera de `frontend/`.
 */
import { describe, expect, it } from 'vitest'
import type { DecisionAction } from '../api/types'
import { FORMAS, GLOSARIO, QUE_SIGNIFICA_LA_ACCION } from './glosario'

describe('glosario de la ficha', () => {
  it('explica los términos que la ficha enseña a alguien sin experiencia', () => {
    // Los de la maqueta aprobada: el PER y el margen de las cifras clave, el stop
    // de la frase y la media de 200 sesiones del gráfico y de las reglas.
    expect(GLOSARIO.per.termino).toBe('PER')
    expect(GLOSARIO.margen_operativo.termino).toBe('margen operativo')
    expect(GLOSARIO.stop.termino).toBe('stop')
    expect(GLOSARIO.media_200.termino).toBe('media de 200 sesiones')
    // «BPA», nunca «EPS» (docs/GLOSARIO.md).
    expect(GLOSARIO.per.definicion).toContain('(BPA)')
  })

  it.each(Object.entries(GLOSARIO))('«%s» es una frase con su punto y nombra su fila del documento', (clave, e) => {
    expect(e.definicion).toMatch(/^[A-ZÁÉÍÓÚ¿].+\.$/)
    expect(e.concepto).toMatch(/^[A-ZÁÉÍÓÚ]/)
    // Se reconoce dentro de un texto (`ConTerminos`) por al menos una forma.
    expect(FORMAS[clave as keyof typeof FORMAS]?.length).toBeGreaterThan(0)
  })

  it('las formas que se reconocen son las de un término del glosario, y de nadie más', () => {
    expect(Object.keys(FORMAS).sort()).toEqual(Object.keys(GLOSARIO).sort())
    const todas = Object.values(FORMAS).flat()
    expect(new Set(todas).size).toBe(todas.length)
  })

  it('cada acción del motor dice qué significa', () => {
    const acciones: DecisionAction[] = ['comprar', 'vigilar', 'mantener', 'reducir', 'vender', 'evitar', 'ninguna', 'sin_datos']
    expect(Object.keys(QUE_SIGNIFICA_LA_ACCION).sort()).toEqual([...acciones].sort())
    for (const a of acciones) expect(QUE_SIGNIFICA_LA_ACCION[a], a).toMatch(/^[A-ZÁÉÍÓÚ].+\.$/)
  })
})
