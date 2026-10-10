/**
 * Revisión del 2.1 en Tesis:
 *
 * - La lista que no cargaba decía «Sin tesis guardadas»: el error solo se
 *   pintaba dentro del formulario cerrado y parecía que las tesis se habían
 *   perdido.
 * - El registro de aciertos se pedía dos veces al montar (y cada vez cotiza
 *   todos los símbolos con escenarios).
 * - Borrar y «+ Escenario» fallaban en silencio.
 * - Tras una acción, el registro pasaba por «Cargando…» y la página saltaba.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThesisRecord, TrackRecord } from '../api/types'
import { ThesesPage } from './ThesesPage'

const TESIS: ThesisRecord = {
  id: 3, symbol: 'KO', title: 'Marca y dividendo', body_md: 'Porque sí.', assumptions: null,
  invalidation_criteria: null, created_at: '2026-01-05T15:00:00+00:00', days_elapsed: 270,
  current_price: 60, scenarios: [],
}
const REGISTRO: TrackRecord = {
  scenarios: [],
  summary: { total: 0, evaluable: 0, hits: 0, misses: 0, hit_rate: null, median_estimate_error_pct: null, note: 'Sin escenarios aún.' },
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

const pintar = () => render(<MemoryRouter><ThesesPage /></MemoryRouter>)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Tesis (revisión del 2.1)', () => {
  it('si la lista no carga, lo dice con su motivo; no sale «Sin tesis guardadas»', async () => {
    servir({
      '/api/theses': { status: 503, json: { detail: 'la base de datos está bloqueada' } },
      '/api/theses/track-record': { status: 200, json: REGISTRO },
    })
    pintar()
    expect(await screen.findByText('No se pudieron cargar las tesis: la base de datos está bloqueada')).toBeInTheDocument()
    expect(screen.queryByText(/Sin tesis guardadas/)).toBeNull()
  })

  // Guarda de no regresión (pasa también con el código anterior).
  it('si carga y no hay ninguna, sí lo dice', async () => {
    servir({ '/api/theses': { status: 200, json: { theses: [] } }, '/api/theses/track-record': { status: 200, json: REGISTRO } })
    pintar()
    expect(await screen.findByText(/Sin tesis guardadas/)).toBeInTheDocument()
  })

  it('el registro de aciertos se pide una sola vez al montar', async () => {
    const pedidas = servir({
      '/api/theses': { status: 200, json: { theses: [TESIS] } },
      '/api/theses/track-record': { status: 200, json: REGISTRO },
    })
    pintar()
    expect(await screen.findByText('Marca y dividendo')).toBeInTheDocument()
    expect(await screen.findByText('Registro de aciertos')).toBeInTheDocument()
    expect(pedidas.filter((p) => p === 'GET /api/theses/track-record')).toHaveLength(1)
  })

  it('un borrado rechazado dice su motivo', async () => {
    servir({
      '/api/theses': { status: 200, json: { theses: [TESIS] } },
      '/api/theses/track-record': { status: 200, json: REGISTRO },
      'DELETE /api/theses/3': { status: 409, json: { detail: 'tiene decisiones registradas' } },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar' }))
    expect(await screen.findByText('No se pudo borrar la tesis: tiene decisiones registradas')).toBeInTheDocument()
  })

  it('un escenario rechazado dice su motivo', async () => {
    servir({
      '/api/theses': { status: 200, json: { theses: [TESIS] } },
      '/api/theses/track-record': { status: 200, json: REGISTRO },
      'POST /api/theses/3/scenarios': { status: 422, json: { detail: 'valor no válido' } },
    })
    vi.spyOn(window, 'prompt').mockReturnValueOnce('base').mockReturnValueOnce('70')
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: '+ Escenario' }))
    expect(await screen.findByText('No se pudo añadir el escenario: valor no válido')).toBeInTheDocument()
  })

  it('tras borrar, la lista y el registro siguen a la vista mientras recargan', async () => {
    const rutas: Record<string, Respuesta> = {
      '/api/theses': { status: 200, json: { theses: [TESIS] } },
      '/api/theses/track-record': { status: 200, json: REGISTRO },
      'DELETE /api/theses/3': { status: 200, json: { deleted: 3 } },
    }
    const pedidas = servir(rutas)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    pintar()
    expect(await screen.findByText('Registro de aciertos')).toBeInTheDocument()
    rutas['/api/theses'] = 'pendiente'
    rutas['/api/theses/track-record'] = 'pendiente'
    const registros = () => pedidas.filter((p) => p === 'GET /api/theses/track-record').length
    const antes = registros()
    fireEvent.click(await screen.findByRole('button', { name: 'Borrar' }))
    await waitFor(() => expect(registros()).toBe(antes + 1))
    expect(screen.getByText('Registro de aciertos')).toBeInTheDocument()
    expect(screen.getByText('Marca y dividendo')).toBeInTheDocument()
    expect(screen.queryByText(/^Cargando/)).toBeNull()
  })
})
