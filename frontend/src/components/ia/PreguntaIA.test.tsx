/**
 * «Pregúntale a la IA» (plan de navegación, fase D). Lo que se protege:
 *
 * - tocar una sugerencia rellena el campo y la envía, con el coste ya a la vista;
 * - la respuesta sale en el bloque de IA (etiqueta, modelo, aviso) y lo calculado
 *   que recibió va aparte, con su fecha;
 * - sin clave (o con el backend respondiendo 503), el bloque explica cómo añadirla
 *   en `.env` en vez de desaparecer, y no ofrece preguntar.
 *
 * Se simula `fetch`, no la API. El estado de la IA se comparte en el módulo `llm`:
 * cada test importa el componente de nuevo para no heredar el del anterior.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Respuesta = { status: number; json: unknown }
type Llamada = { url: string; metodo: string; cuerpo: unknown }

const ENCENDIDA: Respuesta = { status: 200, json: { configured: true, model: 'claude-sonnet-5-5' } }
const APAGADA: Respuesta = { status: 200, json: { configured: false, model: null } }

const LISTA = {
  clave: 'lista',
  titulo: 'Lista del día · EE. UU. — S&P 500',
  fuente: 'lista calculada por la app con sus reglas de decisión',
  fecha: '2026-11-24T14:30:00+00:00',
  estado: 'valido',
  antiguedad_segundos: null,
  nota: null,
}
const MERCADO_VIEJO = {
  clave: 'mercado',
  titulo: 'El mercado: índices',
  fuente: 'cotizaciones guardadas de los ETF que siguen a cada índice',
  fecha: '2026-11-23T21:00:00+00:00',
  estado: 'viejo',
  antiguedad_segundos: 32400,
  nota: 'Algunas cotizaciones son la última copia guardada (marcadas VIEJO).',
}
const COSTE: Respuesta = {
  status: 200,
  json: {
    coste: { tokens_entrada: 1234, usd_estimado: 0.0125, nota: '~1.234 tokens de entrada.' },
    datos_usados: [LISTA],
    datos_ausentes: [],
    max_caracteres: 500,
  },
}
const RESPUESTA: Respuesta = {
  status: 200,
  json: {
    generado_por: 'ia',
    pregunta: 'Resúmeme el día',
    content_md: '**Hoy** la lista tiene una idea de compra. La decisión es tuya.',
    model: 'claude-sonnet-5-5',
    cached: false,
    creado_en: '2026-11-24T15:00:00+00:00',
    coste: { tokens_entrada: 1000, tokens_salida: 200, usd: 0.004, nota: '1.000 tokens de entrada y 200 de salida.' },
    datos_usados: [LISTA, MERCADO_VIEJO],
    datos_ausentes: [{ clave: 'ficha', titulo: 'Ficha de ZZZ', motivo: 'No hay ninguna ficha calculada de ZZZ.' }],
    aviso: 'Respuesta generada por IA a partir de lo que la app ya había calculado.',
  },
}

function servir(llm: Respuesta, rutas: Record<string, Respuesta> = {}): Llamada[] {
  const llamadas: Llamada[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (e: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      llamadas.push({ url, metodo: init?.method ?? 'GET', cuerpo: init?.body ? JSON.parse(String(init.body)) : null })
      const r = url === '/api/meta/llm' ? llm : rutas[url]
      return new Response(JSON.stringify(r ? r.json : { detail: `sin fixture: ${url}` }), { status: r ? r.status : 404 })
    }),
  )
  return llamadas
}

async function montar(props: { mercado?: string; simbolo?: string } = {}) {
  const { PreguntaIA } = await import('./PreguntaIA')
  return render(<PreguntaIA {...props} />)
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('Pregúntale a la IA', () => {
  it('tocar una sugerencia rellena el campo y la envía, con el coste a la vista antes', async () => {
    const llamadas = servir(ENCENDIDA, { '/api/ia/preguntar/coste': COSTE, '/api/ia/preguntar': RESPUESTA })
    await montar({ mercado: 'canada' })

    // El coste, antes de tocar nada.
    expect(await screen.findByText(/coste estimado por pregunta 0,013 USD/)).toBeInTheDocument()
    expect(llamadas.some((l) => l.url === '/api/ia/preguntar')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Resúmeme el día' }))
    expect(screen.getByLabelText('Tu pregunta')).toHaveValue('Resúmeme el día')
    expect(await screen.findByText('Hoy')).toBeInTheDocument()

    const pregunta = llamadas.find((l) => l.url === '/api/ia/preguntar')
    expect(pregunta).toMatchObject({ metodo: 'POST', cuerpo: { pregunta: 'Resúmeme el día', mercado: 'canada' } })
  })

  it('la respuesta va etiquetada como IA, y lo calculado que recibió, aparte y con su fecha', async () => {
    servir(ENCENDIDA, { '/api/ia/preguntar/coste': COSTE, '/api/ia/preguntar': RESPUESTA })
    const { container } = await montar()
    await screen.findByText(/coste estimado por pregunta/)
    fireEvent.change(screen.getByLabelText('Tu pregunta'), { target: { value: 'Resúmeme el día' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preguntar' }))

    await screen.findByText('Hoy')
    const bloque = container.querySelector<HTMLElement>('[data-contenido="ia"]')
    expect(bloque).not.toBeNull()
    const ia = within(bloque as HTMLElement)
    expect(ia.getByText('Generado por IA')).toBeInTheDocument()
    expect(ia.getByText(/claude-sonnet-5-5 · coste 0,004 USD/)).toBeInTheDocument()
    expect(ia.getByText(/Respuesta generada por IA/)).toBeInTheDocument()
    // Anunciada a quien usa un lector de pantalla.
    expect(bloque?.closest('[aria-live="polite"]')).not.toBeNull()

    // Lo calculado, fuera del bloque violeta, con su fecha en la hora del mercado.
    const datos = screen.getByText(/Datos de la app que recibió la IA/).closest<HTMLElement>('[data-contenido="calculado"]')
    expect(datos).not.toBeNull()
    expect(bloque?.contains(datos)).toBe(false)
    const calculado = within(datos as HTMLElement)
    expect(calculado.getByText(/24 nov 2026, 09:30 ET/)).toBeInTheDocument()
    expect(calculado.getByText(/^Viejo, hace/)).toBeInTheDocument()
    expect(calculado.getByText(/No hay ninguna ficha calculada de ZZZ/)).toBeInTheDocument()
  })

  it('sin clave explica cómo añadirla en .env y no ofrece preguntar', async () => {
    const llamadas = servir(APAGADA)
    const { container } = await montar()
    expect(await screen.findByText(/La IA está apagada: falta la clave de Anthropic/)).toBeInTheDocument()
    expect(screen.getAllByText('.env').length).toBeGreaterThan(0)
    expect(screen.getByText('ANTHROPIC_API_KEY=')).toBeInTheDocument()
    expect(screen.getByText('./start.sh')).toBeInTheDocument()
    expect(screen.queryByLabelText('Tu pregunta')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Preguntar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Resúmeme el día' })).toBeNull()
    // Ni coste ni pregunta: sin clave no hay nada que pedir.
    expect(llamadas.filter((l) => l.metodo === 'POST')).toEqual([])
    expect(container.textContent).not.toMatch(/sk-ant/)
  })

  it('si el backend dice que no hay clave (503), también lo explica', async () => {
    servir(ENCENDIDA, {
      '/api/ia/preguntar/coste': { status: 503, json: { detail: 'Capa de IA no configurada: añade ANTHROPIC_API_KEY en .env' } },
    })
    await montar()
    expect(await screen.findByText(/La IA está apagada: falta la clave de Anthropic/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Tu pregunta')).toBeNull()
  })

  it('una pregunta demasiado larga no se envía y se dice por qué', async () => {
    const llamadas = servir(ENCENDIDA, { '/api/ia/preguntar/coste': COSTE, '/api/ia/preguntar': RESPUESTA })
    await montar()
    await screen.findByText(/coste estimado por pregunta/)
    fireEvent.change(screen.getByLabelText('Tu pregunta'), { target: { value: 'a'.repeat(501) } })
    expect(screen.getByText(/501 de 500 caracteres: acórtala/)).toBeInTheDocument()
    const boton = screen.getByRole('button', { name: 'Preguntar' })
    expect(boton).toBeDisabled()
    fireEvent.submit(boton.closest('form') as HTMLFormElement)
    await waitFor(() => expect(llamadas.some((l) => l.url === '/api/ia/preguntar')).toBe(false))
  })

  it('un fallo del modelo se enseña con su motivo, sin borrar el resto', async () => {
    servir(ENCENDIDA, {
      '/api/ia/preguntar/coste': COSTE,
      '/api/ia/preguntar': { status: 502, json: { detail: 'Límite de uso del API de Claude alcanzado; reintenta en unos minutos' } },
    })
    await montar()
    await screen.findByText(/coste estimado por pregunta/)
    fireEvent.click(screen.getByRole('button', { name: '¿Qué ETF sirve para empezar?' }))
    expect(await screen.findByText(/No se pudo preguntar a la IA: Límite de uso del API de Claude/)).toBeInTheDocument()
    expect(screen.getByLabelText('Tu pregunta')).toHaveValue('¿Qué ETF sirve para empezar?')
  })
})
