/**
 * Revisión 11: el intervalo y el múltiplo de los comparables se escribían con un
 * decimal junto a «dentro/fuera», que se decide con las cifras que se sirven
 * (dos decimales): un 22,44 fuera de 15,02–22,36 se leía «P/E 15,0 – 22,4 ·
 * cotiza a 22,4 (fuera)».
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Valoracion } from '../api/types'
import { ComparablesPanel, Escenarios } from './ValuationPage'

describe('comparables ajustados', () => {
  it('el múltiplo y el intervalo, con los decimales que deciden «dentro» o «fuera»', () => {
    render(
      <ComparablesPanel
        c={{
          disponible: true, fiable: true, nota: '', etiqueta_multiplo: 'P/E', pares_usables: 12, grados_libertad: 9,
          r2: 0.45, multiplo_objetivo: 22.44, intervalo: { bajo: 15.02, alto: 22.36 }, dentro_del_intervalo: false,
        }}
      />,
    )
    expect(screen.getByText(/P\/E 15,02 – 22,36/)).toBeInTheDocument()
    expect(screen.getByText('22,44')).toBeInTheDocument()
  })
})

describe('los supuestos de los escenarios', () => {
  // Revisión 12, visual: eran `type="number"` leídos con `Number(...)`. Un «8,5»
  // que el navegador no acepta llegaba vacío, y un campo borrado, también: los dos
  // recalculaban con un 0 % sin avisar.
  const supuestos = { growth_rate: 0.081, discount_rate: 0.11, terminal_growth: 0.02 }
  const data = {
    entradas: { precio_actual: 92 },
    nota_supuestos: '',
    escenarios: { bajista: { supuestos, rango: { disponible: false, nota: '' } } },
  } as unknown as Valoracion

  function montar() {
    const onCambiar = vi.fn()
    const onAplicar = vi.fn()
    render(<Escenarios data={data} supuestos={{ bajista: supuestos }} onCambiar={onCambiar} onAplicar={onAplicar} busy={false} />)
    const wacc = screen.getByLabelText(/^WACC/) as HTMLInputElement
    const recalcular = screen.getByRole('button', { name: 'Recalcular con mis supuestos' })
    return { onCambiar, wacc, recalcular }
  }

  it('se escriben con coma y «8,5» se lee como 8,5 %', () => {
    const { onCambiar, wacc } = montar()
    expect(wacc.value).toBe('11,0')
    expect((screen.getByLabelText(/^Crecimiento FCF/) as HTMLInputElement).value).toBe('8,1')
    fireEvent.change(wacc, { target: { value: '8,5' } })
    expect(wacc.value).toBe('8,5')
    expect(onCambiar).toHaveBeenLastCalledWith('bajista', 'discount_rate', expect.closeTo(0.085, 10))
  })

  it('el crecimiento y la perpetuidad no piden el teclado decimal, que en iOS no trae «-»', () => {
    // Revisión 13: con `inputMode="decimal"` no había forma de escribir en un
    // iPhone un crecimiento o una perpetuidad negativos, que el backend admite.
    const { wacc } = montar()
    expect(screen.getByLabelText(/^Crecimiento FCF/).getAttribute('inputmode')).toBeNull()
    expect(screen.getByLabelText(/^Perpetuidad/).getAttribute('inputmode')).toBeNull()
    expect(wacc.getAttribute('inputmode')).toBe('decimal')
  })

  it('un campo borrado o ilegible no es un 0 %: no llega a los supuestos y no deja recalcular', () => {
    const { onCambiar, wacc, recalcular } = montar()
    fireEvent.change(wacc, { target: { value: '' } })
    expect(onCambiar).not.toHaveBeenCalled()
    expect(recalcular).toBeDisabled()
    expect(screen.getByText('Para recalcular falta: WACC bajista.')).toBeInTheDocument()
    fireEvent.change(wacc, { target: { value: '8,5x' } })
    expect(onCambiar).not.toHaveBeenCalled()
    expect(recalcular).toBeDisabled()
    expect(screen.getByText(/^No se puede leer WACC bajista \(«8,5x»\)/)).toBeInTheDocument()
    fireEvent.change(wacc, { target: { value: '9' } })
    expect(recalcular).toBeEnabled()
  })
})
