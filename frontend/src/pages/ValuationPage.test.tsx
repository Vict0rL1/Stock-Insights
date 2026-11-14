/**
 * Revisión 11: el intervalo y el múltiplo de los comparables se escribían con un
 * decimal junto a «dentro/fuera», que se decide con las cifras que se sirven
 * (dos decimales): un 22,44 fuera de 15,02–22,36 se leía «P/E 15,0 – 22,4 ·
 * cotiza a 22,4 (fuera)».
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComparablesPanel } from './ValuationPage'

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
