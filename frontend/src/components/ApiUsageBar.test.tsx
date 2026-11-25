/**
 * Revisión del 2.1 en la barra lateral:
 *
 * - «IA sin comprobar» no se volvía a pedir nunca (la barra se monta una vez),
 *   y seguía ahí cuando otra pantalla ya había conseguido el estado y ofrecía
 *   los botones de IA.
 * - Unas cifras de uso que no se pudieron actualizar solo lo decían en el
 *   `title`: a la vista parecían las de ahora.
 *
 * El estado de la IA se comparte en el módulo `llm`: cada test lo importa de
 * nuevo para no heredar el del anterior. Solo se falsea `setInterval`.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const USO = [{ provider: 'finnhub', configured: true, used: 3, limit: 60, remaining: 57, window_seconds: 60 }]

type Respuesta = { status: number; json: unknown }

/** Cada ruta da sus respuestas en orden; la última se repite. */
function servir(rutas: Record<string, Respuesta[]>) {
  const veces: Record<string, number> = {}
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const lista = rutas[url] ?? [{ status: 404, json: { detail: `sin fixture: ${url}` } }]
    const i = Math.min(veces[url] ?? 0, lista.length - 1)
    veces[url] = (veces[url] ?? 0) + 1
    return new Response(JSON.stringify(lista[i].json), { status: lista[i].status })
  }))
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const FALLA = { status: 502, json: { detail: 'el backend está arrancando' } }
const ACTIVA = { status: 200, json: { configured: true, model: 'claude' } }

describe('barra de uso de las API (revisión del 2.1)', () => {
  it('la IA sin comprobar se vuelve a pedir con el uso, cada 30 s', async () => {
    servir({ '/api/meta/usage': [{ status: 200, json: USO }], '/api/meta/llm': [FALLA, ACTIVA] })
    const { ApiUsageBar } = await import('./ApiUsageBar')
    render(<ApiUsageBar />)
    expect(await screen.findByText('IA sin comprobar')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(await screen.findByText('IA activa')).toBeInTheDocument()
    expect(screen.queryByText('IA sin comprobar')).toBeNull()
  })

  it('se entera del estado que consigue otra pantalla', async () => {
    servir({ '/api/meta/usage': [{ status: 200, json: USO }], '/api/meta/llm': [FALLA, ACTIVA] })
    const { ApiUsageBar } = await import('./ApiUsageBar')
    const { useLlmStatus } = await import('../lib/llm')
    function OtraPantalla() {
      const llm = useLlmStatus()
      return <p>{llm?.configured ? 'botón de IA' : 'sin botón'}</p>
    }
    const { rerender } = render(<ApiUsageBar />)
    expect(await screen.findByText('IA sin comprobar')).toBeInTheDocument()
    rerender(
      <>
        <ApiUsageBar />
        <OtraPantalla />
      </>,
    )
    expect(await screen.findByText('botón de IA')).toBeInTheDocument()
    expect(await screen.findByText('IA activa')).toBeInTheDocument()
  })

  it('unas cifras que no se pudieron actualizar lo dicen a la vista', async () => {
    servir({ '/api/meta/usage': [{ status: 200, json: USO }, FALLA], '/api/meta/llm': [ACTIVA] })
    const { ApiUsageBar } = await import('./ApiUsageBar')
    render(<ApiUsageBar />)
    expect(await screen.findByText('finnhub 57/60')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(30_000)
    })
    expect(await screen.findByText('últimas cifras: no se pudo actualizar')).toBeInTheDocument()
    expect(screen.getByText('finnhub 57/60')).toBeInTheDocument()
  })
})
