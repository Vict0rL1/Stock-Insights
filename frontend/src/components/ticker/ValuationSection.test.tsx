/**
 * Ítem 2.1, Valoración: sin crecimiento sugerido (el backend no puede medirlo,
 * p. ej. con menos de dos ejercicios), `suggested_growth_capped ?? 0.05` precargaba un
 * 5 % en el escenario base (y 2 % y 8 % en los otros) sin decirlo en ningún
 * sitio. Un supuesto que nadie eligió no se precarga: el campo va vacío, se dice
 * por qué y no se calcula hasta que haya un valor escrito.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { ValuationSection } from './ValuationSection'

type Rutas = Record<string, { status: number; json: unknown }>
const ACME = (empresaCompleta as { rutas: Rutas }).rutas
const DEFAULTS = ACME['/api/stocks/ACME/valuation/defaults'].json as Record<string, unknown>

afterEach(() => vi.unstubAllGlobals())

function servir(defaults: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(defaults), { status: 200 })))
}

const crecimientos = () =>
  screen.getAllByLabelText('Crecimiento FCF (%/año)').map((i) => (i as HTMLInputElement).value)

describe('DCF sin crecimiento histórico', () => {
  it('no precarga un crecimiento inventado: lo deja vacío, dice por qué y no calcula', async () => {
    servir({ ...DEFAULTS, suggested_growth_capped: null })
    render(<ValuationSection symbol="ACME" />)
    expect(await screen.findByText(/^Sin crecimiento histórico con el que precargarlo: escribe el tuyo/)).toBeInTheDocument()
    expect(crecimientos()).toEqual(['', '', ''])
    const calcular = screen.getByRole('button', { name: 'Calcular rango de valor' })
    expect(calcular).toBeDisabled()

    // Con el crecimiento escrito en los tres escenarios, ya se puede calcular.
    for (const campo of screen.getAllByLabelText('Crecimiento FCF (%/año)')) {
      fireEvent.change(campo, { target: { value: '4' } })
    }
    expect(calcular).toBeEnabled()
  })

  it('con crecimiento sugerido lo precarga como antes y no avisa', async () => {
    servir(DEFAULTS)
    render(<ValuationSection symbol="ACME" />)
    expect(await screen.findByRole('button', { name: 'Calcular rango de valor' })).toBeEnabled()
    expect(crecimientos()).toEqual(['8.1', '11.1', '14.1'])
    expect(screen.queryByText(/Sin crecimiento histórico/)).toBeNull()
  })
})
