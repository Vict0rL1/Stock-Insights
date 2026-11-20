/**
 * Ítem 2.1: si los presets no llegan, la pantalla lo dice con su motivo y deja
 * reintentar. Antes el fallo hacía `setPresets([])` y se quedaba en «Cargando
 * presets…» para siempre.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScreenerPage } from './ScreenerPage'

afterEach(() => vi.unstubAllGlobals())

const PRESET = { name: 'Calidad a buen precio', logic_md: 'ROE alto y deuda baja.', filters: { roe: { op: 'gte', value: 0.15 } } }

/** Los presets fallan las `fallos` primeras veces y luego llegan. */
function servir(fallos: number) {
  let pedidas = 0
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    if (url === '/api/screener/presets') {
      pedidas += 1
      if (pedidas <= fallos) return new Response(JSON.stringify({ detail: 'la base no responde' }), { status: 503 })
      return new Response(JSON.stringify({ builtin: [PRESET], saved: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({ detail: 'sin datos en el test' }), { status: 503 })
  }))
}

describe('presets del screener', () => {
  it('un fallo se dice con su motivo, no se queda «cargando», y se puede reintentar', async () => {
    servir(1)
    render(<MemoryRouter><ScreenerPage /></MemoryRouter>)
    expect(await screen.findByText('No se pudieron cargar los presets: la base no responde')).toBeInTheDocument()
    expect(screen.queryByText(/Cargando/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('button', { name: 'Calidad a buen precio' })).toBeInTheDocument()
    // Al llegar, el primero queda elegido, como antes.
    expect(screen.getByText('ROE alto y deuda baja.')).toBeInTheDocument()
  })
})

describe('resultados del screener', () => {
  it('la cifra de una comprobación no se escribe igual que su umbral (revisión 11)', async () => {
    // Un ROE de 0,1496 salía en rojo «ROE: 15,0 %» bajo el filtro «ROE ≥ 15,0 %».
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      if (url === '/api/screener/presets') {
        return new Response(JSON.stringify({ builtin: [PRESET], saved: [] }), { status: 200 })
      }
      if (url === '/api/screener/run') {
        return new Response(JSON.stringify({
          results: [{ symbol: 'ACME', name: 'Acme', passes: false, estado: 'no_pasa', score: 0,
            checks: [{ metric: 'roe', op: 'gte', value: 0.15, actual: 0.1496, passed: false, estado: 'no_pasa' }],
            metrics: { roe: 0.1496 }, source: 'prueba', cached: false }],
          unavailable: [], passed: 0, no_pasan: 1, sin_comprobar: 0, evaluated: 1, note: '',
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: 'sin datos en el test' }), { status: 503 })
    }))
    render(<MemoryRouter><ScreenerPage /></MemoryRouter>)
    await screen.findByText('ROE alto y deuda baja.')
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar screener' }))
    expect(await screen.findByText(/ROE: 14,96\s%/)).toBeInTheDocument()
  })
})

describe('un dato ausente no es un suspenso (revisión 12, visual)', () => {
  const VALUE = {
    name: 'Value', logic_md: 'P/E ≤ 18, deuda/capital ≤ 1, ratio corriente ≥ 1,2 y ROE ≥ 10 %.',
    filters: { pe_ttm: { op: 'lte', value: 18 }, debt_to_equity: { op: 'lte', value: 1.0 },
      current_ratio: { op: 'gte', value: 1.2 }, roe: { op: 'gte', value: 0.10 } },
  }
  const check = (metric: string, op: string, value: number, actual: number | null, estado: string) =>
    ({ metric, op, value, actual, passed: estado === 'pasa', estado })

  function servirValue() {
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      if (url === '/api/screener/presets') {
        return new Response(JSON.stringify({ builtin: [VALUE], saved: [] }), { status: 200 })
      }
      if (url === '/api/screener/run') {
        return new Response(JSON.stringify({
          results: [
            { symbol: 'XOM', passes: false, estado: 'sin_comprobar', metrics: {}, source: 'prueba', cached: false,
              checks: [check('pe_ttm', 'lte', 18, 12, 'pasa'), check('debt_to_equity', 'lte', 1, 0.4, 'pasa'),
                check('current_ratio', 'gte', 1.2, null, 'sin_dato'), check('roe', 'gte', 0.1, 0.19, 'pasa')] },
            { symbol: 'CARA', passes: false, estado: 'no_pasa', metrics: {}, source: 'prueba', cached: false,
              checks: [check('pe_ttm', 'lte', 18, 40, 'no_pasa'), check('debt_to_equity', 'lte', 1, 0.4, 'pasa'),
                check('current_ratio', 'gte', 1.2, 1.5, 'pasa'), check('roe', 'gte', 0.1, 0.19, 'pasa')] },
          ],
          unavailable: [], passed: 0, no_pasan: 1, sin_comprobar: 1, evaluated: 2, note: '',
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ detail: 'sin datos en el test' }), { status: 503 })
    }))
  }

  it('la fila y el resumen separan lo que suspende de lo que no se pudo comprobar', async () => {
    servirValue()
    render(<MemoryRouter><ScreenerPage /></MemoryRouter>)
    await screen.findByText(VALUE.logic_md)
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar screener' }))
    expect(await screen.findByText('Sin comprobar · falta ratio corriente')).toBeInTheDocument()
    expect(screen.getByText('No pasa')).toBeInTheDocument()
    expect(screen.getByText('1 no pasa · 1 sin comprobar (les falta un dato; no es un suspenso)')).toBeInTheDocument()
    // «Ratio corriente: —» salía en rojo, como un suspenso; el P/E de 40, sí.
    const sinDato = screen.getByText(/^Ratio corriente:\s—$/)
    expect(sinDato.className).not.toMatch(/red/)
    expect(sinDato.getAttribute('title')).toBe('Ratio corriente: sin dato')
    expect(screen.getByText(/^P\/E \(TTM\):\s40,00$/).className).toMatch(/red/)
  })

  it('las pastillas escriben el umbral como el texto del preset, sin decimales de relleno', async () => {
    servirValue()
    render(<MemoryRouter><ScreenerPage /></MemoryRouter>)
    await screen.findByText(VALUE.logic_md)
    // Decían «18,00», «1,00», «1,20» y «10,0 %» bajo «P/E ≤ 18» y «ROE ≥ 10 %».
    for (const texto of [/^P\/E \(TTM\) ≤ 18$/, /^Deuda\/capital ≤ 1$/, /^Ratio corriente ≥ 1,2$/, /^ROE ≥ 10\s%$/]) {
      expect(screen.getByText(texto)).toBeInTheDocument()
    }
  })

  it('un ticker que no cabe en el universo se nombra', async () => {
    servirValue()
    render(<MemoryRouter><ScreenerPage /></MemoryRouter>)
    await screen.findByText(VALUE.logic_md)
    const muchos = Array.from({ length: 26 }, (_, i) => `T${String.fromCharCode(65 + (i % 26))}${i}`).join(', ')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: muchos } })
    expect(screen.getByRole('status').textContent).toBe('Solo se evalúan 25 a la vez: TZ25 queda fuera.')
  })
})
