/**
 * Revisión 12, visual: con la IA apagada, Resultados no avisaba de que la
 * extracción de guidance, riesgos y temas la hace la IA (solo la barra lateral,
 * que a 390 px ni se ve), y «Ver qué costaría» acababa en «Error HTTP 500».
 * Ahora lo dice arriba, como Noticias, y no ofrece el paso; la lista de
 * reportes sigue a la vista.
 *
 * El estado de la IA se comparte en el módulo `llm`: cada test lo importa de
 * nuevo para no heredar el del anterior.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Respuesta = { status: number; json: unknown }

const DISPONIBLES = {
  symbol: 'ACME',
  filings: [
    { type: '10-Q', filed_at: '2026-08-01', accession_no: '0000000001-26-000010', url: 'https://www.sec.gov/a.htm', analizado: false },
  ],
  limitacion_transcripciones: 'Las transcripciones de earnings calls NO se analizan.',
}
const HISTORIAL = {
  symbol: 'ACME', extracciones: [], comparaciones: [], trimestres: 0, serie_guidance: [],
  nota: 'Todavía no hay ningún reporte analizado para esta empresa.',
}

function servir(llm: Respuesta): string[] {
  const pedidas: string[] = []
  const rutas: Record<string, Respuesta> = {
    '/api/meta/llm': llm,
    '/api/watchlist': { status: 200, json: { name: 'principal', items: [] } },
    '/api/earnings/ACME/disponibles': { status: 200, json: DISPONIBLES },
    '/api/earnings/ACME': { status: 200, json: HISTORIAL },
  }
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    pedidas.push(url)
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 })
  }))
  return pedidas
}

/** Pinta Resultados, pide los reportes de ACME y devuelve el botón del coste. */
async function verReportes() {
  const { EarningsPage } = await import('./EarningsPage')
  render(<MemoryRouter><EarningsPage /></MemoryRouter>)
  fireEvent.change(screen.getByPlaceholderText('AAPL'), { target: { value: 'acme' } })
  fireEvent.click(screen.getByRole('button', { name: 'Ver reportes' }))
  return screen.findByRole('button', { name: 'Ver qué costaría' })
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('Resultados con la IA apagada (revisión 12, visual)', () => {
  it('lo dice arriba, la lista sigue a la vista y «Ver qué costaría» no se ofrece', async () => {
    const pedidas = servir({ status: 200, json: { configured: false, model: null } })
    const coste = await verReportes()
    expect(
      screen.getByText(/^La extracción la hace la IA, y la capa de IA está desactivada: sin ANTHROPIC_API_KEY/),
    ).toBeInTheDocument()
    expect(screen.getByText('Reportes de ACME')).toBeInTheDocument()
    expect(coste).toBeDisabled()
    fireEvent.click(coste)
    expect(pedidas.some((u) => u.includes('/coste'))).toBe(false)
  })

  it('si no se pudo comprobar la IA, lo dice con el fallo y tampoco ofrece el coste', async () => {
    servir({ status: 502, json: { detail: 'el backend está arrancando' } })
    const coste = await verReportes()
    expect(await screen.findByText(/no se pudo comprobar si está encendida \(el backend está arrancando\)/)).toBeInTheDocument()
    expect(coste).toBeDisabled()
  })

  it('con la IA encendida no hay aviso y el coste se puede pedir', async () => {
    servir({ status: 200, json: { configured: true, model: 'modelo-de-prueba' } })
    const coste = await verReportes()
    await waitFor(() => expect(coste).toBeEnabled())
    expect(screen.queryByText(/La extracción la hace la IA/)).toBeNull()
  })
})
