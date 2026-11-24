/**
 * Las rutas del rediseño (`docs/PLAN_NAVEGACION.md`) y las redirecciones de las
 * viejas: un marcador o un enlace olvidado a «/ticker/AAPL» o «/portafolio»
 * debe seguir llevando a su sitio, con su consulta.
 */
import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Rutas } from '../App'
import { destinoConConsulta, REDIRECCIONES, rutaCartera, rutaEmpresa, rutaExplorar } from './rutas'

let ubicacion = ''
function Ubicacion() {
  const l = useLocation()
  ubicacion = l.pathname + l.search + l.hash
  return null
}

beforeEach(() => {
  // Las pantallas piden sus datos al montarse: aquí no hace falta que lleguen.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
  vi.stubGlobal('scrollTo', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

function ir(ruta: string): string {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Rutas />
      <Ubicacion />
    </MemoryRouter>,
  )
  return ubicacion
}

describe('rutas: ayudantes', () => {
  it('la ficha lleva el símbolo en mayúsculas y codificado', () => {
    expect(rutaEmpresa(' brk.b ')).toBe('/empresa/BRK.B')
    expect(rutaEmpresa('A/B')).toBe('/empresa/A%2FB')
  })

  it('Explorar y la cartera solo llevan consulta cuando no es la vista por defecto', () => {
    expect(rutaExplorar()).toBe('/explorar')
    expect(rutaExplorar({ tipo: 'acciones' })).toBe('/explorar')
    expect(rutaExplorar({ tipo: 'etfs' })).toBe('/explorar?tipo=etfs')
    expect(rutaExplorar({ filtros: 'factores' })).toBe('/explorar?filtros=factores')
    expect(rutaCartera()).toBe('/cartera')
    expect(rutaCartera('posiciones')).toBe('/cartera')
    expect(rutaCartera('tesis')).toBe('/cartera?pestana=tesis')
  })

  it('al redirigir se conserva la consulta vieja y manda la nueva', () => {
    expect(destinoConConsulta('/avanzado/valoracion', '?symbol=KO')).toBe('/avanzado/valoracion?symbol=KO')
    expect(destinoConConsulta('/cartera?pestana=tesis', '?pestana=otra&x=1')).toBe('/cartera?pestana=tesis&x=1')
    expect(destinoConConsulta('/', '')).toBe('/')
  })
})

describe('rutas: las viejas llevan a las nuevas', () => {
  it.each([
    ['/hoy', '/'],
    ['/dashboard', '/avanzado/mercado'],
    ['/ticker', '/explorar'],
    ['/ticker/aapl', '/empresa/AAPL'],
    ['/screener', '/explorar?filtros=simples'],
    ['/multifactor', '/explorar?filtros=factores'],
    ['/etfs', '/explorar?tipo=etfs'],
    ['/portafolio', '/cartera'],
    ['/tesis', '/cartera?pestana=tesis'],
    ['/vigilancia', '/cartera?pestana=tesis'],
    ['/senales', '/avanzado/senales'],
    ['/valoracion?symbol=KO', '/avanzado/valoracion?symbol=KO'],
    ['/resultados', '/avanzado/resultados'],
    ['/noticias', '/avanzado/noticias'],
    ['/no-existe', '/'],
  ])('%s → %s', (vieja, nueva) => {
    expect(ir(vieja)).toBe(nueva)
  })

  it('todas las redirecciones de la tabla están probadas arriba', () => {
    // Una ruta vieja nueva en la tabla sin su caso aquí se notaría tarde.
    expect(Object.keys(REDIRECCIONES).sort()).toEqual(
      ['/dashboard', '/etfs', '/hoy', '/multifactor', '/noticias', '/portafolio', '/resultados', '/screener', '/senales', '/tesis', '/ticker', '/valoracion', '/vigilancia'].sort(),
    )
  })

  it('las nuevas no se mueven', () => {
    for (const r of ['/', '/explorar', '/explorar?tipo=etfs', '/empresa/ACME', '/cartera', '/avanzado', '/avanzado/mercado']) {
      expect(ir(r)).toBe(r)
    }
  })
})
