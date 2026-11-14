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

  it('con cambio de posición, el valor de antes se escribe como en la explicación (revisión 10)', async () => {
    // Con posición la traza de ahora solo tiene el umbral de vender, y el 0,3496
    // de antes salía «+0,35» en la fila y «+0,3496» en la explicación.
    const rutas = structuredClone((empresaCompleta as unknown as { rutas: Rutas }).rutas)
    const analisis = rutas['/api/empresa/ACME/analisis'].json as {
      analisis: { decision: { reglas: unknown[] } }
      cambios: { categorias: Record<string, unknown[]>; decision?: Record<string, unknown> }
    }
    analisis.analisis.decision.reglas = [
      { id: 'puntuacion_desfavorable', regla: 'Puntuación ≤ -0,35', resultado: 'cumple', papel: 'decide', efecto: 'vender',
        datos: { valor: -0.36, umbral: -0.35 } },
    ]
    analisis.cambios.decision = {
      antes: 'ninguna', ahora: 'vender', cambio: true, reglas_que_cambiaron: [], papeles_que_cambiaron: [],
      explicacion: ['«Puntuación ≤ -0,35»: no cumple (+0,3496 frente a -0,35) → cumple (-0,36 frente a -0,35).'],
      umbrales_puntuacion_antes: [-0.35, 0.35],
      umbrales_puntuacion_ahora: [-0.35],
    }
    analisis.cambios.categorias.senal = [
      { clave: 'score', etiqueta: 'Puntuación frente a comparables', tipo: 'material', antes: 0.3496, ahora: -0.36,
        unidad: 'puntos', absoluto: -0.7096, direccion: 'baja' },
    ]
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    render(<MemoryRouter><QueCambioSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText(/\+0,3496 → -0,36/)).toBeInTheDocument()
  })

  it('cada lado de la fila, con los umbrales de su traza (revisión 11)', async () => {
    // Abrir una posición con la misma puntuación: antes se comparaba con el
    // umbral de comprar (0,35) y ahora solo con el de vender (-0,35). Con los de
    // las dos trazas juntas, el de ahora salía «+0,3496» junto a unas razones y
    // una traza que decían «+0,35».
    const rutas = structuredClone((empresaCompleta as unknown as { rutas: Rutas }).rutas)
    const analisis = rutas['/api/empresa/ACME/analisis'].json as {
      analisis: { decision: { reglas: unknown[] } }
      cambios: { categorias: Record<string, unknown[]>; decision?: Record<string, unknown> }
    }
    analisis.analisis.decision.reglas = [
      { id: 'puntuacion_desfavorable', regla: 'Puntuación ≤ -0,35', resultado: 'no_cumple', papel: 'decide', efecto: 'vender',
        datos: { valor: 0.3496, umbral: -0.35 } },
    ]
    analisis.cambios.decision = {
      antes: 'ninguna', ahora: 'mantener', cambio: true, reglas_que_cambiaron: [], papeles_que_cambiaron: [],
      explicacion: ['Ahora tienes posición: la pregunta pasa a ser si sostenerla o soltarla, y con ella cambia el conjunto de reglas.'],
      umbrales_puntuacion_antes: [-0.35, 0.35],
      umbrales_puntuacion_ahora: [-0.35],
    }
    analisis.cambios.categorias.senal = [
      { clave: 'score', etiqueta: 'Puntuación frente a comparables', tipo: 'material', antes: 0.3496, ahora: 0.3496,
        unidad: 'puntos', absoluto: 0, direccion: 'igual' },
    ]
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    render(<MemoryRouter><QueCambioSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText(/\+0,3496 → \+0,35\b/)).toBeInTheDocument()
  })
})

