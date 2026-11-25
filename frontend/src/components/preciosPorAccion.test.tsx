/**
 * Revisión 5: precios y valores por acción que seguían con fmtNum (dos decimales
 * fijos) y daban «0,00» en una acción de céntimos: el BPA de los estados
 * financieros y el máximo y el mínimo de 52 semanas de la ficha. Es el patrón A1:
 * un precio o un nivel, siempre con fmtPrecio.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Financials, Fundamentals } from '../api/types'
import { FundamentalsGrid } from './FundamentalsGrid'
import { FinancialsSection } from './ticker/FinancialsSection'

const FUENTE = { source: 'prueba', as_of: '2026-09-12T14:35:00+00:00', cached: false, fetched_at: null, estado: 'valido' as const }

afterEach(() => vi.unstubAllGlobals())

describe('precios por acción de céntimos', () => {
  it('el máximo y el mínimo de 52 semanas', () => {
    const datos: Fundamentals = { ...FUENTE, symbol: 'CENT', period: 'ttm', metrics: { week52_high: 0.0048, week52_low: 0.0021 } }
    const carga = { estado: 'listo' as const, datos, error: null, reintentar: () => {}, refrescar: () => {}, refrescando: false }
    render(<FundamentalsGrid carga={carga} symbol="CENT" />)
    expect(screen.getByText('0,0048')).toBeInTheDocument()
    expect(screen.getByText('0,0021')).toBeInTheDocument()
  })

  it('el BPA diluido de los estados financieros', async () => {
    const financieros: Financials = {
      ...FUENTE, symbol: 'CENT', entity: 'Cent Corp',
      periods: [{ fiscal_year: '2025', end_date: '2025-12-31', eps_diluted: 0.0042 } as Financials['periods'][number]],
      ratios: [{ fiscal_year: '2025' } as Financials['ratios'][number]],
      growth: { years: 3, revenue_cagr: null, eps_cagr: null, fcf_cagr: null },
    }
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      return url.endsWith('/financials')
        ? new Response(JSON.stringify(financieros), { status: 200 })
        : new Response(JSON.stringify({ detail: 'sin pares' }), { status: 404 })
    }))
    render(<FinancialsSection symbol="CENT" />)
    expect(await screen.findByText('0,0042')).toBeInTheDocument()
  })
})
