/**
 * Revisión 11: el intervalo y el múltiplo de los comparables se escribían con un
 * decimal junto a «dentro/fuera», que se decide con las cifras que se sirven
 * (dos decimales): un 22,44 fuera de 15,02–22,36 se leía «P/E 15,0 – 22,4 ·
 * cotiza a 22,4 (fuera)».
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Valoracion } from '../api/types'
import { rutaValoracion } from '../components/valoracion/ruta'
import empresaCompleta from '../test/fixtures/empresa_completa.json'
import empresaDeudaParcial from '../test/fixtures/empresa_deuda_parcial.json'
import { ComparablesPanel, Escenarios, leerEntradas, textoDeValidacion, ValuationPage } from './ValuationPage'

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

describe('revisión 14', () => {
  const RANGO = 'Rango de valor, del escenario más pesimista al más optimista'
  // Lo que responde el backend de verdad a un bajista de −75 % (el que proponía
  // antes del suelo, `test_revision14_dcf.py`): un 422 de Pydantic, en lista.
  const PYDANTIC = {
    detail: [{ type: 'greater_than_equal', loc: ['body', 'escenarios', 'bajista', 'growth_rate'],
               msg: 'Input should be greater than or equal to -0.5', input: -0.75, ctx: { ge: -0.5 } }],
  }

  /** Escribe un crecimiento en el bajista: sin tocar nada, «Recalcular» ya no
   *  manda escenarios (revisión 15, H1). */
  const tocarElBajista = (valor: string) =>
    fireEvent.change(screen.getAllByLabelText(/^Crecimiento FCF/)[0], { target: { value: valor } })

  it('H3: un 422 de validación no es un dato que falta: se dice en español y la valoración se queda', async () => {
    servir((c) => (c.escenarios ? { status: 422, json: PYDANTIC } : ACME))
    montarEn(rutaValoracion('ACME'))
    await screen.findByText(RANGO)
    tocarElBajista('-75')
    fireEvent.click(screen.getByRole('button', { name: 'Recalcular con mis supuestos' }))
    expect(
      await screen.findByText(
        'No se puede calcular: el cálculo admite como mínimo -50 % en el crecimiento del FCF del escenario bajista ' +
          '(hay -75 %). Corrige lo escrito y vuelve a calcular.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Input should be/)).toBeNull()
    // Ni borra la valoración ni abre «Tus entradas» como si faltara la deuda.
    expect(screen.getByText(RANGO)).toBeInTheDocument()
    expect(screen.getByText(/^Tus entradas/).closest('details')).not.toHaveAttribute('open')
  })

  it('H3 (guarda): un 422 con texto del backend sigue siendo un dato que falta', async () => {
    const DETALLE = 'No se conoce la deuda neta de la empresa (…). Puedes escribirla tú en el campo de deuda neta si la conoces.'
    servir((c) => (c.escenarios ? { status: 422, json: { detail: DETALLE } } : ACME))
    montarEn(rutaValoracion('ACME'))
    await screen.findByText(RANGO)
    tocarElBajista('3')
    fireEvent.click(screen.getByRole('button', { name: 'Recalcular con mis supuestos' }))
    expect(await screen.findByText(DETALLE)).toBeInTheDocument()
    expect(screen.getByText(/^Tus entradas/).closest('details')).toHaveAttribute('open')
  })

  it('H8: al vaciar un campo, la ayuda dice el dato del filing, no tu cifra de antes', async () => {
    const A = ACME as { status: number; json: { entradas: Record<string, unknown> } }
    // El backend usa la deuda que mandas (entradas.net_debt = la tuya).
    servir((c) => ({
      status: 200,
      json: { ...A.json, entradas: { ...A.json.entradas, ...(c.net_debt !== undefined ? { net_debt: c.net_debt } : {}) } },
    }))
    montarEn(rutaValoracion('ACME'))
    await screen.findByText(RANGO)
    const deuda = screen.getByLabelText('Deuda neta') as HTMLInputElement
    expect(deuda.placeholder).toBe('180') // la del filing
    fireEvent.change(deuda, { target: { value: '5.000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Valorar' }))
    await screen.findByText(/\(la tuya\)$/)
    fireEvent.change(deuda, { target: { value: '' } }) // «vacío es el dato del filing»
    expect(deuda.placeholder).toBe('180')
  })

  it('H3: el escenario acotado al −50 % lo dice en su tarjeta', async () => {
    const A = ACME as { status: number; json: Valoracion }
    const MOTIVO = 'Con el crecimiento medido (-50,0 % anual) este escenario propondría un -75,0 %: se acota al -50 %, lo mínimo que admite el cálculo.'
    const escenarios = structuredClone(A.json.escenarios)
    escenarios.bajista.procedencia = { crecimiento_supuesto: false, motivo: MOTIVO }
    servir(() => ({ status: 200, json: { ...A.json, escenarios } }))
    montarEn(rutaValoracion('ACME'))
    expect(await screen.findByText(MOTIVO)).toBeInTheDocument()
  })

  it('el texto de validación nombra cada campo con sus unidades y no deja códigos ni inglés', () => {
    expect(
      textoDeValidacion([
        { type: 'greater_than', loc: ['body', 'shares_outstanding'], msg: 'Input should be greater than 0', input: 0, ctx: { gt: 0 } },
        { type: 'less_than_equal', loc: ['body', 'escenarios', 'alcista', 'discount_rate'], msg: 'x', input: 0.45, ctx: { le: 0.4 } },
        { type: 'raro', loc: ['body', 'otro_campo'], msg: 'Field required' },
      ]),
    ).toBe(
      'No se puede calcular: el cálculo admite más de 0 en las acciones en circulación (hay 0); ' +
        'como máximo 40\u00a0% en el WACC del escenario alcista (hay 45\u00a0%). Corrige lo escrito y vuelve a calcular.',
    )
    expect(textoDeValidacion([{ type: 'missing', loc: ['body', 'otro_campo'], msg: 'Field required' }])).toBe(
      'No se puede calcular: lo enviado no es válido. Corrige lo escrito y vuelve a calcular.',
    )
  })
})

describe('revisión 15', () => {
  const RANGO = 'Rango de valor, del escenario más pesimista al más optimista'
  const A = ACME as { status: number; json: Valoracion }
  /** El campo de un supuesto de un escenario: bajista, base y alcista, en ese orden. */
  const campo = (rotulo: RegExp, escenario: 0 | 1 | 2) => screen.getAllByLabelText(rotulo)[escenario] as HTMLInputElement
  const recalcular = () => fireEvent.click(screen.getByRole('button', { name: 'Recalcular con mis supuestos' }))

  it('H1: «Recalcular» manda solo los escenarios que tocaste; los demás los propone el backend con tus entradas', async () => {
    // Con un FCF escrito de otro signo que el del filing, reenviar los tres de la
    // respuesta anterior valoraba los propuestos para el otro signo: el bajista
    // salía por encima del alcista (centros 63,5 / 38,3 / 18,7).
    const cuerpos = servir(() => ACME)
    montarEn(rutaValoracion('ACME'))
    await screen.findByText(RANGO)
    fireEvent.change(screen.getByLabelText('FCF de partida'), { target: { value: '-200' } })
    recalcular()
    await waitFor(() => expect(cuerpos).toHaveLength(2))
    expect(cuerpos[1]).toEqual({ base_fcf: -200 })
    // Tocar el WACC del base manda solo el base...
    await screen.findByText(RANGO)
    fireEvent.change(campo(/^WACC/, 1), { target: { value: '12' } })
    recalcular()
    await waitFor(() => expect(cuerpos).toHaveLength(3))
    const base = A.json.escenarios.base.supuestos
    expect(cuerpos[2]).toEqual({ base_fcf: -200, escenarios: { base: { ...base, discount_rate: 0.12 } } })
    // ...y sigue siendo tuyo al recalcular otra vez sin tocarlo.
    await screen.findByText(RANGO)
    recalcular()
    await waitFor(() => expect(cuerpos).toHaveLength(4))
    expect(Object.keys((cuerpos[3] as { escenarios: object }).escenarios)).toEqual(['base'])
    // «Valorar» vuelve a lo propuesto.
    await screen.findByText(RANGO)
    fireEvent.click(screen.getByRole('button', { name: 'Valorar' }))
    await waitFor(() => expect(cuerpos).toHaveLength(5))
    expect(cuerpos[4]).toEqual({ base_fcf: -200 })
  })

  it('H1: si tus escenarios no van de menos a más, se avisa', async () => {
    const AVISO = 'Con estos supuestos los escenarios no van de menos a más (centros: bajista 63,5, base 38,3, alcista 18,7).'
    servir(() => ({ status: 200, json: { ...A.json, aviso_orden: AVISO } }))
    montarEn(rutaValoracion('ACME'))
    expect(await screen.findByText(AVISO)).toBeInTheDocument()
  })

  it('H3: un 502 al recalcular deja la valoración y lo que escribiste, dice el fallo y deja reintentar', async () => {
    const DETALLE = "No se pudieron descargar los estados financieros de EDGAR: Todas las fuentes fallaron para 'financials' (edgar: HTTP 503)"
    let fallar = true
    const cuerpos = servir((c) => {
      if (c.escenarios && fallar) {
        fallar = false
        return { status: 502, json: { detail: DETALLE } }
      }
      return ACME
    })
    montarEn(rutaValoracion('ACME'))
    await screen.findByText(RANGO)
    // Tu tesis: WACC del 12 % en el escenario base.
    fireEvent.change(campo(/^WACC/, 1), { target: { value: '12' } })
    recalcular()
    expect(await screen.findByText(DETALLE)).toBeInTheDocument()
    expect(screen.getByText(/^Lo que ves es la valoración de antes/)).toBeInTheDocument()
    // Lo que se veía sigue ahí, con tu 12 %, para volver a pulsar cuando EDGAR responda.
    expect(screen.getByText(RANGO)).toBeInTheDocument()
    expect(campo(/^WACC/, 1).value).toBe('12')
    recalcular()
    await waitFor(() => expect(cuerpos).toHaveLength(3))
    expect((cuerpos[2] as { escenarios: Record<string, { discount_rate: number }> }).escenarios.base.discount_rate).toBe(0.12)
    await waitFor(() => expect(screen.queryByText(DETALLE)).toBeNull())
  })

  it('H3 (guarda): un fallo al valorar otra empresa no deja la de antes', async () => {
    // Lo que se ve es de ACME: con el error de OTRA debajo de su URL, no se queda.
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      if (url === '/api/watchlist') return new Response(JSON.stringify({ items: [] }), { status: 200 })
      if (url === '/api/valuation/OTRA') return new Response(JSON.stringify({ detail: 'EDGAR no responde' }), { status: 502 })
      return new Response(JSON.stringify(ACME.json), { status: 200 })
    }))
    montarEn(rutaValoracion('ACME'))
    await screen.findByText(RANGO)
    fireEvent.change(screen.getByLabelText('Símbolo'), { target: { value: 'otra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Valorar' }))
    expect(await screen.findByText('EDGAR no responde')).toBeInTheDocument()
    expect(screen.queryByText(RANGO)).toBeNull()
  })

  it('H8: sin deuda en el filing, el campo vacío no promete «la del filing»', async () => {
    const DETALLE =
      'No se conoce la deuda neta de la empresa (el filing no trae deuda a largo ni a corto plazo). Sin ella no hay ' +
      'valor por acción: suponerla cero la valoraría como si no debiera nada. Puedes escribirla tú en el campo de ' +
      'deuda neta si la conoces.'
    vi.stubGlobal('fetch', vi.fn(async (e: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
      if (url === '/api/watchlist') return new Response(JSON.stringify({ items: [] }), { status: 200 })
      const cuerpo = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (cuerpo.net_debt === undefined) {
        // La cabecera con que el backend dice qué dato no trae el filing.
        return new Response(JSON.stringify({ detail: DETALLE }), { status: 422, headers: { 'X-Dato-Que-Falta': 'net_debt' } })
      }
      return new Response(JSON.stringify(ACME.json), { status: 200 })
    }))
    montarEn(rutaValoracion('ACME'))
    expect(await screen.findByText(DETALLE)).toBeInTheDocument()
    const deuda = screen.getByLabelText('Deuda neta') as HTMLInputElement
    expect(deuda.placeholder).toBe('sin dato en el filing')
    // Los demás no los ha dicho el backend: siguen siendo «la del filing».
    expect((screen.getByLabelText('FCF de partida') as HTMLInputElement).placeholder).toBe('la del filing')
    // Y tras valorar con la tuya, vaciar el campo tampoco promete «la del filing».
    fireEvent.change(deuda, { target: { value: '1.500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Valorar' }))
    await screen.findByText(RANGO)
    fireEvent.change(deuda, { target: { value: '' } })
    expect(deuda.placeholder).toBe('sin dato en el filing')
    expect((screen.getByLabelText('FCF de partida') as HTMLInputElement).placeholder).toBe('200')
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
