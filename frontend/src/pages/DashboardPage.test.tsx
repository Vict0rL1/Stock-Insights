/**
 * V13: el calendario de resultados confundía un fallo con «no hay eventos» y
 * adivinaba la causa («¿falta FINNHUB_API_KEY en .env?»). Un fallo dice lo que
 * pasó; una lista vacía dice que no hay resultados anunciados.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'

afterEach(() => vi.unstubAllGlobals())

function servir(calendario: { status: number; json: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    if (url.startsWith('/api/market/calendar'))
      return new Response(JSON.stringify(calendario.json), { status: calendario.status })
    return new Response(JSON.stringify({ detail: 'sin datos en el test' }), { status: 503 })
  }))
}

describe('calendario de resultados del panel de mercado', () => {
  it('un fallo se dice como fallo, con su motivo', async () => {
    servir({ status: 502, json: { detail: 'el proveedor no respondió' } })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(await screen.findByText(/No se pudo cargar el calendario de resultados: el proveedor no respondió/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/FINNHUB_API_KEY/)
  })

  it('la curva y los indicadores de FRED que fallan lo dicen, sin adivinar la clave (revisión F1)', async () => {
    servir({ status: 200, json: { events: [] } })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(await screen.findByText('No se pudo cargar la curva: sin datos en el test')).toBeInTheDocument()
    expect(await screen.findByText('No se pudieron cargar los indicadores: sin datos en el test')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/FRED_API_KEY/)
  })

  it('índices y sectores que fallan lo dicen, no se pintan como «no hay datos» (ítem 2.1)', async () => {
    servir({ status: 200, json: { events: [] } })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(await screen.findByText('No se pudieron cargar los índices: sin datos en el test')).toBeInTheDocument()
    expect(await screen.findByText('No se pudieron cargar los sectores: sin datos en el test')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Reintentar' }).length).toBeGreaterThanOrEqual(4)
  })

  it('una lista vacía dice que no hay resultados anunciados', async () => {
    servir({ status: 200, json: { events: [] } })
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(await screen.findByText('Ninguna empresa anuncia resultados en los próximos 14 días.')).toBeInTheDocument()
  })
})

describe('índices y sectores con dato viejo o sin dato (revisión del 2.1)', () => {
  const cotizacion = (symbol: string, estado: 'valido' | 'viejo') => ({
    symbol, price: 100, change: 1, change_pct: 1, prev_close: 99, day_high: null, day_low: null, day_open: null,
    currency: 'USD', freshness: 'delayed', source: 'yfinance', as_of: '2026-09-12T14:35:00+00:00', cached: true,
    fetched_at: '2026-09-12T14:35:00+00:00', estado, antiguedad_segundos: estado === 'viejo' ? 1200 : null,
  })

  it('un precio rescatado de la caché se dice, y uno que falta dice por qué', async () => {
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const json =
        url === '/api/market/overview'
          ? { indices: [
              { symbol: 'SPY', label: 'S&P 500', quote: cotizacion('SPY', 'viejo') },
              { symbol: 'QQQ', label: 'Nasdaq 100', quote: null },
            ] }
          : url === '/api/market/sectors'
            ? { sectors: [
                { symbol: 'XLK', label: 'Tecnología', change_pct: 1, quote: cotizacion('XLK', 'viejo') },
                { symbol: 'XLE', label: 'Energía', change_pct: null, quote: null },
              ], note: '' }
            : null
      return json ? new Response(JSON.stringify(json), { status: 200 }) : new Response(JSON.stringify({ detail: 'sin datos' }), { status: 503 })
    }))
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    const sp = (await screen.findByText('S&P 500')).parentElement!
    expect(sp.textContent).toContain('DATO VIEJO · yfinance · hace 20 min')
    expect(screen.getByText('Nasdaq 100').parentElement!.textContent).toContain('sin dato: ninguna fuente dio precio')
    expect((await screen.findByText(/^Tecnología:/)).textContent).toContain('DATO VIEJO')
    expect(screen.getByText('Sin dato (ninguna fuente dio precio): Energía.')).toBeInTheDocument()
  })
})
