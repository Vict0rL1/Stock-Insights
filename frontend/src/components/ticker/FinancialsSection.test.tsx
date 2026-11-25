/**
 * Ítem 2.1: los pares hacían `() => setPeers(null)` y, si fallaban, la sección
 * de comparables desaparecía sin decir nada. Y un fallo de los estados
 * financieros se llevaba por delante también los pares, que no dependen de él.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Financials, PeersResponse } from '../../api/types'
import { FinancialsSection } from './FinancialsSection'

afterEach(() => vi.unstubAllGlobals())

const FUENTE = { source: 'prueba', as_of: '2026-09-12T14:35:00+00:00', cached: false, fetched_at: null, estado: 'valido' as const }

const FINANCIEROS: Financials = {
  ...FUENTE,
  symbol: 'ACME',
  entity: 'Acme Corp',
  periods: [],
  ratios: [],
  growth: { years: 3, revenue_cagr: null, eps_cagr: null, fcf_cagr: null },
}

const pares = (percentiles: Record<string, number | null>, filas = ['ACME', 'PAR1', 'PAR2']): PeersResponse => ({
  ...FUENTE,
  symbol: 'ACME',
  peers: filas.map((symbol) => ({ symbol, metrics: { pe_ttm: 20 }, source: 'prueba' })),
  percentiles,
  comparison_keys: ['pe_ttm'],
  note: 'Percentil = % de la muestra (empresa + pares) con valor ≤ al de la empresa.',
})

type Respuesta = { status: number; json: unknown }

function servir(rutas: Record<string, Respuesta>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url] ?? { status: 503, json: { detail: `sin fixture: ${url}` } }
      return new Response(JSON.stringify(r.json), { status: r.status })
    }),
  )
}

describe('estados financieros y pares de la ficha', () => {
  it('unos pares que no cargan lo dicen; la sección no desaparece', async () => {
    servir({
      '/api/stocks/ACME/financials': { status: 200, json: FINANCIEROS },
      '/api/stocks/ACME/peers': { status: 502, json: { detail: 'pares caídos' } },
    })
    render(<FinancialsSection symbol="ACME" />)
    expect(await screen.findByText('No se pudo cargar la comparativa con pares: pares caídos')).toBeInTheDocument()
    expect(screen.getByText(/Comparativa con pares/)).toBeInTheDocument()
    expect(screen.getByText(/Estados financieros anuales/)).toBeInTheDocument()
  })

  it('unos estados financieros que no cargan son un fallo, y los pares siguen', async () => {
    const rutas: Record<string, Respuesta> = {
      '/api/stocks/ACME/financials': { status: 502, json: { detail: 'EDGAR caído' } },
      '/api/stocks/ACME/peers': { status: 200, json: pares({ pe_ttm: 67 }) },
    }
    servir(rutas)
    render(<FinancialsSection symbol="ACME" />)
    expect(
      await screen.findByText('No se pudieron cargar los estados financieros de EDGAR: EDGAR caído'),
    ).toBeInTheDocument()
    expect(await screen.findByText('PAR1')).toBeInTheDocument()
    expect(screen.getByText('P67')).toBeInTheDocument()

    rutas['/api/stocks/ACME/financials'] = { status: 200, json: FINANCIEROS }
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText(/Estados financieros anuales/)).toBeInTheDocument()
  })

  it('sin fundamentales de la empresa (percentiles vacíos) el percentil es «—», no «Pundefined»', async () => {
    servir({
      '/api/stocks/ACME/financials': { status: 200, json: FINANCIEROS },
      '/api/stocks/ACME/peers': { status: 200, json: pares({}, ['PAR1', 'PAR2']) },
    })
    render(<FinancialsSection symbol="ACME" />)
    const fila = (await screen.findByText('Percentil ACME')).closest('tr') as HTMLElement
    expect(fila).toHaveTextContent('—')
    expect(document.body.textContent).not.toMatch(/undefined/)
  })

  it('sin pares con los que comparar se dice, en vez de esconder la sección', async () => {
    servir({
      '/api/stocks/ACME/financials': { status: 200, json: FINANCIEROS },
      '/api/stocks/ACME/peers': { status: 200, json: pares({ pe_ttm: null }, ['ACME']) },
    })
    render(<FinancialsSection symbol="ACME" />)
    expect(
      await screen.findByText('Ninguna fuente devolvió pares con fundamentales para comparar ACME.'),
    ).toBeInTheDocument()
  })
})
