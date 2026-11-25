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

describe('rutas: nadie escribe a mano una ruta vieja', () => {
  // Al renombrar /ticker → /empresa quedaron diecisiete enlaces escritos a mano
  // en nueve archivos; la redirección los salvaba, pero cada uno era un salto
  // de más y un historial con la ruta vieja. Las pantallas piden la ruta a
  // `lib/rutas.ts`; esto lo comprueba en el código fuente.
  const fuentes = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const viejas = /(`|'|")\/(ticker|hoy|dashboard|portafolio|tesis|vigilancia|screener|multifactor|senales|etfs|resultados|noticias|valoracion)(\/|\?|`|'|")/

  it('ningún archivo de la app enlaza a una ruta vieja', () => {
    // Sin comentarios: contar la historia de una ruta vieja está bien; enlazarla, no.
    const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const culpables = Object.entries(fuentes)
      .filter(([ruta]) => !/\.test\.tsx?$/.test(ruta) && ruta !== '../App.tsx' && ruta !== './rutas.ts')
      .filter(([, texto]) => viejas.test(sinComentarios(texto)))
      .map(([ruta]) => ruta)
    expect(culpables).toEqual([])
  })
})
