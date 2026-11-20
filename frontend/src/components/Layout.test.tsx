/**
 * Ítem 2.12 (auditoría del 19 oct): por debajo de 768 px la barra lateral es un
 * cajón que se abre con «Menú». Fija, ocupaba media pantalla de 390 px. Aquí se
 * prueba su comportamiento (jsdom no aplica el punto de corte de CSS; eso lo
 * prueban las capturas a 390 y 1440): se abre, y se cierra al navegar, con
 * Escape —devolviendo el foco a «Menú»— y tocando fuera.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Layout } from './Layout'

// jsdom no desplaza: sin esto, cada navegación avisa de que `scrollTo` no existe.
const arriba = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ providers: [], llm: null }), { status: 200 })))
  arriba.mockClear()
  vi.stubGlobal('scrollTo', arriba)
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

  it('pulsar la pantalla en la que ya estás devuelve el foco a «Menú»', () => {
    // Revisión 3: el enlace enfocado quedaba dentro del cajón oculto y el foco
    // caía en BODY.
    pintar()
    fireEvent.click(menu())
    fireEvent.click(screen.getByRole('link', { name: 'Hoy' }))
    expect(document.activeElement).toBe(menu())
  })

  it('al pasar a escritorio (girar el móvil) el cajón se cierra y nada queda inerte', () => {
    // Revisión 3: abierto a 390 px y girado a 844 px, el contenido quedaba
    // `inert` sin forma visible de salir.
    const oyentes: ((e: { matches: boolean }) => void)[] = []
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: (_: string, f: (e: { matches: boolean }) => void) => oyentes.push(f),
      removeEventListener: () => {},
    }))
    const { container } = pintar()
    fireEvent.click(menu())
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(true)
    act(() => oyentes.forEach((f) => f({ matches: true })))
    expect(abierto()).toBe(false)
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(false)
  })
})

/** Una pantalla con enlaces a otra, como la lista de Hoy con «Ver el análisis completo». */
function Pantalla({ titulo }: { titulo: string }) {
  const navigate = useNavigate()
  return (
    <>
      <h1>{titulo}</h1>
      <button type="button" onClick={() => void navigate('/ticker/ACME')}>Ver el análisis completo</button>
      <button type="button" onClick={() => void navigate('/ticker/ACME?pestana=historial')}>Misma ficha, otra consulta</button>
      <button type="button" onClick={() => void navigate('/cartera#riesgo')}>Al riesgo de la cartera</button>
      <button type="button" onClick={() => void navigate(-1)}>Atrás</button>
    </>
  )
}

function pintarConFicha() {
  return render(
    <MemoryRouter initialEntries={['/hoy']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/hoy" element={<Pantalla titulo="Pantalla Hoy" />} />
          <Route path="/ticker/:symbol" element={<Pantalla titulo="Ficha" />} />
          <Route
            path="/cartera"
            element={
              <>
                <Pantalla titulo="Pantalla Cartera" />
                <section id="riesgo">Riesgo</section>
              </>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('Layout: una pantalla nueva se abre por arriba', () => {
  // Revisión 12 (visual): la página no se recarga y el navegador conservaba el
  // desplazamiento de la anterior; «Ver el análisis completo» abría la ficha
  // unos 100 px más abajo, con la cabecera cortada.
  const alAncla = vi.fn()
  const original = Element.prototype.scrollIntoView
  beforeEach(() => {
    alAncla.mockClear()
    Element.prototype.scrollIntoView = alAncla
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = original
  })

  it('al cambiar de ruta vuelve arriba', () => {
    pintarConFicha()
    expect(arriba).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ver el análisis completo' }))
    expect(screen.getByText('Ficha')).toBeInTheDocument()
    expect(arriba).toHaveBeenCalledWith(0, 0)
  })

  it('no al cambiar solo la consulta (las pestañas de la misma pantalla)', () => {
    pintarConFicha()
    fireEvent.click(screen.getByRole('button', { name: 'Ver el análisis completo' }))
    arriba.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Misma ficha, otra consulta' }))
    expect(arriba).not.toHaveBeenCalled()
  })

  it('con «Atrás» no: volver a donde estabas es cosa del navegador', () => {
    pintarConFicha()
    fireEvent.click(screen.getByRole('button', { name: 'Ver el análisis completo' }))
    arriba.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByText('Pantalla Hoy')).toBeInTheDocument()
    expect(arriba).not.toHaveBeenCalled()
  })

  it('con un ancla, a ella y no arriba', () => {
    pintarConFicha()
    fireEvent.click(screen.getByRole('button', { name: 'Al riesgo de la cartera' }))
    expect(alAncla).toHaveBeenCalledTimes(1)
    expect(alAncla.mock.contexts[0]).toBe(document.getElementById('riesgo'))
    expect(arriba).not.toHaveBeenCalled()
  })
})

