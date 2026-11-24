/**
 * Revisión 11: el intervalo y el múltiplo de los comparables se escribían con un
 * decimal junto a «dentro/fuera», que se decide con las cifras que se sirven
 * (dos decimales): un 22,44 fuera de 15,02–22,36 se leía «P/E 15,0 – 22,4 ·
 * cotiza a 22,4 (fuera)».
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Valoracion } from '../api/types'
import { rutaValoracion } from '../components/valoracion/ruta'
import empresaCompleta from '../test/fixtures/empresa_completa.json'
import empresaDeudaParcial from '../test/fixtures/empresa_deuda_parcial.json'
import { ComparablesPanel, Escenarios, leerEntradas, ValuationPage } from './ValuationPage'

afterEach(() => vi.unstubAllGlobals())

type Rutas = Record<string, { status: number; json: unknown }>

/** Las respuestas del backend por URL; la valoración, con `valorar(cuerpo)`. */
function servir(valorar: (cuerpo: Record<string, unknown>) => { status: number; json: unknown }) {
  const cuerpos: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    if (url === '/api/watchlist') return new Response(JSON.stringify({ items: [] }), { status: 200 })
    const cuerpo = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    cuerpos.push(cuerpo)
    const r = valorar(cuerpo)
    return new Response(JSON.stringify(r.json), { status: r.status })
  }))
  return cuerpos
}

const ACME = (empresaCompleta as { rutas: Rutas }).rutas['/api/valuation/ACME']
const montarEn = (ruta: string) => render(<MemoryRouter initialEntries={[ruta]}><ValuationPage /></MemoryRouter>)

describe('el módulo abierto desde la ficha (ítem 3.3)', () => {
  it('con ?simbolo= valora al abrir, una sola vez y sin pulsar nada', async () => {
    const cuerpos = servir(() => ACME)
    montarEn(rutaValoracion('acme'))
    expect(await screen.findByText('Rango de valor, del escenario más pesimista al más optimista')).toBeInTheDocument()
    expect(screen.getByLabelText('Símbolo')).toHaveValue('ACME')
    expect(cuerpos).toEqual([{}])
  })

  it('sin deuda en el filing deja escribirla, y esa es la que se usa: nunca un cero', async () => {
    // El backend decía «escríbela en el campo de deuda neta» y el módulo no tenía
    // ese campo: solo el DCF viejo de la ficha dejaba escribirla.
    const DETALLE =
      'No se conoce la deuda neta de la empresa (el filing no trae deuda a largo ni a corto plazo). Sin ella no hay ' +
      'valor por acción: suponerla cero la valoraría como si no debiera nada. Puedes escribirla tú en el campo de ' +
      'deuda neta si la conoces.'
    const cuerpos = servir((c) => (c.net_debt === undefined ? { status: 422, json: { detail: DETALLE } } : ACME))
    montarEn(rutaValoracion('ACME'))
    expect(await screen.findByText(DETALLE)).toBeInTheDocument()
    const deuda = screen.getByLabelText('Deuda neta')
    expect(deuda).toBeVisible() // los campos se abren solos ante un dato que falta
    expect(deuda).toHaveValue('')
    expect(deuda.getAttribute('inputmode')).toBeNull() // admite negativos (revisión 13)
    fireEvent.change(deuda, { target: { value: '-1.500.000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Valorar' }))
    expect(await screen.findByText('Rango de valor, del escenario más pesimista al más optimista')).toBeInTheDocument()
    expect(cuerpos).toEqual([{}, { net_debt: -1_500_000 }])
    expect(screen.getByText(/\(la tuya\)$/)).toBeInTheDocument()
  })

  it('lo que no se puede leer se dice y no se manda', async () => {
    const cuerpos = servir(() => ACME)
    montarEn(rutaValoracion('ACME'))
    await screen.findByText('Rango de valor, del escenario más pesimista al más optimista')
    fireEvent.change(screen.getByLabelText('Años de proyección'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('FCF de partida'), { target: { value: '2,5x' } })
    expect(screen.getByText(/^No se puede leer fcf de partida \(«2,5x»\), años de proyección \(«12»\)\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Valorar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Recalcular con mis supuestos' })).toBeDisabled()
    expect(cuerpos).toEqual([{}])
  })

  it('la deuda parcial lleva el mismo marcador que Salud y el informe (Ronda 2)', async () => {
    servir(() => (empresaDeudaParcial as { rutas: Rutas }).rutas['/api/valuation/PARC'])
    montarEn(rutaValoracion('PARC'))
    expect(await screen.findByText('parcial: falta deuda a corto plazo')).toBeInTheDocument()
    expect(screen.getByText(/^Deuda parcial\. El filing no trae deuda a corto plazo/)).toBeInTheDocument()
  })
})

describe('leerEntradas', () => {
  it('vacío es «la del filing»; un cero escrito sí es un dato', () => {
    expect(leerEntradas({})).toEqual({ valores: {}, ilegibles: [] })
    expect(leerEntradas({ net_debt: '0', base_fcf: ' ', years: '7' })).toEqual({ valores: { net_debt: 0, years: 7 }, ilegibles: [] })
    expect(leerEntradas({ shares_outstanding: '0', years: '5,5' }).ilegibles).toEqual([
      'acciones en circulación («0»)',
      'años de proyección («5,5»)',
    ])
  })
})

describe('comparables ajustados', () => {
  it('el múltiplo y el intervalo, con los decimales que deciden «dentro» o «fuera»', () => {
    render(
      <ComparablesPanel
        c={{
          disponible: true, fiable: true, nota: '', etiqueta_multiplo: 'P/E', pares_usables: 12, grados_libertad: 9,
          r2: 0.45, multiplo_objetivo: 22.44, intervalo: { bajo: 15.02, alto: 22.36 }, dentro_del_intervalo: false,
        }}
      />,
    )
    expect(screen.getByText(/P\/E 15,02 – 22,36/)).toBeInTheDocument()
    expect(screen.getByText('22,44')).toBeInTheDocument()
  })
})

describe('los supuestos de los escenarios', () => {
  // Revisión 12, visual: eran `type="number"` leídos con `Number(...)`. Un «8,5»
  // que el navegador no acepta llegaba vacío, y un campo borrado, también: los dos
  // recalculaban con un 0 % sin avisar.
  const supuestos = { growth_rate: 0.081, discount_rate: 0.11, terminal_growth: 0.02 }
  const data = {
    entradas: { precio_actual: 92 },
    nota_supuestos: '',
    escenarios: { bajista: { supuestos, rango: { disponible: false, nota: '' } } },
  } as unknown as Valoracion

  function montar() {
    const onCambiar = vi.fn()
    const onAplicar = vi.fn()
    render(<Escenarios data={data} supuestos={{ bajista: supuestos }} onCambiar={onCambiar} onAplicar={onAplicar} busy={false} />)
    const wacc = screen.getByLabelText(/^WACC/) as HTMLInputElement
    const recalcular = screen.getByRole('button', { name: 'Recalcular con mis supuestos' })
    return { onCambiar, wacc, recalcular }
  }

  it('se escriben con coma y «8,5» se lee como 8,5 %', () => {
    const { onCambiar, wacc } = montar()
    expect(wacc.value).toBe('11,0')
    expect((screen.getByLabelText(/^Crecimiento FCF/) as HTMLInputElement).value).toBe('8,1')
    fireEvent.change(wacc, { target: { value: '8,5' } })
    expect(wacc.value).toBe('8,5')
    expect(onCambiar).toHaveBeenLastCalledWith('bajista', 'discount_rate', expect.closeTo(0.085, 10))
  })

  it('el crecimiento y la perpetuidad no piden el teclado decimal, que en iOS no trae «-»', () => {
    // Revisión 13: con `inputMode="decimal"` no había forma de escribir en un
    // iPhone un crecimiento o una perpetuidad negativos, que el backend admite.
    const { wacc } = montar()
    expect(screen.getByLabelText(/^Crecimiento FCF/).getAttribute('inputmode')).toBeNull()
    expect(screen.getByLabelText(/^Perpetuidad/).getAttribute('inputmode')).toBeNull()
    expect(wacc.getAttribute('inputmode')).toBe('decimal')
  })

  it('un campo borrado o ilegible no es un 0 %: no llega a los supuestos y no deja recalcular', () => {
    const { onCambiar, wacc, recalcular } = montar()
    fireEvent.change(wacc, { target: { value: '' } })
    expect(onCambiar).not.toHaveBeenCalled()
    expect(recalcular).toBeDisabled()
    expect(screen.getByText('Para recalcular falta: WACC bajista.')).toBeInTheDocument()
    fireEvent.change(wacc, { target: { value: '8,5x' } })
    expect(onCambiar).not.toHaveBeenCalled()
    expect(recalcular).toBeDisabled()
    expect(screen.getByText(/^No se puede leer WACC bajista \(«8,5x»\)/)).toBeInTheDocument()
    fireEvent.change(wacc, { target: { value: '9' } })
    expect(recalcular).toBeEnabled()
  })
})
