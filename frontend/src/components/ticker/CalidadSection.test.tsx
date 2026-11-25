/**
 * Revisión 7: el valor de cada evidencia se escribía con decimales fijos junto a
 * la insignia que decide su umbral: con CFO/beneficio de 0,996 frente a «≥ 1
 * bueno», «NORMAL · 1,00×».
 */
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import empresaCompleta from '../../test/fixtures/empresa_completa.json'
import { CalidadSection } from './CalidadSection'

type Rutas = Record<string, { status: number; json: unknown }>
const ACME = (empresaCompleta as { rutas: Rutas }).rutas

afterEach(() => vi.unstubAllGlobals())

describe('calidad de beneficios', () => {
  it('el valor de una evidencia no se escribe igual que su umbral', async () => {
    const calidad = structuredClone(ACME['/api/empresa/ACME/calidad'].json) as {
      evidencias: { categoria: string; estado: string; valor: number | null }[]
    }
    const caja = calidad.evidencias.find((e) => e.categoria === 'conversion_caja')!
    Object.assign(caja, { valor: 0.996, estado: 'normal' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(calidad), { status: 200 })))
    render(<CalidadSection symbol="ACME" />)
    expect(await screen.findByText('0,996×')).toBeInTheDocument()
    expect(screen.queryByText('1,00×')).toBeNull()
  })

  it('la tabla de evolución y la causa del aviso tampoco (revisión 8)', async () => {
    // La fila del mismo ejercicio decía «1,00×» bajo el «0,996×» de la evidencia,
    // y «0,60×» con un AVISO que daba el FCF por debajo de 0,6.
    const calidad = structuredClone(ACME['/api/empresa/ACME/calidad'].json) as {
      evidencias: { categoria: string; estado: string; valor: number | null; fcf_sobre_beneficio?: number }[]
      historia: Record<string, unknown>[]
    }
    const caja = calidad.evidencias.find((e) => e.categoria === 'conversion_caja')!
    Object.assign(caja, { valor: 0.996, estado: 'aviso', fcf_sobre_beneficio: 0.5996 })
    Object.assign(calidad.historia[calidad.historia.length - 1], { cfo_sobre_beneficio: 0.996, fcf_sobre_beneficio: 0.5996 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(calidad), { status: 200 })))
    render(<CalidadSection symbol="ACME" />)
    expect(await screen.findByText('· FCF/beneficio 0,5996×')).toBeInTheDocument()
    const tabla = screen.getByRole('region', { name: 'Evolución: ejercicios' })
    expect(within(tabla).getByText('0,996×')).toBeInTheDocument()
    expect(within(tabla).getByText('0,5996×')).toBeInTheDocument()
    expect(within(tabla).queryByText('1,00×')).toBeNull()
    expect(within(tabla).queryByText('0,60×')).toBeNull()
  })

  it('cada evidencia, frente a los umbrales de su propia cifra (revisión 9)', async () => {
    // El CFO/beneficio se escribía también frente al límite del FCF (0,6):
    // «0,5996×» arriba y «0,60×» en la tabla. La calidad del FCF separa BUENO de
    // NORMAL en −5 %, y −4,96 % salía «−5,0 %».
    const calidad = structuredClone(ACME['/api/empresa/ACME/calidad'].json) as {
      evidencias: { categoria: string; estado: string; valor: number | null; umbral: Record<string, number> | null }[]
      historia: Record<string, unknown>[]
    }
    Object.assign(calidad.evidencias.find((e) => e.categoria === 'conversion_caja')!, { valor: 0.5996, estado: 'aviso' })
    Object.assign(calidad.evidencias.find((e) => e.categoria === 'calidad_fcf')!, {
      valor: -0.0496, estado: 'bueno', umbral: { divergencia: 0.05 },
    })
    Object.assign(calidad.historia[calidad.historia.length - 1], { cfo_sobre_beneficio: 0.5996 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(calidad), { status: 200 })))
    render(<CalidadSection symbol="ACME" />)
    expect(await screen.findByText('-4,96 %')).toBeInTheDocument()
    expect(screen.queryByText('0,5996×')).toBeNull()
    expect(screen.getAllByText('0,60×').length).toBeGreaterThanOrEqual(2)
  })
})
