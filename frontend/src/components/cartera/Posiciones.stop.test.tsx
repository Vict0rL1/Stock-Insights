/**
 * Revisión 12, visual: STOP, a 104 con el stop en 110, salía en verde en la
 * tabla del Portafolio (sin columna de stop) y el riesgo abierto la contaba
 * entera sin nombrarla. Hoy, Mi cartera: la tabla en Posiciones, el riesgo
 * abierto y el estrés en Riesgo. Parte de la respuesta REAL de la cartera de ACME
 * (`empresa_completa.json`) y cambia en memoria lo que cada caso necesita.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { MiCarteraPage } from '../../pages/MiCarteraPage'

type Rutas = Record<string, { status: number; json: unknown }>
type Fila = Record<string, unknown>
type Cartera = {
  positions: Fila[]
  divisas: Record<string, unknown>
  summary: Record<string, unknown>
  risk_budget: { posiciones: Fila[]; por_grupo: Record<string, number>; avisos: string[]; riesgo_total_pct: number }
  estres: Record<string, unknown>
}

vi.mock('../PriceChart', () => ({ PriceChart: () => null }))

afterEach(() => vi.unstubAllGlobals())

function servir(cambiar: (cartera: Cartera) => void, pestana = 'posiciones') {
  const rutas: Rutas = structuredClone((empresaCompleta as { rutas: Rutas }).rutas)
  rutas['/api/portfolio/alerts'] = { status: 200, json: { alerts: [], vigilancia: null } }
  cambiar(rutas['/api/portfolio'].json as Cartera)
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
  }))
  return render(
    <MemoryRouter initialEntries={[`/cartera?pestana=${pestana}`]}>
      <MiCarteraPage />
    </MemoryRouter>,
  )
}

/** KO, más STOP (en dólares, stop perforado) y SHOP.TO (en CAD, sin precio). */
function conStop(cartera: Cartera) {
  const ko = cartera.positions[0]
  cartera.positions.push(
    { ...ko, id: 2, symbol: 'STOP', name: 'Stop Corp', sector: 'Technology', quantity: 50, cost_basis: 90, price: 104,
      stop: 110, stop_perforado: true, stop_estado: 'perforado', invested: 4500, market_value: 5200, unrealized_pnl: 700,
      unrealized_pct: 700 / 4500 },
    { ...ko, id: 3, symbol: 'SHOP.TO', name: 'Shopify', currency: 'CAD', sector: 'Technology', price: null,
      precio_estado: 'desconocido', stop: 100, stop_perforado: null, stop_estado: 'sin_comprobar',
      stop_motivo: 'sin precio (ninguna fuente dio su cotización)', market_value: null, unrealized_pnl: null,
      unrealized_pct: null },
  )
  ko.stop_perforado = false
  cartera.divisas = { ...cartera.divisas, mezcla_de_divisas: true, monedas: { USD: 23200, CAD: 0 } }
  cartera.risk_budget.posiciones.unshift({
    symbol: 'STOP', grupo: 'Technology', riesgo_pct: 15.6, peso_pct: 15.6,
    nota: 'stop ya perforado: en riesgo la posición entera',
  })
}

const fila = (simbolo: string) =>
  screen.getAllByRole('row').find((r) => r.querySelector('a')?.textContent?.includes(simbolo))!

describe('el stop en Mi cartera', () => {
  it('la tabla enseña el stop de cada posición, y el perforado en rojo', async () => {
    servir(conStop)
    expect(await screen.findByRole('columnheader', { name: 'Límite de pérdida (stop)' })).toBeInTheDocument()
    const stop = fila('STOP')
    expect(stop.className).toContain('bg-red-50')
    expect(stop.textContent).toContain('110,00\u00a0USDperforado')
    expect(fila('KO').textContent).toContain('50,00\u00a0USD')
    expect(fila('KO').textContent).not.toContain('perforado')
    // Sin precio no se sabe: «sin comprobar», no «intacto».
    expect(fila('SHOP.TO').textContent).toContain('100,00\u00a0CADsin comprobar')
  })

  it('el riesgo abierto nombra la posición que cuenta entera por su stop perforado', async () => {
    servir(conStop, 'riesgo')
    const nota = await screen.findByText(/stop ya perforado: en riesgo la posición entera/)
    expect(nota.textContent).toBe('STOP — stop ya perforado: en riesgo la posición entera (un 15,6\u00a0% de la cartera).')
    expect(nota.className).toContain('text-red-800')
  })

  it('cuatro tarjetas por fila solo cuando caben (desde xl)', async () => {
    servir(() => {})
    const tarjetas = (await screen.findByText('Invertido')).closest('section')!
    expect(tarjetas.className).toMatch(/(^|\s)xl:grid-cols-4(\s|$)/)
    expect(tarjetas.className).not.toMatch(/(^|\s)(sm|md|lg):grid-cols-4(\s|$)/)
  })

  it('el recorrido dice su moneda con dos divisas y que es el último cierre', async () => {
    servir(conStop)
    const rotulo = await screen.findByText('Último cierre')
    expect(rotulo.parentElement!.textContent).toBe('Último cierre20.270,43\u00a0USD11 sept 2026')
    expect(screen.getByText('Máximo').parentElement!.textContent).toContain('20.376,18\u00a0USD')
    expect(screen.queryByText('Ahora')).toBeNull()
  })

  const vacia = (cartera: Cartera) => {
    cartera.positions = []
    cartera.summary = { ...cartera.summary, total_invested: 0, total_market_value: null, unrealized_pnl: null,
                        unrealized_pct: null, max_drawdown_esperado_pct: null, total_positions: 0, priced_positions: 0 }
    cartera.risk_budget = { ...cartera.risk_budget, posiciones: [], por_grupo: {}, avisos: [], riesgo_total_pct: 0 }
    cartera.estres = { suficiente: false, nota: 'Sin cartera o sin histórico.' }
  }

  it('con la cartera vacía, el vacío se dice igual en todas partes', async () => {
    servir(vacia)
    const invertido = (await screen.findByText('Invertido')).parentElement!
    expect(invertido.textContent).toBe('Invertido—')
    expect(screen.getByText('Sin posiciones abiertas.', { selector: 'div' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Sin histórico para estimar|Sin cartera o sin histórico|quedan .* de margen/)
    cleanup()
    // El riesgo abierto y el estrés, en su pestaña.
    servir(vacia, 'riesgo')
    expect(await screen.findByText('Sin posiciones abiertas: no hay riesgo abierto que sumar.')).toBeInTheDocument()
    expect(screen.getByText('Sin posiciones abiertas que estresar.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Sin histórico para estimar|Sin cartera o sin histórico|quedan .* de margen/)
  })

  it('una peor ventana positiva se escribe con su signo y no en rojo', async () => {
    // Desde que el estrés puede medir 12 meses, la peor ventana de una cartera
    // que solo subió salía «5,8 %» en rojo, como una pérdida (revisión 12, visual).
    servir((c) => {
      Object.assign(c.estres, { peor_ventana_meses: 12, peor_ventana_pct: 5.8,
        peor_ventana_desde: '2025-07-24', peor_ventana_hasta: '2026-04-02' })
    }, 'riesgo')
    const cifra = await screen.findByText(/^\+5,8\s%$/)
    expect(cifra.className).not.toMatch(/red/)
  })
})
