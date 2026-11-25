/**
 * El aviso de acción con un solo aspecto (petición del 24 nov): verbo con icono
 * y color, nunca solo color; la frase en texto real; los números para actuar en
 * la vista completa. Y el contraste: `index.css` invierte la paleta para el
 * tema oscuro, y un fondo de un tono sin invertir junto a un texto invertido
 * sale como un rectángulo de color sin letras. Aquí se pinta cada tipo y se
 * mide cada texto sobre su fondo con los valores del propio `index.css`.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import type { Aviso, TipoAviso, TonoAviso } from '../lib/avisos'
import { AvisoDeAccion, TONOS } from './AvisoDeAccion'

const TIPOS: [TipoAviso, TonoAviso, string][] = [
  ['comprar', 'verde', 'Comprar'],
  ['comprar_sin_sitio', 'ambar', 'Sin sitio'],
  ['comprar_sin_tamano', 'verde', 'Comprar'],
  ['esperar', 'ambar', 'Esperar'],
  ['evitar', 'gris', 'Evitar'],
  ['vender', 'rojo', 'Vender'],
  ['reducir', 'naranja', 'Reducir'],
  ['mantener', 'gris', 'Mantener'],
  ['sin_comprobar', 'ambar', 'Revisar'],
  ['sin_datos', 'gris', 'Sin datos'],
  ['sin_accion', 'gris', 'Sin acción'],
]

const aviso = (tipo: TipoAviso, tono: TonoAviso, verbo: string): Aviso => ({
  tipo,
  verbo,
  tono,
  frase: `Frase de ${verbo}.`,
  pasos: [`Paso de ${verbo}.`],
  cifras: [
    { rotulo: 'Comprar entre', valor: '138,18–143,82' },
    { rotulo: 'Vender si baja a', valor: '117,73', tono: 'rojo', nota: 'una nota' },
  ],
})

/** Los colores del tema (`@theme` de index.css): solo los que la inversión redefine. */
function colores(): Record<string, string> {
  const tema = /@theme\s*\{([^}]*)\}/.exec(css)![1]
  return Object.fromEntries([...tema.matchAll(/--color-([a-z]+(?:-\d+)?):\s*(#[0-9a-fA-F]{6})/g)].map(([, n, v]) => [n, v]))
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
const contraste = (a: string, b: string) => {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (oscuro + 0.05)
}

const COLOR = /^(text|bg)-(white|[a-z]+-\d{2,3})$/
const colorDe = (el: Element, prefijo: 'text' | 'bg') =>
  [...el.classList].map((c) => COLOR.exec(c)).find((m) => m && m[1] === prefijo)?.[2]

describe('AvisoDeAccion', () => {
  it('completo: verbo con icono, frase, pasos y los números para actuar', () => {
    const { container } = render(<AvisoDeAccion aviso={aviso('comprar', 'verde', 'Comprar')} titulo={<span>LLY</span>} />)
    expect(screen.getByText('Comprar')).toBeInTheDocument()
    expect(screen.getByText('LLY')).toBeInTheDocument()
    expect(screen.getByText('Frase de Comprar.').tagName).toBe('P')
    expect(screen.getByText('Paso de Comprar.')).toBeInTheDocument()
    // Las cifras como término y valor, con la nota.
    expect(screen.getByText('Comprar entre').tagName).toBe('DT')
    expect(screen.getByText('138,18–143,82').tagName).toBe('DD')
    expect(screen.getByText('una nota')).toBeInTheDocument()
    // El icono es decorativo: el verbo ya es texto.
    const icono = container.querySelector('svg')!
    expect(icono.getAttribute('aria-hidden')).toBe('true')
  })

  it('compacto: verbo y frase en línea, sin las cifras', () => {
    render(<AvisoDeAccion aviso={aviso('vender', 'rojo', 'Vender')} tamano="compacto" titulo={<a href="/x">STOP</a>}>
      <span>Precio: cotización.</span>
    </AvisoDeAccion>)
    expect(screen.getByText('Vender')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'STOP' })).toBeInTheDocument()
    expect(screen.getByText('Frase de Vender.')).toBeInTheDocument()
    expect(screen.getByText('Paso de Vender.')).toBeInTheDocument()
    expect(screen.getByText('Precio: cotización.')).toBeInTheDocument()
    expect(screen.queryByText('138,18–143,82')).toBeNull()
  })

  it('compacto sin frase (una celda estrecha): la frase queda en el título del verbo', () => {
    render(<AvisoDeAccion aviso={aviso('esperar', 'ambar', 'Esperar')} tamano="compacto" conFrase={false} />)
    expect(screen.getByText('Esperar').getAttribute('title')).toBe('Frase de Esperar.')
    expect(screen.queryByText('Frase de Esperar.')).toBeNull()
  })

  it('nunca solo color: cada tipo, su icono; dos del mismo tono no comparten forma', () => {
    const formas = new Map<string, TipoAviso>()
    for (const [tipo, tono, verbo] of TIPOS) {
      const { container, unmount } = render(<AvisoDeAccion aviso={aviso(tipo, tono, verbo)} tamano="compacto" conFrase={false} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('data-tipo')).toBe(tipo)
      // Comprar con y sin tamaño son la misma acción y comparten forma; el resto, no.
      const forma = `${tono}|${svg.innerHTML}`
      const otro = formas.get(forma)
      if (otro) expect([otro, tipo].sort()).toEqual(['comprar', 'comprar_sin_tamano'])
      formas.set(forma, tipo)
      unmount()
    }
  })

  it('cada texto sobre su fondo, con colores del tema invertido y contraste AA (4,5:1)', () => {
    const tema = colores()
    const malos: string[] = []
    for (const [tipo, tono, verbo] of TIPOS) {
      for (const tamano of ['completo', 'compacto'] as const) {
        const { container, unmount } = render(<AvisoDeAccion aviso={aviso(tipo, tono, verbo)} tamano={tamano} />)
        for (const el of container.querySelectorAll('*')) {
          const fondoPropio = colorDe(el, 'bg')
          const texto = colorDe(el, 'text')
          for (const [que, color] of [['fondo', fondoPropio], ['texto', texto]] as const) {
            if (color && !tema[color]) malos.push(`${tipo}/${tamano}: ${que} ${color} no está en el tema invertido`)
          }
          if (!texto || !tema[texto]) continue
          // El fondo: el suyo o el del antepasado más cercano; sin ninguno, la tarjeta.
          let fondo: string | undefined
          for (let a: Element | null = el; a && !fondo; a = a.parentElement) fondo = colorDe(a, 'bg')
          const c = contraste(tema[texto], tema[fondo ?? 'white'])
          if (c < 4.5) malos.push(`${tipo}/${tamano}: ${texto} sobre ${fondo ?? 'white'} = ${c.toFixed(2)}:1`)
        }
        unmount()
      }
    }
    expect(malos).toEqual([])
    // Y los tonos, en pares 100/800 (o 50/800) como pide index.css para los chips.
    for (const t of Object.values(TONOS)) expect(t.chip).toMatch(/^bg-[a-z]+-100 text-[a-z]+-800$/)
  })
})
