/**
 * Ítem 2.1, Expectativas: dos fallos que no se veían.
 *
 * - La calibración hacía `() => setCal(null)`: un fallo y «todavía no hay pares»
 *   se pintaban igual, con la sección desaparecida.
 * - Un evento que no cargaba guardaba el fallo en un mensaje que solo se pintaba
 *   con el evento cargado: «Cargando evento…» para siempre.
 */
import { render, screen } from '@testing-library/react'
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
})
