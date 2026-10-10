/**
 * Ítem 2.1: el riesgo de mercado hacía `() => setRisk(null)`. Si fallaba, beta,
 * volatilidad y drawdown salían «—», como si la fuente no los reportara.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Health, RiskResponse } from '../../api/types'
import { HealthSection } from './HealthSection'

afterEach(() => vi.unstubAllGlobals())

const FUENTE = { source: 'prueba', as_of: '2026-09-12T14:35:00+00:00', cached: false, fetched_at: null, estado: 'valido' as const }

const SALUD: Health = {
  ...FUENTE,
  symbol: 'ACME',
  altman_z: { score: 3.1, zone: 'segura', components: {}, note: 'Z de Altman para manufactureras.' },
  piotroski_f: { score: 6, max_possible: 9, signals: [], fiscal_years: ['2024', '2025'] },
  interest_coverage: 12,
  net_debt: 100_000_000,
  deuda_parcial: null,
  fcf: 200_000_000,
  fiscal_year: '2025',
  market_cap_used: null,
}

const RIESGO_SIN_DATOS: RiskResponse = {
  ...FUENTE,
  symbol: 'ACME',
  window: '1Y (barras diarias)',
  beta_vs_spy: null,
  annualized_volatility: null,
  max_drawdown: null,
}

function servir(rutas: Record<string, { status: number; json: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url] ?? { status: 503, json: { detail: `sin fixture: ${url}` } }
      return new Response(JSON.stringify(r.json), { status: r.status })
    }),
  )
}

describe('salud y riesgo de la ficha', () => {
  it('un riesgo de mercado que no carga se dice, no se pinta como «—»', async () => {
    servir({
      '/api/stocks/ACME/health': { status: 200, json: SALUD },
      '/api/stocks/ACME/risk': { status: 502, json: { detail: 'histórico caído' } },
    })
    render(<HealthSection symbol="ACME" />)
    expect(
      await screen.findByText(
        'No se pudieron cargar las métricas de riesgo (beta, volatilidad y drawdown): histórico caído',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    // Las cifras de la salud siguen; las del riesgo no se inventan.
    expect(screen.getByText('Cobertura de intereses')).toBeInTheDocument()
    expect(screen.queryByText('Beta vs. SPY (1A)')).not.toBeInTheDocument()
  })

  it('con el riesgo cargado, un drawdown ausente es «—» sin rojo', async () => {
    servir({
      '/api/stocks/ACME/health': { status: 200, json: SALUD },
      '/api/stocks/ACME/risk': { status: 200, json: RIESGO_SIN_DATOS },
    })
    render(<HealthSection symbol="ACME" />)
    const etiqueta = await screen.findByText('Máx. drawdown (1A)')
    const valor = etiqueta.nextElementSibling as HTMLElement
    expect(valor).toHaveTextContent('—')
    expect(valor.className).not.toMatch(/red/)
  })

  it('una salud que no carga es un fallo con su motivo y «Reintentar»', async () => {
    servir({ '/api/stocks/ACME/health': { status: 502, json: { detail: 'EDGAR caído' } } })
    render(<HealthSection symbol="ACME" />)
    expect(await screen.findByText('No se pudo cargar la salud financiera: EDGAR caído')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
