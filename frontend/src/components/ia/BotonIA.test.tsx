/**
 * Revisión 12, visual: «Resumir este diff con IA (opcional, gasta API)» salía
 * activo con la IA apagada (la barra lateral decía «IA apagada», y a 390 px ni
 * eso se veía): ofrecía una acción que solo podía acabar en error. `BotonIA`
 * consulta ahora el estado de la IA y, si no está encendida o no se sabe, sale
 * desactivado y dice por qué a la vista.
 *
 * El estado de la IA se comparte en el módulo `llm`: cada test lo importa de
 * nuevo para no heredar el del anterior.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'

type Respuesta = { status: number; json: unknown }
type Rutas = Record<string, Respuesta>

/** Qué cambió de ACME (la fixture, sin tocarla) con el estado de la IA que se pida. */
function servir(llm: Respuesta) {
  const rutas: Rutas = { ...(empresaCompleta as { rutas: Rutas }).rutas, '/api/meta/llm': llm }
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 })
  }))
}

async function botonDeResumir() {
  const { QueCambioSection } = await import('../ticker/QueCambioSection')
  render(<MemoryRouter><QueCambioSection symbol="ACME" /></MemoryRouter>)
  return screen.findByRole('button', { name: /Resumir este diff con IA/ })
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('el botón de IA con la IA apagada (revisión 12, visual)', () => {
  it('Qué cambió: sale desactivado y dice por qué, a la vista', async () => {
    servir({ status: 200, json: { configured: false, model: null } })
    const boton = await botonDeResumir()
    await waitFor(() => expect(boton).toHaveAccessibleDescription(/^IA apagada: sin ANTHROPIC_API_KEY en \.env/))
    expect(boton).toBeDisabled()
    expect(screen.getByText(/^IA apagada: sin ANTHROPIC_API_KEY en \.env/)).toBeInTheDocument()
  })

  it('si no se pudo comprobar, tampoco se ofrece, y se dice el fallo', async () => {
    servir({ status: 502, json: { detail: 'el backend está arrancando' } })
    const boton = await botonDeResumir()
    await waitFor(() => expect(boton).toHaveAccessibleDescription(/el backend está arrancando/))
    expect(boton).toBeDisabled()
  })

  it('con la IA encendida se puede pulsar y no lleva motivo', async () => {
    servir({ status: 200, json: { configured: true, model: 'modelo-de-prueba' } })
    const boton = await botonDeResumir()
    await waitFor(() => expect(boton).toBeEnabled())
    expect(boton).not.toHaveAccessibleDescription()
    expect(screen.queryByText(/IA apagada|Comprobando si la IA/)).toBeNull()
  })
})
