/**
 * Revisión 14: Explorar › Acciones (la lista de Hoy incrustada) y sus avisos
 * de compra y venta. Parte de la respuesta REAL de Hoy (`hoy_completo.json`),
 * cambiada en cada caso por lo que el backend sirve en esa situación.
 *
 * - H1: una idea comprada después de calcular la lista decía «Comprar … Tamaño
 *   sugerido: 7,8 %» en su tarjeta y «Mantener» en su fila.
 * - H12: con «Ideas nuevas al 0 %» (la cartera ya supera el objetivo de
 *   volatilidad), las que califican fuera de la lista corta decían «Comprar» en
 *   verde bajo «ninguna cabe hoy en tu cartera».
 * - H10: el plan prometía el filtro «Evitar» y los paneles del tamaño y de «Lo
 *   que NO comprar», plegados.
 * - H11: textos que mandaban a una pestaña y a un menú que ya no existen.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import hoyCompleto from '../test/fixtures/hoy_completo.json'
import type { DailySignal, Shortlist, StopDePosicion, TodayResponse } from '../api/types'
import { ideasSinSitio, TodayPage } from './TodayPage'

type Rutas = Record<string, { status: number; json: unknown }>
type Hoy = TodayResponse

afterEach(() => vi.unstubAllGlobals())

const posicion = (p: Partial<StopDePosicion> & { symbol: string }): StopDePosicion => ({
  en_lista: true,
  precio: 144,
  precio_estado: 'valido',
  moneda: 'USD',
  stop: 125,
  stop_fijado_al_abrir: true,
  stop_por_clase: false,
  estado: 'por_encima',
  motivo: null,
  ...p,
})

/** La respuesta real de Hoy, con cada pasada cambiada por `cambiar`. */
function servir(cambiar: (hoy: Hoy) => void) {
  const rutas: Rutas = structuredClone((hoyCompleto as unknown as { rutas: Rutas }).rutas)
  for (const [url, r] of Object.entries(rutas)) if (url.startsWith('/api/signals/today')) cambiar(r.json as Hoy)
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
  }))
  vi.stubGlobal('scrollTo', vi.fn())
  return render(<MemoryRouter><TodayPage incrustada /></MemoryRouter>)
}

/** El tipo de aviso de cada fila de la tabla, contado. */
function avisosDeLasFilas(): Record<string, number> {
  const tipos: Record<string, number> = {}
  for (const b of document.querySelectorAll('li button[aria-expanded]')) {
    const t = b.querySelector('[data-aviso]')!.getAttribute('data-aviso')!
    tipos[t] = (tipos[t] ?? 0) + 1
  }
  return tipos
}

const filaDe = (symbol: string) =>
  screen.getAllByText(symbol).map((n) => n.closest('li')!).find((li) => li.querySelector('button[aria-expanded]'))!

// ---------------------------------------------------------------------------

/** HSY es la idea nº 1 de la lista guardada; la compraste DESPUÉS de calcularla:
 *  el repaso (de ahora) la trae abierta y el backend marca la lista desfasada. */
const compradaDespues = (hoy: Hoy) => {
  hoy.cartera = { abiertas: 1, en_lista: 1, posiciones: [posicion({ symbol: 'HSY' })] }
  hoy.lista_desfasada = { abiertas: ['HSY'], cerradas: [], cambiadas: [], efectivo: false }
}

describe('H1: una idea que ya tienes no dice «Comprar» en su tarjeta', () => {
  it('la tarjeta de la idea y su fila dicen lo mismo: su stop, no un tamaño sugerido', async () => {
    servir(compradaDespues)
    const tarjeta = (await screen.findByText('Hershey Company (The)', {}, { timeout: 3000 })).closest('li')!
    const avisoTarjeta = tarjeta.querySelector('[data-aviso]')!.getAttribute('data-aviso')
    expect(tarjeta.textContent).not.toContain('Tamaño sugerido')
    expect(tarjeta.textContent).not.toContain('Por qué este tamaño')
    fireEvent.click(screen.getByRole('button', { name: /Todas las que califican/ }))
    const avisoFila = filaDe('HSY').querySelector('[data-aviso]')!.getAttribute('data-aviso')
    expect([avisoTarjeta, avisoFila]).toEqual(['mantener', 'mantener'])
  })

  it('una idea que ya tienes no cuenta como «sin sitio» en la cabecera', () => {
    const hoy = structuredClone((hoyCompleto as unknown as { rutas: Rutas }).rutas['/api/signals/today?market=us_sp500'].json) as Hoy
    for (const i of hoy.shortlist.ideas) i.peso_final_pct = 0
    expect(ideasSinSitio(hoy.shortlist)).toBe(5)
    compradaDespues(hoy)
    // HSY, ya en cartera, es «Mantener» en su tarjeta: no una idea sin sitio.
    expect(ideasSinSitio(hoy.shortlist, hoy.cartera)).toBe(4)
  })
})

// ---------------------------------------------------------------------------

const RECORTE_GLOBAL =
  'Ideas nuevas al 0 %: la cartera que YA tienes estima un 22,2 % de volatilidad, por encima del objetivo (12 %). No es que las ideas sean malas — es que no cabe más riesgo.'

/** Lo que sirve el backend de demostración (escenario normal): las 5 ideas al
 *  0 % por la volatilidad de la cartera que ya tienes. */
const sinHueco = (hoy: Hoy) => {
  const corta = hoy.shortlist as Shortlist
  for (const i of corta.ideas) i.peso_final_pct = 0
  corta.sizing.recortes = [RECORTE_GLOBAL]
  corta.sin_hueco_de_riesgo = true
}

describe('H12: con «Ideas nuevas al 0 %», ninguna que califica dice «Comprar»', () => {
  it('las de fuera de la lista corta tampoco caben, y lo dicen con el mismo motivo', async () => {
    servir(sinHueco)
    fireEvent.click(await screen.findByRole('button', { name: /Todas las que califican/ }, { timeout: 3000 }))
    expect(screen.getByRole('heading', { name: 'Hoy' }).nextElementSibling!.textContent).toContain('ninguna cabe hoy')
    // 17 que califican: 5 en la lista corta y 12 fuera, todas «Sin sitio».
    expect(avisosDeLasFilas()).toEqual({ comprar_sin_sitio: 17 })
    // Fuera de la lista corta, desplegada: el porqué, y su tamaño sin escribirse como un cero.
    const fuera = (hoyCompleto as unknown as { rutas: Rutas }).rutas['/api/signals/today?market=us_sp500'].json as Hoy
    const enLaCorta = new Set(fuera.shortlist.ideas.map((i) => i.symbol))
    const otra = fuera.signals.find((s: DailySignal) => s.decision.action === 'comprar' && !enLaCorta.has(s.symbol))!.symbol
    fireEvent.click(filaDe(otra).querySelector('button[aria-expanded]')!)
    const desplegada = filaDe(otra)
    expect(desplegada.textContent).toContain('Buena idea, pero hoy no cabe en tu cartera.')
    expect(desplegada.textContent).toContain('Ideas nuevas al 0 %: la cartera que YA tienes estima un 22,2 % de volatilidad, por encima del objetivo (12 %).')
    expect(desplegada.textContent).toContain('sin calcular: hoy no cabe ninguna idea nueva')
    expect(desplegada.textContent).not.toMatch(/Tamaño sugerido|Compra entre/)
  })
})

// ---------------------------------------------------------------------------

describe('H10: lo que el plan prometía para Explorar › Acciones', () => {
  /** Las que la lista corta manda evitar, también como filas de la lista. */
  const conEvitar = (hoy: Hoy) => {
    hoy.signals = [...hoy.signals, ...hoy.shortlist.evitar]
  }

  it('el filtro «Evitar» enseña solo las que la regla manda evitar', async () => {
    servir(conEvitar)
    fireEvent.click(await screen.findByRole('button', { name: 'Evitar (5)' }, { timeout: 3000 }))
    expect(avisosDeLasFilas()).toEqual({ evitar: 5 })
    expect(filaDe('PSKY')).toBeTruthy()
  })

  it('«Cómo se repartió el tamaño» y «Lo que NO comprar», plegados debajo de las ideas', async () => {
    servir(conEvitar)
    const tamano = await screen.findByRole('heading', { name: 'Cómo se repartió el tamaño' }, { timeout: 3000 })
    const noComprar = screen.getByRole('heading', { name: 'Lo que NO comprar ahora' })
    for (const h of [tamano, noComprar]) {
      expect(h.closest('summary')).not.toBeNull()
      expect(h.closest('details')?.open).toBe(false)
    }
    expect(noComprar.closest('summary')!.textContent).toContain('(5)')
  })

  it('un límite de riesgo sin comprobar no se esconde: el panel se abre y su resumen lo dice', async () => {
    servir((hoy) => {
      const correlacion = hoy.shortlist.sizing.controles!.find((c) => c.limite === 'correlación')!
      Object.assign(correlacion, { aplicado: false, parejas_medidas: 3, motivo: 'Solo se pudieron medir 3 de 10 parejas.' })
    })
    const tamano = await screen.findByRole('heading', { name: 'Cómo se repartió el tamaño' }, { timeout: 3000 })
    expect(tamano.closest('details')?.open).toBe(true)
    expect(tamano.closest('summary')!.textContent).toContain('un límite sin comprobar')
  })
})

// ---------------------------------------------------------------------------

describe('H11: los textos mandan a sitios que existen', () => {
  it('la traza está en el Resumen de la ficha, y la búsqueda manda a la ficha, no a «Acciones»', async () => {
    servir(() => {})
    fireEvent.click(await screen.findByRole('button', { name: /Todas las que califican/ }, { timeout: 3000 }))
    // Una fila de la cola, que lleva la traza en su ficha (`traza_en_ficha`).
    const hoy = (hoyCompleto as unknown as { rutas: Rutas }).rutas['/api/signals/today?market=us_sp500'].json as Hoy
    const cola = hoy.signals.find((s: DailySignal) => s.decision.traza_en_ficha)!.symbol
    fireEvent.click(filaDe(cola).querySelector('button[aria-expanded]')!)
    const enlace = screen.getByRole('link', { name: `ficha de ${cola}` })
    expect(enlace.getAttribute('href')).toBe(`/empresa/${cola}`)
    expect(enlace.closest('p')!.textContent).toBe(
      `El porqué regla a regla y qué cambiaría esta decisión están en la ficha de ${cola}, en su Resumen («Lo que comprueba la app»).`,
    )

    fireEvent.change(screen.getByLabelText('Buscar ticker o empresa'), { target: { value: 'zzzz' } })
    const vacio = screen.getByText(/no está en EE\. UU\./).parentElement!
    expect(vacio.textContent).not.toContain('Acciones')
    expect(within(vacio).getByRole('link', { name: 'ficha de ZZZZ' }).getAttribute('href')).toBe('/empresa/ZZZZ')
  })
})
