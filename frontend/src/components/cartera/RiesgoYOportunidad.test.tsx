/**
 * Ítem 2.1 en los paneles de riesgo y coste de oportunidad de Cartera:
 *
 * - El efectivo que no se pudo leer decía «ninguno — el motor lo trata como
 *   DESCONOCIDO»: se confundía con no haberlo anotado. Son cosas distintas.
 * - La contribución al riesgo que no carga dice qué no cargó; antes era un
 *   motivo suelto, y un error de la descarga se quedaba encima de la tabla.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { ContribucionAlRiesgoPanel, CosteOportunidadPanel } from './RiesgoYOportunidad'

type Rutas = Record<string, { status: number; json: unknown }>

const base = (empresaCompleta as { rutas: Rutas }).rutas
const falla = (motivo: string) => ({ status: 503, json: { detail: motivo } })

function servir(rutas: Rutas) {
  const fetchFalso = vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
  })
  vi.stubGlobal('fetch', fetchFalso)
  return fetchFalso
}

afterEach(() => vi.unstubAllGlobals())

describe('efectivo anotado (ítem 2.1)', () => {
  it('si no se pudo leer, lo dice; no sale «ninguno»', async () => {
    servir({ ...base, '/api/portfolio/efectivo': falla('la base de datos está bloqueada') })
    render(<CosteOportunidadPanel />)
    expect(
      await screen.findByText('No se pudo cargar el efectivo anotado: la base de datos está bloqueada'),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ninguno/)
  })

  it('si se leyó y no hay ninguno, sí lo dice', async () => {
    servir({ ...base, '/api/portfolio/efectivo': { status: 200, json: { saldos: [], nota: null } } })
    render(<CosteOportunidadPanel />)
    expect(
      await screen.findByText('ninguno — el motor lo trata como DESCONOCIDO, no como cero'),
    ).toBeInTheDocument()
  })

  it('el anotado se enseña con su moneda', async () => {
    servir(base)
    render(<CosteOportunidadPanel />)
    expect(await screen.findByText(/Efectivo anotado: 1\.500,00 USD/)).toBeInTheDocument()
  })
})

describe('contribución al riesgo (ítem 2.1)', () => {
  it('si no carga, dice qué no cargó, con su motivo', async () => {
    servir({ ...base, '/api/portfolio/contribucion?descargar=false': falla('sin histórico en caché') })
    render(<ContribucionAlRiesgoPanel />)
    expect(
      await screen.findByText('No se pudo cargar la contribución al riesgo: sin histórico en caché'),
    ).toBeInTheDocument()
  })

  it('el botón vuelve a pedirla, ya descargando', async () => {
    const fetchFalso = servir({
      ...base,
      '/api/portfolio/contribucion?descargar=true': base['/api/portfolio/contribucion?descargar=false'],
    })
    render(<ContribucionAlRiesgoPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar histórico y recalcular' }))
    await waitFor(() =>
      expect(fetchFalso.mock.calls.map(([u]) => String(u))).toContain('/api/portfolio/contribucion?descargar=true'),
    )
    expect(await screen.findByRole('button', { name: 'Descargar histórico y recalcular' })).toBeInTheDocument()
  })
})
