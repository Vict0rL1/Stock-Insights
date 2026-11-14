/**
 * Ítem 2.1 en el screener multifactor:
 * - si los mercados no llegan se dice, con su motivo y «Reintentar»; antes el
 *   fallo hacía `setMarkets([])` y el selector se quedaba vacío sin más;
 * - al reordenar con pesos nuevos, una empresa sin ninguna familia con peso y
 *   dato no tiene nota: antes puntuaba 0 y se colaba en mitad de la tabla como
 *   neutral, por delante de las que sí puntúan en negativo.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MultifactorPage } from './MultifactorPage'

afterEach(() => vi.unstubAllGlobals())

const SIN_FAMILIAS = { value: null, quality: null, momentum: null, growth: null, low_volatility: null, size: null }

const fila = (symbol: string, puesto: number, score: number, familias: Record<string, number | null>) => ({
  symbol,
  name: `Empresa ${symbol}`,
  sector: 'Tecnología',
  price: 100,
  puesto,
  score,
  cobertura: 0.25,
  familias: { ...SIN_FAMILIAS, ...familias },
  aportaciones: {},
  crudos: {},
})

const RESULTADO = {
  // AAA solo tiene valor; BBB solo calidad, y en negativo.
  ranking: [fila('AAA', 1, 1, { value: 1 }), fila('BBB', 2, -0.5, { quality: -0.5 })],
  sin_puntuar: [],
  pesos: { value: 0.25, quality: 0.25, momentum: 0.25, growth: 0.1, low_volatility: 0.1, size: 0.05 },
  correlacion_familias: { pares: {}, solapamientos: [], nota: '' },
  sectores: { Tecnología: 2 },
  sectores_sin_muestra: [],
  aviso_sectores: null,
  market_key: 'us_sp500',
  market_name: 'S&P 500',
  evaluadas: 2,
  sin_datos: [],
  pendientes: [],
  completo: true,
  nota_cobertura: '',
  nota_coste: '',
  nota: '',
  advertencia: 'Un ranking de factores no es una recomendación.',
}

function servir(meta: { status: number; json: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    if (url === '/api/screener/multifactor/meta') return new Response(JSON.stringify(meta.json), { status: meta.status })
    if (url === '/api/screener/multifactor') return new Response(JSON.stringify(RESULTADO), { status: 200 })
    return new Response(JSON.stringify({ detail: 'sin datos en el test' }), { status: 503 })
  }))
}

const META = {
  familias: {},
  pesos_por_defecto: RESULTADO.pesos,
  markets: [{ key: 'us_sp500', name: 'S&P 500', description: '', companies: 500, sectors: 11 }],
}

describe('screener multifactor', () => {
  it('mercados que no llegan: se dice el fallo y se puede reintentar', async () => {
    servir({ status: 503, json: { detail: 'la descarga del universo falló' } })
    render(<MemoryRouter><MultifactorPage /></MemoryRouter>)
    expect(await screen.findByText('No se pudieron cargar los mercados: la descarga del universo falló')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('una empresa sin familias con peso se queda sin nota y al final, no como neutral', async () => {
    servir({ status: 200, json: META })
    render(<MemoryRouter><MultifactorPage /></MemoryRouter>)
    expect(await screen.findByRole('option', { name: 'S&P 500' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ejecutar' }))
    await screen.findByText('Un ranking de factores no es una recomendación.')

    // Sin peso para «Valor», a AAA no le queda ninguna familia que puntuar.
    fireEvent.change(screen.getByLabelText('Valor'), { target: { value: '0' } })

    const filas = screen.getAllByRole('row').slice(1)
    expect(filas[0]).toHaveTextContent('BBB')
    expect(filas[1]).toHaveTextContent('AAA')
    expect(within(filas[1]).getByText('sin nota con estos pesos')).toBeInTheDocument()
    // Sin puesto ni nota: «—», no «0,00».
    const celdas = within(filas[1]).getAllByRole('cell')
    expect(celdas[0]).toHaveTextContent('—')
    expect(celdas[3]).toHaveTextContent('—')
  })
})
