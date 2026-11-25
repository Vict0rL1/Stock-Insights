/**
 * La línea que sustituye a «Puntuando el universo…»: dice qué se está viendo
 * (la lista guardada y su edad, o la de ahora a medias) y que se puede seguir
 * usando la app mientras se completa.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ListaDiaria } from '../hooks/useListaDiaria'
import { ProgresoAnalisis, textoDeAntiguedad } from './ProgresoAnalisis'

type Lista = Parameters<typeof ProgresoAnalisis>[0]['lista']

const base: Lista = {
  estado: 'actualizando',
  progreso: { puntuadas: 312, total: 502, pendientes: 190, completa: false },
  vieja: false,
  calculadaEn: null,
  recibidaEn: null,
  pasada: 2,
  maxPasadas: 4,
  primeraVez: false,
  ocupado: true,
}
const con = (cambios: Partial<ListaDiaria>): Lista => ({ ...base, ...cambios })
const HORA = 3_600_000

afterEach(() => vi.useRealTimers())

describe('ProgresoAnalisis', () => {
  it('con pasadas en marcha, la barra dice cuántas lleva y que se puede seguir', () => {
    render(<ProgresoAnalisis lista={base} />)
    const estado = screen.getByRole('status')
    expect(estado).toHaveTextContent(
      'Analizando el mercado en segundo plano: 312 de 502 empresas. Ya puedes usar la app; las ideas se completan solas.',
    )
    expect(estado).toHaveTextContent('Pasada 2 de 4.')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('con la lista guardada a la vista, su antigüedad y que se está actualizando', () => {
    const ahora = Date.now()
    render(<ProgresoAnalisis lista={con({ estado: 'vieja', vieja: true, calculadaEn: ahora - 9 * HORA, recibidaEn: ahora, progreso: { ...base.progreso!, completa: true } })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Lista de hace 9 h; actualizando…')
    expect(screen.getByRole('status')).toHaveTextContent('El repaso del stop de tus posiciones sí es de ahora.')
  })

  it('sin antigüedad conocida no la inventa, y si ya no se actualiza lo dice', () => {
    render(<ProgresoAnalisis lista={con({ estado: 'error', vieja: false, ocupado: false })} />)
    // Sin edad no hay aviso de lista vieja: es la de ahora a medias.
    expect(screen.getByRole('status')).toHaveTextContent('Cobertura parcial: 312 de 502 empresas')
    expect(textoDeAntiguedad(null)).toBe('Lista guardada, de antigüedad desconocida')
    const ahora = new Date('2026-11-24T15:00:00Z')
    expect(textoDeAntiguedad(ahora.getTime() - 9 * HORA, ahora)).toBe('Lista de hace 9 h')
  })

  it('la guardada que no se pudo actualizar no dice «actualizando»', () => {
    const ahora = Date.now()
    render(<ProgresoAnalisis lista={con({ estado: 'error', vieja: true, calculadaEn: ahora - 3 * HORA, recibidaEn: ahora, ocupado: false })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Lista de hace 3 h, sin actualizar.')
    expect(screen.getByRole('status')).toHaveTextContent('con 312 de 502 empresas')
    expect(screen.getByRole('status')).not.toHaveTextContent('actualizando')
  })

  it('la edad y el repaso avanzan con la pantalla abierta, sin esperar a otra petición', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-11-24T19:00:00Z'))
    const ahora = Date.now()
    render(<ProgresoAnalisis lista={con({ estado: 'error', vieja: true, calculadaEn: ahora - 9 * HORA, recibidaEn: ahora, ocupado: false })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Lista de hace 9 h, sin actualizar.')
    expect(screen.getByRole('status')).toHaveTextContent('El repaso del stop de tus posiciones sí es de ahora.')
    act(() => {
      vi.advanceTimersByTime(HORA)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Lista de hace 10 h, sin actualizar.')
    expect(screen.getByRole('status')).toHaveTextContent('El repaso del stop de tus posiciones es de cuando llegó, hace 1 h.')
  })

  it('vieja sin fecha conocida no la inventa', () => {
    render(<ProgresoAnalisis lista={con({ estado: 'vieja', vieja: true, calculadaEn: null, recibidaEn: Date.now() })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Lista guardada, de antigüedad desconocida; actualizando…')
  })

  it('sin nada que enseñar, un estado de carga breve; la primera vez dice que va corta', () => {
    const { rerender } = render(<ProgresoAnalisis lista={con({ estado: 'cargando', progreso: null })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Cargando la lista de hoy…')
    rerender(<ProgresoAnalisis lista={con({ estado: 'cargando', progreso: null, primeraVez: true })} />)
    expect(screen.getByRole('status')).toHaveTextContent('Preparando la primera lista…')
    expect(screen.getByRole('status')).toHaveTextContent('primero se analizan 40 empresas')
  })

  it('parada sin cubrir todo: la cobertura parcial y «Seguir completando»', () => {
    const seguir = vi.fn()
    render(<ProgresoAnalisis lista={con({ estado: 'lista', ocupado: false, pasada: 0 })} onSeguir={seguir} />)
    expect(screen.getByRole('status')).toHaveTextContent('Cobertura parcial: 312 de 502 empresas')
    fireEvent.click(screen.getByRole('button', { name: 'Seguir completando' }))
    expect(seguir).toHaveBeenCalledOnce()
  })

  it('completa y sin nada en marcha, o un fallo sin lista, no pinta nada', () => {
    const { container, rerender } = render(
      <ProgresoAnalisis lista={con({ estado: 'lista', ocupado: false, progreso: { ...base.progreso!, completa: true } })} />,
    )
    expect(container).toBeEmptyDOMElement()
    rerender(<ProgresoAnalisis lista={con({ estado: 'error', ocupado: false, progreso: null })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
