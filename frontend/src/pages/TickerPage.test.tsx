/**
 * Ítem 2.1: la ficha ya no depende de la cotización. Antes `Promise.all` la
 * hacía imprescindible: si `api.quote` fallaba (o la fuente no la tenía), la
 * ficha entera era «No se encontró el símbolo…», sin pestañas, aunque EDGAR
 * tuviera estados financieros (captura `empresa_sin_datos`). Perfil,
 * fundamentales e histórico se tragaban su fallo: un error de histórico salía
 * «Sin histórico disponible…» y uno de perfil o fundamentales, nada.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Financials, History, Profile, Quote } from '../api/types'
import { TickerPage } from './TickerPage'

// El gráfico dibuja en un canvas que jsdom no tiene; aquí basta con saber de
// qué símbolo es el que se pinta.
vi.mock('../components/PriceChart', () => ({
  PriceChart: ({ history }: { history: History }) => <div>Gráfico de {history.symbol}</div>,
}))

afterEach(() => vi.unstubAllGlobals())

const FUENTE = { source: 'prueba', as_of: '2026-09-12T14:35:00+00:00', cached: false, fetched_at: null, estado: 'valido' as const }

const cotizacion = (symbol: string, change: number | null): Quote => ({
  ...FUENTE,
  symbol,
  price: 92,
  change,
  change_pct: change === null ? null : -1.3,
  prev_close: 93.2,
  day_high: 94,
  day_low: 91,
  day_open: 93,
  currency: 'USD',
  freshness: 'delayed',
})

const perfil = (symbol: string, name: string): Profile => ({
  ...FUENTE,
  symbol,
  name,
  exchange: 'NYSE',
  sector: 'Industria',
  industry: null,
  market_cap: null,
  currency: 'USD',
  country: 'US',
  ipo: null,
  website: null,
})

const historico = (symbol: string): History => ({
  ...FUENTE,
  symbol,
  interval: '1day',
  range: '1Y',
  currency: 'USD',
  bars: [],
  indicators: { sma20: [], sma50: [], sma200: [], rsi14: [], macd: { macd: [], signal: [], histogram: [] } },
})

const financieros = (symbol: string): Financials => ({
  ...FUENTE,
  symbol,
  entity: 'Vacía Corp',
  periods: [],
  ratios: [],
  growth: { years: 3, revenue_cagr: null, eps_cagr: null, fcf_cagr: null },
})

type Respuesta = { status: number; json: unknown } | 'pendiente'
const ok = (json: unknown): Respuesta => ({ status: 200, json })
const falla = (status: number, detail: string): Respuesta => ({ status, json: { detail } })

/** Simula `fetch` por URL; lo que no está en `rutas` es un 503. El objeto se
 *  lee en cada petición, así que un test puede cambiarlo antes de reintentar. */
function servir(rutas: Record<string, Respuesta>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url] ?? falla(503, `sin fixture: ${url}`)
      if (r === 'pendiente') return new Promise<Response>(() => {})
      return Promise.resolve(new Response(JSON.stringify(r.json), { status: r.status }))
    }),
  )
}

function abrir(symbol: string) {
  return render(
    <MemoryRouter initialEntries={[`/ticker/${symbol}`]}>
      <Routes>
        <Route path="/ticker/:symbol" element={<TickerPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ficha de una empresa', () => {
  it('sin cotización en ninguna fuente (404), la cabecera y las pestañas siguen ahí', async () => {
    servir({
      '/api/stocks/VACIA/quote': falla(404, "'quote' no existe en ninguna fuente (yfinance)"),
      '/api/stocks/VACIA/profile': ok(perfil('VACIA', 'Vacía Corp')),
      '/api/stocks/VACIA/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/VACIA/history?range=1Y': falla(404, 'sin histórico'),
      '/api/stocks/VACIA/financials': ok(financieros('VACIA')),
      '/api/stocks/VACIA/peers': falla(404, 'sin pares'),
    })
    abrir('VACIA')
    expect(
      await screen.findByText('Precio no disponible: ninguna fuente configurada tiene cotización de VACIA.'),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/No se encontró el símbolo/)
    // El nombre, del perfil; el 404 de fundamentales e histórico es «no lo
    // tiene», no un fallo.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vacía Corp')
    expect(
      await screen.findByText('Ninguna fuente configurada tiene fundamentales básicos de VACIA.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Sin histórico disponible para VACIA en las fuentes configuradas.')).toBeInTheDocument()
    // Las pestañas existen y cargan lo que EDGAR sí tiene.
    fireEvent.click(screen.getByRole('button', { name: 'Fundamentales' }))
    expect(await screen.findByText(/Estados financieros anuales/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decisiones y replay' })).toBeInTheDocument()
  })

  it('una cotización que no carga se dice como fallo, con su motivo, y se puede reintentar', async () => {
    const rutas: Record<string, Respuesta> = {
      '/api/stocks/ACME/quote': falla(502, 'el proveedor no respondió'),
      '/api/stocks/ACME/profile': falla(404, 'sin perfil'),
      '/api/stocks/ACME/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/ACME/history?range=1Y': ok(historico('ACME')),
    }
    servir(rutas)
    abrir('ACME')
    const fallo = await screen.findByText('No se pudo cargar la cotización: el proveedor no respondió')
    // Sin perfil, el nombre es el símbolo, y se dice que no hay perfil.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ACME')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('sin perfil en las fuentes configuradas')
    expect(await screen.findByText('Gráfico de ACME')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salud y riesgo' })).toBeInTheDocument()

    rutas['/api/stocks/ACME/quote'] = ok(cotizacion('ACME', -1.2))
    fireEvent.click(within(fallo.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('92,00')).toBeInTheDocument()
  })

  it('perfil y fundamentales que fallan lo dicen en su sitio (antes `.catch(() => null)`)', async () => {
    servir({
      '/api/stocks/ACME/quote': ok(cotizacion('ACME', -1.2)),
      '/api/stocks/ACME/profile': falla(502, 'perfil caído'),
      '/api/stocks/ACME/fundamentals': falla(502, 'fundamentales caídos'),
      '/api/stocks/ACME/history?range=1Y': ok(historico('ACME')),
    })
    abrir('ACME')
    expect(await screen.findByText('No se pudo cargar el perfil: perfil caído')).toBeInTheDocument()
    expect(
      await screen.findByText('No se pudieron cargar los fundamentales básicos: fundamentales caídos'),
    ).toBeInTheDocument()
  })

  it('un histórico que falla es un fallo, no «Sin histórico disponible»', async () => {
    servir({
      '/api/stocks/ACME/quote': ok(cotizacion('ACME', -1.2)),
      '/api/stocks/ACME/profile': ok(perfil('ACME', 'Acme Corp')),
      '/api/stocks/ACME/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/ACME/history?range=1Y': falla(502, 'histórico caído'),
    })
    abrir('ACME')
    expect(await screen.findByText('No se pudo cargar el histórico: histórico caído')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Sin histórico disponible/)
  })

  it('al cambiar de símbolo no queda el gráfico del anterior bajo la cabecera del nuevo', async () => {
    servir({
      '/api/stocks/ACME/quote': ok(cotizacion('ACME', -1.2)),
      '/api/stocks/ACME/profile': ok(perfil('ACME', 'Acme Corp')),
      '/api/stocks/ACME/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/ACME/history?range=1Y': ok(historico('ACME')),
      '/api/stocks/OTRA/quote': ok(cotizacion('OTRA', 0.5)),
      '/api/stocks/OTRA/profile': ok(perfil('OTRA', 'Otra Corp')),
      '/api/stocks/OTRA/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/OTRA/history?range=1Y': 'pendiente',
    })
    abrir('ACME')
    expect(await screen.findByText('Gráfico de ACME')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Ticker/), { target: { value: 'otra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }))
    expect(await screen.findByText('Cargando el histórico…')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: /Otra Corp/ })).toBeInTheDocument()
    expect(screen.queryByText('Gráfico de ACME')).not.toBeInTheDocument()
  })

  it('un cambio del día desconocido no se pinta en verde', async () => {
    servir({
      '/api/stocks/ACME/quote': ok(cotizacion('ACME', null)),
      '/api/stocks/ACME/profile': falla(404, 'sin perfil'),
      '/api/stocks/ACME/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/ACME/history?range=1Y': falla(404, 'sin histórico'),
    })
    abrir('ACME')
    const cambio = await screen.findByText('— (—)')
    expect(cambio.className).not.toMatch(/emerald|red/)
    expect(cambio.className).toMatch(/slate/)
  })
})
