/**
 * Revisión 12, visual: Hoy solo miraba las posiciones del mercado barrido. Con
 * STOP fuera del S&P 500 (stop en 110, cotizando a 104) decía «Para vender 0 ·
 * nada urgente», «1 en cartera» con tres abiertas y «1 posiciones abiertas».
 * Parte de la respuesta REAL de Hoy (`hoy_completo.json`) y le pone el repaso
 * de stops que ahora sirve el backend (`cartera`), construido aquí.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import hoyCompleto from '../test/fixtures/hoy_completo.json'
import type { StopDePosicion, StopsDeCartera, TodayResponse } from '../api/types'
import { TodayPage, recortesDe, recuentos, tonoDeVariacion } from './TodayPage'

type Rutas = Record<string, { status: number; json: unknown }>
type Hoy = {
  cartera?: StopsDeCartera
  shortlist: { ideas: { symbol: string; price: { change_pct: number | null }; peso_final_pct: number | null; decision: { levels: { peso_bruto_pct: number | null } } }[]; sizing: { recortes: string[] } }
}

afterEach(() => vi.unstubAllGlobals())

const posicion = (p: Partial<StopDePosicion> & { symbol: string }): StopDePosicion => ({
  en_lista: false,
  precio: 100,
  precio_estado: 'valido',
  moneda: 'USD',
  stop: 90,
  stop_fijado_al_abrir: true,
  stop_por_clase: false,
  estado: 'por_encima',
  motivo: null,
  ...p,
})

/** La respuesta real, con cada pasada de Hoy cambiada por `cambiar`. */
function servir(cambiar: (hoy: Hoy) => void) {
  const rutas: Rutas = structuredClone((hoyCompleto as unknown as { rutas: Rutas }).rutas)
  for (const [url, r] of Object.entries(rutas)) if (url.startsWith('/api/signals/today')) cambiar(r.json as Hoy)
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
  }))
  return render(<MemoryRouter><TodayPage /></MemoryRouter>)
}

const tarjeta = (rotulo: string) => screen.getByText(rotulo, { selector: 'div' }).parentElement!

const TRES: StopsDeCartera = {
  abiertas: 3,
  en_lista: 1,
  posiciones: [
    posicion({ symbol: 'STOP', precio: 104, stop: 110, estado: 'perforado' }),
    posicion({ symbol: 'SHOP.TO', precio: null, precio_estado: 'desconocido', moneda: 'CAD', stop: 100, estado: 'sin_comprobar', motivo: 'sin precio (ninguna fuente dio su cotización)' }),
    posicion({ symbol: 'KO', en_lista: true, precio: 60, stop: 50 }),
  ],
}

describe('Hoy repasa el stop de toda la cartera', () => {
  it('un stop perforado fuera de la lista es urgente, y los recuentos cuentan las tres', async () => {
    const { container } = servir((hoy) => { hoy.cartera = TRES })
    expect(await screen.findByText('Stop perforado en 1 posición')).toBeInTheDocument()
    expect(container.textContent).toContain(
      'STOP cotiza a 104,00\u00a0USD, en o por debajo de su stop (110,00\u00a0USD). No está en EE. UU. — S&P 500',
    )
    expect(container.textContent).toContain('SHOP.TO: sin precio (ninguna fuente dio su cotización). Míralo en tu broker.')

    const vender = tarjeta('Para vender')
    expect(vender.textContent).toContain('1')
    expect(vender.textContent).toContain('en tu cartera')
    expect(container.textContent).not.toContain('nada urgente')
    expect(tarjeta('En cartera').textContent).toBe('En cartera3posiciones abiertas · 2 fuera de esta lista')
    expect(screen.getByRole('heading', { name: 'Hoy' }).nextElementSibling!.textContent).toContain('1 para vender')
    expect(screen.getByRole('heading', { name: 'Hoy' }).nextElementSibling!.textContent).toContain('3 en cartera')

    // La pestaña cuenta las tres y enseña las de fuera, con su stop.
    fireEvent.click(screen.getByRole('button', { name: 'Mi cartera (3)' }))
    const fuera = screen.getByRole('heading', { name: 'Fuera de EE. UU. — S&P 500' }).parentElement!
    expect(within(fuera).getByText('perforado')).toBeInTheDocument()
    expect(within(fuera).getByText('sin comprobar')).toBeInTheDocument()
    expect(fuera.textContent).not.toContain('KO')
    expect(screen.getByText('Ninguna de tus posiciones está en EE. UU. — S&P 500.')).toBeInTheDocument()
  })

  it('un stop sin comprobar no es «nada urgente», y una posición va en singular', async () => {
    servir((hoy) => {
      hoy.cartera = { abiertas: 1, en_lista: 0, posiciones: [posicion({ symbol: 'CHIP', precio: null, estado: 'sin_comprobar', motivo: 'sin precio (ninguna fuente dio su cotización)' })] }
    })
    await screen.findByText('1 posición con el stop sin comprobar')
    expect(tarjeta('Para vender').textContent).toBe('Para vender01 sin comprobar')
    expect(tarjeta('En cartera').textContent).toBe('En cartera1posición abierta · 1 fuera de esta lista')
  })

  it('sin repaso en la respuesta no se afirma nada urgente ni se cuenta la cartera entera', async () => {
    servir((hoy) => { delete hoy.cartera })
    await screen.findByText('Para vender')
    expect(tarjeta('Para vender').textContent).toBe('Para vender0cartera sin repasar')
    expect(tarjeta('En cartera').textContent).toBe('En cartera0posiciones abiertas en esta lista')
  })

  it('con todo repasado y nada perforado, sí es «nada urgente»', async () => {
    servir((hoy) => { hoy.cartera = { abiertas: 1, en_lista: 0, posiciones: [posicion({ symbol: 'STOP' })] } })
    await screen.findByText('Para vender')
    expect(tarjeta('Para vender').textContent).toBe('Para vender0nada urgente')
    expect(screen.queryByText(/Stop perforado en/)).toBeNull()
  })

  it('una venta de la lista cacheada no cuenta si la posición ya está cerrada', () => {
    // La lista vive hasta 6 h en caché; el repaso es de ahora.
    const venta = { symbol: 'VIEJA', decision: { action: 'vender', owned: true } }
    const data = { signals: [venta], cartera: { abiertas: 0, en_lista: 0, posiciones: [] } } as unknown as TodayResponse
    expect(recuentos(data).vender).toBe(0)
    expect(recuentos({ ...data, cartera: undefined }).vender).toBe(1)
  })
})

describe('las tarjetas de ideas', () => {
  it('una variación de 0,00 % no se pinta como una subida', async () => {
    servir((hoy) => { hoy.shortlist.ideas[0].price.change_pct = 0 })
    const ceros = await screen.findAllByText(/^[+-]?0,00\s%$/)
    expect(ceros.length).toBeGreaterThan(0)
    for (const cero of ceros) expect(cero.className).not.toMatch(/emerald|red/)
    expect(tonoDeVariacion(0.001, '+0,00\u00a0%', 'sube', 'baja')).toBe('text-slate-400')
    expect(tonoDeVariacion(0.5, '+0,50\u00a0%', 'sube', 'baja')).toBe('sube')
    expect(tonoDeVariacion(-0.5, '-0,50\u00a0%', 'sube', 'baja')).toBe('baja')
  })

  it('una idea recortada dice por qué en su propia tarjeta', async () => {
    const global = 'Ideas nuevas al 0\u00a0%: la cartera que YA tienes estima un 22,2\u00a0% de volatilidad.'
    let recortada = ''
    servir((hoy) => {
      const idea = hoy.shortlist.ideas[0]
      recortada = idea.symbol
      idea.decision.levels.peso_bruto_pct = 6.1
      idea.peso_final_pct = 0
      hoy.shortlist.sizing.recortes = [...hoy.shortlist.sizing.recortes, global]
    })
    const cifra = await screen.findByText(/recortado desde 6,1/)
    const card = cifra.closest('li')!
    expect(card.textContent).toContain(recortada)
    expect(card.textContent).toContain(global)
  })

  it('cada recorte va a las ideas que nombra; el que no nombra a ninguna, a todas', () => {
    const recortes = [
      'DXCM: 10,9 % → 10,0 % (tope por posición).',
      '«Consumer Staples»: sin margen para ideas nuevas (tope por sector). Afecta a HSY.',
      '«grupo FTV+KO»: sin margen (tope por correlación). Afecta a FTV.',
      'Ideas nuevas al 0 %: la cartera que YA tienes estima un 22,2 % de volatilidad.',
    ]
    const ideas = ['DXCM', 'HSY', 'FTV', 'KOF']
    expect(recortesDe('HSY', recortes, ideas)).toEqual([recortes[1], recortes[3]])
    expect(recortesDe('FTV', recortes, ideas)).toEqual([recortes[2], recortes[3]])
    // «KO» del grupo no es «KOF».
    expect(recortesDe('KOF', recortes, ideas)).toEqual([recortes[3]])
  })
})
