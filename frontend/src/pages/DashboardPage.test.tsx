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

describe('cotizaciones de Mercado con fecha, fuente y color de lo que se lee (revisión 12, visual)', () => {
  const cotizacion = (symbol: string, change_pct: number | null, extra: Record<string, unknown> = {}) => ({
    symbol, price: 100, change: null, change_pct, prev_close: 99, day_high: null, day_low: null, day_open: null,
    currency: 'USD', freshness: 'live', source: 'finnhub', as_of: '2026-09-11T20:00:00+00:00', cached: false,
    fetched_at: null, estado: 'valido', ...extra,
  })

  function servirMercado() {
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const json =
        url === '/api/market/overview'
          ? { indices: [
              { symbol: 'SPY', label: 'S&P 500', quote: cotizacion('SPY', 1.5) },
              { symbol: 'QQQ', label: 'Nasdaq 100', quote: cotizacion('QQQ', 0) },
              { symbol: 'DIA', label: 'Dow Jones', quote: cotizacion('DIA', 0.004) },
              { symbol: 'IWM', label: 'Russell 2000', quote: cotizacion('IWM', -0.5) },
              { symbol: '^VIX', label: 'VIX', quote: cotizacion('^VIX', 0.5, { source: 'yfinance', as_of: '2026-09-12T14:35:00+00:00' }) },
            ] }
          : url === '/api/market/sectors'
            ? { sectors: [
                { symbol: 'XLE', label: 'Energía', change_pct: 1.5, quote: cotizacion('XLE', 1.5) },
                { symbol: 'XLK', label: 'Tecnología', change_pct: 0, quote: cotizacion('XLK', 0) },
                { symbol: 'XLF', label: 'Financiero', change_pct: -0.5, quote: cotizacion('XLF', -0.5, { source: 'twelvedata' }) },
              ], note: '' }
            : null
      return json ? new Response(JSON.stringify(json), { status: 200 }) : new Response(JSON.stringify({ detail: 'sin datos' }), { status: 503 })
    }))
  }

  it('una variación que se lee 0,00 % no se pinta como subida', async () => {
    servirMercado()
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    const chip = (label: string) => {
      const tarjeta = screen.getByText(label).parentElement!
      return [...tarjeta.querySelectorAll('span')].find((s) => s.textContent?.includes('%'))!
    }
    await screen.findByText('Nasdaq 100')
    expect(chip('S&P 500').className).toMatch(/emerald/)
    expect(chip('Russell 2000').className).toMatch(/red/)
    // 0 y 0,004 se escriben «0,00 %»: ni verde ni rojo.
    for (const label of ['Nasdaq 100', 'Dow Jones']) {
      expect(chip(label).textContent).toBe('0,00\u00a0%')
      expect(chip(label).className).not.toMatch(/emerald|red/)
    }
    const tecnologia = screen.getByText('Tecnología').closest('li')!
    expect(tecnologia.textContent).toContain('0,00\u00a0%')
    expect(tecnologia.innerHTML).not.toMatch(/emerald|red/)
  })

  it('cada índice dice de qué fuente y de cuándo es, y los sectores también', async () => {
    servirMercado()
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    // 20:00 UTC del 11 sept son las 16:00 ET: el cierre del viernes, no «hoy».
    expect((await screen.findByText('S&P 500')).parentElement!.textContent).toContain(
      'finnhub · dato del 11 sept 2026, 16:00\u00a0ET',
    )
    expect(screen.getByText('VIX').parentElement!.textContent).toContain('yfinance · dato del 12 sept 2026, 10:35\u00a0ET')
    // `findByText` normaliza el espacio duro de «16:00 ET» a uno normal.
    expect(await screen.findByText('finnhub, twelvedata · dato del 11 sept 2026, 16:00 ET')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Sectores hoy/)
  })

  it('con datos de momentos distintos, los sectores dan el intervalo', async () => {
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      if (url !== '/api/market/sectors') return new Response(JSON.stringify({ detail: 'sin datos' }), { status: 503 })
      return new Response(JSON.stringify({ sectors: [
        { symbol: 'XLE', label: 'Energía', change_pct: 1, quote: cotizacion('XLE', 1, { as_of: '2026-09-12T14:35:00+00:00' }) },
        { symbol: 'XLK', label: 'Tecnología', change_pct: 1, quote: cotizacion('XLK', 1) },
        // Un dato viejo ya lleva su insignia: no entra en la línea de procedencia.
        { symbol: 'XLF', label: 'Financiero', change_pct: 1, quote: cotizacion('XLF', 1, { estado: 'viejo', source: 'otra', as_of: '2026-09-01T14:35:00+00:00' }) },
      ], note: '' }), { status: 200 })
    }))
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    expect(
      await screen.findByText('finnhub · datos del 11 sept 2026, 16:00 ET al 12 sept 2026, 10:35 ET'),
    ).toBeInTheDocument()
  })
})
