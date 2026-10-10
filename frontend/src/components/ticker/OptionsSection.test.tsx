/**
 * Ítem 2.1, Opciones: lo que falta no se pinta como un cero medido, y una copia
 * de caché dice de cuándo es.
 *
 * - `p.prima ?? 0` pintaba «0,0 %» (en azul, el color de «prima negativa o
 *   nula») cuando no había prima.
 * - «(de caché)» a secas hacía pasar por fresca una cadena descargada hace una hora.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SeñalesDeOpciones } from '../../api/types'
import { OptionsSection } from './OptionsSection'

afterEach(() => vi.unstubAllGlobals())

function servir(datos: SeñalesDeOpciones) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(datos), { status: 200 })))
}

const BASE: SeñalesDeOpciones = {
  disponible: true,
  symbol: 'ACME',
  aviso: 'Las opciones van al lado del fundamental, no dentro.',
  fuente: 'yfinance',
  cacheado: false,
  vencimientos_leidos: ['2026-10-16'],
  vencimientos_totales: 6,
}

describe('panel de opciones', () => {
  it('sin prima, «—» en neutro, no un «0,0 %» que nadie midió', async () => {
    servir({ ...BASE, prima_de_riesgo: { disponible: true, iv: 0.3, rv: 0.25, aviso_sesgo: 'La IV tiende a exceder a la RV.' } })
    render(<OptionsSection symbol="ACME" />)
    const rotulo = await screen.findByText('Prima')
    const cifra = rotulo.nextElementSibling as HTMLElement
    expect(cifra.textContent).toBe('—')
    expect(cifra.className).toMatch(/text-slate-/)
    expect(cifra.className).not.toMatch(/text-sky-|text-amber-/)
  })

  it('con prima, su signo y su color, como antes', async () => {
    servir({ ...BASE, prima_de_riesgo: { disponible: true, iv: 0.3, rv: 0.25, prima: 0.05, aviso_sesgo: 'La IV tiende a exceder a la RV.' } })
    render(<OptionsSection symbol="ACME" />)
    const cifra = (await screen.findByText('Prima')).nextElementSibling as HTMLElement
    expect(cifra.textContent).toBe('+5,0 %')
    expect(cifra.className).toMatch(/text-amber-800/)
  })

  it('una cadena de caché dice cuánto tiene', async () => {
    const hace20 = new Date(Date.now() - 20 * 60_000).toISOString()
    servir({ ...BASE, cacheado: true, as_of: hace20 })
    render(<OptionsSection symbol="ACME" />)
    expect(await screen.findByText(/fuente: yfinance \(de caché, hace 20 min\)/)).toBeInTheDocument()
  })
})
