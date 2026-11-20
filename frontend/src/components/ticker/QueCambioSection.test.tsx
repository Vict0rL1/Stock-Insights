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

describe('qué cambió, revisión 12 (visual)', () => {
  type Analisis = {
    instantanea: { nueva: boolean } | null
    analisis: {
      tesis: { titulo?: string; disparadores?: { salta: boolean }[] }
      expectativas: { ultimo?: { impacto_en_tesis?: { punto: string; estado: string }[] } | null }
    }
    cambios: { categorias: Record<string, { clave: string; antes: unknown; ahora: unknown; absoluto?: number }[]> }
  }

  function servir(cambiar: (a: Analisis) => void) {
    const rutas = structuredClone((empresaCompleta as unknown as { rutas: Rutas }).rutas)
    cambiar(rutas['/api/empresa/ACME/analisis'].json as Analisis)
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    render(<MemoryRouter><QueCambioSection symbol="ACME" /></MemoryRouter>)
  }

  it('la diferencia en pp es la de las cifras que se leen', async () => {
    // 0,3343 → 0,3006 se escribe «33,4 % → 30,1 %»: la diferencia que se lee es
    // -3,3; con la de los valores sin redondear salía «(-3,4 pp)».
    servir((a) => {
      const fila = a.cambios.categorias.valoracion.find((c) => c.clave === 'dcf_inverso')!
      Object.assign(fila, { antes: 0.3343, ahora: 0.3006, absoluto: -0.0337 })
    })
    expect(await screen.findByText('(-3,3 pp)')).toBeInTheDocument()
    expect(screen.queryByText('(-3,4 pp)')).not.toBeInTheDocument()
  })

  it('una instantánea ya congelada no dice «sin cambios materiales» encima de los cambios', async () => {
    servir((a) => {
      a.instantanea = { ...a.instantanea!, nueva: false }
    })
    expect(await screen.findByText(/ya congelada: desde ella no ha cambiado nada que pida otra/)).toBeInTheDocument()
    expect(screen.queryByText(/Sin cambios materiales/)).not.toBeInTheDocument()
  })

  it('la tesis invalidada se ve junto a la decisión', async () => {
    // Solo salía en rojo al final del diff; el bloque de la decisión no la nombraba.
    servir((a) => {
      a.analisis.expectativas.ultimo!.impacto_en_tesis = [{ punto: 'margen operativo < 18%', estado: 'invalidado' }]
    })
    const aviso = await screen.findByText(/Tu tesis «El margen aguanta» tiene 1 punto de invalidación cruzado/)
    const bloque = aviso.closest('div')!
    expect(bloque).toHaveTextContent('margen operativo < 18% (según los resultados de 2026-Q2: trimestre, no ejercicio)')
    expect(bloque).toHaveTextContent('El motor de decisión no mira la tesis')
    // Arriba, en la sección de la decisión, no en la del diff.
    expect(aviso.closest('section')).toHaveTextContent('Decisión del motor')
  })

  it('sin puntos cruzados no hay aviso de tesis', async () => {
    servir((a) => {
      a.analisis.expectativas.ultimo!.impacto_en_tesis = []
    })
    expect(await screen.findByText(/Decisión del motor/)).toBeInTheDocument()
    expect(screen.queryByText(/Tu tesis/)).not.toBeInTheDocument()
  })
})

