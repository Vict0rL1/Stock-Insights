/**
 * Revisión 11: las casillas del informe a fondo seguían con decimales fijos
 * debajo de una lectura que ya escribía cada cifra de su lado del umbral:
 * «cobertura de intereses 4,996× — ajustada» encima de «Cobertura 5,0×» (holgada
 * es por encima de 5), y «Solo el 59,96 %» encima de «Conversión 60,0 %». Con la
 * respuesta REAL del backend (`empresa_completa.json`), cambiando solo las cifras.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { DeepDiveSection } from './DeepDiveSection'

type Rutas = Record<string, { status: number; json: unknown }>
type Informe = {
  debt: { debt_to_equity: number | null; interest_coverage: number | null }
  cash_flow: { current: Record<string, unknown> }
}

afterEach(() => vi.unstubAllGlobals())

describe('casillas del informe a fondo', () => {
  it('escriben la cifra frente a las mismas fronteras que la lectura', async () => {
    const rutas = structuredClone((empresaCompleta as unknown as { rutas: Rutas }).rutas)
    const informe = rutas['/api/deep-dive/ACME?history_years=10'].json as Informe
    informe.debt.debt_to_equity = 2.004
    informe.debt.interest_coverage = 4.996
    informe.cash_flow.current.fcf_conversion = 0.5996
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    render(<DeepDiveSection symbol="ACME" />)
    expect(await screen.findByText('2,004', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('4,996×')).toBeInTheDocument()
    expect(screen.getByText(/^59,96\s%$/)).toBeInTheDocument()
  })
})
