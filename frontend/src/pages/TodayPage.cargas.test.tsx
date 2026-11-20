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
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import hoyCompleto from '../test/fixtures/hoy_completo.json'
import { TodayPage } from './TodayPage'

afterEach(() => vi.unstubAllGlobals())

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
