/**
 * Revisión 12, visual: el texto de la IA enseñaba el Markdown en crudo
 * («**Lectura de demostración.**»), y los prompts piden Markdown, con «##» en el
 * informe. `BloqueIA` lo pinta ahora con un subconjunto seguro, como elementos
 * de React: nada de lo que escriba el modelo llega al DOM como HTML.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BloqueIA } from './ContenidoIA'

function pintar(md: string): HTMLElement {
  const { container } = render(<BloqueIA modelo="modelo-de-prueba">{md}</BloqueIA>)
  return container.querySelector('[data-contenido="ia"]') as HTMLElement
}

describe('el Markdown de la IA', () => {
  it('la negrita de la demo sale en negrita, sin los asteriscos', () => {
    const b = pintar('**Lectura de demostración.** Este párrafo lo genera un proveedor ficticio.')
    expect(b.querySelector('strong')?.textContent).toBe('Lectura de demostración.')
    expect(b.textContent).toContain('Lectura de demostración. Este párrafo')
    expect(b.textContent).not.toContain('*')
  })

  it('cursiva, código, negrita con cursiva dentro y párrafos separados', () => {
    const b = pintar('El *margen* sube y `ROE` también.\n\n**Lo que *no* cambia**: la deuda.')
    expect(b.querySelectorAll('p')).toHaveLength(2)
    expect(b.querySelector('em')?.textContent).toBe('margen')
    expect(b.querySelector('code')?.textContent).toBe('ROE')
    expect(b.querySelector('strong em')?.textContent).toBe('no')
    expect(b.textContent).not.toMatch(/[*`]/)
  })

  it('los encabezados del informe (# a ###) son encabezados, por debajo del título de la sección', () => {
    const b = pintar('# Informe\n## El negocio\nVende cosas.\n### Detalle\n#### Más detalle')
    expect(b.querySelector('h4')?.textContent).toBe('Informe')
    expect(b.querySelector('h5')?.textContent).toBe('El negocio')
    expect([...b.querySelectorAll('h6')].map((h) => h.textContent)).toEqual(['Detalle', 'Más detalle'])
    expect(b.querySelector('p')?.textContent).toBe('Vende cosas.')
    expect(b.textContent).not.toContain('#')
  })

  it('listas con guion, asterisco o número; una línea suelta sigue la viñeta anterior', () => {
    const b = pintar('Qué vigilar:\n- el margen\n* la deuda\n  que vence en 2027\n\n1. primero\n2. segundo')
    expect(b.querySelector('p')?.textContent).toBe('Qué vigilar:')
    expect([...b.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual([
      'el margen',
      'la deuda\nque vence en 2027',
    ])
    expect([...b.querySelectorAll('ol > li')].map((li) => li.textContent)).toEqual(['primero', 'segundo'])
    expect(b.textContent).not.toMatch(/^\s*[-*]|\d\./m)
  })

  it('lo que no es Markdown se queda como está', () => {
    const b = pintar('3 * 4 * 5 vale 60, **sin cerrar y ANTHROPIC_API_KEY.\nFue un año:\n2025. Cerró en positivo.\n\n-5 % en el día.')
    expect(b.querySelector('em, strong, ol, ul')).toBeNull()
    expect(b.textContent).toContain('3 * 4 * 5 vale 60, **sin cerrar y ANTHROPIC_API_KEY.')
    expect(b.textContent).toContain('2025. Cerró en positivo.')
    expect(b.textContent).toContain('-5 % en el día.')
  })

  it('el HTML del modelo se lee como texto: ni script ni imagen llegan al DOM', () => {
    const malicioso = '<script>alert(1)</script> **hola** <img src=x onerror="alert(2)"> [enlace](javascript:alert(3))'
    const b = pintar(malicioso)
    expect(b.querySelector('script, img, a')).toBeNull()
    expect(b.textContent).toContain('<script>alert(1)</script>')
    expect(b.textContent).toContain('<img src=x onerror="alert(2)">')
    expect(b.querySelector('strong')?.textContent).toBe('hola')
  })
})
