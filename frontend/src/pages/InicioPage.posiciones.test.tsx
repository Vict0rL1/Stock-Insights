/**
 * Revisión 14: Inicio dice de cada posición lo mismo que Mi cartera y Explorar.
 *
 * El estado de cada posición (vender, reducir, sin comprobar, mantener) sale de
 * UNA fuente y UNA regla: el repaso de `/api/portfolio` (el de Explorar, con la
 * lista guardada) pasado por `avisosDeCartera`. Antes Inicio hacía su cuenta con
 * el stop de cada lote: contaba lotes, repetía avisos, callaba una venta por
 * puntuación y decía «Nada urgente» con las alertas aún cargando. También lo que
 * Inicio afirmaba sin haberlo mirado: un valor parcial como total, «ninguna
 * empresa cumple» sin lista corta, «ninguna de tu cartera presenta» con el
 * calendario recortado. Se parte de respuestas REALES (`hoy_completo.json`).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DailySignal, PortfolioPosition, StopsDeCartera } from '../api/types'
import { Rutas as RutasApp } from '../App'
import { avisosDeCartera } from '../lib/avisos'
import hoyCompleto from '../test/fixtures/hoy_completo.json'
import { posicionDelRepaso, repasoDe } from '../test/repaso'
import { InicioPage } from './InicioPage'
import { recuentos } from './TodayPage'

type Rutas = Record<string, { status: number; json: unknown }>
type Hoy = Record<string, unknown> & { cartera?: StopsDeCartera; signals: DailySignal[] }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const HOY = (hoyCompleto as unknown as { rutas: Rutas }).rutas
const VIGILANCIA_VACIA = { tesis: [], total_saltan: 0, sin_disparadores: [], nota: '', aviso_sin_disparadores: null }

/** Lo que no se sirve se queda cargando (`status: 0`, también). Las rutas de la
 *  lista del día, las reales; `cambiarHoy` las cambia todas igual. */
function servir(rutas: Rutas, { conLista = false, cambiarHoy }: { conLista?: boolean; cambiarHoy?: (hoy: Hoy) => void } = {}) {
  const todas: Rutas = { ...(conLista ? structuredClone(HOY) : {}), ...rutas }
  for (const [url, r] of Object.entries(todas)) if (url.startsWith('/api/signals/today')) cambiarHoy?.(r.json as Hoy)
  const fetchMock = vi.fn((e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = todas[url] ?? todas[url.split('?')[0]]
    if (!r || r.status === 0) return new Promise<Response>(() => {})
    return Promise.resolve(new Response(JSON.stringify(r.json), { status: r.status }))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const lote = (p: Partial<PortfolioPosition> & { id: number; symbol: string }): PortfolioPosition => ({
  name: null, sector: 'x', opened_at: '2026-09-01T00:00:00Z', quantity: 10, cost_basis: 100, invested: 1000,
  price: 120, market_value: 1200, unrealized_pnl: 200, unrealized_pct: 20, spark: null, currency: 'USD',
  market_value_base: 1200, invested_base: 1000, stop: 90, stop_perforado: false, precio_estado: 'valido', ...p,
})

const cartera = (positions: PortfolioPosition[], repaso: unknown, summary: Record<string, unknown> = {}) => ({
  status: 200,
  json: { positions, repaso, summary: { total_market_value: 2400, priced_positions: positions.length, total_positions: positions.length, ...summary },
    divisas: { base: 'USD' } },
})

const pintar = () => render(<MemoryRouter><InicioPage /></MemoryRouter>)
const tuCartera = () => screen.getByRole('region', { name: 'Tu cartera' })
const texto = (el: Element) => (el.textContent ?? '').replace(/\u00a0/g, ' ')

describe('una posición, una fila y un aviso, por símbolo', () => {
  it('dos lotes de KO, uno perforado: «1 posición abierta», KO una vez y «Vender»', async () => {
    servir({
      '/api/portfolio': cartera(
        [lote({ id: 1, symbol: 'KO', price: 104, stop: 110, stop_perforado: true }), lote({ id: 2, symbol: 'KO', price: 104, stop: 70 })],
        repasoDe([posicionDelRepaso({ symbol: 'KO', precio: 104, stop: 110, lotes: 2, estado: 'perforado' })]),
      ),
    })
    pintar()
    await within(tuCartera()).findByText('Vender')
    // Decía «2 posiciones abiertas» y pintaba KO dos veces, «Por debajo de su límite» y «En orden».
    expect(within(tuCartera()).getByText(/posici(ón|ones) abiertas?/).textContent).toMatch(/^1 posición abierta/)
    expect(within(tuCartera()).getAllByRole('link', { name: 'KO' })).toHaveLength(1)
    expect(within(tuCartera()).queryByText('Mantener')).toBeNull()
  })

  it('dos lotes perforados: un aviso, no dos con la misma clave', async () => {
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {})
    servir({
      '/api/portfolio': cartera(
        [lote({ id: 1, symbol: 'KO', price: 104, stop: 110, stop_perforado: true }), lote({ id: 2, symbol: 'KO', price: 104, stop: 105, stop_perforado: true })],
        repasoDe([posicionDelRepaso({ symbol: 'KO', precio: 104, stop: 110, lotes: 2, estado: 'perforado' })]),
      ),
    })
    pintar()
    expect(await screen.findAllByText(/KO bajó de tu límite de pérdida/)).toHaveLength(1)
    expect(errores.mock.calls.flat().join(' ')).not.toMatch(/same key/)
  })

  it('dos lotes de AAPL sin stop: una posición y un aviso', async () => {
    servir({
      '/api/portfolio': cartera(
        [lote({ id: 1, symbol: 'AAPL', stop: null, stop_perforado: null }), lote({ id: 2, symbol: 'AAPL', stop: null, stop_perforado: null })],
        repasoDe([posicionDelRepaso({ symbol: 'AAPL', stop: null, lotes: 2, lotes_sin_stop: 2, estado: 'sin_comprobar',
          motivo: '2 de sus 2 lotes sin stop (ni fijado al abrir ni coste con que calcularlo)' })]),
      ),
    })
    pintar()
    expect(await screen.findAllByText(/AAPL no tiene límite de pérdida/)).toHaveLength(1)
    expect(texto(tuCartera())).toMatch(/1 posición abierta/)
  })
})

describe('Inicio, Mi cartera y Explorar cuentan lo mismo', () => {
  it('una venta por puntuación (la del «Para vender» de Explorar) no es «Nada urgente» ni «Mantener»', async () => {
    // La fila de TPL de la lista REAL, decidida como posición con «vender»; el
    // mismo objeto viaja en la lista de Explorar y en el repaso de la cartera.
    const tpl = structuredClone((HOY['/api/signals/today?market=us_sp500'].json as Hoy).signals.find((s) => s.symbol === 'TPL')!)
    Object.assign(tpl.decision, {
      action: 'vender', label: 'Vender', owned: true, reasons: ['La puntuación cayó a -0,52.'],
      reglas: [{ id: 'puntuacion_desfavorable', regla: 'Puntuación ≤ -0,35', resultado: 'cumple', efecto: 'vender', papel: 'decide', datos: { valor: -0.52, umbral: -0.35 } }],
    })
    const repaso = repasoDe([posicionDelRepaso({ symbol: 'TPL', en_lista: true })], { senales: [tpl] })
    servir({
      '/api/portfolio': cartera([lote({ id: 1, symbol: 'TPL', price: 60, stop: 50 })], repaso),
      '/api/portfolio/alerts': { status: 200, json: { alerts: [], vigilancia: null } },
      '/api/theses/vigilancia': { status: 200, json: VIGILANCIA_VACIA },
    })
    pintar()
    expect(await screen.findByText(/Tu regla dice vender TPL/)).toBeInTheDocument()
    expect(screen.queryByText(/Nada urgente/)).toBeNull()
    expect(within(tuCartera()).getByText('Vender')).toBeInTheDocument()
    // Explorar, con la misma fila y el mismo repaso: «Para vender 1».
    expect(recuentos({ signals: [tpl], cartera: repaso } as never).vender).toBe(1)
    expect(avisosDeCartera([tpl], repaso).map((a) => a.aviso.tipo)).toEqual(['vender'])
  })

  it('una alerta que saltó va como alerta: «Necesita tu atención» es lo mismo que cuenta Mi cartera', async () => {
    servir({
      '/api/portfolio': cartera([lote({ id: 1, symbol: 'KO' })], repasoDe([posicionDelRepaso({ symbol: 'KO' })])),
      '/api/portfolio/alerts': { status: 200, json: { alerts: [{ id: 1, symbol: 'KO', kind: 'precio', active: true,
        condition: { op: 'lt', price: 61 }, current_price: 60, triggered: true, estado: 'ok', motivo: 'KO bajó de 61,00', triggered_at: null }], vigilancia: null } },
      '/api/theses/vigilancia': { status: 200, json: VIGILANCIA_VACIA },
    })
    pintar()
    expect(await screen.findByText(/Alerta de precio: Saltó tu alerta de KO/)).toBeInTheDocument()
    // Mi cartera: «1 posición abierta · ninguna necesita atención»; Inicio no dice lo contrario.
    expect(screen.queryByText(/Necesita tu atención/)).toBeNull()
  })
})

describe('«Nada urgente» solo con todo mirado', () => {
  const enOrden = () => cartera([lote({ id: 1, symbol: 'KO' })], repasoDe([posicionDelRepaso({ symbol: 'KO' })]))

  it('mientras las alertas cargan no lo dice; cuando llega la que saltó, sale', async () => {
    let responder: (r: Response) => void = () => {}
    const pendiente = new Promise<Response>((r) => (responder = r))
    const fetchMock = servir({ '/api/portfolio': enOrden(), '/api/theses/vigilancia': { status: 200, json: VIGILANCIA_VACIA } })
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((e: RequestInfo | URL) => (String(e).startsWith('/api/portfolio/alerts') ? pendiente : original(e)))
    pintar()
    await within(tuCartera()).findByText('Mantener')
    expect(screen.getByText('Comprobando tus alertas de precio…')).toBeInTheDocument()
    expect(screen.queryByText(/Nada urgente/)).toBeNull()
    await act(async () => {
      responder(new Response(JSON.stringify({ alerts: [{ id: 1, symbol: 'KO', kind: 'precio', active: true, condition: { op: 'lt', price: 61 },
        current_price: 60, triggered: true, estado: 'ok', motivo: 'KO bajó de 61,00', triggered_at: null }], vigilancia: null }), { status: 200 }))
    })
    expect(await screen.findByText(/Saltó tu alerta de KO/)).toBeInTheDocument()
  })

  it('con la cartera, las alertas y las tesis mirados y nada que decir, lo dice', async () => {
    servir({
      '/api/portfolio': enOrden(),
      '/api/portfolio/alerts': { status: 200, json: { alerts: [], vigilancia: null } },
      '/api/theses/vigilancia': { status: 200, json: VIGILANCIA_VACIA },
    })
    pintar()
    expect(await screen.findByText(/^Nada urgente: todas tus posiciones siguen por encima de su límite de pérdida/)).toBeInTheDocument()
  })

  it('sin lista guardada no dice «Nada urgente»: dice qué no se ha mirado', async () => {
    servir({
      '/api/portfolio': cartera([lote({ id: 1, symbol: 'KO' })], repasoDe([posicionDelRepaso({ symbol: 'KO' })], { lista: null })),
      '/api/portfolio/alerts': { status: 200, json: { alerts: [], vigilancia: null } },
      '/api/theses/vigilancia': { status: 200, json: VIGILANCIA_VACIA },
    })
    pintar()
    expect(await screen.findByText(/^Ningún límite de pérdida perforado. Sin la lista del día guardada/)).toBeInTheDocument()
    expect(screen.queryByText(/Nada urgente/)).toBeNull()
  })

  it('pide la vigilancia de tesis y avisa de un punto cruzado', async () => {
    const fetchMock = servir({
      '/api/portfolio': enOrden(),
      '/api/portfolio/alerts': { status: 200, json: { alerts: [], vigilancia: null } },
      '/api/theses/vigilancia': { status: 200, json: { ...VIGILANCIA_VACIA, total_saltan: 1, tesis: [{ thesis_id: 3, symbol: 'KO', title: 't',
        invalidation_criteria: null, vigilancia: { disparadores: [{ id: 1, kind: 'metrica', descripcion: 'Margen operativo por debajo del 10 %',
          config: {}, activo: true, created_at: '2026-09-01T00:00:00Z', last_fired_at: null, salta: true, medible: true }], saltan: 1, sin_medir: 0, total: 1, nota: '' } }] } },
    })
    pintar()
    expect(await screen.findByText(/Tu tesis de KO: saltó un punto de vigilancia/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/theses/vigilancia'))).toBe(true)
    expect(screen.queryByText(/Nada urgente/)).toBeNull()
  })

  it('si las tesis no cargan, lo dice y no afirma «Nada urgente»', async () => {
    servir({
      '/api/portfolio': enOrden(),
      '/api/portfolio/alerts': { status: 200, json: { alerts: [], vigilancia: null } },
      '/api/theses/vigilancia': { status: 503, json: { detail: 'sin conexión' } },
    })
    pintar()
    expect(await screen.findByText(/Los puntos de vigilancia de tus tesis no se han podido comprobar/)).toBeInTheDocument()
    expect(screen.queryByText(/Nada urgente/)).toBeNull()
  })
})

describe('lo que Inicio afirma, solo si lo ha mirado', () => {
  it('con una posición sin precio, el valor dice que no la cuenta', async () => {
    servir({
      '/api/portfolio': cartera(
        [lote({ id: 1, symbol: 'KO' }), lote({ id: 2, symbol: 'PEP', price: null, market_value: null, market_value_base: null, stop_perforado: null })],
        repasoDe([posicionDelRepaso({ symbol: 'KO' }), posicionDelRepaso({ symbol: 'PEP', precio: null, estado: 'sin_comprobar', motivo: 'sin precio' })]),
        { total_market_value: 1200, priced_positions: 1, total_positions: 2 },
      ),
    })
    pintar()
    await within(tuCartera()).findByText('Revisar')
    // Decía «2 posiciones abiertas · valor 1.200,00 USD», sin decir que PEP no cuenta.
    expect(texto(tuCartera())).toContain('2 posiciones abiertas · valor 1.200,00 USD, sin contar PEP (sin precio)')
  })

  it('el calendario recortado no permite decir «ninguna de tu cartera presenta»', async () => {
    const otros = Array.from({ length: 120 }, (_, i) => ({ symbol: `X${i}`, date: '2026-11-25', hour: null, eps_estimate: null, eps_actual: null, revenue_estimate: null, revenue_actual: null }))
    servir({
      '/api/portfolio': cartera([lote({ id: 1, symbol: 'KO' })], repasoDe([posicionDelRepaso({ symbol: 'KO' })])),
      '/api/market/calendar': { status: 200, json: { events: otros, total: 900, error: null } },
    })
    pintar()
    const proximos = screen.getByRole('region', { name: 'Próximos días' })
    await within(proximos).findByText(/Resultados:/)
    expect(proximos.textContent).not.toContain('ninguna empresa de tu cartera presenta')
    expect(proximos.textContent).toContain('el calendario solo trae los 120 más próximos de 900')
  })

  it('«Próximos días» no dice «sin tu cartera» mientras la cartera carga', async () => {
    servir({ '/api/portfolio': { status: 0, json: null }, '/api/market/calendar': { status: 200, json: { events: [], total: 0, error: null } } })
    pintar()
    const proximos = screen.getByRole('region', { name: 'Próximos días' })
    expect(await within(proximos).findByText('Comprobando cuáles son de tu cartera…')).toBeInTheDocument()
    expect(proximos.textContent).not.toContain('Sin tu cartera')
  })

  const ideas = () => screen.getByRole('region', { name: 'Ideas para invertir hoy' })

  it('sin lista corta no dice «ninguna empresa cumple»', async () => {
    servir({}, { conLista: true, cambiarHoy: (hoy) => { delete hoy.shortlist } })
    pintar()
    await within(ideas()).findByText(/Ver la lista completa/, {}, { timeout: 3000 })
    expect(ideas().textContent).not.toContain('ninguna empresa cumple')
    expect(ideas().textContent).toContain('no trae la lista corta de ideas')
  })

  it('con la lista a medias y sin ideas, dice de cuántas analizadas', async () => {
    servir({}, { conLista: true, cambiarHoy: (hoy) => {
      ;(hoy.shortlist as { ideas: unknown[] }).ideas = []
      Object.assign(hoy, { complete: false, scored: 240, requested: 502 })
    } })
    pintar()
    expect(await within(ideas()).findByText(/De momento ninguna entre las 240 de 502 empresas analizadas/, {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('una idea que compraste después de calcular la lista no dice «Comprar», y se dice que la lista es de otra cartera', async () => {
    servir({}, { conLista: true, cambiarHoy: (hoy) => {
      hoy.cartera = { abiertas: 1, en_lista: 1, posiciones: [posicionDelRepaso({ symbol: 'HSY', en_lista: true, precio: 144, stop: 125 })] }
      hoy.lista_desfasada = { abiertas: ['HSY'], cerradas: [], cambiadas: [], efectivo: false }
    } })
    pintar()
    const ideas = screen.getByRole('region', { name: 'Ideas para invertir hoy' })
    const hsy = (await within(ideas).findByText('Hershey Company (The)', {}, { timeout: 3000 })).closest('li')!
    // Decía «COMPRAR · Compra entre 141,12 y 146,88 … Tamaño sugerido: 7,8 % de tu cartera».
    expect(hsy.querySelector('[data-aviso]')!.getAttribute('data-aviso')).not.toBe('comprar')
    expect(ideas.textContent).toContain('con otra cartera. Después abriste HSY')
    expect(ideas.textContent).toContain('Explorar la recalcula con «Actualizar».')
  })
})

describe('el repaso sigue a la lista que se enseña', () => {
  it('cuando llega una lista distinta de la que leyó la cartera, la cartera se vuelve a pedir una vez', async () => {
    const vencida = (HOY['/api/signals/today?market=us_sp500&vencida=aceptar'].json as { as_of: string }).as_of
    const deAhora = (HOY['/api/signals/today?market=us_sp500'].json as { as_of: string }).as_of
    const repaso = (as_of: string) => repasoDe([posicionDelRepaso({ symbol: 'KO' })], { lista: { mercado: 'us_sp500', as_of, estado: 'valido', antiguedad_segundos: null } })
    let pedidas = 0
    const fetchMock = servir({}, { conLista: true })
    const original = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation((e: RequestInfo | URL) => {
      if (String(e) !== '/api/portfolio') return original(e)
      pedidas += 1
      // La primera lee la guardada (la caducada); las siguientes, la de ahora.
      return Promise.resolve(new Response(JSON.stringify(cartera([lote({ id: 1, symbol: 'KO' })], repaso(pedidas === 1 ? vencida : deAhora)).json), { status: 200 }))
    })
    pintar()
    await screen.findByText('Ver la lista completa →', {}, { timeout: 3000 })
    await waitFor(() => expect(pedidas).toBe(2))
    // Con la de ahora ya leída, no vuelve a pedirla aunque sigan las pasadas.
    await new Promise((r) => setTimeout(r, 50))
    expect(pedidas).toBe(2)
  })
})

describe('navegación desde Inicio', () => {
  let ubicacion = ''
  function Ubicacion() {
    const l = useLocation()
    ubicacion = l.pathname + l.search
    return null
  }
  const navegar = (ruta: string) => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    vi.stubGlobal('scrollTo', vi.fn())
    return render(
      <MemoryRouter initialEntries={[ruta]}>
        <RutasApp />
        <Ubicacion />
      </MemoryRouter>,
    )
  }

  it('comparar ETFs manda todo lo escrito y dice qué queda fuera', () => {
    navegar('/')
    const ideas = screen.getByRole('region', { name: 'Ideas para invertir hoy' })
    fireEvent.click(within(ideas).getByRole('button', { name: 'ETFs' }))
    fireEvent.change(screen.getByLabelText('ETFs que quieres comparar'), { target: { value: 'SPY, QQQ, VTI, VOO, IWM' } })
    expect(within(ideas).getByText(/IWM queda fuera/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }))
    // Llegaba a «…simbolos=SPY%2CQQQ%2CVTI%2CVOO»: IWM no aparecía en ninguna parte.
    expect(ubicacion).toBe('/explorar?tipo=etfs&simbolos=SPY%2CQQQ%2CVTI%2CVOO%2CIWM')
    expect(document.body.textContent).toContain('IWM')
  })

  it('el enlace de noticias no promete filtrar por tu cartera', () => {
    navegar('/')
    expect(screen.queryByRole('link', { name: 'Noticias de tus empresas →' })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Noticias del mercado →' }))
    expect(ubicacion).toBe('/avanzado/noticias')
  })

  it('los enlaces de Inicio miden al menos 44 px de alto', () => {
    navegar('/')
    for (const nombre of ['Ver mi cartera', 'Ver más', 'Noticias del mercado →']) {
      expect(screen.getByRole('link', { name: nombre }).className).toMatch(/(^|\s)min-h-11(\s|$)/)
    }
  })
})
