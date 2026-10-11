/**
 * Tercera pasada de la revisión del 2.1: al refrescar tras una acción,
 * `BloqueDatos` remonta su contenido y cada logo inexistente se volvía a pedir
 * (el navegador no guarda ese 404). El componente recuerda los que fallaron.
 */
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CompanyLogo } from './CompanyLogo'

describe('CompanyLogo', () => {
  it('un logo que falló no se vuelve a pedir al remontar: sale el monograma', () => {
    const primera = render(<CompanyLogo symbol="ZZZT" />)
    fireEvent.error(primera.container.querySelector('img')!)
    expect(primera.container.querySelector('img')).toBeNull()
    primera.unmount()

    const segunda = render(<CompanyLogo symbol="ZZZT" />)
    expect(segunda.container.querySelector('img')).toBeNull()
    expect(segunda.container.textContent).toBe('ZZ')
  })

  // Guarda de no regresión: un símbolo sin fallos sigue pidiendo su logo.
  it('un símbolo cuyo logo no ha fallado sí lo pide', () => {
    const { container } = render(<CompanyLogo symbol="AAPL" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/stocks/AAPL/logo')
  })
})
