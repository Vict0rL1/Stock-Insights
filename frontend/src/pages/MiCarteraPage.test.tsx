/**
 * Mi cartera (fase 3, 3.1 y 3.2): Portafolio, Cartera, Tesis y Vigilancia en
 * una sección con tres sub-pestañas.
 *
 * - La pestaña va en la dirección (`?pestana=`); una desconocida abre
 *   Posiciones, no una página en blanco.
 * - La exposición por sector y la concentración salían dos veces (Portafolio y
 *   Cartera): una sola vez cada una, en Riesgo, y el aviso por peso no se pierde
 *   aunque el análisis no cargue.
 * - La línea de arriba cuenta lo que necesita atención (límite de pérdida
 *   perforado o sin comprobar) y, sin datos, dice que no se sabe: nunca «0».
 *
 * Parte de la respuesta REAL de la cartera de ACME (`empresa_completa.json`).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../test/fixtures/empresa_completa.json'
import { MiCarteraPage, pestanaDe } from './MiCarteraPage'

type Rutas = Record<string, { status: number; json: unknown }>
type Fila = Record<string, unknown>
type Cartera = { positions: Fila[]; concentration_warnings: string[]; allocation_by_sector: Fila[] }

vi.mock('../components/PriceChart', () => ({ PriceChart: () => null }))

const RIESGO = '/api/portfolio/riesgo?descargar=false'

/** Un análisis con exposición y concentración real, como el de `/riesgo`. */
const ANALISIS = {
  disponible: true,
  sin_precio: [],
  sin_convertir: [],
  sin_historico: {},
  concentracion: { disponible: true, nota: 'Con 250 sesiones.', posiciones: 1, apuestas_efectivas: 1, primera_componente_pct: 100 },
  exposicion: {
    sector: { filas: [{ etiqueta: 'Consumer Staples', peso_pct: 100 }], desconocido_pct: 0, concentracion_mayor_pct: 100, nota: '' },
    geografia: { filas: [{ etiqueta: 'Estados Unidos', peso_pct: 100 }], desconocido_pct: 0, concentracion_mayor_pct: 100, nota: '' },
  },
  nota_geografia: 'La geografía es el país de domicilio.',
}

function rutasBase(cambiar: (cartera: Cartera, rutas: Rutas) => void = () => {}): Rutas {
  const rutas: Rutas = structuredClone((empresaCompleta as { rutas: Rutas }).rutas)
  rutas['/api/portfolio/alerts'] = { status: 200, json: { alerts: [], vigilancia: null } }
  rutas[RIESGO] = { status: 200, json: ANALISIS }
  cambiar(rutas['/api/portfolio'].json as Cartera, rutas)
  return rutas
}

function servir(rutas: Rutas | 'pendiente') {
  vi.stubGlobal('fetch', vi.fn((e: RequestInfo | URL) => {
    if (rutas === 'pendiente') return new Promise<Response>(() => {})
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return Promise.resolve(new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 }))
  }))
}

/** La dirección de ahora, para ver adónde lleva un clic. */
function Direccion() {
  const { search } = useLocation()
  return <output aria-label="dirección">{search}</output>
}

const pintar = (ruta = '/cartera') =>
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/cartera" element={<><MiCarteraPage /><Direccion /></>} />
      </Routes>
    </MemoryRouter>,
  )

const pestana = (nombre: string) => screen.getByRole('link', { name: nombre })
const resumen = () => screen.getByText(/posici(ón|ones) abiertas? ·/)

afterEach(() => vi.unstubAllGlobals())

describe('las sub-pestañas, por la dirección', () => {
  it('sin parámetro abre Posiciones', async () => {
    servir(rutasBase())
    pintar()
    expect(await screen.findByRole('heading', { name: 'Anotar una compra' })).toBeInTheDocument()
    expect(pestana('Posiciones').getAttribute('aria-current')).toBe('page')
    expect(pestana('Riesgo').getAttribute('aria-current')).toBeNull()
  })

  it('?pestana=riesgo abre Riesgo y ?pestana=tesis, Tesis y vigilancia', async () => {
    servir(rutasBase())
    const { unmount } = pintar('/cartera?pestana=riesgo')
    expect(await screen.findByRole('heading', { name: 'Riesgo abierto' })).toBeInTheDocument()
    expect(pestana('Riesgo').getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('heading', { name: 'Anotar una compra' })).toBeNull()
    unmount()
    pintar('/cartera?pestana=tesis')
    expect(await screen.findByRole('heading', { name: 'Mis tesis' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Puntos de vigilancia' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Diario de decisiones' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lista de seguimiento' })).toBeInTheDocument()
    expect(pestana('Tesis y vigilancia').getAttribute('aria-current')).toBe('page')
  })

  it('una pestaña desconocida abre Posiciones, no una página en blanco', async () => {
    servir(rutasBase())
    pintar('/cartera?pestana=portafolio')
    expect(await screen.findByRole('heading', { name: 'Anotar una compra' })).toBeInTheDocument()
    expect(pestana('Posiciones').getAttribute('aria-current')).toBe('page')
    expect(pestanaDe('vigilancia')).toBe('posiciones')
    expect(pestanaDe(null)).toBe('posiciones')
  })

  it('pulsar una pestaña cambia la dirección y lo que se ve', async () => {
    servir(rutasBase())
    pintar()
    await screen.findByRole('heading', { name: 'Anotar una compra' })
    fireEvent.click(pestana('Riesgo'))
    expect(await screen.findByRole('heading', { name: 'Riesgo abierto' })).toBeInTheDocument()
    expect(screen.getByLabelText('dirección').textContent).toBe('?pestana=riesgo')
  })

  it('las tres pestañas van en una fila: ni se parten ni bajan de línea', async () => {
    // A 390 px caben; lo que no debe pasar es que una etiqueta se parta en dos
    // líneas o que la tercera baje (las capturas lo miden de verdad).
    servir(rutasBase())
    pintar()
    const nav = screen.getByRole('navigation', { name: 'Secciones de Mi cartera' })
    expect(nav.className).not.toMatch(/(^|\s)flex-wrap(\s|$)/)
    for (const enlace of within(nav).getAllByRole('link')) expect(enlace.className).toMatch(/(^|\s)whitespace-nowrap(\s|$)/)
  })
})

describe('un solo bloque de exposición y uno de concentración', () => {
  it('en Riesgo sale una vez cada uno, y en Posiciones ninguno', async () => {
    // La cartera trae su exposición por sector y su aviso de concentración por
    // peso, y el análisis, los suyos: antes salían los dos de cada.
    servir(rutasBase())
    const { unmount } = pintar('/cartera?pestana=riesgo')
    expect(await screen.findByText('Apuestas independientes')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: /exposición/i })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: /concentración/i })).toHaveLength(1)
    // El aviso por peso, dentro del bloque de concentración y no suelto.
    const bloque = screen.getByRole('heading', { name: /concentración/i }).closest('section')!
    expect(within(bloque).getByText(/^KO representa el 100,0.% de la cartera$/)).toBeInTheDocument()
    expect(screen.getAllByText(/KO representa el/)).toHaveLength(1)
    unmount()
    pintar()
    await screen.findByRole('heading', { name: 'Posiciones abiertas' })
    expect(screen.queryByRole('heading', { name: /exposición|concentración/i })).toBeNull()
    expect(screen.queryByText(/KO representa el/)).toBeNull()
  })

  it('si el análisis no carga, el aviso de concentración por peso sigue ahí', async () => {
    // Ante la duda, avisar: la concentración real necesita histórico, el peso no.
    servir(rutasBase((_, rutas) => {
      rutas[RIESGO] = { status: 503, json: { detail: 'no hay precios en caché' } }
    }))
    pintar('/cartera?pestana=riesgo')
    expect(await screen.findByText('No se pudo cargar el análisis de la cartera: no hay precios en caché')).toBeInTheDocument()
    const bloque = screen.getByRole('heading', { name: 'Concentración' }).closest('section')!
    expect(within(bloque).getByText(/^KO representa el 100,0.% de la cartera$/)).toBeInTheDocument()
    expect(screen.queryByText('Apuestas independientes')).toBeNull()
  })
})

/** KO en orden, STOP con el stop perforado, SHOP.TO sin precio y un segundo
 *  lote de KO: tres posiciones, dos necesitan atención. */
function conAvisos(cartera: Cartera) {
  const ko = cartera.positions[0]
  cartera.positions.push(
    { ...ko, id: 2, symbol: 'STOP', price: 104, stop: 110, stop_perforado: true },
    { ...ko, id: 3, symbol: 'SHOP.TO', price: null, precio_estado: 'desconocido', stop: 100, stop_perforado: null,
      market_value: null, unrealized_pnl: null, unrealized_pct: null },
    { ...ko, id: 4, quantity: 10 },
  )
}

describe('la línea de arriba', () => {
  it('cuenta posiciones por símbolo y nombra las que necesitan atención, en todas las pestañas', async () => {
    servir(rutasBase(conAvisos))
    const { unmount } = pintar()
    expect(await screen.findByText('3 posiciones abiertas · 2 necesitan atención')).toBeInTheDocument()
    const lista = resumen().parentElement!
    expect(lista.textContent).toContain('STOP: el precio ha llegado a su límite de pérdida (stop).')
    expect(lista.textContent).toContain('SHOP.TO: no hay precio con que comparar su límite de pérdida.')
    // Lo perforado, primero; y en rojo.
    expect(within(lista).getAllByRole('listitem')[0].textContent).toMatch(/^STOP/)
    expect(within(lista).getAllByRole('listitem')[0].className).toContain('text-red-800')
    unmount()
    pintar('/cartera?pestana=tesis')
    expect(await screen.findByText('3 posiciones abiertas · 2 necesitan atención')).toBeInTheDocument()
  })

  it('con todo en orden lo dice, en singular', async () => {
    servir(rutasBase())
    pintar()
    expect(await screen.findByText('1 posición abierta · ninguna necesita atención')).toBeInTheDocument()
  })

  it('un precio viejo por encima del stop es «sin comprobar», en la línea y en la fila', async () => {
    // Fail-safe, como el repaso de Hoy (revisión 13): un precio rescatado de la
    // caché no dice que el precio de ahora siga por encima del stop.
    servir(rutasBase((c) => Object.assign(c.positions[0], { precio_estado: 'viejo', precio_antiguedad_segundos: 3600 })))
    pintar()
    expect(await screen.findByText('1 posición abierta · 1 necesita atención')).toBeInTheDocument()
    expect(resumen().parentElement!.textContent).toContain('KO: solo hay un precio viejo')
    const fila = screen.getAllByRole('row').find((r) => r.querySelector('a')?.textContent?.includes('KO'))!
    expect(fila.textContent).toContain('50,00sin comprobar')
  })

  it('sin datos de la cartera no cuenta cero: dice que no se sabe, con el motivo', async () => {
    servir(rutasBase((_, rutas) => {
      rutas['/api/portfolio'] = { status: 503, json: { detail: 'tiempo de espera agotado' } }
    }))
    pintar('/cartera?pestana=tesis')
    expect(await screen.findByText('No se pudo cargar la cartera: tiempo de espera agotado')).toBeInTheDocument()
    expect(screen.getByText('No se sabe cuántas posiciones tienes ni si alguna necesita atención.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/0 posiciones|ninguna necesita atención|No tienes posiciones/)
  })

  it('sin datos, en Riesgo el riesgo abierto dice por qué no está', async () => {
    servir(rutasBase((_, rutas) => {
      rutas['/api/portfolio'] = { status: 503, json: { detail: 'tiempo de espera agotado' } }
    }))
    pintar('/cartera?pestana=riesgo')
    expect(await screen.findByText(/Sin la cartera no se puede sumar el riesgo abierto/)).toBeInTheDocument()
    // El fallo se dice una vez, arriba, con su «Reintentar».
    expect(screen.getAllByText(/No se pudo cargar la cartera/)).toHaveLength(1)
  })

  it('mientras carga lo dice, y sin posiciones lo dice como vacío, no como fallo', async () => {
    servir('pendiente')
    const { unmount } = pintar()
    expect(screen.getByText('Cargando tu cartera…')).toBeInTheDocument()
    unmount()
    servir(rutasBase((c) => {
      c.positions = []
    }))
    pintar()
    expect(await screen.findByText('No tienes posiciones abiertas.')).toBeInTheDocument()
  })
})
