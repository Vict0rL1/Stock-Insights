/**
 * Ítem 2.1: un fallo de carga se dice como fallo, con su motivo, y nunca como
 * «no hay». Parte de la respuesta REAL de la cartera de ACME
 * (`empresa_completa.json`) y rompe o retoca una ruta cada vez.
 *
 * - Alertas: es un control de riesgo. Con la carga fallida salían «Sin alertas
 *   configuradas.» y quien vigilaba un stop creía que no tenía ninguno.
 * - Watchlist: el fallo dejaba la lista en `[]` y decía «Watchlist vacía.».
 * - Cartera y recorrido: el motivo salía suelto, sin decir qué no había cargado.
 * - Cerradas: el P&L realizado salía sin código de moneda con dos divisas.
 * - Precio: «viejo · N min» a mano, y el «desconocido» del backend no se decía.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../test/fixtures/empresa_completa.json'
import { PortfolioPage } from './PortfolioPage'

type Rutas = Record<string, { status: number; json: unknown }>
type Cartera = {
  positions: Record<string, unknown>[]
  closed_positions: Record<string, unknown>[]
  summary: Record<string, unknown>
}

vi.mock('../components/PriceChart', () => ({ PriceChart: () => null }))

const base = (empresaCompleta as { rutas: Rutas }).rutas
const falla = (motivo: string) => ({ status: 503, json: { detail: motivo } })

function servir(rutas: Rutas) {
  const fetchFalso = vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
  })
  vi.stubGlobal('fetch', fetchFalso)
  return fetchFalso
}

function con(cambios: (rutas: Rutas, cartera: Cartera) => void): Rutas {
  const rutas: Rutas = structuredClone(base)
  cambios(rutas, rutas['/api/portfolio'].json as Cartera)
  return rutas
}

const pintar = () => render(<MemoryRouter><PortfolioPage /></MemoryRouter>)
const pestaña = (nombre: string) => fireEvent.click(screen.getByRole('button', { name: nombre }))
const fila = (simbolo: string) =>
  screen.getAllByRole('row').find((r) => r.querySelector('a')?.textContent?.includes(simbolo))

afterEach(() => vi.unstubAllGlobals())

describe('alertas (ítem 2.1)', () => {
  it('si no cargan, lo dicen con su motivo; no salen «Sin alertas configuradas.»', async () => {
    servir({ ...base, '/api/portfolio/alerts': falla('la base de datos está bloqueada') })
    pintar()
    pestaña('Alertas')
    expect(
      await screen.findByText('No se pudieron cargar las alertas: la base de datos está bloqueada'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Sin alertas configuradas.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('si cargan y no hay ninguna, sí lo dicen', async () => {
    servir({
      ...base,
      '/api/portfolio/alerts': {
        status: 200,
        json: { alerts: [], vigilancia: { activa: false, nunca: true, nota: 'Nadie vigila las alertas.' } },
      },
    })
    pintar()
    pestaña('Alertas')
    expect(await screen.findByText('Sin alertas configuradas.')).toBeInTheDocument()
    expect(screen.getByText('Nadie vigila las alertas.')).toBeInTheDocument()
  })
})

describe('watchlist (ítem 2.1)', () => {
  it('si no carga, lo dice; no sale «Watchlist vacía.»', async () => {
    servir({ ...base, '/api/watchlist': falla('el servidor no respondió') })
    pintar()
    pestaña('Watchlist')
    expect(await screen.findByText('No se pudo cargar la watchlist: el servidor no respondió')).toBeInTheDocument()
    expect(screen.queryByText('Watchlist vacía.')).toBeNull()
  })

  it('una variación desconocida no se pinta en verde', async () => {
    servir({
      ...base,
      '/api/watchlist': {
        status: 200,
        json: {
          name: 'principal',
          items: [
            {
              id: 1, symbol: 'KO', name: 'KO Corp', sector: null, notes: null,
              added_at: '2026-09-01T14:00:00+00:00', spark: null,
              quote: { price: 60, change_pct: null },
            },
          ],
        },
      },
    })
    pintar()
    pestaña('Watchlist')
    const item = (await screen.findByText('KO')).closest('li')!
    const variacion = within(item).getByText('—')
    expect(variacion.className).not.toMatch(/emerald|red/)
  })
})

describe('cartera y recorrido (ítem 2.1)', () => {
  it('si la cartera no carga, dice qué no cargó y se puede reintentar', async () => {
    const rutas = con((r) => {
      r['/api/portfolio'] = falla('tiempo de espera agotado')
    })
    servir(rutas)
    pintar()
    expect(await screen.findByText('No se pudo cargar la cartera: tiempo de espera agotado')).toBeInTheDocument()
    rutas['/api/portfolio'] = base['/api/portfolio']
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Invertido')).toBeInTheDocument()
  })

  it('si el recorrido no carga, lo dice con su nombre', async () => {
    servir({ ...base, '/api/portfolio/historial?descargar=false': falla('sin histórico en caché') })
    pintar()
    expect(
      await screen.findByText('No se pudo cargar el recorrido de la cartera: sin histórico en caché'),
    ).toBeInTheDocument()
  })

  it('un rendimiento desconocido del recorrido no se pinta en verde', async () => {
    servir(con((r) => {
      const h = r['/api/portfolio/historial?descargar=false'].json as { resumen: Record<string, unknown> }
      h.resumen.rendimiento_pct = null
    }))
    pintar()
    const valor = (await screen.findByText('Rendimiento')).nextElementSibling!
    expect(valor.textContent).toBe('—')
    expect(valor.className).not.toMatch(/emerald|red/)
  })
})

describe('posiciones cerradas (ítem 2.1)', () => {
  const cerradas = () =>
    con((_, cartera) => {
      cartera.closed_positions = [
        {
          id: 9, symbol: 'RY.TO', quantity: 10, cost_basis: 120, realized_pnl: 370,
          opened_at: '2026-01-05T15:00:00+00:00', closed_at: '2026-06-01T15:00:00+00:00',
          currency: 'CAD', realized_pnl_base: 270.5,
        },
        {
          id: 10, symbol: 'XYZ', quantity: 5, cost_basis: 10, realized_pnl: 12,
          opened_at: '2026-01-05T15:00:00+00:00', closed_at: '2026-06-01T15:00:00+00:00',
          currency: null, realized_pnl_base: null,
        },
      ]
      cartera.summary.realized_pnl = 270.5
      cartera.summary.realizado_sin_convertir = ['XYZ']
    })

  it('cada realizado dice su moneda, y el total la base, aunque las abiertas sean todas USD', async () => {
    servir(cerradas())
    pintar()
    const ry = (await screen.findByText('Posiciones cerradas')).parentElement!
    expect(within(ry).getByText('RY.TO').closest('li')!.textContent).toContain('+370,00 CAD')
    expect(screen.getByText('Realizado (cerradas)').parentElement!.textContent).toContain('+270,50 USD')
    // Con dos monedas en pantalla, también las abiertas dicen la suya.
    expect(fila('KO')!.textContent).toContain('58,00 USD')
  })

  it('una cerrada sin moneda conocida lo dice, en vez de un importe sin código', async () => {
    servir(cerradas())
    pintar()
    const lista = (await screen.findByText('Posiciones cerradas')).parentElement!
    const xyz = within(lista).getByText('XYZ').closest('li')!
    expect(xyz.textContent).toContain('+12,00')
    expect(xyz.textContent).toContain('moneda desconocida')
  })
})

describe('estado del precio de cada fila (ítem 2.1)', () => {
  it('el viejo dice su antigüedad con fmtAntiguedad y el desconocido se dice', async () => {
    servir(con((_, cartera) => {
      const ko = cartera.positions[0]
      ko.precio_estado = 'viejo'
      ko.precio_antiguedad_segundos = 660
      cartera.positions.push({
        ...ko,
        id: 3, symbol: 'PEP', name: 'PEP Corp',
        price: null, market_value: null, market_value_base: null,
        unrealized_pnl: null, unrealized_pct: null,
        precio_estado: 'desconocido', precio_antiguedad_segundos: null,
      })
    }))
    pintar()
    expect(await screen.findByText('Invertido')).toBeInTheDocument()
    expect(fila('KO')!.textContent).toContain('viejo · hace 11 min')
    expect(fila('PEP')!.textContent).toContain('precio desconocido')
  })
})
