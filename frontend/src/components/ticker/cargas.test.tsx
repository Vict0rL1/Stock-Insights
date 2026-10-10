/**
 * Ítem 2.1: cada sección de la ficha dice su fallo de carga con su motivo y una
 * forma de reintentarlo. Antes cada una lo pintaba a su manera: un mensaje
 * suelto sin decir qué no había cargado, «No hay datos para prellenar el DCF»
 * (un fallo contado como falta de datos) o nada.
 *
 * Y el fallo de una acción (resumir con IA, redactar el informe, abrir un
 * replay) es de esa acción: antes sustituía la sección entera y lo ya cargado
 * desaparecía de la pantalla.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { CalidadSection } from './CalidadSection'
import { DeepDiveSection } from './DeepDiveSection'
import { ExpectativasSection } from './ExpectativasSection'
import { FilingsSection } from './FilingsSection'
import { FinancialsSection } from './FinancialsSection'
import { HealthSection } from './HealthSection'
import { HistorialSection } from './HistorialSection'
import { OptionsSection } from './OptionsSection'
import { QueCambioSection } from './QueCambioSection'
import { ValuationSection } from './ValuationSection'

type Rutas = Record<string, { status: number; json: unknown }>
const ACME = (empresaCompleta as { rutas: Rutas }).rutas

afterEach(() => vi.unstubAllGlobals())

/** Responde con `rutas` y, lo que no esté, con un 503. La IA, siempre
 *  configurada: `useLlmStatus` guarda la primera respuesta buena para todo el
 *  fichero, y el botón de la narrativa solo sale con ella. */
function servir(rutas: Rutas) {
  const todas: Rutas = { ...rutas, '/api/meta/llm': { status: 200, json: { configured: true, model: 'modelo-de-prueba' } } }
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = todas[url]
    return new Response(JSON.stringify(r ? r.json : { detail: 'sin datos en el test' }), { status: r ? r.status : 503 })
  }))
}

const pintar = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('fallo de carga de cada sección de la ficha', () => {
  const casos: [string, ReactElement, string][] = [
    ['Calidad', <CalidadSection symbol="ACME" />, 'No se pudo cargar la calidad de beneficios: sin datos en el test'],
    ['Qué cambió', <QueCambioSection symbol="ACME" />, 'No se pudo cargar el análisis de ACME: sin datos en el test'],
    ['Informe', <DeepDiveSection symbol="ACME" />, 'No se pudo cargar el informe: sin datos en el test'],
    ['Historial', <HistorialSection symbol="ACME" />, 'No se pudo cargar el historial de decisiones: sin datos en el test'],
    ['Opciones', <OptionsSection symbol="ACME" />, 'No se pudo cargar la cadena de opciones: sin datos en el test'],
    // Antes: «No hay datos para prellenar el DCF: …», un fallo contado como falta de datos.
    ['Valoración', <ValuationSection symbol="ACME" />, 'No se pudieron cargar los valores de partida del DCF: sin datos en el test'],
    ['Expectativas', <ExpectativasSection symbol="ACME" />, 'No se pudieron cargar los eventos: sin datos en el test'],
  ]
  for (const [sitio, ui, frase] of casos) {
    it(`${sitio}: dice qué no cargó, por qué, y ofrece reintentar`, async () => {
      servir({})
      pintar(ui)
      expect(await screen.findByText(frase)).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Reintentar' }).length).toBeGreaterThan(0)
      expect(document.body.textContent).not.toMatch(/No hay datos/)
    })
  }

  it('«Reintentar» vuelve a pedir y, si ahora llega, enseña la sección', async () => {
    servir({})
    pintar(<CalidadSection symbol="ACME" />)
    const reintentar = await screen.findByRole('button', { name: 'Reintentar' })
    servir(ACME)
    fireEvent.click(reintentar)
    expect(await screen.findByText(/^Calidad de beneficios \(2025\)/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('un 404 es que la fuente no lo tiene, no un fallo (revisión del 2.1)', () => {
  /** Todo responde 404 con el motivo de la fuente, como `DataNotFoundError`. */
  function noLoTiene() {
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      if (url === '/api/meta/llm') return new Response(JSON.stringify({ configured: true, model: 'm' }), { status: 200 })
      return new Response(JSON.stringify({ detail: 'SHOP.TO no está registrado en la SEC' }), { status: 404 })
    }))
  }
  const casos: [string, ReactElement, string[]][] = [
    ['Fundamentales', <FinancialsSection symbol="SHOP.TO" />, [
      'Sin estados financieros: SHOP.TO no está registrado en la SEC',
      'Sin pares con los que comparar: SHOP.TO no está registrado en la SEC',
    ]],
    ['Salud', <HealthSection symbol="SHOP.TO" />, ['Sin datos de salud financiera: SHOP.TO no está registrado en la SEC']],
    ['Valoración', <ValuationSection symbol="SHOP.TO" />, ['No hay datos para prellenar el DCF: SHOP.TO no está registrado en la SEC']],
    ['Filings', <FilingsSection symbol="SHOP.TO" />, ['Sin filings: SHOP.TO no está registrado en la SEC']],
    ['Opciones', <OptionsSection symbol="SHOP.TO" />, ['SHOP.TO no está registrado en la SEC']],
  ]
  for (const [sitio, ui, frases] of casos) {
    it(`${sitio}: lo dice como ausencia, con el motivo de la fuente y sin «Reintentar»`, async () => {
      noLoTiene()
      pintar(ui)
      for (const frase of frases) expect(await screen.findByText(frase)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
      expect(document.body.textContent).not.toMatch(/No se pud/)
    })
  }

  it('Informe: su 404 también llega cuando EDGAR cae, así que sigue siendo un fallo con «Reintentar»', async () => {
    noLoTiene()
    pintar(<DeepDiveSection symbol="SHOP.TO" />)
    expect(await screen.findByText('No se pudo cargar el informe: SHOP.TO no está registrado en la SEC')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})

describe('el fallo de una acción no borra lo cargado', () => {
  it('Informe: la narrativa por IA que falla se dice junto al botón y el informe sigue', async () => {
    servir(ACME)
    pintar(<DeepDiveSection symbol="ACME" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Redactar informe (IA)' }))
    expect(await screen.findByText('No se pudo redactar el informe: sin datos en el test')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Lectura conjunta/ })).toBeInTheDocument()
  })

  it('Qué cambió: el resumen por IA que falla se dice junto al botón y el análisis sigue', async () => {
    servir(ACME)
    pintar(<QueCambioSection symbol="ACME" />)
    fireEvent.click(await screen.findByRole('button', { name: /Resumir este diff con IA/ }))
    expect(await screen.findByText('No se pudo resumir con IA: sin datos en el test')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Decisión del motor/ })).toBeInTheDocument()
  })

  it('Historial: un replay que falla se dice y la tabla de decisiones sigue', async () => {
    servir({ ...ACME, '/api/snapshots/2/replay': { status: 503, json: { detail: 'sin datos en el test' } } })
    pintar(<HistorialSection symbol="ACME" />)
    const botones = await screen.findAllByRole('button', { name: 'Replay' })
    fireEvent.click(botones[0])
    expect(await screen.findByText('No se pudo cargar el replay: sin datos en el test')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Replay' })).toHaveLength(botones.length)
  })
})

describe('calidad de beneficios desconocida', () => {
  it('dice por qué, y sin un ejercicio que no hay', async () => {
    servir({
      '/api/empresa/ACME/calidad': {
        status: 200,
        json: { symbol: 'ACME', estado: 'desconocido', global: 'desconocido', evidencias: [], motivo: 'sin estados financieros', huella: null },
      },
    })
    pintar(<CalidadSection symbol="ACME" />)
    expect(await screen.findByText('Calidad de beneficios: DESCONOCIDA')).toBeInTheDocument()
    expect(screen.getByText('sin estados financieros')).toBeInTheDocument()
  })
})

describe('Qué cambió: lo que no se pudo comprobar se dice como tal (revisión de M1)', () => {
  it('un punto que deja de medirse lleva su motivo, y el estado de la tesis sale con etiqueta', async () => {
    const rutas: Rutas = structuredClone(ACME)
    const r = rutas['/api/empresa/ACME/analisis'].json as {
      cambios: { tesis: { nuevos_riesgos: unknown[] }; categorias: Record<string, unknown[]> }
    }
    r.cambios.tesis.nuevos_riesgos = [
      { punto: 'Si hay un recall', motivo: 'ya no se puede medir (Las noticias no se pudieron descargar): deja de vigilar' },
    ]
    r.cambios.categorias.tesis = [
      { clave: 'tesis_estado', etiqueta: 'Estado de la tesis', antes: 'intacta', ahora: 'sin_comprobar', tipo: 'material' },
    ]
    servir(rutas)
    pintar(<QueCambioSection symbol="ACME" />)
    expect(await screen.findByText(/Nuevos riesgos: Si hay un recall \(ya no se puede medir \(Las noticias no se pudieron descargar\)/)).toBeInTheDocument()
    expect(screen.getByText(/intacta → sin comprobar/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/sin_comprobar/)
  })
})
