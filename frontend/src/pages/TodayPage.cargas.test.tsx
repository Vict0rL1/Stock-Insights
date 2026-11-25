/**
 * Ítem 2.1 en Hoy: lo que falta o falla se dice.
 * - Los mercados que no llegan: `() => undefined` lo callaba y el selector
 *   desaparecía sin más.
 * - La lista que no llega: el error salía suelto, sin decir qué falló ni dejar
 *   reintentar; ahora con la misma frase que el resto y «Reintentar».
 * - Sin lista corta no hay «0 ideas»: `?? 0` confundía una respuesta sin lista
 *   con un día sin ideas, y la pestaña caía a la tabla de todas.
 * - Sin variación del día, el color es neutro: `?? 0` la pintaba en verde.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import hoyCompleto from '../test/fixtures/hoy_completo.json'
import { TodayPage } from './TodayPage'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

type Ruta = { status: number; json: unknown }
const RUTAS = (hoyCompleto as { rutas: Record<string, Ruta> }).rutas
const HOY = '/api/signals/today?market=us_sp500'

/** Las rutas del día con `cambiar` aplicado a cada respuesta de la lista (copia). */
function rutasCon(cambiar: (hoy: Record<string, unknown>) => void): Record<string, Ruta> {
  const copia = JSON.parse(JSON.stringify(RUTAS)) as Record<string, Ruta>
  for (const [url, r] of Object.entries(copia)) if (url.startsWith(HOY)) cambiar(r.json as Record<string, unknown>)
  return copia
}

/** Sirve `rutas`; `fallos[url]` hace fallar esa ruta las N primeras veces. */
function servir(rutas: Record<string, Ruta>, fallos: Record<string, { veces: number; detail: string }> = {}) {
  const pedidas: Record<string, number> = {}
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    pedidas[url] = (pedidas[url] ?? 0) + 1
    const f = fallos[url]
    if (f && pedidas[url] <= f.veces) return new Response(JSON.stringify({ detail: f.detail }), { status: 502 })
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 })
  }))
}

const pintar = () => render(<MemoryRouter><TodayPage /></MemoryRouter>)

describe('Hoy: cargas que fallan o faltan', () => {
  it('los mercados que no llegan se dicen, con «Reintentar»', async () => {
    servir(RUTAS, { '/api/signals/markets': { veces: 1, detail: 'el servidor no respondió' } })
    pintar()
    expect(await screen.findByText('No se pudieron cargar los mercados: el servidor no respondió')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('button', { name: 'EE. UU. — S&P 500' })).toBeInTheDocument()
    expect(screen.queryByText(/No se pudieron cargar los mercados/)).not.toBeInTheDocument()
  })

  it('la lista que no llega dice qué falló y se puede reintentar', async () => {
    servir(RUTAS, { [HOY]: { veces: 1, detail: 'el proveedor de precios no respondió' } })
    pintar()
    expect(await screen.findByText('No se pudo cargar la lista de hoy: el proveedor de precios no respondió')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('button', { name: 'Mejores ideas (5)' })).toBeInTheDocument()
    expect(screen.queryByText(/No se pudo cargar la lista de hoy/)).not.toBeInTheDocument()
  })

  it('sin lista corta no dice «0 ideas»: dice que no hay lista', async () => {
    servir(rutasCon((hoy) => delete hoy.shortlist))
    const { container } = pintar()
    expect(await screen.findByRole('button', { name: 'Mejores ideas (sin lista)' })).toBeInTheDocument()
    expect(screen.getByText(/no trae la lista corta de ideas/)).toBeInTheDocument()
    const celda = screen.getByText('Ideas de compra').parentElement!
    expect(celda).toHaveTextContent('—')
    expect(celda).toHaveTextContent('sin lista corta')
    expect(container.textContent).not.toMatch(/\b0 ideas\b|Mejores ideas \(0\)/)
  })

  it('sin variación del día, el color es neutro, no verde', async () => {
    servir(
      rutasCon((hoy) => {
        const corta = hoy.shortlist as { ideas: { symbol: string; price: { change_pct: number | null } }[] }
        const senales = hoy.signals as { symbol: string; price: { change_pct: number | null } | null }[]
        for (const s of [...corta.ideas, ...senales]) if (s.symbol === 'HSY' && s.price) s.price.change_pct = null
      }),
    )
    pintar()
    // La tarjeta de la idea.
    const tarjeta = (await screen.findAllByText('HSY'))[0].closest('li')!
    const variacion = within(tarjeta)
      .getAllByText('—')
      .find((el) => el.className.includes('text-xs tabular-nums'))!
    expect(variacion.className).toContain('text-slate-400')
    expect(variacion.className).not.toMatch(/emerald|red/)

    // La fila de la lista.
    fireEvent.click(screen.getByRole('button', { name: /^Todas \(/ }))
    const fila = (await screen.findAllByText('HSY')).map((el) => el.closest('button')).find(Boolean)!
    const enFila = within(fila)
      .getAllByText('—')
      .find((el) => el.className.includes('text-xs tabular-nums'))!
    expect(enFila.className).toContain('text-slate-400')
    expect(enFila.className).not.toMatch(/emerald|red/)
  })

  it('un fallo del mercado anterior que llega tarde no tapa la lista del nuevo ni su «Reintentar»', async () => {
    // Revisión del 2.1: el S&P 500 fallaba después de cambiar a Canadá; su
    // aviso quedaba sobre la lista de Canadá y «Reintentar» pedía el S&P 500.
    let fallarSp500: () => void = () => {}
    const pedidas: string[] = []
    vi.stubGlobal('fetch', vi.fn((e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      pedidas.push(url)
      if (url === HOY) {
        return new Promise<Response>((r) => {
          fallarSp500 = () => r(new Response(JSON.stringify({ detail: 'el S&P 500 no respondió' }), { status: 502 }))
        })
      }
      const r = url.startsWith('/api/signals/today?market=canada') ? RUTAS[HOY] : RUTAS[url]
      return Promise.resolve(new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 }))
    }))
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Canadá — cotizadas en EE. UU.' }))
    expect(await screen.findByRole('button', { name: 'Mejores ideas (5)' })).toBeInTheDocument()
    await act(async () => fallarSp500())
    expect(screen.queryByText(/No se pudo cargar la lista de hoy/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
    expect(pedidas.filter((u) => u === HOY)).toHaveLength(1)
  })

  it('en StrictMode (`npm run dev`) la lista se pide una sola vez al abrir', async () => {
    // Segunda revisión del 2.1: el efecto corría dos veces y lanzaba dos
    // cadenas de pasadas, el doble de cuota para lo mismo.
    const pedidas: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      pedidas.push(url)
      const r = RUTAS[url]
      return new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 })
    }))
    render(<StrictMode><MemoryRouter><TodayPage /></MemoryRouter></StrictMode>)
    expect(await screen.findByRole('button', { name: 'Mejores ideas (5)' })).toBeInTheDocument()
    // Una primera pasada y, como la lista viene incompleta, como mucho las
    // cuatro automáticas de UNA cadena (con el efecto doble eran 2 y 8).
    // Se espera a que la cadena termine («Actualizar» vuelve) antes de contar.
    expect(await screen.findByRole('button', { name: 'Actualizar' }, { timeout: 3000 })).toBeEnabled()
    expect(pedidas.filter((u) => u === HOY)).toHaveLength(1)
    expect(pedidas.filter((u) => u === `${HOY}&refresh=true`)).toHaveLength(4)
  })

  it('S&P 500 → Canadá → S&P 500 reutiliza la petición que ya iba, y su respuesta es la que vale', async () => {
    let soltarSp500: () => void = () => {}
    const pedidas: string[] = []
    vi.stubGlobal('fetch', vi.fn((e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      pedidas.push(url)
      if (url === HOY) {
        return new Promise<Response>((r) => {
          soltarSp500 = () => r(new Response(JSON.stringify(RUTAS[HOY].json), { status: 200 }))
        })
      }
      const r = url.startsWith('/api/signals/today?market=canada') ? RUTAS[HOY] : RUTAS[url]
      return Promise.resolve(new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 }))
    }))
    pintar()
    fireEvent.click(await screen.findByRole('button', { name: 'Canadá — cotizadas en EE. UU.' }))
    expect(await screen.findByRole('button', { name: 'Mejores ideas (5)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'EE. UU. — S&P 500' }))
    await act(async () => soltarSp500())
    expect(await screen.findByRole('button', { name: 'Mejores ideas (5)' })).toBeInTheDocument()
    expect(pedidas.filter((u) => u === HOY)).toHaveLength(1)
  })
})

describe('Hoy: la primera carga no bloquea', () => {
  /** Sirve las rutas del día y deja `retener` esperando hasta llamar a lo que devuelve. */
  function servirReteniendo(rutas: Record<string, Ruta>, retener: string) {
    let soltar: () => void = () => {}
    vi.stubGlobal('fetch', vi.fn((e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      const respuesta = () => new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 })
      if (url === retener) return new Promise<Response>((ok) => { soltar = () => ok(respuesta()) })
      return Promise.resolve(respuesta())
    }))
    return () => soltar()
  }

  it('sin lista vigente enseña al momento la guardada, con su antigüedad, y la de ahora la sustituye', async () => {
    // Antes, «Puntuando el universo…» los minutos de una pasada, sin nada más.
    const soltar = servirReteniendo(RUTAS, HOY)
    pintar()
    expect(await screen.findByText('Lista de hace 9 h; actualizando…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mejores ideas (5)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Puntuando…' })).toBeDisabled()
    expect(screen.queryByText(/Puntuando el universo/)).toBeNull()

    await act(async () => soltar())
    await waitFor(() => expect(screen.queryByText(/Lista de hace 9 h/)).toBeNull())
    expect(await screen.findByText(/Cobertura parcial: 240 de 502 empresas/, {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('sin ninguna lista guardada, la primera pasada va corta y enseña lo que hay mientras sigue', async () => {
    const corta = `${HOY}&budget=40`
    const rutas = {
      ...RUTAS,
      [`${HOY}&vencida=aceptar`]: { status: 404, json: { detail: 'No hay ninguna lista de EE. UU. — S&P 500 guardada' } },
      [corta]: RUTAS[HOY],
    }
    const soltar = servirReteniendo(rutas, corta)
    pintar()
    expect(await screen.findByText('Preparando la primera lista…')).toBeInTheDocument()
    await act(async () => soltar())
    expect(await screen.findByRole('button', { name: 'Mejores ideas (5)' })).toBeInTheDocument()
    expect(screen.queryByText(/No se pudo cargar la lista de hoy/)).toBeNull()
    expect(await screen.findByText(/Cobertura parcial/, {}, { timeout: 3000 })).toBeInTheDocument()
  })
})

describe('Hoy: la edad de la lista avanza y el día sin registro se dice (revisión 15)', () => {
  const G = `${HOY}&vencida=aceptar`
  const HORA = 3_600_000
  const cabecera = () => screen.getByText(/^(Calculado|Recalculado) /)

  it('con una lista vigente, la cabecera y el repaso del stop envejecen con la pantalla abierta', async () => {
    // H2: la cabecera se calculaba al pintar la página, y la página solo se
    // repinta cuando cambia la lista: «Calculado hace 5 min» tres horas después,
    // y «nada urgente» con el repaso de entonces sin decir de cuándo.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-09-12T10:05:00Z'))
    const rutas = JSON.parse(JSON.stringify(RUTAS)) as Record<string, Ruta>
    const vigente = rutas[G].json as Record<string, unknown>
    delete vigente.estado
    delete vigente.antiguedad_segundos
    Object.assign(vigente, { fetched_at: '2026-09-12T10:00:00+00:00', as_of: '2026-09-12T09:58:00+00:00',
      complete: true, pending: 0, fallidas: 0, scored: 502 })
    // Una posición fuera de la lista, por encima de su stop con la cotización de las 10:04.
    vigente.cartera = { abiertas: 1, en_lista: 0, posiciones: [{
      symbol: 'STOP', en_lista: false, precio: 104, precio_estado: 'valido', moneda: 'USD', stop: 90,
      stop_fijado_al_abrir: true, stop_por_clase: false, estado: 'por_encima', motivo: null,
      precio_fuente: 'cotizacion', precio_proveedor: 'finnhub', precio_fecha: '2026-09-12T10:04:00+00:00' }] }
    servir(rutas)
    pintar()
    expect(await screen.findByText('Calculado hace 5 min')).toBeInTheDocument()
    expect(screen.getByText('nada urgente')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3 * HORA)
    })
    expect(cabecera()).toHaveTextContent('Calculado hace 3 h')
    expect(screen.getByText('nada urgente · repaso de hace 3 h')).toBeInTheDocument()
  })

  it('con la copia caducada, la cabecera y la línea de progreso dicen la misma edad', async () => {
    // H2: la cabecera contaba desde `fetched_at` y no se repintaba; la línea de
    // progreso, desde la edad que dio el backend al llegar, cada minuto.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    // La copia del fixture se guardó a las 05:35 y llega con 9 h.
    vi.setSystemTime(new Date('2026-09-12T14:35:00Z'))
    const rutas = JSON.parse(JSON.stringify(RUTAS)) as Record<string, Ruta>
    rutas[HOY] = { status: 502, json: { detail: 'EDGAR no respondió' } }
    servir(rutas)
    pintar()
    expect(await screen.findByText('Lista de hace 9 h, sin actualizar.')).toBeInTheDocument()
    expect(cabecera()).toHaveTextContent('Calculado hace 9 h')

    act(() => {
      vi.advanceTimersByTime(HORA)
    })
    expect(screen.getByText('Lista de hace 10 h, sin actualizar.')).toBeInTheDocument()
    expect(cabecera()).toHaveTextContent('Calculado hace 10 h')
  })

  it('un día que se queda sin registrar la decisión lo dice junto a la cobertura parcial', async () => {
    // H4: cada pasada parcial trae `instantaneas.sin_congelar`; las cuatro
    // automáticas terminan en 240 de 502 y la pantalla decía «Cobertura
    // parcial», pero no que hoy no quedaba registrada ninguna decisión.
    servir(RUTAS)
    pintar()
    expect(await screen.findByText(/Cobertura parcial: 240 de 502/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText(
      'La decisión de hoy aún no se registra en el historial: se registra con la primera lista que cubra el mercado entero.',
    )).toBeInTheDocument()
  })
})
