/**
 * Inicio (`docs/PLAN_NAVEGACION.md`): el día de un vistazo. Lo que se prueba
 * aquí es lo que un usuario sin experiencia no puede perderse — qué necesita su
 * atención, sin callar nunca lo que no se pudo comprobar — y que cada tarjeta
 * carga por su cuenta: la cartera y el mercado no esperan a la lista del día.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexEntry, PortfolioPosition, PriceAlert, SectorEntry } from '../api/types'
import { atencionDeCartera, extremosDeSectores, indicesDeInicio, InicioPage } from './InicioPage'

function posicion(p: Partial<PortfolioPosition> & { symbol: string }): PortfolioPosition {
  return {
    id: 1,
    name: null,
    sector: 'Tecnología',
    opened_at: '2026-09-01T00:00:00Z',
    quantity: 10,
    cost_basis: 100,
    invested: 1000,
    price: 120,
    market_value: 1200,
    unrealized_pnl: 200,
    unrealized_pct: 20,
    spark: null,
    currency: 'USD',
    market_value_base: 1200,
    invested_base: 1000,
    stop: 90,
    stop_perforado: false,
    precio_estado: 'valido',
    ...p,
  }
}

function alerta(a: Partial<PriceAlert> & { symbol: string }): PriceAlert {
  return {
    id: 1,
    kind: 'precio',
    condition: { op: '<=', price: 50 },
    active: true,
    current_price: 60,
    triggered: false,
    estado: 'ok',
    motivo: 'motivo de la alerta',
    triggered_at: null,
    ...a,
  }
}

describe('atencionDeCartera', () => {
  it('un stop perforado va primero, en rojo, con los dos precios y qué dice la regla', () => {
    const lista = atencionDeCartera(
      [posicion({ symbol: 'KO', price: null, stop_perforado: null }), posicion({ symbol: 'STOP', price: 104, stop: 110, stop_perforado: true })],
      [],
    )
    expect(lista[0]).toMatchObject({ tono: 'rojo', titulo: 'STOP bajó de tu límite de pérdida' })
    expect(lista[0].texto).toContain('104,00')
    expect(lista[0].texto).toContain('110,00')
    expect(lista[0].texto).toContain('Tu regla dice vender')
  })

  it('sin precio, con un precio viejo o sin stop: «sin comprobar», nunca en orden ni callado', () => {
    const lista = atencionDeCartera(
      [
        posicion({ symbol: 'SINPRECIO', price: null, stop_perforado: null }),
        posicion({ symbol: 'VIEJO', precio_estado: 'viejo' }),
        posicion({ symbol: 'SINSTOP', stop: null, stop_perforado: null }),
        posicion({ symbol: 'BIEN' }),
      ],
      null,
    )
    expect(lista.map((a) => [a.tono, a.titulo])).toEqual([
      ['ambar', 'SINPRECIO: sin comprobar'],
      ['ambar', 'VIEJO: sin comprobar'],
      ['ambar', 'SINSTOP no tiene límite de pérdida'],
    ])
  })

  it('una alerta de precio que saltó es roja; una que no se pudo comprobar, ámbar; una desactivada no cuenta', () => {
    const lista = atencionDeCartera([], [
      alerta({ symbol: 'AAA', triggered: true }),
      alerta({ symbol: 'BBB', triggered: null, estado: 'sin_precio' }),
      alerta({ symbol: 'CCC', triggered: true, active: false }),
    ])
    expect(lista.map((a) => [a.tono, a.titulo])).toEqual([
      ['rojo', 'Saltó tu alerta de AAA'],
      ['ambar', 'Tu alerta de BBB: sin comprobar'],
    ])
  })
})

describe('índices y sectores de Inicio', () => {
  const ix = (symbol: string, label: string): IndexEntry => ({ symbol, label, quote: null })
  it('elige S&P 500, Nasdaq 100 y el VIX; si faltan, completa con los que haya', () => {
    expect(indicesDeInicio([ix('DIA', 'Dow'), ix('^VIX', 'VIX'), ix('QQQ', 'Nasdaq 100'), ix('SPY', 'S&P 500')]).map((i) => i.symbol)).toEqual([
      'SPY',
      'QQQ',
      '^VIX',
    ])
    expect(indicesDeInicio([ix('DIA', 'Dow'), ix('IWM', 'Russell')]).map((i) => i.symbol)).toEqual(['DIA', 'IWM'])
  })

  it('el que más sube y el que más baja, solo entre los que tienen dato', () => {
    const s = (label: string, change_pct: number | null): SectorEntry => ({ symbol: label, label, change_pct, quote: null })
    const e = extremosDeSectores([s('Salud', -1), s('Energía', 1.5), s('Sin dato', null), s('Tecnología', 0)])
    expect([e?.sube.label, e?.baja.label]).toEqual(['Energía', 'Salud'])
    expect(extremosDeSectores([s('Solo', 1), s('Nada', null)])).toBeNull()
  })
})

describe('InicioPage', () => {
  let respuestas: Record<string, () => Promise<Response>>
  beforeEach(() => {
    window.localStorage.clear()
    respuestas = {}
    vi.stubGlobal(
      'fetch',
      vi.fn((e: RequestInfo | URL) => {
        const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
        const ruta = Object.keys(respuestas).find((r) => url.split('?')[0] === r)
        // Lo que el test no sirve se queda cargando: así se ve que el resto no lo espera.
        return ruta ? respuestas[ruta]() : new Promise<Response>(() => {})
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const pintar = () =>
    render(
      <MemoryRouter>
        <InicioPage />
      </MemoryRouter>,
    )

  it('la cartera y el mercado se pintan sin esperar a la lista del día', async () => {
    respuestas['/api/portfolio'] = async () =>
      new Response(JSON.stringify({ positions: [posicion({ symbol: 'KO' })], summary: { total_market_value: null } }), { status: 200 })
    respuestas['/api/market/overview'] = async () =>
      new Response(JSON.stringify({ indices: [{ symbol: 'SPY', label: 'S&P 500 (SPY)', quote: null }] }), { status: 200 })
    pintar()
    expect(await screen.findByText('En orden')).toBeInTheDocument()
    expect(await screen.findByText('S&P 500 (SPY)')).toBeInTheDocument()
    // La lista (`/api/signals/today`) sigue pendiente y lo dice sin bloquear nada.
    expect(screen.getByText('Cargando la lista de hoy…')).toBeInTheDocument()
  })

  it('si la cartera no carga, no dice «nada urgente»: dice que no se comprobó', async () => {
    respuestas['/api/portfolio'] = async () => new Response(JSON.stringify({ detail: 'base caída' }), { status: 500 })
    pintar()
    expect(await screen.findByText('Ningún límite de pérdida se ha podido comprobar.')).toBeInTheDocument()
    expect(screen.queryByText(/Nada urgente/)).not.toBeInTheDocument()
  })

  it('la guía de tres pasos se oculta y no vuelve a salir', () => {
    const { unmount } = pintar()
    fireEvent.click(screen.getByRole('button', { name: 'Entendido, ocultar' }))
    expect(screen.queryByRole('heading', { name: 'Cómo usar la app, en tres pasos' })).not.toBeInTheDocument()
    unmount()
    pintar()
    expect(screen.queryByRole('heading', { name: 'Cómo usar la app, en tres pasos' })).not.toBeInTheDocument()
  })
})
