/**
 * Ítem 2.1, Expectativas: dos fallos que no se veían.
 *
 * - La calibración hacía `() => setCal(null)`: un fallo y «todavía no hay pares»
 *   se pintaban igual, con la sección desaparecida.
 * - Un evento que no cargaba guardaba el fallo en un mensaje que solo se pintaba
 *   con el evento cargado: «Cargando evento…» para siempre.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { ExpectativasSection } from './ExpectativasSection'

type Rutas = Record<string, { status: number; json: unknown }>
const ACME = (empresaCompleta as { rutas: Rutas }).rutas
const FALLO = { status: 502, json: { detail: 'el servidor no respondió' } }

afterEach(() => vi.unstubAllGlobals())

function servir(rutas: Rutas) {
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 })
  }))
}

describe('resultados frente a expectativas', () => {
  it('una calibración que no carga lo dice, con su motivo; los eventos siguen', async () => {
    servir({ ...ACME, '/api/expectativas/calibracion?symbol=ACME': FALLO })
    render(<ExpectativasSection symbol="ACME" />)
    expect(await screen.findByText('No se pudo cargar la calibración histórica: el servidor no respondió')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /^Resultados 2026-Q2/ })).toBeInTheDocument()
  })

  it('una calibración sin pares dice que aún no hay con qué medir, no que falló', async () => {
    servir({ ...ACME, '/api/expectativas/calibracion?symbol=ACME': { status: 200, json: { pares: 0, por_fuente: {}, nota: '' } } })
    render(<ExpectativasSection symbol="ACME" />)
    expect(await screen.findByText(/^Todavía no hay pares de expectativa y resultado/)).toBeInTheDocument()
    expect(screen.queryByText(/No se pudo cargar la calibración/)).toBeNull()
  })

  it('un evento que no carga lo dice en vez de quedarse «cargando» para siempre', async () => {
    servir({ ...ACME, '/api/expectativas/eventos/1': FALLO })
    render(<ExpectativasSection symbol="ACME" />)
    expect(await screen.findByText('No se pudo cargar el evento: el servidor no respondió')).toBeInTheDocument()
    expect(screen.queryByText(/Cargando/)).toBeNull()
  })

  it('un BPA de céntimos se escribe como un precio, no «0,00»', async () => {
    // Revisión 5: una tercera copia del formateador de métricas escribía el BPA
    // esperado de 0,0042 y el real de 0,0038 como «0,00 0,00».
    const evento = structuredClone(ACME['/api/expectativas/eventos/1'].json) as {
      por_fuente: Record<string, { metrica: string; esperado: { valor: number | null }; real: number | null }[]>
    }
    const bpa = evento.por_fuente.consenso.find((c) => c.metrica === 'eps_diluted')!
    bpa.esperado.valor = 0.0042
    bpa.real = 0.0038
    servir({ ...ACME, '/api/expectativas/eventos/1': { status: 200, json: evento } })
    render(<ExpectativasSection symbol="ACME" />)
    expect(await screen.findByText('0,0042')).toBeInTheDocument()
    expect(screen.getAllByText('0,0038').length).toBeGreaterThan(0)
  })

  it('las cifras de un evento, cada una en su forma y de su lado', async () => {
    // Revisión 6: códigos en crudo en «parcial: sin resultado para…», un
    // invalidado «real 18,0 %, umbral 18,0 %» y una sorpresa absoluta «0,00».
    const evento = structuredClone(ACME['/api/expectativas/eventos/1'].json) as {
      parcial: boolean; sin_resultado: string[]
      impacto_en_tesis: { real?: number; umbral?: number }[]
      por_fuente: Record<string, { metrica: string; esperado: { valor: number | null }; real: number | null;
        sorpresa: number | null; tipo_sorpresa: string; lectura: string }[]>
    }
    evento.parcial = true
    evento.sin_resultado = ['eps_diluted', 'revenue']
    evento.impacto_en_tesis[0].real = 0.1796
    const bpa = evento.por_fuente.consenso.find((c) => c.metrica === 'eps_diluted')!
    Object.assign(bpa, { esperado: { ...bpa.esperado, valor: -0.0042 }, real: -0.0038, sorpresa: 0.0004,
                         tipo_sorpresa: 'absoluta (referencia no positiva)', lectura: 'supera' })
    servir({ ...ACME, '/api/expectativas/eventos/1': { status: 200, json: evento } })
    const { container } = render(<ExpectativasSection symbol="ACME" />)
    expect(await screen.findByText(/parcial: sin resultado para BPA diluido, ingresos/)).toBeInTheDocument()
    expect(container.textContent).toContain('real 17,96\u00a0%, umbral 18,0\u00a0%')
    expect(screen.getByText('+0,0004')).toBeInTheDocument()
  })

  it('tras «Capturar expectativas» la lectura sigue a la vista mientras recarga', async () => {
    // Revisión del 2.1: la recarga pasaba por «cargando» y la lectura, la
    // lista y la calibración desaparecían; la página saltaba.
    let recargando = false
    const pedidas: string[] = []
    vi.stubGlobal('fetch', vi.fn((e: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      pedidas.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'POST') {
        recargando = true
        return Promise.resolve(new Response(JSON.stringify({ registradas: [], sin_fuente: [] }), { status: 200 }))
      }
      if (recargando) return new Promise<Response>(() => {})
      const r = ACME[url]
      return Promise.resolve(new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 }))
    }))
    render(<ExpectativasSection symbol="ACME" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Capturar expectativas' }))
    await waitFor(() => expect(pedidas.filter((p) => p === 'GET /api/expectativas/eventos/1')).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Capturar expectativas' })).toBeInTheDocument()
    expect(screen.queryByText(/^Cargando/)).toBeNull()
  })
})
