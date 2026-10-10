/**
 * Ítem 2.1 en la pantalla de Cartera:
 *
 * - El análisis que no carga dice qué no cargó y se puede reintentar; antes era
 *   un motivo suelto en rojo.
 * - Sin el recuento de posiciones, `?? 0` pintaba «Posiciones 0» y unas
 *   apuestas en verde que no se habían comparado con nada.
 * - Una crisis sin retorno, `?? 0`, salía «+0,0 %» en verde: en 2008.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../test/fixtures/empresa_completa.json'
import { CarteraPage } from './CarteraPage'

type Rutas = Record<string, { status: number; json: unknown }>

const base = (empresaCompleta as { rutas: Rutas }).rutas
const RIESGO = '/api/portfolio/riesgo?descargar=false'

function servir(riesgo: { status: number; json: unknown }) {
  const rutas: Rutas = { ...base, [RIESGO]: riesgo, '/api/portfolio/riesgo?descargar=true': riesgo }
  const fetchFalso = vi.fn(async (e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    const r = rutas[url]
    return new Response(JSON.stringify(r ? r.json : {}), { status: r ? r.status : 404 })
  })
  vi.stubGlobal('fetch', fetchFalso)
  return fetchFalso
}

const pintar = () => render(<MemoryRouter><CarteraPage /></MemoryRouter>)

afterEach(() => vi.unstubAllGlobals())

describe('pantalla de Cartera (ítem 2.1)', () => {
  it('si el análisis no carga, dice qué no cargó, con su motivo', async () => {
    servir({ status: 503, json: { detail: 'no hay precios en caché' } })
    pintar()
    expect(
      await screen.findByText('No se pudo cargar el análisis de la cartera: no hay precios en caché'),
    ).toBeInTheDocument()
  })

  it('sin el recuento de posiciones, «—» y sin veredicto de color', async () => {
    servir({
      status: 200,
      json: {
        disponible: true,
        concentracion: { disponible: true, nota: 'Con 250 sesiones.', apuestas_efectivas: 2.4, primera_componente_pct: 55 },
      },
    })
    pintar()
    const posiciones = (await screen.findByText('Posiciones')).nextElementSibling!
    expect(posiciones.textContent).toBe('—')
    const apuestas = screen.getByText('Apuestas independientes').nextElementSibling!
    expect(apuestas.textContent).toBe('2,4')
    expect(apuestas.className).not.toMatch(/emerald|red/)
  })

  it('una crisis sin retorno sale «—» en neutro, no «+0,0 %» en verde', async () => {
    servir({
      status: 200,
      json: {
        disponible: true,
        estres: {
          aviso_general: 'Pesos de hoy aplicados al pasado.',
          crisis: [
            {
              clave: 'gfc', nombre: 'Crisis financiera', desde: '2007-10-09', hasta: '2009-03-09',
              caida_sp500_pct: -56.8, contexto: 'Quiebra de Lehman.', medible: true, nota: 'Cubre lo que hay.',
              cobertura_pct: 80, sin_datos: [], titular_fiable: true, max_drawdown_pct: -40,
            },
          ],
        },
      },
    })
    pintar()
    const retorno = (await screen.findByText('Esta mezcla')).nextElementSibling!
    expect(retorno.textContent).toBe('—')
    expect(retorno.className).not.toMatch(/emerald|red/)
    expect(document.body.textContent).not.toContain('+0,0')
  })

  it('el botón vuelve a pedir el análisis, ya descargando', async () => {
    const fetchFalso = servir({ status: 200, json: { disponible: false, nota: 'Sin posiciones abiertas.' } })
    pintar()
    expect(await screen.findByText('Sin posiciones abiertas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Descargar histórico completo' }))
    await waitFor(() =>
      expect(fetchFalso.mock.calls.map(([u]) => String(u))).toContain('/api/portfolio/riesgo?descargar=true'),
    )
    expect(await screen.findByText('Sin posiciones abiertas.')).toBeInTheDocument()
  })
})
