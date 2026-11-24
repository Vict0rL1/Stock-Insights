/**
 * Ítem 3.3, un solo DCF. La pestaña Valoración de la ficha tenía su propio DCF
 * (`/api/stocks/{s}/valuation/{defaults,dcf}`), con supuestos escritos en el
 * frontend (WACC 11/10/9 %, crecimiento ±3 puntos) distintos de los del módulo
 * Valoración y un valor por escenario: la misma empresa tenía dos valoraciones
 * según la pantalla. Ahora es un resumen de `POST /api/valuation/{s}`, el mismo
 * que abre el módulo con el símbolo. Con las respuestas REALES del backend
 * (`backend/tests/fixtures/exportar_frontend.py`).
 */
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Valoracion } from '../../api/types'
import { fmtValorRedondo } from '../../lib/formato'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import empresaDeudaParcial from '../../test/fixtures/empresa_deuda_parcial.json'
import empresaVacia from '../../test/fixtures/empresa_vacia.json'
import { ValuationPage } from '../../pages/ValuationPage'
import { textoRango } from '../valoracion/ResumenDcf'
import { rutaValoracion } from '../valoracion/ruta'
import { ValuationSection } from './ValuationSection'

type Rutas = Record<string, { status: number; json: unknown }>
type Escenario = { symbol: string; rutas: Rutas }
const ESCENARIOS = ['bajista', 'base', 'alcista'] as const

afterEach(() => vi.unstubAllGlobals())

/** Sirve las rutas del fixture por URL, como el test de fugas, y apunta qué se pidió. */
function servir(rutas: Rutas) {
  const pedidas: { url: string; metodo: string; cuerpo: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    pedidas.push({ url, metodo: init?.method ?? 'GET', cuerpo: init?.body ? JSON.parse(String(init.body)) : null })
    const r = url === '/api/watchlist' ? { status: 200, json: { items: [] } } : rutas[url]
    return new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 })
  }))
  return pedidas
}

const valoracionDe = (e: Escenario) => e.rutas[`/api/valuation/${e.symbol}`].json as Valoracion

describe('la pestaña Valoración de la ficha', () => {
  it('es un resumen del módulo: un rango por escenario, sin precio objetivo, y el enlace al análisis completo', async () => {
    const acme = empresaCompleta as Escenario
    const pedidas = servir(acme.rutas)
    render(<MemoryRouter><ValuationSection symbol="ACME" /></MemoryRouter>)
    const v = valoracionDe(acme)
    expect(await screen.findByText(textoRango(v.rango_global!.bajo, v.rango_global!.alto))).toBeInTheDocument()
    for (const [n, titulo] of [['bajista', 'Si va mal'], ['base', 'Escenario base'], ['alcista', 'Si va bien']] as const) {
      const r = v.escenarios[n].rango
      const tarjeta = screen.getByText(titulo).closest('div')!.parentElement!
      expect(within(tarjeta).getByText(textoRango(r.bajo, r.alto))).toBeInTheDocument()
      // Ni el centro suelto: tres valores puntuales son tres precios objetivo.
      expect(within(tarjeta).queryByText(fmtValorRedondo(r.centro))).toBeNull()
    }
    expect(screen.getByRole('link', { name: 'Abrir el análisis completo' })).toHaveAttribute('href', rutaValoracion('ACME'))
    expect(screen.getByRole('link', { name: 'Abrir el análisis completo' })).toHaveAttribute('href', '/avanzado/valoracion?simbolo=ACME')
    // Una sola petición, al módulo, sin supuestos propios: nada del DCF viejo.
    expect(pedidas).toEqual([{ url: '/api/valuation/ACME', metodo: 'POST', cuerpo: {} }])
    expect(screen.queryByRole('button', { name: 'Calcular rango de valor' })).toBeNull()
  })

  it('con deuda parcial lo dice, con la misma nota que el módulo', async () => {
    const parc = empresaDeudaParcial as Escenario
    servir(parc.rutas)
    render(<MemoryRouter><ValuationSection symbol={parc.symbol} /></MemoryRouter>)
    const nota = valoracionDe(parc).entradas.nota_deuda!
    expect(nota).toMatch(/deuda a corto plazo/)
    expect(await screen.findByText(`Deuda parcial. ${nota}`)).toBeInTheDocument()
  })

  it('sin un dato que el filing no trae dice cuál y lleva al módulo, donde se escribe; sin «Reintentar»', async () => {
    // El backend responde 422 (aquí falta el FCF): no es un fallo de carga.
    const vacia = empresaVacia as Escenario
    servir(vacia.rutas)
    render(<MemoryRouter><ValuationSection symbol={vacia.symbol} /></MemoryRouter>)
    const motivo = (vacia.rutas[`/api/valuation/${vacia.symbol}`].json as { detail: string }).detail
    expect(vacia.rutas[`/api/valuation/${vacia.symbol}`].status).toBe(422)
    expect(await screen.findByText(motivo)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir el análisis completo' })).toHaveAttribute('href', rutaValoracion(vacia.symbol))
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
  })
})

describe('las mismas fixtures dan los mismos rangos en las dos vistas', () => {
  // La condición de hecho del ítem 3.3: la ficha y el módulo, cada uno con sus
  // peticiones de verdad contra las mismas respuestas del backend, enseñan los
  // mismos rangos. Antes la ficha pedía otro endpoint y daba otros números.
  for (const [nombre, e] of [['completa', empresaCompleta], ['deuda parcial', empresaDeudaParcial]] as const) {
    it(nombre, async () => {
      const { symbol, rutas } = e as Escenario
      const pedidas = servir(rutas)
      const ficha = render(<MemoryRouter><ValuationSection symbol={symbol} /></MemoryRouter>).container
      const modulo = render(
        <MemoryRouter initialEntries={[rutaValoracion(symbol)]}><ValuationPage /></MemoryRouter>,
      ).container
      const v = valoracionDe(e as Escenario)
      const global = textoRango(v.rango_global!.bajo, v.rango_global!.alto)
      expect(await within(ficha).findByText(global)).toBeInTheDocument()
      expect(await within(modulo).findByText(global)).toBeInTheDocument()
      for (const n of ESCENARIOS) {
        const { bajo, centro, alto } = v.escenarios[n].rango
        expect(within(ficha).getByText(textoRango(bajo, alto))).toBeInTheDocument()
        // El módulo escribe además el centro, en medio: «bajo – centro – alto».
        const fila = `${fmtValorRedondo(bajo)} – ${fmtValorRedondo(centro)} – ${fmtValorRedondo(alto)}`
        expect(within(modulo).getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === fila)).toBeInTheDocument()
      }
      // Las dos vistas, del mismo endpoint y sin supuestos propios.
      expect(pedidas.filter((p) => p.url.startsWith('/api/valuation/'))).toEqual([
        { url: `/api/valuation/${symbol}`, metodo: 'POST', cuerpo: {} },
        { url: `/api/valuation/${symbol}`, metodo: 'POST', cuerpo: {} },
      ])
      expect(pedidas.some((p) => p.url.includes('/valuation/dcf') || p.url.includes('/valuation/defaults'))).toBe(false)
    })
  }
})
