/**
 * Revisión 9: la fila de la puntuación en «Qué cambió» se escribía con dos
 * decimales: «0,15 → 0,35» junto a una traza que en el mismo panel decía 0,3496.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { QueCambioSection } from './QueCambioSection'

type Rutas = Record<string, { status: number; json: unknown }>

afterEach(() => vi.unstubAllGlobals())

describe('qué cambió', () => {
  it('la puntuación se escribe frente a los umbrales de su decisión', async () => {
    const rutas = structuredClone((empresaCompleta as unknown as { rutas: Rutas }).rutas)
    const analisis = rutas['/api/empresa/ACME/analisis'].json as {
      analisis: { decision: { reglas: unknown[] } }
      cambios: { categorias: Record<string, unknown[]> }
    }
    analisis.analisis.decision.reglas = [
      { id: 'puntuacion_favorable', regla: 'Puntuación ≥ +0,35', resultado: 'no_cumple', papel: 'evaluada', efecto: 'comprar',
        datos: { valor: 0.3496, umbral: 0.35 } },
      { id: 'puntuacion_desfavorable', regla: 'Puntuación ≤ -0,35', resultado: 'no_cumple', papel: 'evaluada', efecto: 'evitar',
        datos: { valor: 0.3496, umbral: -0.35 } },
    ]
    analisis.cambios.categorias.senal = [
      { clave: 'score', etiqueta: 'Puntuación frente a comparables', tipo: 'material', antes: 0.15, ahora: 0.3496,
        unidad: 'puntos', absoluto: 0.1996, direccion: 'sube' },
    ]
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    render(<MemoryRouter><QueCambioSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText(/\+0,15 → \+0,3496/)).toBeInTheDocument()
  })
})
