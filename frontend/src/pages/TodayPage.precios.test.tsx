/**
 * Auditoría del 19 oct, hallazgo 1: los niveles se pintaban con dos decimales
 * fijos. Para una acción de céntimos, «Comprar entre 0,00–0,00» y «Vender si
 * baja a 0,00»: un stop a cero. Con la respuesta REAL de Hoy
 * (`hoy_completo.json`), cambiando solo una idea (HSY) a una de 0,003.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import hoyCompleto from '../test/fixtures/hoy_completo.json'
import { TodayPage } from './TodayPage'

type Rutas = Record<string, { status: number; json: unknown }>
type Idea = { symbol: string; decision: { levels: Record<string, number | null> }; price: { last: number } }

afterEach(() => vi.unstubAllGlobals())

describe('Hoy con una acción de céntimos', () => {
  it('los niveles conservan sus cifras: ni «0,00» de stop ni de zona de compra', async () => {
    const rutas = structuredClone((hoyCompleto as unknown as { rutas: Rutas }).rutas)
    for (const [url, r] of Object.entries(rutas)) {
      if (!url.startsWith('/api/signals/today')) continue
      const idea = (r.json as { shortlist: { ideas: Idea[] } }).shortlist.ideas.find((i) => i.symbol === 'HSY')!
      idea.price.last = 0.003
      Object.assign(idea.decision.levels, { entrada_desde: 0.00294, entrada_hasta: 0.00306, stop: 0.002616, objetivo: 0.003768 })
    }
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    render(<MemoryRouter><TodayPage /></MemoryRouter>)
    expect(await screen.findByText('0,00294–0,00306')).toBeInTheDocument()
    expect(screen.getByText('0,002616')).toBeInTheDocument()
    expect(screen.getByText('0,003')).toBeInTheDocument()
    expect(screen.queryByText('0,00–0,00')).toBeNull()
  })
})
