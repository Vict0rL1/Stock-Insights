/**
 * Mi cartera (fase 3, 3.1 y 3.2): Portafolio, Cartera, Tesis y Vigilancia en
 * una sección con tres sub-pestañas.
 *
 * - La pestaña va en la dirección (`?pestana=`); una desconocida abre
 *   Posiciones, no una página en blanco.
 * - La exposición por sector y la concentración salían dos veces (Portafolio y
 *   Cartera): una sola vez cada una, en Riesgo, y el aviso por peso no se pierde
 *   aunque el análisis no cargue.
 * - La línea de arriba cuenta lo que necesita atención, por símbolo y con el
 *   aviso de Explorar (el repaso del stop y la decisión de la lista), y, sin
 *   datos, dice que no se sabe: nunca «0».
 *
 * Parte de la respuesta REAL de la cartera de ACME (`empresa_completa.json`).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Decision, TodayResponse } from '../api/types'
import empresaCompleta from '../test/fixtures/empresa_completa.json'
import { posicionDelRepaso, repasoDe, senalDePosicion } from '../test/repaso'
import { MiCarteraPage, pestanaDe } from './MiCarteraPage'
import { recuentos } from './TodayPage'

type Rutas = Record<string, { status: number; json: unknown }>
type Fila = Record<string, unknown>
type Cartera = { positions: Fila[]; concentration_warnings: string[]; allocation_by_sector: Fila[]; repaso?: unknown }

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
/** El texto, con el espacio duro entre cifra y moneda como uno normal. */
const texto = (el: Element) => (el.textContent ?? '').replace(/\u00a0/g, ' ')

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
 *  lote de KO: tres posiciones, dos necesitan atención. La línea lee el repaso
 *  (por símbolo), así que se cambia también: es lo que sirve el backend. */
function conAvisos(cartera: Cartera) {
  const ko = cartera.positions[0]
  cartera.positions.push(
    { ...ko, id: 2, symbol: 'STOP', price: 104, stop: 110, stop_perforado: true, stop_estado: 'perforado' },
    { ...ko, id: 3, symbol: 'SHOP.TO', price: null, precio_estado: 'desconocido', stop: 100, stop_perforado: null,
      stop_estado: 'sin_comprobar', stop_motivo: 'sin precio (ninguna fuente dio su cotización)',
      market_value: null, unrealized_pnl: null, unrealized_pct: null },
    { ...ko, id: 4, quantity: 10 },
  )
  cartera.repaso = repasoDe([
    posicionDelRepaso({ symbol: 'KO', lotes: 2 }),
    posicionDelRepaso({ symbol: 'STOP', precio: 104, stop: 110, estado: 'perforado' }),
    posicionDelRepaso({ symbol: 'SHOP.TO', precio: null, stop: 100, estado: 'sin_comprobar',
      motivo: 'sin precio (ninguna fuente dio su cotización)', moneda: 'CAD' }),
  ])
}

describe('la línea de arriba', () => {
  it('cuenta posiciones por símbolo y nombra las que necesitan atención, en todas las pestañas', async () => {
    servir(rutasBase(conAvisos))
    const { unmount } = pintar()
    expect(await screen.findByText('3 posiciones abiertas · 2 necesitan atención')).toBeInTheDocument()
    const lista = resumen().parentElement!
    // El aviso de Explorar, con su verbo y su frase.
    expect(texto(lista)).toContain('VenderSTOPCotiza a 104,00 USD, por debajo de tu límite de pérdida (stop) de 110,00 USD. Tu regla dice vender.')
    expect(texto(lista)).toContain('RevisarSHOP.TONo hay precio de hoy: el límite de pérdida (stop) no se ha podido comprobar.')
    // Lo perforado, primero; y en rojo.
    const avisos = within(lista).getAllByRole('listitem')
    expect(avisos[0].textContent).toMatch(/^VenderSTOP/)
    expect(lista.className).toContain('bg-red-50')
    unmount()
    pintar('/cartera?pestana=tesis')
    expect(await screen.findByText('3 posiciones abiertas · 2 necesitan atención')).toBeInTheDocument()
  })

  it('con todo en orden lo dice, en singular', async () => {
    servir(rutasBase())
    pintar()
    expect(await screen.findByText('1 posición abierta · ninguna necesita atención')).toBeInTheDocument()
    // La respuesta real no trae lista guardada: se dice qué no se ha mirado.
    expect(resumen().parentElement!.textContent).toContain('Sin la lista del día guardada solo se ha mirado el límite de pérdida')
  })

  it('un precio viejo por encima del stop es «sin comprobar», en la línea y en la fila', async () => {
    // Fail-safe, como el repaso de Hoy (revisión 13): un precio rescatado de la
    // caché no dice que el precio de ahora siga por encima del stop.
    servir(rutasBase((c) => {
      const motivo = 'solo hay un precio viejo (la cotización, hace 1 h): estaba por encima del stop, pero no se puede afirmar que lo siga'
      // La fila, con la misma regla que el repaso (`stop_estado`, revisión 15).
      Object.assign(c.positions[0], { precio_estado: 'viejo', precio_antiguedad_segundos: 3600, stop_estado: 'sin_comprobar', stop_motivo: motivo })
      c.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', precio_estado: 'viejo', estado: 'sin_comprobar', motivo })])
    }))
    pintar()
    expect(await screen.findByText('1 posición abierta · 1 necesita atención')).toBeInTheDocument()
    expect(resumen().parentElement!.textContent).toContain('KOEl límite de pérdida (stop) no se ha podido comprobar: solo hay un precio viejo')
    const fila = screen.getAllByRole('row').find((r) => r.querySelector('a')?.textContent?.includes('KO'))!
    expect(fila.textContent).toContain('50,00sin comprobar')
  })

  it('sin repaso no cuenta «ninguna»: dice que ningún stop se ha comprobado', async () => {
    servir(rutasBase((c) => {
      c.repaso = { abiertas: null, en_lista: null, posiciones: [], senales: [], lista: null,
        error: 'No se pudo repasar el stop de tus posiciones: ninguna se ha comprobado (el motivo está en el log del backend).' }
    }))
    pintar()
    expect(await screen.findByText('1 posición abierta · no se sabe si alguna necesita atención')).toBeInTheDocument()
    expect(document.body.textContent).toContain('Ningún límite de pérdida se ha podido comprobar: No se pudo repasar')
    expect(document.body.textContent).not.toMatch(/ninguna necesita atención/)
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
      c.repaso = repasoDe([])
    }))
    pintar()
    expect(await screen.findByText('No tienes posiciones abiertas.')).toBeInTheDocument()
  })
})

describe('Mi cartera dice de cada posición lo mismo que Explorar (revisión 14)', () => {
  it('KO perforada por el último cierre de la lista con la cotización por encima: «Vender», en la línea y en la fila', async () => {
    // Stop 118, la lista cerró a 117 y la cotización es 120 (`test_estado_por_simbolo.py`):
    // Explorar decía «Para vender 1» y Mi cartera «ninguna necesita atención».
    servir(rutasBase((c) => {
      const cierre = { precio: 117, fuente: 'cierre_de_la_lista', estado: 'valido', proveedor: 'yfinance', fecha: '2026-09-11T20:00:00+00:00' }
      Object.assign(c.positions[0], { price: 120, stop: 118, stop_perforado: true, stop_perforado_por: cierre, stop_estado: 'perforado', stop_precio: cierre })
      c.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', en_lista: true, precio: 117, precio_fuente: 'cierre_de_la_lista',
        stop: 118, estado: 'perforado',
        precios: [{ precio: 120, fuente: 'cotizacion', estado: 'valido', proveedor: 'finnhub', fecha: '2026-09-12T14:35:00+00:00' },
          cierre as never] })], { senales: [senalDePosicion('KO', { action: 'mantener', label: 'Mantener' }, 117)] })
    }))
    pintar()
    expect(await screen.findByText('1 posición abierta · 1 necesita atención')).toBeInTheDocument()
    const linea = texto(resumen().parentElement!)
    expect(linea).toContain('VenderKO')
    expect(linea).toContain('La cotización de ahora (120,00 USD) está por encima: compruébalo en tu broker.')
    const fila = screen.getAllByRole('row').find((r) => r.querySelector('a')?.textContent?.includes('KO'))!
    // Con su fecha (revisión 15, cartera H4).
    expect(texto(fila)).toMatch(/118,00perforadoúltimo cierre de la lista: 117,00 · hace \d+ días · compruébalo en tu broker/)
  })

  it('una venta por puntuación con el stop intacto: «Vender», como el «Para vender» de Explorar', async () => {
    const vender: Partial<Decision> = { action: 'vender', label: 'Vender', reglas: [
      { id: 'puntuacion_desfavorable', regla: 'Puntuación ≤ -0,35', resultado: 'cumple', efecto: 'vender', papel: 'decide', datos: { valor: -0.6, umbral: -0.35 } },
    ] }
    const hoy = { signals: [senalDePosicion('KO', vender)], cartera: repasoDe([posicionDelRepaso({ symbol: 'KO', en_lista: true })]) }
    servir(rutasBase((c) => {
      c.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', en_lista: true })], { senales: hoy.signals })
    }))
    pintar()
    expect(await screen.findByText('1 posición abierta · 1 necesita atención')).toBeInTheDocument()
    expect(resumen().parentElement!.textContent).toContain('Su puntuación frente a sus comparables cayó a -0,60')
    // El mismo recuento que Explorar con la misma lista y el mismo repaso.
    expect(recuentos(hoy as unknown as TodayResponse).vender).toBe(1)
  })

  it('con dos lotes y uno sin stop, el motivo es del lote, no de la posición', async () => {
    servir(rutasBase((c) => {
      const ko = c.positions[0]
      c.positions.push({ ...ko, id: 2, quantity: 10, cost_basis: 0, stop: null, stop_perforado: null, stop_fijado_al_abrir: false })
      c.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', lotes: 2, lotes_sin_stop: 1, estado: 'sin_comprobar',
        motivo: '1 de sus 2 lotes sin stop (ni fijado al abrir ni coste con que calcularlo)' })])
    }))
    pintar()
    const linea = (await screen.findByText('1 posición abierta · 1 necesita atención')).parentElement!
    // Decía «KO: no tiene límite de pérdida…» con el stop de 50,00 de su otro lote justo debajo.
    expect(linea.textContent).toMatch(/1 de sus 2 lotes sin stop/)
  })

  it('de una lista caducada, la venta dice de cuándo es la lista', async () => {
    const vender: Partial<Decision> = { action: 'vender', label: 'Vender', reasons: ['La puntuación cayó.'] }
    servir(rutasBase((c) => {
      c.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', en_lista: true })], {
        senales: [senalDePosicion('KO', vender)],
        lista: { mercado: 'us_sp500', as_of: new Date(Date.now() - 30 * 3600 * 1000).toISOString(), estado: 'viejo', antiguedad_segundos: 30 * 3600 },
      })
    }))
    pintar()
    expect(await screen.findByText('1 posición abierta · 1 necesita atención')).toBeInTheDocument()
    expect(resumen().parentElement!.textContent).toContain('sale de la lista del día guardada hace 30 h, que ya caducó')
  })
})

describe('la línea y la fila, del mismo cálculo; la regla, solo de lo que ha mirado (revisión 15)', () => {
  it('sin cotización, el cierre de la lista prueba «por encima»: la fila lo dice, con su precio y su fecha (cartera H1)', async () => {
    // Lo que sirve el backend (`test_estado_por_simbolo.py`): la fila decía «sin
    // comprobar» (sin precio propio) bajo «ninguna necesita atención».
    const hace10h = new Date(Date.now() - 10 * 3600_000).toISOString()
    const cierre = { precio: 58, fuente: 'cierre_de_la_lista', estado: 'valido', proveedor: 'yfinance', fecha: hace10h }
    servir(rutasBase((c) => {
      Object.assign(c.positions[0], { price: null, precio_estado: 'desconocido', stop: 50, stop_perforado: null,
        stop_estado: 'por_encima', stop_motivo: null, stop_precio: cierre })
      c.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', en_lista: true, precio: 58, precio_fuente: 'cierre_de_la_lista',
        precio_fecha: hace10h, precios: [cierre as never] })],
      { senales: [senalDePosicion('KO', { action: 'mantener', label: 'Mantener' }, 58)] })
    }))
    pintar()
    expect(await screen.findByText('1 posición abierta · ninguna necesita atención')).toBeInTheDocument()
    const fila = screen.getAllByRole('row').find((r) => r.querySelector('a')?.textContent?.includes('KO'))!
    expect(texto(fila)).toContain('50,00por encima con el último cierre de la lista: 58,00 · hace 10 h')
    expect(texto(fila)).not.toContain('sin comprobar')
  })

  it('con la lista caducada, «ninguna necesita atención» dice de cuándo es la regla (costuras H2)', async () => {
    servir(rutasBase((c) => {
      c.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', en_lista: true })], {
        senales: [senalDePosicion('KO', { action: 'mantener', label: 'Mantener' })],
        lista: { mercado: 'us_sp500', as_of: new Date(Date.now() - 3 * 86400_000).toISOString(), estado: 'viejo', antiguedad_segundos: 3 * 86400 },
      })
    }))
    pintar('/cartera?pestana=tesis')
    expect(await screen.findByText('1 posición abierta · ninguna necesita atención')).toBeInTheDocument()
    expect(texto(resumen().parentElement!)).toContain(
      'Lo que dice la regla (vender, reducir o mantener) sale de la lista del día guardada hace 3 días, que ya caducó')
  })

  it('de una posición que la regla no decide, dice que solo se ha mirado su stop (cartera H2)', async () => {
    servir(rutasBase((c) => {
      c.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', en_lista: false })])
    }))
    pintar('/cartera?pestana=tesis')
    expect(await screen.findByText('1 posición abierta · ninguna necesita atención')).toBeInTheDocument()
    expect(texto(resumen().parentElement!)).toContain('De KO (no está en la lista del día) solo se ha mirado su límite de pérdida.')
  })
})
