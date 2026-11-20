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
  ventana: { sesiones: 252, pedidas: 252, desde: '2025-09-12', hasta: '2026-09-11', parcial: false },
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

  it('el Altman Z se escribe de su lado de las fronteras de su zona (revisión 10)', async () => {
    // 2,9904 y 2,9896 salían los dos «2,99», uno «zona segura» y el otro «zona gris».
    servir({
      '/api/stocks/ACME/health': {
        status: 200,
        json: { ...SALUD, altman_z: { ...SALUD.altman_z, score: 2.9896, zone: 'gris', umbrales: [1.81, 2.99] } },
      },
      '/api/stocks/ACME/risk': { status: 200, json: RIESGO_SIN_DATOS },
    })
    render(<HealthSection symbol="ACME" />)
    expect(await screen.findByText('2,9896')).toBeInTheDocument()
  })

  // Revisión 12, visual: «Máx. drawdown (1A) 0,0 %» salía en rojo, con «pico 26
  // dic 2025 → valle 26 dic 2025»: un cero pintado como alarma.
  it('un drawdown de cero no se pinta en rojo ni da un pico y un valle del mismo día', async () => {
    servir({
      '/api/stocks/ACME/health': { status: 200, json: SALUD },
      '/api/stocks/ACME/risk': {
        status: 200,
        json: { ...RIESGO_SIN_DATOS, max_drawdown: { max_drawdown: 0, peak: '2025-12-26', trough: '2025-12-26' } },
      },
    })
    const { container } = render(<HealthSection symbol="ACME" />)
    const valor = (await screen.findByText(/^Máx\. drawdown/)).nextElementSibling as HTMLElement
    expect(valor).toHaveTextContent('0,0 %')
    expect(valor.className).not.toMatch(/red/)
    expect(container.textContent).toContain('Drawdown: ninguna caída desde un máximo en la ventana.')
    expect(container.textContent).not.toMatch(/pico .* → valle/)
  })

  it('una caída de verdad sí va en rojo, con su pico y su valle', async () => {
    servir({
      '/api/stocks/ACME/health': { status: 200, json: SALUD },
      '/api/stocks/ACME/risk': {
        status: 200,
        json: { ...RIESGO_SIN_DATOS, max_drawdown: { max_drawdown: -0.25, peak: '2026-02-02', trough: '2026-04-07' } },
      },
    })
    const { container } = render(<HealthSection symbol="ACME" />)
    const valor = (await screen.findByText(/^Máx\. drawdown/)).nextElementSibling as HTMLElement
    expect(valor).toHaveTextContent('-25,0 %')
    expect(valor.className).toMatch(/red/)
    expect(container.textContent).toContain('Drawdown: pico 2 feb 2026 → valle 7 abr 2026.')
  })

  // Revisión 12, visual: el pie decía «Ventana: 1Y (barras diarias)», en inglés y
  // fijo: ni desde cuándo había serie (26 dic 2025) ni «parcial» si no llegaba a un año.
  it('la ventana es la medida, en español, y dice «parcial» si no llega a un año', async () => {
    servir({
      '/api/stocks/ACME/health': { status: 200, json: SALUD },
      '/api/stocks/ACME/risk': {
        status: 200,
        json: {
          ...RIESGO_SIN_DATOS,
          ventana: { sesiones: 180, pedidas: 252, desde: '2025-12-26', hasta: '2026-09-11', parcial: true },
        },
      },
    })
    const { container } = render(<HealthSection symbol="ACME" />)
    expect((await screen.findByText(/^Máx\. drawdown/)).textContent).toBe('Máx. drawdown (1Aparcial)')
    expect(screen.getByText(/^Beta vs\. SPY/).textContent).toBe('Beta vs. SPY (1Aparcial)')
    expect(container.textContent).toContain(
      'Ventana: 180 sesiones diarias, del 26 dic 2025 al 11 sept 2026 · parcial: un año completo son 252.',
    )
    expect(container.textContent).not.toMatch(/1Y/)
  })

  it('con el año completo, la ventana no lleva «parcial»', async () => {
    servir({
      '/api/stocks/ACME/health': { status: 200, json: SALUD },
      '/api/stocks/ACME/risk': { status: 200, json: RIESGO_SIN_DATOS },
    })
    const { container } = render(<HealthSection symbol="ACME" />)
    expect((await screen.findByText(/^Máx\. drawdown/)).textContent).toBe('Máx. drawdown (1A)')
    expect(container.textContent).toContain('Ventana: 252 sesiones diarias, del 12 sept 2025 al 11 sept 2026.')
    expect(container.textContent).not.toMatch(/parcial/)
  })
})
