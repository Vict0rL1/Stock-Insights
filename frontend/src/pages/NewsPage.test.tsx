/**
 * Revisión del 2.1 en Noticias:
 *
 * - La carga era un `useEffect` sin descarte: si el feed general llegaba
 *   después que el de AAPL, lo pisaba bajo «Noticias · AAPL». El fallo salía
 *   suelto, sin «Reintentar».
 * - «La capa de IA está desactivada: sin ANTHROPIC_API_KEY» salía también
 *   cuando solo había fallado la consulta del estado de la IA.
 *
 * El estado de la IA se comparte en el módulo `llm`: cada test lo importa de
 * nuevo para no heredar el del anterior.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsFeed } from '../api/types'

const feed = (symbol: string | null, titular: string): NewsFeed => ({
  source: 'finnhub', as_of: '2026-09-12T14:35:00+00:00', cached: false, fetched_at: null, estado: 'valido',
  symbol,
  items: [{ headline: titular, summary: null, url: `https://x/${titular}`, published_at: '2026-09-12T14:00:00+00:00', source: 'x', related: symbol }],
})

type Respuesta = { status: number; json: unknown }
const GENERAL = '/api/news?days=7'
const AAPL = '/api/news?days=7&symbol=AAPL'

function servir(rutas: Record<string, Respuesta | ((r: (x: Response) => void) => void)>) {
  vi.stubGlobal('fetch', vi.fn((e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    if (typeof r === 'function') return new Promise<Response>((resolver) => r(resolver))
    return Promise.resolve(new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 }))
  }))
}

async function pintar() {
  const { NewsPage } = await import('./NewsPage')
  return render(<NewsPage />)
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

const responder = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status })

describe('Noticias (revisión del 2.1)', () => {
  it('un feed general que llega tarde no pisa el del símbolo filtrado', async () => {
    let soltarGeneral: (r: Response) => void = () => {}
    servir({
      '/api/meta/llm': { status: 200, json: { configured: false, model: null } },
      [GENERAL]: (r) => (soltarGeneral = r),
      [AAPL]: { status: 200, json: feed('AAPL', 'Titular de AAPL') },
    })
    await pintar()
    fireEvent.change(screen.getByPlaceholderText(/Filtrar por ticker/), { target: { value: 'aapl' } })
    fireEvent.click(screen.getByRole('button', { name: 'Filtrar' }))
    expect(await screen.findByText('Titular de AAPL')).toBeInTheDocument()
    await act(async () => soltarGeneral(responder(feed(null, 'Titular general'))))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Noticias · AAPL')
    expect(screen.queryByText('Titular general')).toBeNull()
    expect(screen.getByText('Titular de AAPL')).toBeInTheDocument()
  })

  it('un feed que no carga lo dice con su motivo y se puede reintentar', async () => {
    const rutas: Record<string, Respuesta> = {
      '/api/meta/llm': { status: 200, json: { configured: false, model: null } },
      [GENERAL]: { status: 502, json: { detail: 'Finnhub no respondió' } },
    }
    servir(rutas)
    await pintar()
    const fallo = await screen.findByText('No se pudieron cargar las noticias: Finnhub no respondió')
    rutas[GENERAL] = { status: 200, json: feed(null, 'Titular general') }
    fireEvent.click(within(fallo.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Titular general')).toBeInTheDocument()
  })

  it('si el estado de la IA no se pudo consultar, no afirma que falte la clave', async () => {
    servir({
      '/api/meta/llm': { status: 502, json: { detail: 'el backend está arrancando' } },
      [GENERAL]: { status: 200, json: feed(null, 'Titular general') },
    })
    await pintar()
    expect(await screen.findByText(/No se pudo comprobar la capa de IA \(el backend está arrancando\)/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ANTHROPIC_API_KEY/)
  })

  // Guarda de no regresión (pasa también con el código anterior).
  it('sin la clave configurada, sí lo dice', async () => {
    servir({
      '/api/meta/llm': { status: 200, json: { configured: false, model: null } },
      [GENERAL]: { status: 200, json: feed(null, 'Titular general') },
    })
    await pintar()
    expect(await screen.findByText(/sin ANTHROPIC_API_KEY no hay interpretación/)).toBeInTheDocument()
  })
})
