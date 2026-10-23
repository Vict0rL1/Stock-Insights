/**
 * Ítem 2.12 (auditoría del 19 oct): por debajo de 768 px la barra lateral es un
 * cajón que se abre con «Menú». Fija, ocupaba media pantalla de 390 px. Aquí se
 * prueba su comportamiento (jsdom no aplica el punto de corte de CSS; eso lo
 * prueban las capturas a 390 y 1440): se abre, y se cierra al navegar, con
 * Escape —devolviendo el foco a «Menú»— y tocando fuera.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Layout } from './Layout'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ providers: [], llm: null }), { status: 200 })))
})
afterEach(() => vi.unstubAllGlobals())

function pintar(ruta = '/hoy') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/hoy" element={<h1>Pantalla Hoy</h1>} />
          <Route path="/cartera" element={<h1>Pantalla Cartera</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const menu = () => screen.getByRole('button', { name: 'Menú' })
const cajon = () => document.getElementById('navegacion')!
const abierto = () => menu().getAttribute('aria-expanded') === 'true'

describe('Layout: el menú en móvil', () => {
  it('«Menú» abre el cajón y lleva el foco a «Cerrar»', () => {
    pintar()
    expect(abierto()).toBe(false)
    expect(cajon().className).toMatch(/(^|\s)hidden(\s|$)/)
    fireEvent.click(menu())
    expect(abierto()).toBe(true)
    expect(cajon().className).toMatch(/(^|\s)fixed(\s|$)/)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar' }))
  })

  it('navegar desde el cajón lo cierra y enseña la pantalla elegida', () => {
    pintar()
    fireEvent.click(menu())
    fireEvent.click(screen.getByRole('link', { name: 'Cartera' }))
    expect(screen.getByText('Pantalla Cartera')).toBeInTheDocument()
    expect(abierto()).toBe(false)
  })

  it('pulsar la pantalla en la que ya estás también lo cierra', () => {
    pintar()
    fireEvent.click(menu())
    fireEvent.click(screen.getByRole('link', { name: 'Hoy' }))
    expect(abierto()).toBe(false)
  })

  it('Escape lo cierra y devuelve el foco a «Menú»', () => {
    pintar()
    fireEvent.click(menu())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(abierto()).toBe(false)
    expect(document.activeElement).toBe(menu())
  })

  it('tocar fuera lo cierra y devuelve el foco a «Menú»', () => {
    const { container } = pintar()
    fireEvent.click(menu())
    fireEvent.click(container.querySelector('.bg-black\\/60')!)
    expect(abierto()).toBe(false)
    expect(document.activeElement).toBe(menu())
  })

  it('abierto es modal: lo de detrás queda inerte y el cajón es un diálogo', () => {
    // Revisión de A7: Mayús+Tab salía a «Menú», bajo el velo, y tras los enlaces
    // el foco pasaba a la pantalla tapada.
    const { container } = pintar()
    fireEvent.click(menu())
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(true)
    expect(container.querySelector('header')!.hasAttribute('inert')).toBe(true)
    expect(cajon().getAttribute('role')).toBe('dialog')
    expect(cajon().getAttribute('aria-modal')).toBe('true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(false)
    expect(cajon().getAttribute('role')).toBeNull()
  })
})
