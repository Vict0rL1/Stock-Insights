/**
 * Revisión del 2.12: el marco con desplazamiento de una tabla era una clase
 * (`overflow-x-auto`) repetida en quince sitios. En Safari un contenedor con
 * scroll no recibe el foco, así que con teclado las columnas que quedaban fuera
 * a 390 px (los otros ETF, los ejercicios antiguos) no se alcanzaban.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MarcoTabla } from './MarcoTabla'

const fuentes = import.meta.glob(['../**/*.tsx', '!../**/*.test.tsx', '!./MarcoTabla.tsx'], {
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
    expect(marco.className).toMatch(/(^|\s)mt-4(\s|$)/)
  })

  it('es la única forma de dar scroll horizontal a una tabla', () => {
    expect(Object.keys(fuentes)).toContain('../pages/EtfsPage.tsx')
    const malos: string[] = []
    for (const [ruta, texto] of Object.entries(fuentes)) {
      texto.split('\n').forEach((linea, i) => {
        // El `<pre>` del error no es una tabla: su texto se lee entero con el lector.
        if (linea.includes('overflow-x-auto') && !linea.includes('<pre')) malos.push(`${ruta}:${i + 1}`)
      })
    }
    expect(malos).toEqual([])
  })
})
