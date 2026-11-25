/**
 * «Qué dice la app» dice lo mismo que la tarjeta desde la que se llega a la
 * ficha (revisión 15, costuras H1 y H4):
 *
 * - H1: Inicio decía «KO bajó de tu límite de pérdida», su «Revisar» llevaba a
 *   la ficha y la ficha decía «Mantener… ni ha llegado a tu stop» con el mismo
 *   precio. La decisión del análisis lleva el stop agregado (el más alto de los
 *   FIJADOS, 70) y el repaso de Inicio el de CADA lote (119,60 en el lote viejo
 *   sin stop guardado). La ficha avisa con el repaso de su posición. El motor
 *   agrega ya el stop de cada lote; el repaso sigue mandando si aun así discrepan
 *   (otro precio, la lista guardada).
 * - H4: «Ver por qué →» de una idea «Sin sitio» llevaba a una ficha con
 *   «Comprar» en verde, con el coste de oportunidad de la misma respuesta en
 *   «No cabe».
 *
 * Parte de la respuesta REAL del análisis (`empresa_completa.json`) y de la
 * decisión real de HSY de la lista (`hoy_completo.json`).
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalisisEmpresaResponse, Decision, TodayResponse } from '../../api/types'
import { avisoDeLaFila } from '../../lib/avisos'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import hoyCompleto from '../../test/fixtures/hoy_completo.json'
import { posicionDelRepaso, repasoDe } from '../../test/repaso'
import { QueDiceLaApp } from './QueDiceLaApp'

type Rutas = Record<string, { status: number; json: unknown }>

afterEach(() => vi.unstubAllGlobals())

const RECORTE =
  'Ideas nuevas al 0 %: la cartera que YA tienes estima un 22,2 % de volatilidad, por encima del objetivo (12 %). No es que las ideas sean malas — es que no cabe más riesgo.'

function respuesta(cambiar: (r: AnalisisEmpresaResponse) => void): AnalisisEmpresaResponse {
  const r = structuredClone((empresaCompleta as unknown as { rutas: Rutas }).rutas['/api/empresa/ACME/analisis'].json) as AnalisisEmpresaResponse
  cambiar(r)
  return r
}

function pintar(datos: AnalisisEmpresaResponse) {
  // `useLlmStatus` pide el estado de la IA: que se quede esperando.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
  render(
    <MemoryRouter>
      <QueDiceLaApp
        carga={{ estado: 'listo', datos, error: null, reintentar: () => {}, refrescar: () => {}, refrescando: false }}
        moneda="USD"
        alExplicar={() => {}}
      />
    </MemoryRouter>,
  )
  const bloque = screen.getByRole('region', { name: 'Qué dice la app' })
  return { bloque, aviso: bloque.querySelector('[data-aviso]')!.getAttribute('data-aviso'), texto: (bloque.textContent ?? '').replace(/\u00a0/g, ' ') }
}

/** La decisión real de la ficha de KO con los dos lotes (`test_estado_por_simbolo.py`):
 *  «mantener», con el stop agregado en 70 sin perforar. */
const MANTENER_CON_70: Partial<Decision> = {
  action: 'mantener', label: 'Mantener', owned: true,
  reasons: ['Puntuación +0,10 y el precio está claramente sobre su media de 200 sesiones (94,78): no hay motivo para tocar la posición.'],
  levels: { entrada_desde: null, entrada_hasta: null, stop: 70, stop_pct: -32.7, objetivo: 133.4, objetivo_pct: 28.3, ratio: 2,
    peso_bruto_pct: null, stop_fijado_al_abrir: true } as Decision['levels'],
  reglas: [
    { id: 'puntuacion_desfavorable', regla: 'Puntuación ≤ -0,35', resultado: 'no_cumple', efecto: 'vender', datos: { valor: 0.1, umbral: -0.35 }, papel: 'evaluada' },
    { id: 'stop_perforado', regla: 'Precio en o bajo el stop de la posición', resultado: 'no_cumple', efecto: 'vender', datos: { valor: 104, umbral: 70 }, papel: 'evaluada' },
    { id: 'tendencia_perdida', regla: 'Precio ≤ media de 200 sesiones − 1 %', resultado: 'no_cumple', efecto: 'reducir', datos: { valor: 104, umbral: 93.83 }, papel: 'evaluada' },
  ],
  cambiaria: [],
}

describe('la ficha de una posición avisa con el repaso de su stop (H1)', () => {
  it('KO, con el lote viejo perforado: «Vender», nunca «ni ha llegado a tu stop»', () => {
    const { aviso, texto } = pintar(respuesta((r) => {
      r.analisis.symbol = 'KO'
      r.analisis.decision = { ...r.analisis.decision, ...MANTENER_CON_70 } as Decision
      r.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', precio: 104, stop: 119.6, estado: 'perforado', stop_fijado_al_abrir: false,
        lotes: 2, lotes_recalculados: 1 })])
    }))
    expect(aviso).toBe('vender')
    expect(texto).not.toContain('ni ha llegado a tu stop')
    // («stop» va con su explicación del glosario en línea: se mira a los dos lados.)
    expect(texto).toContain('Cotiza a 104,00 USD, por debajo de tu límite de pérdida (stop')
    expect(texto).toContain(') de 119,60 USD. Tu regla dice vender.')
    // Y por qué la traza dice otra cosa.
    expect(texto).toContain('«Lo que comprueba la app» mira otro stop (70,00 USD); este aviso mira el de cada lote')
  })

  it('con el repaso de acuerdo, la frase es la de la traza', () => {
    const { aviso, texto } = pintar(respuesta((r) => {
      r.analisis.symbol = 'KO'
      r.analisis.decision = { ...r.analisis.decision, ...MANTENER_CON_70 } as Decision
      r.repaso = repasoDe([posicionDelRepaso({ symbol: 'KO', precio: 104, stop: 70 })])
    }))
    expect(aviso).toBe('mantener')
    expect(texto).toContain('La tienes en cartera y nada pide tocarla')
  })
})

describe('la ficha de una idea dice lo mismo que su tarjeta (H4)', () => {
  const lista = structuredClone((hoyCompleto as unknown as { rutas: Rutas }).rutas['/api/signals/today?market=us_sp500'].json) as TodayResponse
  const hsy = lista.shortlist.ideas.find((i) => i.symbol === 'HSY')!

  it('«Sin sitio» en la tarjeta y «No cabe» en su coste de oportunidad: «Sin sitio» en la ficha', () => {
    for (const i of lista.shortlist.ideas) i.peso_final_pct = 0
    lista.shortlist.sizing.recortes = [RECORTE]
    lista.shortlist.sin_hueco_de_riesgo = true
    expect(avisoDeLaFila(hsy, lista).verbo).toBe('Sin sitio')
    const { aviso, texto } = pintar(respuesta((r) => {
      r.analisis.decision = structuredClone(hsy.decision)
      r.analisis.coste_oportunidad = { ...r.analisis.coste_oportunidad, sizing: { recortes: [RECORTE] },
        tamano: { maximo_permitido: 0, efectivo_disponible: 0.3 },
        veredicto: { accion: 'NO_TRADE', motivo: `No cabe: los límites de la cartera le dejan 0 %. ${RECORTE}` } }
    }))
    expect(aviso).toBe('comprar_sin_sitio')
    expect(texto).toContain('Sin sitio')
  })

  it('sin efectivo anotado (INDETERMINADO), sin tamaño y con su motivo, no «Sin sitio» ni «vende algo antes»', () => {
    const { aviso, texto } = pintar(respuesta((r) => {
      r.analisis.decision = structuredClone(hsy.decision)
      r.analisis.coste_oportunidad = { ...r.analisis.coste_oportunidad, tamano: { maximo_permitido: 0, efectivo_disponible: null },
        veredicto: { accion: 'INDETERMINADO', motivo: 'Sin efectivo anotado, la cartera se mide como invertida al 100 % y así la idea no cabe. Anota tu efectivo para saber si de verdad no cabe.' } }
    }))
    expect(aviso).toBe('comprar_sin_tamano')
    expect(texto).not.toContain('vender algo antes')
  })
})
