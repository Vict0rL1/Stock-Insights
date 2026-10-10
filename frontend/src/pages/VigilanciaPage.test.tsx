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
})
