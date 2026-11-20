/**
 * Revisión 12 (visual): el gráfico de precios se quedaba con la rueda (zoom en
 * el tiempo y la página sin bajar con el puntero encima) y, en un móvil, con el
 * arrastre vertical; y en sus ejes las etiquetas se cortaban o se montaban
 * («026», el «76,00» del precio bajo el «100,00» del RSI, el 70 y el 30 tapando
 * el 75 y el 25). jsdom no tiene canvas: se comprueba lo que se le pide a la
 * librería.
 */
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { History } from '../api/types'
import { PriceChart } from './PriceChart'

type Llamada =
  | { tipo: 'crear'; opciones: Record<string, unknown> }
  | { tipo: 'serie'; clase: string; panel: number }
  | { tipo: 'escala'; id: string; panel: number; opciones: Record<string, unknown> }
  | { tipo: 'banda'; opciones: Record<string, unknown> }

const { llamadas } = vi.hoisted(() => ({ llamadas: [] as Llamada[] }))

vi.mock('lightweight-charts', () => ({
  CandlestickSeries: 'velas',
  HistogramSeries: 'histograma',
  LineSeries: 'linea',
  createChart: (_el: unknown, opciones: Record<string, unknown>) => {
    llamadas.push({ tipo: 'crear', opciones })
    return {
      addSeries: (clase: string, _o: unknown, panel = 0) => {
        llamadas.push({ tipo: 'serie', clase, panel })
        return {
          setData: () => {},
          applyOptions: () => {},
          createPriceLine: (o: Record<string, unknown>) => llamadas.push({ tipo: 'banda', opciones: o }),
        }
      },
      priceScale: (id: string, panel = 0) => ({
        applyOptions: (o: Record<string, unknown>) => llamadas.push({ tipo: 'escala', id, panel, opciones: o }),
      }),
      panes: () => [],
      timeScale: () => ({ fitContent: () => {} }),
      remove: () => {},
    }
  },
}))

const N = 3
const serie = (v: number) => Array.from({ length: N }, () => v)
const HISTORICO: History = {
  symbol: 'ACME',
  interval: '1d',
  range: '1Y',
  currency: 'USD',
  source: 'yfinance',
  as_of: '2026-09-11T00:00:00Z',
  cached: false,
  fetched_at: null,
  bars: Array.from({ length: N }, (_, i) => ({ ts: `2026-09-0${i + 1} 00:00:00`, open: 100, high: 101, low: 99, close: 100, volume: 1000 })),
  indicators: { sma20: serie(100), sma50: serie(100), sma200: serie(100), rsi14: serie(55), macd: { macd: serie(0.5), signal: serie(0.4), histogram: serie(0.1) } },
}

beforeEach(() => {
  llamadas.length = 0
})

function opcionesDelGrafico() {
  render(<PriceChart history={HISTORICO} />)
  const crear = llamadas.find((l) => l.tipo === 'crear')
  if (!crear || crear.tipo !== 'crear') throw new Error('no se creó el gráfico')
  return crear.opciones as {
    handleScroll: Record<string, boolean>
    handleScale: Record<string, boolean>
    timeScale: Record<string, unknown>
    rightPriceScale: Record<string, unknown>
  }
}

describe('PriceChart: la página es de la página', () => {
  it('la rueda y el arrastre vertical mueven la página, no el gráfico', () => {
    const o = opcionesDelGrafico()
    expect(o.handleScroll).toMatchObject({ mouseWheel: false, vertTouchDrag: false })
    expect(o.handleScale).toMatchObject({ mouseWheel: false })
    // El gráfico sigue moviéndose arrastrando en horizontal y ampliándose con dos dedos.
    expect(o.handleScroll).toMatchObject({ pressedMouseMove: true, horzTouchDrag: true })
    expect(o.handleScale).toMatchObject({ pinch: true })
  })

  it('los bordes fijos: sin hueco a la derecha y la primera fecha entera', () => {
    expect(opcionesDelGrafico().timeScale).toMatchObject({ fixLeftEdge: true, fixRightEdge: true })
  })
})

describe('PriceChart: etiquetas de los ejes', () => {
  it('ninguna cifra cortada por el borde de su panel', () => {
    expect(opcionesDelGrafico().rightPriceScale).toMatchObject({ entireTextOnly: true })
  })

  it('en el eje del RSI solo las bandas, y fijado cuando ya existe el panel del MACD', () => {
    opcionesDelGrafico()
    const bandas = llamadas.filter((l) => l.tipo === 'banda').map((l) => l.tipo === 'banda' && l.opciones)
    expect(bandas.map((b) => b && b.price)).toEqual([70, 30])
    expect(bandas.every((b) => b && b.axisLabelVisible === true)).toBe(true)

    const ejeRsi = llamadas.findIndex((l) => l.tipo === 'escala' && l.id === 'right' && l.panel === 1)
    expect(ejeRsi).toBeGreaterThan(-1)
    const fijado = llamadas[ejeRsi]
    expect(fijado.tipo === 'escala' && fijado.opciones).toMatchObject({ autoScale: false, textColor: 'transparent' })
    // La librería copia las opciones de la escala derecha de un panel a la de la
    // gráfica, y el panel creado después las hereda: antes, el MACD salía sin cifras.
    const ultimoMacd = llamadas.map((l) => l.tipo === 'serie' && l.panel === 2).lastIndexOf(true)
    expect(ultimoMacd).toBeGreaterThan(-1)
    expect(ejeRsi).toBeGreaterThan(ultimoMacd)
  })
})
