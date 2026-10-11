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

  it('sin cotización, perfil ni fundamentales, pero con estados en EDGAR, la ficha y sus pestañas siguen ahí', async () => {
    // La captura `empresa_sin_datos`: VACIA solo existe en EDGAR. Contar solo
    // los tres primeros 404 la daba por inexistente (segunda revisión del 2.1).
    servir({
      '/api/stocks/VACIA/quote': falla(404, 'sin cotización'),
      '/api/stocks/VACIA/profile': falla(404, 'sin perfil'),
      '/api/stocks/VACIA/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/VACIA/history?range=1Y': falla(404, 'sin histórico'),
      '/api/stocks/VACIA/financials': ok(financieros('VACIA')),
    })
    abrir('VACIA')
    expect(await screen.findByRole('button', { name: 'Fundamentales' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/No se encontró el símbolo/)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('sin perfil en las fuentes configuradas')
  })

  it('un símbolo que ninguna fuente conoce dice «No se encontró» y no abre pestañas', async () => {
    // Revisión del 2.1: con las 11 pestañas abiertas, «Qué cambió» congelaba
    // una instantánea inmutable de «AAPLL» que ya no se podía borrar.
    servir({
      '/api/stocks/AAPLL/quote': falla(404, 'sin cotización'),
      '/api/stocks/AAPLL/profile': falla(404, 'sin perfil'),
      '/api/stocks/AAPLL/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/AAPLL/history?range=1Y': falla(404, 'sin histórico'),
      '/api/stocks/AAPLL/financials': falla(404, 'AAPLL no está registrado en la SEC'),
    })
    abrir('AAPLL')
    expect(await screen.findByText('No se encontró el símbolo «AAPLL» en las fuentes configuradas.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Qué cambió' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('las pestañas no se abren hasta saber que el símbolo existe', async () => {
    servir({
      '/api/stocks/ACME/quote': 'pendiente',
      '/api/stocks/ACME/profile': 'pendiente',
      '/api/stocks/ACME/fundamentals': 'pendiente',
      '/api/stocks/ACME/history?range=1Y': 'pendiente',
    })
    abrir('ACME')
    expect(await screen.findByText('Cargando la cotización…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Qué cambió' })).toBeNull()
  })

  it('cambiar de símbolo con «Qué cambió» abierto no pide el análisis del nuevo antes de saber si existe', async () => {
    const rutas: Record<string, Respuesta> = {
      '/api/stocks/ACME/quote': ok(cotizacion('ACME', -1.2)),
      '/api/stocks/ACME/profile': ok(perfil('ACME', 'Acme Corp')),
      '/api/stocks/ACME/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/ACME/history?range=1Y': ok(historico('ACME')),
      '/api/empresa/ACME/analisis': 'pendiente',
      '/api/stocks/AAPLL/quote': falla(404, 'sin cotización'),
      '/api/stocks/AAPLL/profile': falla(404, 'sin perfil'),
      '/api/stocks/AAPLL/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/AAPLL/history?range=1Y': falla(404, 'sin histórico'),
      '/api/stocks/AAPLL/financials': falla(404, 'AAPLL no está registrado en la SEC'),
    }
    servir(rutas)
    abrir('ACME')
    fireEvent.click(await screen.findByRole('button', { name: 'Qué cambió' }))
    fireEvent.change(screen.getByPlaceholderText(/Ticker/), { target: { value: 'aapll' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }))
    expect(await screen.findByText(/No se encontró el símbolo «AAPLL»/)).toBeInTheDocument()
    const pedidas = vi.mocked(fetch).mock.calls.map(([e]) => String(e))
    // La de ACME sí se pidió: la pestaña estaba abierta y el filtro mira bien.
    expect(pedidas.some((u) => u.startsWith('/api/empresa/ACME/analisis'))).toBe(true)
    // El análisis es lo que congela; el historial (solo lectura) sí se mira.
    expect(pedidas.filter((u) => u.startsWith('/api/empresa/AAPLL/analisis'))).toEqual([])
  })

  it('volver a un símbolo no reabre la pestaña que tenía: «Qué cambió» no se vuelve a pedir solo', async () => {
    // Segunda revisión del 2.1: A («Qué cambió») → B → A reabría «Qué cambió» y
    // volvía a pedir (y a poder congelar) el análisis sin que nadie lo abriera.
    const rutas: Record<string, Respuesta> = {
      '/api/empresa/ACME/analisis': 'pendiente',
    }
    for (const s of ['ACME', 'OTRA']) {
      rutas[`/api/stocks/${s}/quote`] = ok(cotizacion(s, 0.5))
      rutas[`/api/stocks/${s}/profile`] = ok(perfil(s, `${s} Corp`))
      rutas[`/api/stocks/${s}/fundamentals`] = falla(404, 'sin fundamentales')
      rutas[`/api/stocks/${s}/history?range=1Y`] = ok(historico(s))
    }
    servir(rutas)
    abrir('ACME')
    fireEvent.click(await screen.findByRole('button', { name: 'Qué cambió' }))
    const analisis = () => vi.mocked(fetch).mock.calls.filter(([e]) => String(e).startsWith('/api/empresa/ACME/analisis')).length
    expect(analisis()).toBe(1)
    for (const s of ['otra', 'acme']) {
      fireEvent.change(screen.getByPlaceholderText(/Ticker/), { target: { value: s } })
      fireEvent.click(screen.getByRole('button', { name: 'Analizar' }))
      expect(await screen.findByRole('heading', { level: 1, name: new RegExp(`${s.toUpperCase()} Corp`) })).toBeInTheDocument()
    }
    expect(await screen.findByText('Gráfico de ACME')).toBeVisible()
    expect(analisis()).toBe(1)
  })

  it('un símbolo que ya no está en ninguna fuente enseña sus decisiones guardadas', async () => {
    // Un valor deslistado con decisiones congeladas: el historial es la única
    // entrada a sus replays (segunda revisión del 2.1).
    servir({
      '/api/stocks/VIEJA/quote': falla(404, 'sin cotización'),
      '/api/stocks/VIEJA/profile': falla(404, 'sin perfil'),
      '/api/stocks/VIEJA/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/VIEJA/history?range=1Y': falla(404, 'sin histórico'),
      '/api/stocks/VIEJA/financials': falla(404, 'edgar: VIEJA no está registrado en la SEC'),
      '/api/empresa/VIEJA/historial': ok({
        symbol: 'VIEJA', reglas_version_actual: 'v1',
        decisiones: [{ id: 4, fecha: '2026-03-02', creado_en: '2026-03-02T15:00:00+00:00', origen: 'hoy:us_sp500',
                       accion: 'comprar', precio: 20, score: 0.5 }],
      }),
    })
    abrir('VIEJA')
    expect(await screen.findByText('No se encontró el símbolo «VIEJA» en las fuentes configuradas.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Replay' })).toBeInTheDocument()
  })

  it('si no se pueden consultar las decisiones guardadas de un símbolo no encontrado, se dice', async () => {
    // Tercera pasada: con el historial en 500 la página solo decía «No se
    // encontró el símbolo», como si no hubiera nada guardado.
    const rutas: Record<string, Respuesta> = {
      '/api/stocks/VIEJA/quote': falla(404, 'sin cotización'),
      '/api/stocks/VIEJA/profile': falla(404, 'sin perfil'),
      '/api/stocks/VIEJA/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/VIEJA/history?range=1Y': falla(404, 'sin histórico'),
      '/api/stocks/VIEJA/financials': falla(404, 'edgar: VIEJA no está registrado en la SEC'),
      '/api/empresa/VIEJA/historial': falla(500, 'database is locked'),
    }
    servir(rutas)
    abrir('VIEJA')
    const fallo = await screen.findByText('No se pudieron cargar las decisiones guardadas: database is locked')
    rutas['/api/empresa/VIEJA/historial'] = ok({ symbol: 'VIEJA', reglas_version_actual: 'v1', decisiones: [
      { id: 4, fecha: '2026-03-02', creado_en: '2026-03-02T15:00:00+00:00', origen: 'hoy:us_sp500', accion: 'comprar', precio: 20, score: 0.5 },
    ] })
    fireEvent.click(within(fallo.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('button', { name: 'Replay' })).toBeInTheDocument()
  })
})
