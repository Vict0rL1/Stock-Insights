/**
 * Revisión del 2.12: el marco con desplazamiento de una tabla era una clase
 * (`overflow-x-auto`) repetida en quince sitios. En Safari un contenedor con
 * scroll no recibe el foco, así que con teclado las columnas que quedaban fuera
 * a 390 px (los otros ETF, los ejercicios antiguos) no se alcanzaban.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FranjaDesplazable, MarcoTabla, mascara, medirOcultos } from './MarcoTabla'

// También los .ts: el patrón de antes era una constante en `lib/tablas.ts`
// (`MARCO_TABLA = 'overflow-x-auto'`) y el glob solo de .tsx no la veía (revisión 3).
const fuentes = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!./MarcoTabla.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('MarcoTabla', () => {
  it('es una región con nombre que recibe el foco del teclado', () => {
    render(
      <MarcoTabla etiqueta="Comparador de ETFs" className="mt-4">
        <table />
      </MarcoTabla>,
    )
    const marco = screen.getByRole('region', { name: 'Comparador de ETFs' })
    expect(marco.tabIndex).toBe(0)
    expect(marco.className).toMatch(/(^|\s)overflow-x-auto(\s|$)/)
    expect(marco.parentElement?.className).toMatch(/(^|\s)mt-4(\s|$)/)
  })

  it('el anillo de foco va por dentro y por encima de la columna fija', () => {
    // Por fuera lo recortaba un ancestro con overflow-hidden (revisión 3); como
    // contorno por dentro lo tapaban las celdas `sticky z-10 bg-white` de la
    // columna fija, que se pintan después (revisión 4).
    render(
      <MarcoTabla etiqueta="Estados financieros">
        <table />
      </MarcoTabla>,
    )
    const marco = screen.getByRole('region', { name: 'Estados financieros' })
    expect(marco.className).toMatch(/(^|\s)peer(\s|$)/)
    const anillo = marco.nextElementSibling as HTMLElement
    expect(anillo.getAttribute('aria-hidden')).toBe('true')
    // Un outline, no un ring: con colores forzados el box-shadow desaparece (revisión 5).
    for (const clase of ['absolute', 'inset-0', 'z-20', 'outline', '-outline-offset-2', 'pointer-events-none', 'peer-focus-visible:block']) {
      expect(anillo.className.split(/\s+/)).toContain(clase)
    }
    expect(marco.parentElement?.className.split(/\s+/)).toContain('isolate')
  })

  it('es la única forma de dar scroll horizontal a una tabla', () => {
    expect(Object.keys(fuentes)).toContain('../pages/EtfsPage.tsx')
    const malos: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes)) {
      texto.split('\n').forEach((linea, i) => {
        if (/overflow-(x-)?(auto|scroll)\b/.test(linea)) malos.push(`${ruta}:${i + 1}`)
      })
    }
    expect(malos).toEqual([])
  })
})

/** Lo que mediría el navegador: jsdom no maqueta y lo deja todo a 0. */
function medidas(el: HTMLElement, { ancho, contenido, desplazado = 0 }: { ancho: number; contenido: number; desplazado?: number }) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: ancho })
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: contenido })
  Object.defineProperty(el, 'scrollLeft', { configurable: true, value: desplazado })
}

const lados = (el: HTMLElement) => [el.getAttribute('data-oculto-izquierda'), el.getAttribute('data-oculto-derecha')]

describe('MarcoTabla: la señal de que hay más a un lado (revisión 12, visual)', () => {
  // A 390 px la contribución al riesgo se cortaba en «RIESGO/PES» y «2,15» sin
  // su «×», la calibración en «Err» y el Portafolio en «Precio», y nada decía
  // que la tabla se desplazaba; a 820 el botón «Replay» quedaba fuera sin aviso.
  let alCambiarTamano: (() => void)[] = []
  beforeEach(() => {
    alCambiarTamano = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(f: () => void) {
          alCambiarTamano.push(f)
        }
        observe() {}
        disconnect() {}
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('marca el lado que esconde columnas, al desplazar y al cambiar el tamaño', () => {
    render(
      <MarcoTabla etiqueta="Contribución al riesgo por posición">
        <table />
      </MarcoTabla>,
    )
    const marco = screen.getByRole('region', { name: 'Contribución al riesgo por posición' })
    expect(lados(marco)).toEqual(['false', 'false'])

    // A 390 px: la tabla mide más que el marco y se ve su principio.
    medidas(marco, { ancho: 300, contenido: 700 })
    act(() => alCambiarTamano.forEach((f) => f()))
    expect(lados(marco)).toEqual(['false', 'true'])

    medidas(marco, { ancho: 300, contenido: 700, desplazado: 200 })
    fireEvent.scroll(marco)
    expect(lados(marco)).toEqual(['true', 'true'])

    // Al final del recorrido (con zoom, a décimas del máximo) ya no queda nada a la derecha.
    medidas(marco, { ancho: 300, contenido: 700, desplazado: 399.6 })
    fireEvent.scroll(marco)
    expect(lados(marco)).toEqual(['true', 'false'])

    // Girar el móvil: ahora cabe entera y la señal se apaga.
    medidas(marco, { ancho: 800, contenido: 800 })
    act(() => alCambiarTamano.forEach((f) => f()))
    // (La máscara en sí la prueba `mascara` abajo: jsdom no guarda `mask-image`.)
    expect(lados(marco)).toEqual(['false', 'false'])
  })

  it('sin ResizeObserver, mide al cambiar el tamaño de la ventana', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    render(
      <MarcoTabla etiqueta="Posiciones abiertas">
        <table />
      </MarcoTabla>,
    )
    const marco = screen.getByRole('region', { name: 'Posiciones abiertas' })
    medidas(marco, { ancho: 300, contenido: 700 })
    fireEvent(window, new Event('resize'))
    expect(lados(marco)).toEqual(['false', 'true'])
  })

  it('el fundido empieza en el borde de las columnas fijas, que no se funden', () => {
    render(
      <MarcoTabla etiqueta="Historial de decisiones">
        <table>
          <tbody>
            <tr>
              <td style={{ position: 'sticky' }}>Métrica</td>
              <td>2025</td>
              <td style={{ position: 'sticky' }}>Replay</td>
            </tr>
          </tbody>
        </table>
      </MarcoTabla>,
    )
    const marco = screen.getByRole('region', { name: 'Historial de decisiones' })
    const [rotulo, , accion] = Array.from(marco.querySelectorAll('td'))
    Object.defineProperty(rotulo, 'offsetWidth', { configurable: true, value: 136 })
    Object.defineProperty(accion, 'offsetWidth', { configurable: true, value: 72 })
    medidas(marco, { ancho: 300, contenido: 700, desplazado: 100 })
    expect(medirOcultos(marco)).toMatchObject({ izquierda: true, derecha: true, desde: 136, hasta: 72 })

    const m = mascara({ izquierda: true, derecha: true, desde: 136, hasta: 72, barra: 0 })
    // Opaco hasta el borde de la columna fija; de ahí, se funde hacia dentro.
    expect(m?.maskImage).toMatch(/black 0, black 136px, rgb\(0 0 0 \/ 0\.15\) 136px, black 168px/)
    expect(m?.maskImage).toMatch(/black calc\(100% - 104px\), rgb\(0 0 0 \/ 0\.15\) calc\(100% - 72px\), black calc\(100% - 72px\)/)
    expect(mascara({ izquierda: false, derecha: false, desde: 136, hasta: 72, barra: 0 })).toBeUndefined()
  })

  it('la barra de desplazamiento no se funde: también avisa', () => {
    const m = mascara({ izquierda: false, derecha: true, desde: 0, hasta: 0, barra: 15 })
    expect(m?.maskImage).toMatch(/^linear-gradient\(black, black\), linear-gradient\(to right/)
    expect(m?.maskSize).toBe('100% 15px, 100% 100%')
    expect(m?.maskPosition).toBe('0 100%, 0 0')
  })

  it('la franja de pestañas usa la misma señal', () => {
    render(
      <FranjaDesplazable className="flex">
        <button type="button">Resumen</button>
      </FranjaDesplazable>,
    )
    const franja = screen.getByRole('button', { name: 'Resumen' }).parentElement as HTMLElement
    expect(franja.className.split(/\s+/)).toContain('overflow-x-auto')
    medidas(franja, { ancho: 300, contenido: 900 })
    act(() => alCambiarTamano.forEach((f) => f()))
    expect(lados(franja)).toEqual(['false', 'true'])
  })
})

