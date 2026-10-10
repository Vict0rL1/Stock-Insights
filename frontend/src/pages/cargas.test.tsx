/**
 * Ítem 2.1, el resto de pantallas: un fallo de carga se dice como fallo, con su
 * motivo, y nunca como «no hay».
 *
 * - Vigilancia: si fallaba el recuento de posiciones sin tesis, su aviso
 *   desaparecía sin decir nada (falla abierto); decisiones y tesis enlazables,
 *   igual.
 * - Tesis: el registro de aciertos desaparecía.
 * - Resultados y Valoración: los atajos de la watchlist desaparecían.
 * - Barra de las API: si la primera consulta del uso fallaba, la barra entera
 *   desaparecía; y un fallo del estado de la IA no se distinguía de «sin IA».
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiUsageBar } from '../components/ApiUsageBar'
import { EarningsPage } from './EarningsPage'
import { ThesesPage } from './ThesesPage'
import { VigilanciaPage } from './VigilanciaPage'

afterEach(() => vi.unstubAllGlobals())

type Rutas = Record<string, { status: number; json: unknown }>
const falla = (motivo: string) => ({ status: 503, json: { detail: motivo } })

function servir(rutas: Rutas) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      const r = rutas[url]
      return new Response(JSON.stringify(r ? r.json : { detail: 'sin ruta en el test' }), { status: r ? r.status : 404 })
    }),
  )
}

const vigilanciaVacia = {
  tesis: [], total_saltan: 0, sin_disparadores: [], nota: 'Ningún punto de invalidación cruzado.', aviso_sin_disparadores: null,
}

describe('Vigilancia', () => {
  it('si no se pudo comprobar qué posiciones no tienen tesis, se dice en vez de callar el aviso', async () => {
    servir({
      '/api/theses/vigilancia': { status: 200, json: vigilanciaVacia },
      '/api/theses/sin-tesis': falla('la base no respondió'),
      '/api/theses/decisiones': falla('timeout'),
      '/api/theses': falla('timeout'),
      '/api/theses/vigilancia/metricas': { status: 200, json: { metricas: [], crecimientos: [], operadores: [], nota: '' } },
    })
    render(<MemoryRouter><VigilanciaPage /></MemoryRouter>)
    expect(await screen.findByText(/No se pudo cargar el recuento de posiciones sin tesis: la base no respondió/)).toBeInTheDocument()
    expect(await screen.findByText(/No se pudieron cargar las decisiones pasadas: timeout/)).toBeInTheDocument()
    expect(await screen.findByText(/No se pudieron cargar las tesis que se pueden enlazar: timeout/)).toBeInTheDocument()
  })
})

describe('Tesis', () => {
  it('un registro de aciertos que no carga se dice; no desaparece', async () => {
    servir({ '/api/theses': { status: 200, json: { theses: [] } }, '/api/theses/track-record': falla('sin precios') })
    render(<MemoryRouter><ThesesPage /></MemoryRouter>)
    expect(await screen.findByText(/No se pudo cargar el registro de aciertos: sin precios/)).toBeInTheDocument()
  })
})

describe('Atajos de la watchlist', () => {
  it('una watchlist que no carga se dice, con «Reintentar»', async () => {
    servir({ '/api/watchlist': falla('base ocupada') })
    render(<MemoryRouter><EarningsPage /></MemoryRouter>)
    expect(await screen.findByText(/No se pudieron cargar los atajos de tu watchlist: base ocupada/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})

describe('Barra de las API', () => {
  it('un uso que no se pudo consultar y una IA sin comprobar se dicen', async () => {
    servir({ '/api/meta/usage': falla('backend caído'), '/api/meta/llm': falla('backend caído') })
    render(<ApiUsageBar />)
    expect(await screen.findByText('uso desconocido: no se pudo consultar')).toBeInTheDocument()
    expect(await screen.findByText('IA sin comprobar')).toBeInTheDocument()
    expect(screen.queryByText(/IA off/)).not.toBeInTheDocument()
  })
})
