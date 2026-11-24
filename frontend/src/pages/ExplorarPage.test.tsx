/**
 * Explorar (`docs/PLAN_NAVEGACION.md`): Hoy, Screener, Multifactor y ETFs en un
 * solo sitio. La vista va en la URL, porque las rutas viejas redirigen aquí con
 * ella (`/etfs` → `?tipo=etfs`, `/multifactor` → `?filtros=factores`).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExplorarPage, vistaDeExplorar } from './ExplorarPage'

let ubicacion = ''
function Ubicacion() {
  const l = useLocation()
  ubicacion = l.pathname + l.search
  return null
}

const peticiones: string[] = []
beforeEach(() => {
  peticiones.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((e: RequestInfo | URL) => {
      peticiones.push(typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url)
      return new Promise<Response>(() => {})
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

const pintar = (ruta: string) =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <ExplorarPage />
      <Ubicacion />
    </MemoryRouter>,
  )

describe('vistaDeExplorar', () => {
  it('por defecto, acciones con la lista de la app; los filtros propios solo en acciones', () => {
    expect(vistaDeExplorar(new URLSearchParams(''))).toEqual({ tipo: 'acciones', filtros: null })
    expect(vistaDeExplorar(new URLSearchParams('filtros=factores'))).toEqual({ tipo: 'acciones', filtros: 'factores' })
    expect(vistaDeExplorar(new URLSearchParams('tipo=etfs&filtros=simples'))).toEqual({ tipo: 'etfs', filtros: null })
    expect(vistaDeExplorar(new URLSearchParams('tipo=raro&filtros=raro'))).toEqual({ tipo: 'acciones', filtros: null })
  })
})

describe('ExplorarPage', () => {
  it('abre con la lista del día de la app', () => {
    pintar('/explorar')
    expect(screen.getByRole('heading', { level: 1, name: 'Explorar acciones y ETFs' })).toBeInTheDocument()
    // La lista de Hoy, como subtítulo: un solo h1 por pantalla.
    expect(screen.getByRole('heading', { level: 2, name: 'Hoy' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('«ETFs» cambia la vista y la URL', () => {
    pintar('/explorar')
    fireEvent.click(screen.getByRole('button', { name: 'ETFs' }))
    expect(ubicacion).toBe('/explorar?tipo=etfs')
    expect(screen.getByRole('heading', { level: 2, name: 'ETFs' })).toBeInTheDocument()
  })

  it('los filtros propios avisan de que exploran pero no deciden', () => {
    pintar('/explorar?filtros=factores')
    expect(screen.getByText(/Tus filtros exploran; no deciden/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Filtros por factores' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Por cifras' }))
    expect(ubicacion).toBe('/explorar?filtros=simples')
    fireEvent.click(screen.getByRole('button', { name: 'Ideas de la app' }))
    expect(ubicacion).toBe('/explorar')
  })

  it('con ?simbolos= (desde Inicio) los ETF llegan escritos y se comparan solos, una vez', async () => {
    pintar('/explorar?tipo=etfs&simbolos=SPY,QQQ')
    expect(screen.getByDisplayValue('SPY,QQQ')).toBeInTheDocument()
    await waitFor(() => expect(peticiones.filter((u) => u.includes('etf')).length).toBeGreaterThan(0))
    const antes = peticiones.length
    fireEvent.click(screen.getByRole('button', { name: 'Acciones' }))
    fireEvent.click(screen.getByRole('button', { name: 'ETFs' }))
    // Volver a ETFs sin `simbolos` en la URL no repite la comparación.
    expect(peticiones.slice(antes).filter((u) => u.includes('etf'))).toEqual([])
  })
})
