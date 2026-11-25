/**
 * Inicio (`docs/PLAN_NAVEGACION.md`): el día de un vistazo. Lo que se prueba
 * aquí es lo que un usuario sin experiencia no puede perderse — qué necesita su
 * atención, sin callar nunca lo que no se pudo comprobar — y que cada tarjeta
 * carga por su cuenta: la cartera y el mercado no esperan a la lista del día.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexEntry, Portfolio, PortfolioPosition, PriceAlert, RepasoDeCartera, SectorEntry, VigilanciaResponse } from '../api/types'
import { atencionDeCartera } from '../components/cartera/atencion'
import { posicionDelRepaso, repasoDe, senalDePosicion } from '../test/repaso'
import { atencionesDeInicio, extremosDeSectores, indicesDeInicio, InicioPage } from './InicioPage'

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

/** Lo que Inicio cuenta de una cartera con este repaso (el de `/api/portfolio`). */
const deInicio = (repaso: RepasoDeCartera, alertas: PriceAlert[] | null = [], tesis: VigilanciaResponse | null = null) =>
  atencionesDeInicio(atencionDeCartera({ positions: [], repaso } as Pick<Portfolio, 'positions' | 'repaso'>), alertas, tesis)

describe('atencionesDeInicio', () => {
  it('un stop perforado va primero, en rojo, con los dos precios y qué dice la regla', () => {
    const lista = deInicio(
      repasoDe([
        posicionDelRepaso({ symbol: 'KO', precio: null, estado: 'sin_comprobar', motivo: 'sin precio (ninguna fuente dio su cotización)' }),
        posicionDelRepaso({ symbol: 'STOP', precio: 104, stop: 110, estado: 'perforado' }),
      ]),
    )
    expect(lista[0]).toMatchObject({ tono: 'rojo', de: 'posicion', titulo: 'STOP bajó de tu límite de pérdida' })
    expect(lista[0].texto).toContain('104,00')
    expect(lista[0].texto).toContain('110,00')
    expect(lista[0].texto).toContain('Tu regla dice vender')
  })

  it('sin precio, con un precio viejo o sin stop: «sin comprobar», nunca en orden ni callado', () => {
    const lista = deInicio(
      repasoDe([
        posicionDelRepaso({ symbol: 'SINPRECIO', precio: null, estado: 'sin_comprobar', motivo: 'sin precio' }),
        posicionDelRepaso({ symbol: 'VIEJO', precio_estado: 'viejo', estado: 'sin_comprobar', motivo: 'solo hay un precio viejo' }),
        posicionDelRepaso({ symbol: 'SINSTOP', stop: null, estado: 'sin_comprobar', motivo: 'sin stop' }),
        posicionDelRepaso({ symbol: 'BIEN' }),
      ]),
      null,
    )
    expect(lista.map((a) => [a.tono, a.titulo])).toEqual([
      ['ambar', 'SINPRECIO: sin comprobar'],
      ['ambar', 'SINSTOP no tiene límite de pérdida'],
      ['ambar', 'VIEJO: sin comprobar'],
    ])
  })

  it('una venta por puntuación con el stop intacto sale, como en Explorar; «Mantener» no', () => {
    const vender = senalDePosicion('TPL', { action: 'vender', label: 'Vender', reglas: [
      { id: 'puntuacion_desfavorable', regla: 'Puntuación ≤ -0,35', resultado: 'cumple', efecto: 'vender', papel: 'decide', datos: { valor: -0.52, umbral: -0.35 } },
    ] })
    const mantener = senalDePosicion('KO', { action: 'mantener', label: 'Mantener' })
    const lista = deInicio(repasoDe([posicionDelRepaso({ symbol: 'TPL', en_lista: true }), posicionDelRepaso({ symbol: 'KO', en_lista: true })], {
      senales: [vender, mantener],
    }))
    expect(lista.map((a) => [a.tono, a.titulo])).toEqual([['rojo', 'Tu regla dice vender TPL']])
    expect(lista[0].texto).toContain('cayó a -0,52')
  })

  it('una alerta de precio que saltó es roja y va como alerta; una que no se pudo comprobar, ámbar; una desactivada no cuenta', () => {
    const lista = deInicio(repasoDe([]), [
      alerta({ id: 1, symbol: 'AAA', triggered: true }),
      alerta({ id: 2, symbol: 'BBB', triggered: null, estado: 'sin_precio' }),
      alerta({ id: 3, symbol: 'CCC', triggered: true, active: false }),
    ])
    expect(lista.map((a) => [a.tono, a.de, a.titulo])).toEqual([
      ['rojo', 'alerta', 'Saltó tu alerta de AAA'],
      ['ambar', 'alerta', 'Tu alerta de BBB: sin comprobar'],
    ])
  })

  it('una tesis con un punto de vigilancia cruzado, en ámbar y no como orden de venta; uno sin medir, sin comprobar', () => {
    const tesis = (id: number, symbol: string, saltan: number, sinMedir: number) => ({
      thesis_id: id, symbol, title: 't', invalidation_criteria: null,
      vigilancia: { disparadores: saltan ? [{ id: 1, kind: 'metrica', descripcion: 'Margen operativo por debajo del 10 %', config: {}, activo: true,
        created_at: '2026-09-01T00:00:00Z', last_fired_at: null, salta: true, medible: true }] : [], saltan, sin_medir: sinMedir, total: 2, nota: '' },
    })
    const lista = deInicio(repasoDe([]), [], {
      tesis: [tesis(1, 'KO', 1, 0), tesis(2, 'PEP', 0, 1), tesis(3, 'MSFT', 0, 0)], total_saltan: 1, sin_disparadores: [], nota: '', aviso_sin_disparadores: null,
    } as unknown as VigilanciaResponse)
    expect(lista.map((a) => [a.tono, a.de, a.titulo])).toEqual([
      ['ambar', 'tesis', 'Tu tesis de KO: saltó un punto de vigilancia'],
      ['ambar', 'tesis', 'Tu tesis de PEP: sin comprobar'],
    ])
    expect(lista[0].texto).toContain('Margen operativo por debajo del 10 %. No es una orden de venta')
    expect(lista[0].to).toBe('/cartera?pestana=tesis')
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
      new Response(
        JSON.stringify({ positions: [posicion({ symbol: 'KO' })], summary: { total_market_value: null }, repaso: repasoDe([posicionDelRepaso({ symbol: 'KO' })]) }),
        { status: 200 },
      )
    respuestas['/api/market/overview'] = async () =>
      new Response(JSON.stringify({ indices: [{ symbol: 'SPY', label: 'S&P 500 (SPY)', quote: null }] }), { status: 200 })
    pintar()
    // El verbo de Explorar para una posición con el stop intacto.
    expect(await screen.findByText('Mantener')).toBeInTheDocument()
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
