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
