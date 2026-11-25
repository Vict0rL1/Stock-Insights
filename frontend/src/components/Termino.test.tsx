/**
 * Un término se explica al pasar, al llegar con el teclado o al tocarlo en el
 * móvil, no solo con el ratón: un `title` no se ve en el móvil ni se abre con
 * el teclado. La definición sale del glosario (`lib/glosario.ts`), en un sitio.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GLOSARIO, QUE_SIGNIFICA_LA_ACCION } from '../lib/glosario'
import { ConTerminos, Termino, terminosEn } from './Termino'

const definicion = () => screen.queryByRole('tooltip')

describe('Termino', () => {
  it('es un botón al que se llega con el teclado y lleva su definición como descripción', () => {
    render(<Termino clave="per" />)
    const boton = screen.getByRole('button', { name: 'PER' })
    // Abierta o no, el lector de pantalla la lee al enfocarlo.
    expect(boton).toHaveAccessibleDescription(GLOSARIO.per.definicion)
    expect(definicion()).toBeNull()
  })

  it('con el teclado: se abre al enfocarlo, Escape la cierra y salir también', () => {
    render(<Termino clave="stop" />)
    const boton = screen.getByRole('button', { name: 'stop' })
    fireEvent.focus(boton)
    expect(definicion()).toHaveTextContent(GLOSARIO.stop.definicion)
    expect(boton).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(boton, { key: 'Escape' })
    expect(definicion()).toBeNull()
    fireEvent.focus(boton)
    fireEvent.blur(boton)
    expect(definicion()).toBeNull()
  })

  it('en el móvil, un toque la abre y la deja abierta; otro la cierra (el foco del toque no la cierra en el mismo gesto)', () => {
    render(<Termino clave="margen_operativo" />)
    const boton = screen.getByRole('button', { name: 'margen operativo' })
    // Un toque: puntero, foco y clic, en ese orden.
    fireEvent.pointerDown(boton)
    fireEvent.focus(boton)
    fireEvent.click(boton)
    expect(definicion()).toHaveTextContent(GLOSARIO.margen_operativo.definicion)
    fireEvent.pointerDown(boton)
    fireEvent.click(boton)
    expect(definicion()).toBeNull()
  })

  it('en el móvil, con los eventos de un toque de verdad, el segundo toque la cierra (revisión 14)', () => {
    // Un toque emula la entrada del ratón y nunca su salida (Playwright, Pixel 5):
    // pointerenter → pointerdown → mouseover → mouseenter → focus → click; el
    // segundo, pointerenter → pointerdown → click. Con `onMouseEnter` la
    // definición se quedaba «encima» y no se cerraba.
    render(<Termino clave="per" />)
    const boton = screen.getByRole('button', { name: 'PER' })
    fireEvent.pointerEnter(boton, { pointerType: 'touch' })
    fireEvent.pointerDown(boton, { pointerType: 'touch' })
    fireEvent.mouseEnter(boton)
    fireEvent.focus(boton)
    fireEvent.click(boton)
    expect(definicion()).toHaveTextContent(GLOSARIO.per.definicion)
    fireEvent.pointerEnter(boton, { pointerType: 'touch' })
    fireEvent.pointerDown(boton, { pointerType: 'touch' })
    fireEvent.click(boton)
    expect(definicion()).toBeNull()
  })

  it('con el ratón, se abre al pasar por encima y se cierra al irse', () => {
    render(<Termino clave="media_200" />)
    const boton = screen.getByRole('button', { name: 'media de 200 sesiones' })
    fireEvent.pointerEnter(boton, { pointerType: 'mouse' })
    expect(definicion()).toBeInTheDocument()
    fireEvent.pointerLeave(boton, { pointerType: 'mouse' })
    expect(definicion()).toBeNull()
  })

  it('una acción del motor se explica con su significado, con el nombre que trae', () => {
    render(<Termino accion="vigilar">Vigilar</Termino>)
    expect(screen.getByRole('button', { name: 'Vigilar' })).toHaveAccessibleDescription(QUE_SIGNIFICA_LA_ACCION.vigilar)
  })
})

describe('ConTerminos', () => {
  it('explica los términos de un texto sin cambiar ni una letra', () => {
    const texto = 'Puntuación ≥ +0,35 y el precio sobre su media de 200 sesiones; salir en el stop.'
    const { container } = render(<p>{<ConTerminos texto={texto} />}</p>)
    expect(container.textContent?.replace(GLOSARIO.puntuacion.definicion, '').replace(GLOSARIO.media_200.definicion, '').replace(GLOSARIO.stop.definicion, '')).toBe(texto)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Puntuación', 'media de 200 sesiones', 'stop'])
  })

  it('no confunde un término con un trozo de otra palabra ni con un símbolo en mayúsculas', () => {
    // STOP es una empresa de la demo; «stops» o «PERA» no son el término.
    expect(terminosEn('STOP cae; los stops; PERA; superpuntuación')).toEqual([])
    expect(terminosEn('El PER de STOP')).toEqual([{ desde: 3, hasta: 6, clave: 'per' }])
  })
})
