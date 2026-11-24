/**
 * Ítem 2.1: la ficha ya no depende de la cotización. Antes `Promise.all` la
 * hacía imprescindible: si `api.quote` fallaba (o la fuente no la tenía), la
 * ficha entera era «No se encontró el símbolo…», sin pestañas, aunque EDGAR
 * tuviera estados financieros (captura `empresa_sin_datos`). Perfil,
 * fundamentales e histórico se tragaban su fallo: un error de histórico salía
 * «Sin histórico disponible…» y uno de perfil o fundamentales, nada.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Financials, History, Profile, Quote } from '../api/types'
import empresaCompleta from '../test/fixtures/empresa_completa.json'
import empresaDeudaParcial from '../test/fixtures/empresa_deuda_parcial.json'
import { PESTANAS_VIEJAS } from '../lib/pestanasFicha'
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

/** Dónde está la página: la pestaña vive en la URL (`?pestana=`). */
let ubicacion = ''
function Ubicacion() {
  const l = useLocation()
  ubicacion = l.pathname + l.search
  return null
}

function abrir(symbol: string, consulta = '') {
  return render(
    <MemoryRouter initialEntries={[`/ticker/${symbol}${consulta}`]}>
      <Routes>
        <Route path="/ticker/:symbol" element={<><TickerPage /><Ubicacion /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

const pestana = (nombre: string) => screen.findByRole('tab', { name: nombre })
const abrirPestana = async (nombre: string) => fireEvent.click(await pestana(nombre))
/** Las peticiones que congelan una instantánea: el análisis SIN `congelar=false`. */
const queCongelan = (symbol: string) =>
  vi.mocked(fetch).mock.calls.map(([e]) => String(e)).filter((u) => u === `/api/empresa/${symbol}/analisis`)
const pedidas = () => vi.mocked(fetch).mock.calls.map(([e]) => String(e))

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
    expect(await screen.findByText('Sin histórico disponible para VACIA en las fuentes configuradas.')).toBeInTheDocument()
    // Las pestañas existen y cargan lo que EDGAR sí tiene: en «Números»,
    // los fundamentales básicos (sin fuente) y los estados de EDGAR.
    await abrirPestana('Números')
    expect(
      await screen.findByText('Ninguna fuente configurada tiene fundamentales básicos de VACIA.'),
    ).toBeInTheDocument()
    expect(await screen.findByText(/Estados financieros anuales/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Más detalle (avanzado)' }))
    expect(screen.getByRole('button', { name: 'Decisiones y replay' })).toBeInTheDocument()
  })

  it('el cambio del día lleva los decimales del precio, no los suyos', async () => {
    // Revisión 6: con fmtPrecio el cambio tomaba sus propios decimales y el ruido
    // de float32 de Yahoo salía «+0,06999» sobre un precio de 172,87.
    servir({
      '/api/stocks/RUIDO/quote': ok({ ...cotizacion('RUIDO', 0.0699920654296875), price: 172.8699951171875, change_pct: 0.04 }),
      '/api/stocks/RUIDO/profile': ok(perfil('RUIDO', 'Ruido Corp')),
      '/api/stocks/RUIDO/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/RUIDO/history?range=1Y': falla(404, 'sin histórico'),
      '/api/stocks/RUIDO/financials': ok(financieros('RUIDO')),
      '/api/stocks/RUIDO/peers': falla(404, 'sin pares'),
    })
    abrir('RUIDO')
    expect(await screen.findByText(/^\+0,07 \(/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/0,06999/)
  })

  it('el cambio del día toma el color de lo que se lee: un «0,00 (0,00 %)» no es una subida (revisión 13)', async () => {
    // Con `change >= 0`, un cambio que se escribe cero salía en verde; Hoy y
    // Mercado ya seguían a `signoLeido`.
    const cabecera = async (symbol: string, cambio: number, pct: number) => {
      servir({
        [`/api/stocks/${symbol}/quote`]: ok({ ...cotizacion(symbol, cambio), change_pct: pct }),
        [`/api/stocks/${symbol}/profile`]: ok(perfil(symbol, `${symbol} Corp`)),
        [`/api/stocks/${symbol}/fundamentals`]: falla(404, 'sin fundamentales'),
        [`/api/stocks/${symbol}/history?range=1Y`]: falla(404, 'sin histórico'),
      })
      const { unmount } = abrir(symbol)
      const texto = await screen.findByText(/\(.*%\)$/)
      const clases = texto.className.split(/\s+/)
      unmount()
      return { texto: texto.textContent, clases }
    }
    const cero = await cabecera('CERO', 0.001, 0.001)
    expect(cero.texto).toBe('0,00 (0,00 %)')
    expect(cero.clases).not.toContain('text-emerald-600')
    expect(cero.clases).toContain('text-slate-500')
    // El cambio se escribe cero pero el porcentaje no: manda el porcentaje.
    expect((await cabecera('PCT', -0.004, -0.01)).clases).toContain('text-red-600')
    expect((await cabecera('SUBE', 0.5, 0.54)).clases).toContain('text-emerald-600')
  })

  it('cuatro pestañas en una fila que no se parte; «Más detalle» aparte (revisiones 12 y 13 y plan de navegación)', async () => {
    // A 390 px las once pestañas, partidas, ocupaban unos 200 px antes del
    // contenido. Ahora son cuatro (docs/PLAN_NAVEGACION.md) y caben en una fila
    // (las capturas lo miden a 390 px). jsdom no aplica los puntos de corte: se
    // comprueba que la fila no se parte en ningún ancho y que, si una pantalla
    // aún más estrecha no las cupiera, se desplaza en su franja con la señal de
    // que hay más (components/MarcoTabla.tsx) en vez de partirse.
    servir({
      '/api/stocks/ACME/quote': ok(cotizacion('ACME', -1.2)),
      '/api/stocks/ACME/profile': ok(perfil('ACME', 'ACME Corp')),
      '/api/stocks/ACME/fundamentals': falla(404, 'sin fundamentales'),
      '/api/stocks/ACME/history?range=1Y': falla(404, 'sin histórico'),
    })
    abrir('ACME')
    const lista = await screen.findByRole('tablist', { name: 'Pestañas de la ficha' })
    const tabs = within(lista).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Resumen', 'Números', 'Valoración', 'Novedades'])
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    const clases = lista.className.split(/\s+/)
    expect(clases).toEqual(expect.arrayContaining(['flex', 'overflow-x-auto']))
    for (const partida of ['flex-wrap', 'sm:flex-wrap', 'md:flex-wrap', 'lg:flex-wrap', 'xl:flex-wrap']) expect(clases).not.toContain(partida)
    expect(lista.hasAttribute('data-oculto-derecha')).toBe(true)
    // Cada pestaña en una línea: partida, la fila tendría dos alturas.
    for (const t of tabs) expect(t.className.split(/\s+/)).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']))
    // «Más detalle» no es una quinta pestaña: va fuera de la fila.
    const mas = screen.getByRole('button', { name: 'Más detalle (avanzado)' })
    expect(lista.contains(mas)).toBe(false)
    expect(screen.getByRole('navigation', { name: 'Secciones de la ficha' }).contains(mas)).toBe(true)
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
    // Con la cotización caída, las pestañas siguen ahí y abren lo suyo.
    await abrirPestana('Números')
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
    // Los fundamentales básicos viven ahora en «Números».
    await abrirPestana('Números')
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
    fireEvent.change(screen.getByPlaceholderText(/Símbolo/), { target: { value: 'otra' } })
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
    expect(await pestana('Números')).toBeInTheDocument()
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
    abrir('AAPLL', '?pestana=cambios')
    expect(await screen.findByText('No se encontró el símbolo «AAPLL» en las fuentes configuradas.')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Qué cambió' })).toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    // Ni aunque la URL pida «Qué cambió»; ni siquiera el análisis que no congela.
    expect(pedidas().filter((u) => u.startsWith('/api/empresa/AAPLL/analisis'))).toEqual([])
  })

  it('las pestañas no se abren hasta saber que el símbolo existe', async () => {
    servir({
      '/api/stocks/ACME/quote': 'pendiente',
      '/api/stocks/ACME/profile': 'pendiente',
      '/api/stocks/ACME/fundamentals': 'pendiente',
      '/api/stocks/ACME/history?range=1Y': 'pendiente',
    })
    abrir('ACME', '?pestana=cambios')
    expect(await screen.findByText('Cargando la cotización…')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Qué cambió' })).toBeNull()
    expect(pedidas().filter((u) => u.startsWith('/api/empresa/ACME/analisis'))).toEqual([])
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
    // «Novedades» abre «Qué cambió», que congela.
    await abrirPestana('Novedades')
    expect(screen.getByRole('button', { name: 'Qué cambió' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(screen.getByPlaceholderText(/Símbolo/), { target: { value: 'aapll' } })
    fireEvent.click(screen.getByRole('button', { name: 'Analizar' }))
    expect(await screen.findByText(/No se encontró el símbolo «AAPLL»/)).toBeInTheDocument()
    // La de ACME sí se pidió: la pestaña estaba abierta y el filtro mira bien.
    expect(queCongelan('ACME')).toHaveLength(1)
    // El análisis es lo que congela; el historial (solo lectura) sí se mira. Y
    // de AAPLL ni el que no congela: no se sabe si existe.
    expect(pedidas().filter((u) => u.startsWith('/api/empresa/AAPLL/analisis'))).toEqual([])
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
    await abrirPestana('Novedades')
    // Solo cuenta el que congela: el de «Qué dice la app» (`congelar=false`) se
    // pide en cada visita y no guarda nada.
    const analisis = () => queCongelan('ACME').length
    expect(analisis()).toBe(1)
    expect(ubicacion).toBe('/ticker/ACME?pestana=novedades')
    for (const s of ['otra', 'acme']) {
      fireEvent.change(screen.getByPlaceholderText(/Símbolo/), { target: { value: s } })
      fireEvent.click(screen.getByRole('button', { name: 'Analizar' }))
      expect(await screen.findByRole('heading', { level: 1, name: new RegExp(`${s.toUpperCase()} Corp`) })).toBeInTheDocument()
    }
    expect(await screen.findByText('Gráfico de ACME')).toBeVisible()
    expect(await pestana('Resumen')).toHaveAttribute('aria-selected', 'true')
    expect(ubicacion).toBe('/ticker/ACME')
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
        symbol: 'VIEJA', reglas_version_actual: 'v1', thresholds: { favorable: 0.35, desfavorable: -0.35 },
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
    rutas['/api/empresa/VIEJA/historial'] = ok({ symbol: 'VIEJA', reglas_version_actual: 'v1', thresholds: { favorable: 0.35, desfavorable: -0.35 }, decisiones: [
      { id: 4, fecha: '2026-03-02', creado_en: '2026-03-02T15:00:00+00:00', origen: 'hoy:us_sp500', accion: 'comprar', precio: 20, score: 0.5 },
    ] })
    fireEvent.click(within(fallo.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('button', { name: 'Replay' })).toBeInTheDocument()
  })
})

// --- La ficha en cuatro pestañas (docs/PLAN_NAVEGACION.md) ----------------------

/** Las respuestas REALES del backend sobre el paquete de casos extremos. */
const rutasDe = (f: { rutas: Record<string, { status: number; json: unknown }> }, extra: Record<string, Respuesta> = {}) =>
  ({ ...(f.rutas as Record<string, Respuesta>), ...extra })

/** El texto que se lee, sin las definiciones de los términos (ocultas hasta tocarlos). */
function leido(el: Element): string {
  const copia = el.cloneNode(true) as Element
  copia.querySelectorAll('[role="tooltip"]').forEach((t) => t.remove())
  // Sin tocar el espacio duro: es parte de cómo se escribe una cifra («96,68 USD»).
  return (copia.textContent ?? '').replace(/[ \t\n]+/g, ' ').trim()
}

const ACME_SIMPLE: Record<string, Respuesta> = {
  '/api/stocks/ACME/quote': ok(cotizacion('ACME', -1.2)),
  '/api/stocks/ACME/profile': ok(perfil('ACME', 'ACME Corp')),
  '/api/stocks/ACME/fundamentals': falla(404, 'sin fundamentales'),
  '/api/stocks/ACME/history?range=1Y': ok(historico('ACME')),
}

// Lo primero que pide cada sección al abrirse: prueba de que está montada.
const PIDE: Record<string, string> = {
  fundamentales: '/api/stocks/ACME/financials',
  salud: '/api/stocks/ACME/health',
  calidad: '/api/empresa/ACME/calidad',
  cambios: '/api/empresa/ACME/analisis',
  expectativas: '/api/expectativas/eventos?symbol=ACME',
  filings: '/api/stocks/ACME/filings',
  informe: '/api/deep-dive/ACME?history_years=10',
  opciones: '/api/options/ACME',
  historial: '/api/empresa/ACME/historial',
  valoracion: '/api/valuation/ACME',
}

describe('la ficha en cuatro pestañas', () => {
  it('«Qué dice la app» cuenta la decisión del motor en una frase, y abrir la ficha no congela nada', async () => {
    servir(rutasDe(empresaDeudaParcial))
    abrir('PARC')
    const bloque = await screen.findByRole('region', { name: 'Qué dice la app' })
    await waitFor(() => expect(leido(bloque)).toMatch(/Es una buena empresa/))
    expect(leido(bloque)).toContain(
      'Es una buena empresa frente a las de su sector y su precio va al alza. ' +
        'La app sugiere comprar entre 101,92 y 106,08\u00a0USD, y salir si cierra a 95,68\u00a0USD o menos (su stop).',
    )
    // La acción, con lo que significa a un toque; la confianza, con su porqué.
    // La acción, con el mismo aviso que Inicio y Explorar (`AvisoDeAccion`).
    expect(bloque.querySelector('[data-aviso]')?.textContent).toMatch(/Comprar/)
    expect(leido(bloque)).toMatch(/Confianza baja/)
    expect(leido(bloque)).toContain('Por qué la confianza es baja: 5 puntos débiles en los datos que la respaldan')
    expect(within(bloque).getByRole('link', { name: 'Anotar una compra' })).toHaveAttribute('href', '/cartera')
    // Con la IA apagada no hay botón de IA que no lleve a nada.
    expect(within(bloque).queryByRole('button', { name: 'Explícamelo con IA' })).toBeNull()
    // Se lee sin congelar: una visita a la ficha no deja una instantánea inmutable.
    expect(pedidas()).toContain('/api/empresa/PARC/analisis?congelar=false')
    expect(queCongelan('PARC')).toEqual([])
  })

  it('el Resumen enseña lo que comprueba la app (✓ / ✗ / ?) y las cifras clave, explicadas', async () => {
    servir(rutasDe(empresaDeudaParcial))
    abrir('PARC')
    const reglas = await screen.findByRole('region', { name: 'Lo que comprueba la app' })
    const items = within(reglas).getAllByRole('listitem').slice(0, 2).map(leido)
    expect(items).toEqual([
      '✓cumple: Es mejor que las empresas de su sector. Puntuación ≥ +0,35 (0,60 frente a 0,35)',
      '✓cumple: Su precio va al alza. Precio ≥ media de 200 sesiones + 2\u00a0% (104,00 frente a 96,68)',
    ])
    // Y la traza entera, plegada debajo: la de siempre, no otra explicación.
    expect(within(reglas).getByText('Ver todas las reglas y qué cambiaría la decisión')).toBeInTheDocument()
    expect(within(reglas).getByText('¿Por qué esta decisión?')).toBeInTheDocument()
    const cifras = screen.getByRole('region', { name: 'Cifras clave, explicadas' })
    expect(within(cifras).getByRole('button', { name: 'PER (precio / beneficio)' })).toHaveAccessibleDescription(/BPA/)
    expect(leido(cifras)).toContain('Al precio de hoy pagas 63,0 veces lo que ganó por acción en su último ejercicio.')
    expect(leido(cifras)).toContain('Fuente: EDGAR · presentado el 10 feb 2026')
    fireEvent.click(within(cifras).getByRole('button', { name: 'Más cifras en «Números»' }))
    expect(await pestana('Números')).toHaveAttribute('aria-selected', 'true')
  })

  it('una tesis tuya con un punto cruzado se avisa en el Resumen, aunque el motor no la mire', async () => {
    servir(rutasDe(empresaCompleta))
    abrir('ACME')
    const aviso = await screen.findByText(/Tu tesis «El margen aguanta» tiene 1 punto de invalidación cruzado/)
    const caja = aviso.parentElement as HTMLElement
    expect(leido(caja)).toContain('margen operativo < 18%')
    expect(within(caja).getByRole('link', { name: 'Revisar mi tesis' })).toHaveAttribute('href', '/cartera?pestana=tesis')
  })

  it.each(Object.entries(PESTANAS_VIEJAS))('la pestaña vieja «%s» (?pestana=) abre su sitio nuevo y su sección', async (vieja, vista) => {
    servir(ACME_SIMPLE)
    abrir('ACME', `?pestana=${vieja}`)
    if (vista.pestana === 'detalle') {
      expect(await screen.findByRole('button', { name: 'Más detalle (avanzado)' })).toHaveAttribute('aria-pressed', 'true')
      for (const t of await screen.findAllByRole('tab')) expect(t).toHaveAttribute('aria-selected', 'false')
    } else {
      const nombre = { resumen: 'Resumen', numeros: 'Números', valoracion: 'Valoración', novedades: 'Novedades' }[vista.pestana]
      expect(await pestana(nombre)).toHaveAttribute('aria-selected', 'true')
    }
    if (vista.seccion) {
      const boton = screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true' && b.textContent !== 'Más detalle (avanzado)')
      expect(boton?.textContent).toBe(
        { fundamentales: 'Fundamentales', salud: 'Salud y riesgo', calidad: 'Calidad de beneficios', cambios: 'Qué cambió',
          expectativas: 'Resultados vs expectativas', filings: 'Filings', informe: 'Informe completo', opciones: 'Opciones',
          historial: 'Decisiones y replay' }[vista.seccion],
      )
    }
    // La sección de verdad está abierta: ha pedido lo suyo (y ninguna otra).
    const suya = PIDE[vieja]
    if (suya) await waitFor(() => expect(pedidas()).toContain(suya))
    for (const [otra, url] of Object.entries(PIDE)) if (otra !== vieja) expect(pedidas(), otra).not.toContain(url)
  })

  it('la pestaña y la sección van a la URL, con los identificadores nuevos', async () => {
    servir(ACME_SIMPLE)
    abrir('ACME')
    await abrirPestana('Números')
    expect(ubicacion).toBe('/ticker/ACME?pestana=numeros')
    fireEvent.click(screen.getByRole('button', { name: 'Salud y riesgo' }))
    expect(ubicacion).toBe('/ticker/ACME?pestana=salud')
    fireEvent.click(screen.getByRole('button', { name: 'Más detalle (avanzado)' }))
    expect(ubicacion).toBe('/ticker/ACME?pestana=detalle')
    // «Más detalle» no abre nada solo: cada sección cuesta su carga.
    for (const url of [PIDE.informe, PIDE.opciones, PIDE.historial]) expect(pedidas()).not.toContain(url)
    fireEvent.click(screen.getByRole('button', { name: 'Opciones' }))
    expect(ubicacion).toBe('/ticker/ACME?pestana=opciones')
    await abrirPestana('Resumen')
    expect(ubicacion).toBe('/ticker/ACME')
  })

  it('con el teclado, las flechas mueven el foco entre pestañas sin abrirlas; Intro la abre', async () => {
    // Abrir cuesta llamadas (y «Qué cambió» congela): pasar por encima no abre.
    servir(ACME_SIMPLE)
    abrir('ACME')
    const resumen = await pestana('Resumen')
    expect(resumen).toHaveAttribute('tabIndex', '0')
    expect(screen.getByRole('tab', { name: 'Números' })).toHaveAttribute('tabIndex', '-1')
    resumen.focus()
    const lista = screen.getByRole('tablist')
    fireEvent.keyDown(lista, { key: 'ArrowRight' })
    fireEvent.keyDown(lista, { key: 'ArrowRight' })
    fireEvent.keyDown(lista, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Novedades' }))
    expect(resumen).toHaveAttribute('aria-selected', 'true')
    expect(queCongelan('ACME')).toEqual([])
    fireEvent.keyDown(lista, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(resumen)
    fireEvent.keyDown(lista, { key: 'End' })
    fireEvent.click(document.activeElement as HTMLElement)
    expect(screen.getByRole('tab', { name: 'Novedades' })).toHaveAttribute('aria-selected', 'true')
  })

  it('«Explícamelo con IA», con la IA encendida, abre el informe completo y lo redacta una vez', async () => {
    servir(
      rutasDe(empresaDeudaParcial, {
        '/api/meta/llm': ok({ configured: true, model: 'demo' }),
        '/api/deep-dive/PARC/narrative': ok({ generated_by: 'llm', content_md: 'Narrativa de demostración.', model: 'demo', disclaimer: 'Aviso de IA.' }),
      }),
    )
    // El estado de la IA se pide una vez para toda la app (`lib/llm.ts`): con
    // módulos nuevos, el «apagada» de los tests de antes no cuenta aquí.
    vi.resetModules()
    const { TickerPage: FichaNueva } = await import('./TickerPage')
    render(
      <MemoryRouter initialEntries={['/ticker/PARC']}>
        <Routes>
          <Route path="/ticker/:symbol" element={<FichaNueva />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Explícamelo con IA' }))
    expect(screen.getByRole('button', { name: 'Más detalle (avanzado)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Informe completo' })).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText('Narrativa de demostración.')).toBeInTheDocument()
    const redactadas = () => pedidas().filter((u) => u === '/api/deep-dive/PARC/narrative').length
    expect(redactadas()).toBe(1)
    // Volver a la sección no la vuelve a pedir (gasta API).
    await abrirPestana('Resumen')
    fireEvent.click(screen.getByRole('button', { name: 'Más detalle (avanzado)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Informe completo' }))
    expect(await screen.findByText(/Redactar informe \(IA\)/)).toBeInTheDocument()
    expect(redactadas()).toBe(1)
  })
})
