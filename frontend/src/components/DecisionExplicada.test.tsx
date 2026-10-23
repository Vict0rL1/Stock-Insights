/**
 * Revisión de la Fase 1: la distancia que falta para cambiar de decisión se
 * escribía `{fmtNum(d, 2)} {unidad}`, con un espacio normal antes de «%» (el
 * signo podía quedarse solo en la línea siguiente) y, sin unidad, con un
 * espacio suelto antes del paréntesis: «falta +3,00 )».
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CondicionDecision, ReglaTraza } from '../api/types'
import { PorQue, QueLaCambiaria } from './DecisionExplicada'

const NBSP = '\u00a0'

function texto(c: Partial<CondicionDecision>): string {
  const condicion: CondicionDecision = {
    regla: 'r', condicion: 'condición', actual: 1, umbral: 2, distancia: null, unidad: null, ...c,
  }
  const { container } = render(
    <QueLaCambiaria cambiaria={[{ hacia: 'mantener', requiere: 'todas', condiciones: [condicion] }]} />,
  )
  return container.querySelector('li li span')?.textContent ?? ''
}

describe('distancia de una condición que cambiaría la decisión', () => {
  it('en %, con espacio duro y signo', () => {
    expect(texto({ distancia: 2.5, unidad: '%' })).toBe(`(ahora 1,00; falta +2,50${NBSP}%)`)
  })

  it('en otra unidad, con espacio duro', () => {
    expect(texto({ distancia: -1, unidad: 'puntos' })).toBe(`(ahora 1,00; falta -1,00${NBSP}puntos)`)
  })

  it('sin unidad, sin espacio suelto antes del paréntesis', () => {
    expect(texto({ distancia: 3, unidad: null })).toBe('(ahora 1,00; falta +3,00)')
  })
})

describe('los precios de la traza, con sus cifras (revisión de A1)', () => {
  // El caso de la auditoría: precio 0,003 y stop 0,004. Con `fmtNum(v, 2)` la
  // explicación decía «0,00 frente a 0,00».
  it('«¿Por qué?» escribe el precio y el stop como precios; la puntuación, como siempre', () => {
    const reglas = [
      { id: 'stop_perforado', regla: 'Precio en o bajo el stop', resultado: 'cumple', efecto: 'vender', papel: 'decide',
        datos: { valor: 0.003, umbral: 0.004 } },
      { id: 'puntuacion_desfavorable', regla: 'Puntuación ≤ -0,35', resultado: 'no_cumple', efecto: 'vender', papel: 'evaluada',
        datos: { valor: 0.8, umbral: -0.35 } },
    ] as unknown as ReglaTraza[]
    const { container } = render(<PorQue reglas={reglas} />)
    expect(container.textContent).toContain('(0,003 frente a 0,004)')
    expect(container.textContent).toContain('(0,80 frente a -0,35)')
  })

  it('«¿Qué la cambiaría?» escribe el precio de ahora como precio', () => {
    expect(texto({ actual: 0.003, distancia: 33.33, unidad: '%' })).toBe(`(ahora 0,003; falta +33,33${NBSP}%)`)
  })
})
