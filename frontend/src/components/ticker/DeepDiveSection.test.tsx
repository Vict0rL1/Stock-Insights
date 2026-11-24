/**
 * Revisión 11: las casillas del informe a fondo seguían con decimales fijos
 * debajo de una lectura que ya escribía cada cifra de su lado del umbral:
 * «cobertura de intereses 4,996× — ajustada» encima de «Cobertura 5,0×» (holgada
 * es por encima de 5), y «Solo el 59,96 %» encima de «Conversión 60,0 %». Con la
 * respuesta REAL del backend (`empresa_completa.json`), cambiando solo las cifras.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { DeepDiveSection } from './DeepDiveSection'
import { textoRango } from '../valoracion/ResumenDcf'
import { rutaValoracion } from '../valoracion/ruta'

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
    render(<MemoryRouter><DeepDiveSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText('2,004', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('4,996×')).toBeInTheDocument()
    expect(screen.getByText(/^59,96\s%$/)).toBeInTheDocument()
  })
})

/** El informe del fixture con los campos que añade la revisión 12, en memoria. */
function servirInforme(cambiar: (informe: Record<string, unknown> & InformeR12) => void) {
  const rutas = structuredClone((empresaCompleta as unknown as { rutas: Rutas }).rutas)
  cambiar(rutas['/api/deep-dive/ACME?history_years=10'].json as Record<string, unknown> & InformeR12)
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
  }))
}

type InformeR12 = {
  verdict: { alcance?: string }
  margins: { ejercicio?: string | null }
  risks: unknown[]
  riesgos_sin_comprobar?: string[]
  catalysts: { type: string; when: string | null; detail: string | null; source: string; url?: string }[]
  catalysts_note?: string
  catalysts_sin_comprobar?: string[]
}

describe('informe a fondo, revisión 12 (visual)', () => {
  it('el DCF dice que la cifra es el peso del valor terminal', async () => {
    // «terminal 63,8 %» se leía como el crecimiento terminal (2,0, 2,5 y 3,0
    // en la pestaña Valoración).
    servirInforme(() => {})
    render(<MemoryRouter><DeepDiveSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText(/el valor terminal es el 65,3\s% del valor de empresa/, {}, { timeout: 3000 })).toBeInTheDocument()
  })

  it('el DCF del informe es el del módulo: sus rangos, no un valor por escenario, y el enlace al análisis completo', async () => {
    // Ítem 3.3: era un tercer DCF (WACC 12/10/9 %, crecimiento ±4 puntos) con un
    // precio por escenario. Con el fixture REAL del backend, los rangos del
    // informe son los de `POST /api/valuation/ACME`.
    servirInforme(() => {})
    render(<MemoryRouter><DeepDiveSection symbol="ACME" /></MemoryRouter>)
    const modulo = (empresaCompleta as unknown as { rutas: Rutas }).rutas['/api/valuation/ACME'].json as {
      escenarios: Record<string, { rango: { bajo: number; alto: number } }>
    }
    for (const n of ['bajista', 'base', 'alcista']) {
      const { bajo, alto } = modulo.escenarios[n].rango
      expect(await screen.findByText(textoRango(bajo, alto), {}, { timeout: 3000 })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Abrir el análisis completo' })).toHaveAttribute('href', rutaValoracion('ACME'))
    expect(screen.queryByText('Valor intrínseco (DCF precargado)')).toBeNull()
  })

  it('los márgenes dicen de qué ejercicio son, y la lectura conjunta su alcance', async () => {
    servirInforme((informe) => {
      informe.margins.ejercicio = '2025'
      informe.verdict.alcance = 'Lectura del ejercicio anual 2025 y de la valoración frente a su propia historia.'
    })
    render(<MemoryRouter><DeepDiveSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText('Márgenes del ejercicio 2025', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText(/^Lectura del ejercicio anual 2025/)).toBeInTheDocument()
  })

  it('un umbral de riesgo sin dato no pasa por comprobado', async () => {
    servirInforme((informe) => {
      informe.risks = []
      informe.riesgos_sin_comprobar = ['deuda/capital', 'cobertura de intereses', 'valoración frente a su historia']
    })
    render(<MemoryRouter><DeepDiveSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText(/Ninguno de los umbrales comprobados se dispara/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('Sin comprobar por falta de datos: deuda/capital, cobertura de intereses y valoración frente a su historia.')).toBeInTheDocument()
    expect(screen.queryByText(/umbrales del modelo se dispara/)).not.toBeInTheDocument()
  })

  it('los catalizadores no prometen un plazo y dicen si la fecha ya pasó', async () => {
    servirInforme((informe) => {
      informe.catalysts = [
        { type: 'Resultados', when: '2026-10-06', detail: 'Publicación de resultados', source: 'calendario' },
        { type: '10-Q', when: '2026-08-01', detail: 'Documento presentado ante la SEC', source: 'edgar', url: 'https://example.com/q' },
      ]
      informe.catalysts_note = 'Resultados previstos en los próximos 120 días (calendario) y los 3 últimos documentos presentados ante la SEC.'
    })
    render(<MemoryRouter><DeepDiveSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText('Catalizadores y fechas a vigilar', {}, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.queryByText(/6-18 meses/)).not.toBeInTheDocument()
    expect(screen.getByText(/Resultados previstos en los próximos 120 días/)).toBeInTheDocument()
    expect(screen.getByText('previsto el 6 oct 2026')).toBeInTheDocument()
    expect(screen.getByText('presentado el 1 ago 2026')).toBeInTheDocument()
  })

  it('con una fuente caída, la lista vacía de catalizadores no es «ninguno»', async () => {
    // Revisión 13: el backend ya nombraba las fuentes que no respondieron, pero
    // la pantalla seguía escribiendo «Ninguno identificado en los datos.».
    servirInforme((informe) => {
      informe.catalysts = []
      informe.catalysts_sin_comprobar = ['calendario de resultados', 'documentos presentados ante la SEC']
    })
    render(<MemoryRouter><DeepDiveSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText(
      'Sin comprobar. Fuentes que no respondieron: calendario de resultados y documentos presentados ante la SEC.',
      {}, { timeout: 3000 },
    )).toBeInTheDocument()
    expect(screen.queryByText('Ninguno identificado en los datos.')).not.toBeInTheDocument()
  })

  it('con una fuente caída y algo en la lista, avisa de que puede estar incompleta', async () => {
    servirInforme((informe) => {
      informe.catalysts = [{ type: '10-Q', when: '2026-08-01', detail: 'Documento presentado ante la SEC', source: 'edgar' }]
      informe.catalysts_sin_comprobar = ['calendario de resultados']
    })
    render(<MemoryRouter><DeepDiveSection symbol="ACME" /></MemoryRouter>)
    expect(await screen.findByText(
      'La lista puede estar incompleta. Fuentes que no respondieron: calendario de resultados.',
      {}, { timeout: 3000 },
    )).toBeInTheDocument()
  })
})
