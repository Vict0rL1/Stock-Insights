/**
 * Revisión del 2.1 en Vigilancia:
 *
 * - Los puntos de invalidación seguían fuera de `useDato`: el fallo salía
 *   suelto, sin «Reintentar», y el registro de decisiones lo borraba.
 * - «quitar» un punto fallaba en silencio y el punto seguía ahí.
 * - Tras una acción, «Decisiones pasadas» y el aviso pasaban por «Cargando» y
 *   el selector de tesis se quedaba sin opciones.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecisionesResponse, VigilanciaResponse } from '../api/types'
import { VigilanciaPage } from './VigilanciaPage'

const VIGILANCIA: VigilanciaResponse = {
  tesis: [
    {
      thesis_id: 3, symbol: 'KO', title: 'Marca y dividendo', invalidation_criteria: null,
      vigilancia: {
        disparadores: [
          {
            id: 11, thesis_id: 3, kind: 'metrica', descripcion: 'Si el margen baja del 18 %', config: {},
            activo: true, created_at: '2026-01-05T15:00:00+00:00', last_fired_at: null,
            salta: false, medible: true, detalle: 'Margen 21 %: todavía no lo cruza.',
          },
        ],
        saltan: 0, sin_medir: 0, total: 1, nota: 'Nada cruzado.',
      },
    },
  ],
  total_saltan: 0, sin_disparadores: [], nota: '', aviso_sin_disparadores: null,
}
const DECISIONES: DecisionesResponse = {
  decisiones: [
    {
      id: 1, symbol: 'KO', thesis_id: 3, accion: 'comprar', razonamiento: 'Marca fuerte y dividendo creciente.',
      price_at_decision: 55, quantity: null, created_at: '2026-02-01T15:00:00+00:00', days_elapsed: 250,
      precio_actual: 60, cambio_pct: 9.1, contexto: null,
    },
  ],
  coherencia: { decisiones: 1, nota: '' },
  nota: '',
}

type Respuesta = { status: number; json: unknown } | 'pendiente'

function servir(rutas: Record<string, Respuesta>) {
  const pedidas: string[] = []
  vi.stubGlobal('fetch', vi.fn((e: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const clave = `${init?.method ?? 'GET'} ${url}`
    pedidas.push(clave)
    const r = rutas[clave] ?? rutas[url]
    if (r === 'pendiente') return new Promise<Response>(() => {})
    return Promise.resolve(new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 }))
  }))
  return pedidas
}

const BASE: Record<string, Respuesta> = {
  '/api/theses/vigilancia': { status: 200, json: VIGILANCIA },
  '/api/theses/decisiones': { status: 200, json: DECISIONES },
  '/api/theses/sin-tesis': {
    status: 200,
    json: { posiciones_sin_tesis: [], watchlist_sin_tesis: [], posiciones_totales: 1, watchlist_total: 0, nota: '' },
  },
  '/api/theses': { status: 200, json: { theses: [] } },
  '/api/theses/vigilancia/metricas': { status: 200, json: { metricas: [], crecimientos: [], operadores: [], nota: '' } },
}

const pintar = () => render(<MemoryRouter><VigilanciaPage /></MemoryRouter>)

afterEach(() => vi.unstubAllGlobals())

describe('Vigilancia (revisión del 2.1)', () => {
  it('si la vigilancia no carga, lo dice con su motivo y se puede reintentar', async () => {
    const rutas: Record<string, Respuesta> = { ...BASE, '/api/theses/vigilancia': { status: 503, json: { detail: 'EDGAR no respondió' } } }
    servir(rutas)
    pintar()
    const fallo = await screen.findByText('No se pudo cargar la vigilancia de tesis: EDGAR no respondió')
    rutas['/api/theses/vigilancia'] = BASE['/api/theses/vigilancia']
    fireEvent.click(within(fallo.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Si el margen baja del 18 %')).toBeInTheDocument()
  })

  it('quitar un punto rechazado dice su motivo', async () => {
    servir({ ...BASE, 'DELETE /api/theses/triggers/11': { status: 409, json: { detail: 'la base de datos está bloqueada' } } })
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'quitar' }))
    expect(
      await screen.findByText('No se pudo quitar el punto de invalidación: la base de datos está bloqueada'),
    ).toBeInTheDocument()
  })

  it('tras quitar un punto, los puntos y las decisiones siguen a la vista mientras recargan', async () => {
    const rutas: Record<string, Respuesta> = { ...BASE, 'DELETE /api/theses/triggers/11': { status: 200, json: { deleted: 11 } } }
    const pedidas = servir(rutas)
    pintar()
    expect(await screen.findByText('Decisiones pasadas, con el razonamiento de entonces')).toBeInTheDocument()
    for (const u of ['/api/theses/vigilancia', '/api/theses/decisiones', '/api/theses/sin-tesis', '/api/theses']) rutas[u] = 'pendiente'
    fireEvent.click(screen.getByRole('button', { name: 'quitar' }))
    await waitFor(() => expect(pedidas.filter((p) => p === 'GET /api/theses/decisiones')).toHaveLength(2))
    expect(screen.getByText('Decisiones pasadas, con el razonamiento de entonces')).toBeInTheDocument()
    expect(screen.getByText('Si el margen baja del 18 %')).toBeInTheDocument()
    expect(screen.queryByText(/^Cargando/)).toBeNull()
  })

  it('un umbral vacío no se guarda como 0 %: se pide, y no se envía nada', async () => {
    // Segunda revisión del 2.1: `Number('') / 100` enviaba `umbral: 0`, un
    // punto «margen < 0 %» que nadie escribió.
    const pedidas = servir({
      ...BASE,
      '/api/theses/vigilancia/metricas': {
        status: 200,
        json: { metricas: [{ clave: 'operating_margin', etiqueta: 'margen operativo', alto_mejor: true }], crecimientos: [], operadores: [{ clave: 'lt', etiqueta: 'por debajo de' }], nota: '' },
      },
    })
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: '+ punto de invalidación' }))
    // Las pestañas del formulario dicen la palabra, no el código («metrica»).
    expect(screen.getByRole('button', { name: 'Métrica' })).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Por qué esto invalidaría la tesis'), { target: { value: 'Si el margen se hunde' } })
    fireEvent.change(screen.getByDisplayValue('18'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Escribe el umbral como número (p. ej. 18 o 18,5): vacío no es 0 %.')).toBeInTheDocument()
    expect(pedidas.some((p) => p.startsWith('POST'))).toBe(false)
  })

  it('un umbral con decimales se envía tal cual: «0.125» es 0,125 %, no 125 %', async () => {
    // Tercera pasada: leído con la convención de miles, el valor que el
    // navegador ya normaliza («0.125») llegaba como 125.
    const cuerpos: unknown[] = []
    servir({
      ...BASE,
      '/api/theses/vigilancia/metricas': {
        status: 200,
        json: { metricas: [{ clave: 'operating_margin', etiqueta: 'margen operativo', alto_mejor: true }], crecimientos: [], operadores: [{ clave: 'lt', etiqueta: 'por debajo de' }], nota: '' },
      },
      'POST /api/theses/3/triggers': { status: 200, json: { id: 12 } },
    })
    const fetchBase = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((e, init) => {
      if (init?.method === 'POST') cuerpos.push(JSON.parse(String(init.body)))
      return fetchBase(e, init)
    })
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: '+ punto de invalidación' }))
    fireEvent.change(screen.getByPlaceholderText('Por qué esto invalidaría la tesis'), { target: { value: 'Margen casi nulo' } })
    fireEvent.change(screen.getByDisplayValue('18'), { target: { value: '0.125' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(cuerpos).toHaveLength(1))
    expect((cuerpos[0] as { config: { umbral: number } }).config.umbral).toBeCloseTo(0.00125, 10)
  })

  it('un ratio se escribe en veces y se envía tal cual: «ratio corriente < 1,2» no es 0,012', async () => {
    // Revisión del 2.12: el formulario lo dividía todo entre 100, y un punto
    // sobre el ratio corriente se guardaba cien veces más bajo y no saltaba nunca.
    const cuerpos: unknown[] = []
    servir({
      ...BASE,
      '/api/theses/vigilancia/metricas': {
        status: 200,
        json: {
          metricas: [
            { clave: 'operating_margin', etiqueta: 'margen operativo', alto_mejor: true, unidad: 'pct' },
            { clave: 'current_ratio', etiqueta: 'ratio corriente', alto_mejor: false, unidad: 'veces' },
          ],
          crecimientos: [], operadores: [{ clave: 'lt', etiqueta: 'por debajo de' }], nota: '',
        },
      },
      'POST /api/theses/3/triggers': { status: 200, json: { id: 12 } },
    })
    const fetchBase = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation((e, init) => {
      if (init?.method === 'POST') cuerpos.push(JSON.parse(String(init.body)))
      return fetchBase(e, init)
    })
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: '+ punto de invalidación' }))
    fireEvent.change(screen.getByPlaceholderText('Por qué esto invalidaría la tesis'), { target: { value: 'Sin liquidez' } })
    fireEvent.change(screen.getByDisplayValue('margen operativo'), { target: { value: 'current_ratio' } })
    expect(screen.getByText('veces')).toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue('18'), { target: { value: '1.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(cuerpos).toHaveLength(1))
    expect((cuerpos[0] as { config: { umbral: number } }).config.umbral).toBeCloseTo(1.2, 10)
  })
})

describe('la serie de un punto, de su lado del umbral', () => {
  it('un ratio corriente de 0,996 que cruza «< 1» no se escribe «1,00»', async () => {
    // Revisión 6: el detalle decía 0,996 y la serie de debajo, «→ 1,00».
    const vigilancia = structuredClone(VIGILANCIA)
    vigilancia.tesis[0].vigilancia.disparadores[0] = {
      ...vigilancia.tesis[0].vigilancia.disparadores[0],
      config: { metrica: 'current_ratio', op: 'lt', umbral: 1 },
      salta: true, umbral: 1, serie: [1.1, 1.05, 0.996],
      detalle: 'Ratio corriente = 0,996; el punto salta si cae por debajo de 1.',
    }
    servir({
      ...BASE,
      '/api/theses/vigilancia': { status: 200, json: vigilancia },
      '/api/theses/vigilancia/metricas': {
        status: 200,
        json: { metricas: [{ clave: 'current_ratio', etiqueta: 'Ratio corriente', alto_mejor: true, unidad: 'veces' }],
                crecimientos: [], operadores: [], nota: '' },
      },
    })
    pintar()
    expect(await screen.findByText(/Últimos ejercicios: 1,10 → 1,05 → 0,996/)).toBeInTheDocument()
  })
})

describe('el aviso de un punto sin unidad, congelado con la decisión', () => {
  it('se pinta en el registro de decisiones', async () => {
    // Revisión 6: viajaba en `contexto.disparadores_saltando` y no lo pintaba nadie.
    const decisiones = structuredClone(DECISIONES)
    decisiones.decisiones[0].contexto = {
      precio: 55, tesis: null, disparadores_totales: 1, capturado_en: '2026-02-01T15:00:00+00:00',
      disparadores_saltando: [{ descripcion: 'D/E alto', aviso: 'Punto guardado sin unidad: puede ser 0,1 escrito por ti.' }],
      disparadores_sin_comprobar: [],
    } as never
    servir({ ...BASE, '/api/theses/decisiones': { status: 200, json: decisiones } })
    pintar()
    expect(await screen.findByText('Punto guardado sin unidad: puede ser 0,1 escrito por ti.')).toBeInTheDocument()
  })
})

