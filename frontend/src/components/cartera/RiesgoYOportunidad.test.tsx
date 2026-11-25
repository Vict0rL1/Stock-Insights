/**
 * Ítem 2.1 en los paneles de riesgo y de efectivo de Mi cartera (el efectivo
 * iba dentro del coste de oportunidad; hoy es su propio panel, en Posiciones):
 *
 * - El efectivo que no se pudo leer decía «ninguno — el motor lo trata como
 *   DESCONOCIDO»: se confundía con no haberlo anotado. Son cosas distintas.
 * - La contribución al riesgo que no carga dice qué no cargó; antes era un
 *   motivo suelto, y un error de la descarga se quedaba encima de la tabla.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { ContribucionAlRiesgoPanel, EfectivoPanel } from './RiesgoYOportunidad'

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
    render(<EfectivoPanel />)
    expect(
      await screen.findByText('No se pudo cargar el efectivo anotado: la base de datos está bloqueada'),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ninguno/)
  })

  // Guarda de no regresión (pasa también con el código anterior): el arreglo
  // del fallo no puede convertir un «ninguno» de verdad en un error.
  it('si se leyó y no hay ninguno, sí lo dice', async () => {
    servir({ ...base, '/api/portfolio/efectivo': { status: 200, json: { saldos: [], nota: null } } })
    render(<EfectivoPanel />)
    expect(
      await screen.findByText('ninguno — el motor lo trata como DESCONOCIDO, no como cero'),
    ).toBeInTheDocument()
  })

  // Guarda de no regresión (pasa también con el código anterior).
  it('el anotado se enseña con su moneda', async () => {
    servir(base)
    render(<EfectivoPanel />)
    expect(await screen.findByText(/Efectivo anotado: 1\.500,00 USD/)).toBeInTheDocument()
  })
})

describe('anotar efectivo (segunda revisión del 2.1)', () => {
  it('lo anotado antes sigue a la vista mientras recarga', async () => {
    // Volver a `reintentar` aquí no lo cazaba ningún test.
    let recargando = false
    const pedidas: string[] = []
    vi.stubGlobal('fetch', vi.fn((e: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      pedidas.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'POST') {
        recargando = true
        return Promise.resolve(new Response(JSON.stringify({ id: 9 }), { status: 200 }))
      }
      if (recargando && url === '/api/portfolio/efectivo') return new Promise<Response>(() => {})
      const r = base[url]
      return Promise.resolve(new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 }))
    }))
    render(<EfectivoPanel />)
    expect(await screen.findByText(/Efectivo anotado: 1\.500,00 USD/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Efectivo disponible'), { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anotar efectivo' }))
    await waitFor(() => expect(pedidas.filter((p) => p === 'GET /api/portfolio/efectivo')).toHaveLength(2))
    expect(screen.getByText(/Efectivo anotado: 1\.500,00 USD/)).toBeInTheDocument()
    expect(screen.getByText('Actualizando el efectivo anotado…')).toBeInTheDocument()
  })
})

describe('efectivo escrito a mano (tercera pasada de la revisión del 2.1)', () => {
  it('«10.000» se anota como diez mil, no como diez', async () => {
    const cuerpos: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      if (init?.method === 'POST') {
        cuerpos.push(JSON.parse(String(init.body)))
        return new Response(JSON.stringify({ id: 9 }), { status: 200 })
      }
      const r = base[url]
      return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
    }))
    render(<EfectivoPanel />)
    await screen.findByText(/Efectivo anotado/)
    fireEvent.change(screen.getByPlaceholderText('Efectivo disponible'), { target: { value: '10.000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Anotar efectivo' }))
    await waitFor(() => expect(cuerpos).toHaveLength(1))
    expect(cuerpos[0]).toMatchObject({ importe: 10000 })
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

  it('el botón vuelve a pedirla, ya descargando, sin quitar la tabla mientras tanto', async () => {
    // Revisión del 2.1: con una clave nueva por pulsación, el panel entero
    // decía «Cargando…» durante una descarga que puede durar minutos.
    let soltar: (r: Response) => void = () => {}
    const fetchFalso = vi.fn((e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      if (url === '/api/portfolio/contribucion?descargar=true') return new Promise<Response>((r) => (soltar = r))
      const r = base[url]
      return Promise.resolve(new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 }))
    })
    vi.stubGlobal('fetch', fetchFalso)
    render(<ContribucionAlRiesgoPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar histórico y recalcular' }))
    await waitFor(() =>
      expect(fetchFalso.mock.calls.map(([u]) => String(u))).toContain('/api/portfolio/contribucion?descargar=true'),
    )
    expect(screen.getByRole('button', { name: 'Descargando…' })).toBeDisabled()
    expect(screen.getByText(/Volatilidad anual medida/)).toBeInTheDocument()
    expect(screen.queryByText(/^Cargando/)).toBeNull()
    soltar(new Response(JSON.stringify(base['/api/portfolio/contribucion?descargar=false'].json), { status: 200 }))
    expect(await screen.findByRole('button', { name: 'Descargar histórico y recalcular' })).toBeInTheDocument()
  })

  it('la dimensión de cada clúster se escribe con su etiqueta, no con el código', async () => {
    // Salía «correlacion» sin tilde (el código del backend), e «industria» no tenía etiqueta (revisión 14).
    servir({ '/api/portfolio/contribucion?descargar=false': { status: 200, json: {
      disponible: true, posiciones: [], desconocidas: [], metodo: 'm', nota: 'n',
      clusters: [
        { dimension: 'correlacion', etiqueta: 'Se mueven juntas #1', miembros: ['AAA', 'BBB'], peso: 0.5, contribucion: 0.6, desconocidos: [] },
        { dimension: 'industria', etiqueta: 'Bebidas', miembros: ['KO', 'PEP'], peso: 0.3, contribucion: 0.2, desconocidos: [] },
      ] } } })
    render(<ContribucionAlRiesgoPanel />)
    await screen.findByText(/Se mueven juntas #1/)
    expect(screen.queryByText('correlacion')).toBeNull()
    expect(screen.getByText('correlación')).toBeInTheDocument()
    expect(screen.getByText('industria')).toBeInTheDocument()
  })

  it('con la cartera vacía no ofrece descargar el histórico de nada', async () => {
    // Revisión 12, visual: sin ninguna posición se ofrecía «Descargar histórico y
    // recalcular». Con posiciones sin precio sí sale: reintentar puede traerlo.
    const vacia = { disponible: false, sin_posiciones: true, posiciones: [], desconocidas: [],
      nota: 'No hay posiciones abiertas cuyo riesgo descomponer.' }
    servir({ ...base, '/api/portfolio/contribucion?descargar=false': { status: 200, json: vacia } })
    render(<ContribucionAlRiesgoPanel />)
    expect(await screen.findByText('No hay posiciones abiertas cuyo riesgo descomponer.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Descargar histórico y recalcular' })).toBeNull()
  })
})
