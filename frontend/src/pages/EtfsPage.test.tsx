/**
 * Revisión del 2.1 en ETFs: el comparador pintaba una sola insignia, la del
 * primer ETF, para toda la tabla. Cada ETF se pide por separado y puede llegar
 * viejo por su cuenta: un segundo rescatado de la caché (hasta una semana)
 * parecía tan fresco como el primero.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EtfData } from '../api/types'
import { EtfsPage } from './EtfsPage'

afterEach(() => vi.unstubAllGlobals())

const etf = (symbol: string, estado: 'valido' | 'viejo', antiguedad: number | null): EtfData => ({
  source: 'yfinance', as_of: '2026-09-12T14:35:00+00:00', cached: estado === 'viejo', fetched_at: '2026-09-12T14:35:00+00:00',
  estado, antiguedad_segundos: antiguedad,
  symbol, name: `${symbol} Fund`, category: null, expense_ratio: 0.0003, aum: null, dividend_yield: null,
  currency: 'USD', top_holdings: [], sector_weights: {},
})

describe('ETFs (revisión del 2.1)', () => {
  it('cada ETF dice su fuente y su estado; un segundo ETF viejo no se da por fresco', async () => {
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const json = url.startsWith('/api/etfs/compare')
        ? { etfs: [etf('VOO', 'valido', null), etf('QQQ', 'viejo', 3 * 86400)], overlaps: [], errors: {}, note: '' }
        : { evaluados: [], recomendados: [], avisos: [], nota: '', errors: {}, aviso_solapamiento: '' }
      return new Response(JSON.stringify(json), { status: 200 })
    }))
    render(<MemoryRouter><EtfsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Analizar y recomendar' }))
    const qqq = await screen.findByText(/^QQQ:/)
    expect(qqq.textContent).toContain('DATO VIEJO · yfinance · hace 3 días')
    expect(screen.getByText(/^VOO:/).textContent).not.toContain('VIEJO')
  })
})
