/**
 * Un día sin candidatas (V3): el reparto del tamaño dice que no hay nada que
 * repartir en vez de pintar «undefined %». Con la respuesta REAL del backend
 * para ese día (`hoy_sin_candidatas.json`), que trae un aviso de la cartera y
 * por eso enseña el panel.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import hoyCompleto from '../test/fixtures/hoy_completo.json'
import hoySinCandidatas from '../test/fixtures/hoy_sin_candidatas.json'
import { TodayPage } from './TodayPage'

const rutas = (hoySinCandidatas as { rutas: Record<string, { status: number; json: unknown }> }).rutas

afterEach(() => vi.unstubAllGlobals())

describe('Hoy sin candidatas', () => {
  it('el reparto del tamaño dice que no hay candidatas, sin «undefined»', async () => {
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    const { container } = render(<MemoryRouter><TodayPage /></MemoryRouter>)
    expect(await screen.findByText('Cómo se repartió el tamaño')).toBeInTheDocument()
    expect(screen.getByText('Hoy no hay candidatas que dimensionar.')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/undefined|NaN/)
  })

  it('el estado vacío pide la media con su banda, como la regla', async () => {
    // Revisión 4: decía «cotizar sobre su media de 200 sesiones» cuando la regla
    // exige cerrar en o por encima de la media + 2 %. La cifra no viaja en la
    // respuesta de Hoy (añadirla cambia el golden): se nombra la banda.
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    const { container } = render(<MemoryRouter><TodayPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /^Todas las que califican \(0\)/ }))
    await screen.findByText(/Ninguna empresa está hoy en «Comprar»/)
    expect(container.textContent).toContain('cerrar por encima de su media de 200 sesiones con el margen de su banda')
    // Revisión 5: una «Vigilar» aplazada por resultados cumple las dos y no
    // espera ningún precio; el texto no puede decir lo contrario.
    expect(container.textContent).toContain('o se aplaza (resultados en los próximos días, precio viejo)')
    expect(container.textContent).not.toContain('dice a qué precio')
    expect(container.textContent).not.toContain('cotizar sobre su media')
  })
})

describe('Hoy en móvil', () => {
  it('el puesto global va junto al símbolo cuando su columna no cabe (sm:hidden)', async () => {
    // Revisión 3: por debajo de 640 px la columna del puesto se ocultaba y el
    // dato no salía en ningún otro sitio de la fila.
    const completas = (hoyCompleto as { rutas: Record<string, { status: number; json: unknown }> }).rutas
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = completas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    const { container } = render(<MemoryRouter><TodayPage /></MemoryRouter>)
    await screen.findAllByText('HSY')
    fireEvent.click(screen.getByRole('button', { name: /^Todas \(/ }))
    const filas = container.querySelectorAll('li button[aria-expanded]')
    expect(filas.length).toBeGreaterThan(0)
    const puesto = Array.from(filas[0].querySelectorAll('span')).find((s) => /^#\d+$/.test(s.textContent ?? ''))
    expect(puesto?.className).toMatch(/(^|\s)sm:hidden(\s|$)/)
  })
})
