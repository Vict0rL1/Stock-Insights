/**
 * Ítem 2.1 en Señales:
 * - si los universos no llegan se dice, con su motivo y «Reintentar»; antes el
 *   fallo hacía `setUniverses([])` y quedaba solo «Mi watchlist», como si el
 *   servidor no tuviera ninguno;
 * - un backtest de reglas sin la racha perdedora no pinta «0 seguidas», la
 *   mejor racha posible, para algo que no se midió.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignalsPage } from './SignalsPage'

afterEach(() => vi.unstubAllGlobals())

const REGLAS = {
  n_operaciones: 12,
  fiable: false,
  tasa_acierto: 0.5,
  esperanza_pct: 1.2,
  media_ganadora_pct: 6,
  media_perdedora_pct: -4,
  referencia_pct: 0.4,
  ventaja_pct: 0.8,
  // Sin `racha_perdedora`: el tipo la declara opcional.
  coste_por_lado_pct: 0.1,
  coste_total_por_operacion_pct: 0.2,
  filtro_tendencia: true,
  umbral: 0.5,
  descartes: {},
  operaciones: [],
  sesgo_supervivencia: 'El universo es el de hoy: sesgo de supervivencia.',
  universo: ['AAPL', 'MSFT', 'KO'],
  sin_datos: [],
  periodo: { desde: '2020-01-01', hasta: '2026-01-01' },
  comparativa_sin_filtro_tendencia: { n_operaciones: 0 },
  veredicto: 'Muestra corta para concluir.',
}

function servir(universos: { status: number; json: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    if (url === '/api/signals/universes') return new Response(JSON.stringify(universos.json), { status: universos.status })
    if (url === '/api/signals/rule-backtest') return new Response(JSON.stringify(REGLAS), { status: 200 })
    return new Response(JSON.stringify({ detail: 'sin datos en el test' }), { status: 503 })
  }))
}

describe('Señales', () => {
  it('universos que no llegan: se dice el fallo y la watchlist sigue disponible', async () => {
    servir({ status: 502, json: { detail: 'el servidor no respondió' } })
    render(<MemoryRouter><SignalsPage /></MemoryRouter>)
    expect(await screen.findByText('No se pudieron cargar los universos: el servidor no respondió')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mi watchlist/ })).toBeInTheDocument()
  })

  it('universos que llegan se pintan junto a la watchlist', async () => {
    servir({ status: 200, json: { universes: [{ key: 'megacaps', name: 'Megacaps', description: 'Las más grandes.', size: 30 }], note: '' } })
    render(<MemoryRouter><SignalsPage /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: /Megacaps/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Mi watchlist/ })).toHaveLength(1)
    expect(screen.queryByText(/No se pudieron cargar/)).not.toBeInTheDocument()
  })

  it('sin racha perdedora en el backtest de reglas, «—» y no «0 seguidas»', async () => {
    servir({ status: 200, json: { universes: [], note: '' } })
    render(<MemoryRouter><SignalsPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Universo propio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Validar reglas (comprar/vender)' }))
    const rotulo = await screen.findByText('Peor racha')
    const celda = rotulo.parentElement!
    expect(celda.textContent).not.toMatch(/0 seguidas/)
    expect(celda.textContent).toContain('—')
    expect(celda.textContent).toContain('sin dato')
  })
})
