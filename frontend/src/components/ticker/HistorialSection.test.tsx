/**
 * Revisión de la Fase 1 (A2): «Sin información posterior: 0 marcas de tiempo
 * comprobadas» vendía como garantía lo que no se había comprobado. UNKNOWN no
 * se convierte en PASS, tampoco en una frase.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Anticipacion, HistorialSection } from './HistorialSection'

const REGLA = 'cada dato estaba disponible antes del momento de la decisión'

function texto(marcas: number, sinFecha: string[] = []): string {
  const p = { regla: REGLA, marcas_comprobadas: marcas, retiradas_por_fecha_futura: [], sin_fecha_verificable: sinFecha, nota: '' }
  return render(<Anticipacion p={p} />).container.textContent ?? ''
}

describe('protección contra información posterior en el replay', () => {
  it('sin marcas no se comprobó nada, y se dice', () => {
    const t = texto(0)
    expect(t).toMatch(/^No se pudo comprobar que no hubiera información posterior/)
    expect(t).not.toMatch(/Sin información posterior/)
  })

  it('con marcas, la garantía y su recuento', () => {
    expect(texto(1)).toBe(`Sin información posterior: 1 marca de tiempo comprobada contra «${REGLA}».`)
  })

  it('lo que no tiene fecha verificable se nombra y quita la garantía', () => {
    const t = texto(4, ['consenso'])
    expect(t).not.toMatch(/Sin información posterior/)
    expect(t).toMatch(/Sin fecha verificable, no se pudo comprobar: consenso\./)
  })
})

describe('historial de decisiones', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('la puntuación de cada fila no se escribe igual que un umbral (revisión 8)', async () => {
    // Dos instantáneas con 0,3504 (comprar) y 0,3496 (sin acción) salían
    // «Comprar 0,35» y «Sin acción 0,35»: una acción distinta con la misma cifra.
    const fila = (id: number, accion: string, score: number) => ({
      id, fecha: '2026-09-12', creado_en: `2026-09-12T1${id}:00:00+00:00`, origen: 'analisis:14:35:00',
      accion, precio: 110, moneda: 'USD', score, reglas_version: 'v1', replay: true,
    })
    const respuesta = {
      symbol: 'ACME', reglas_version_actual: 'v1', thresholds: { favorable: 0.35, desfavorable: -0.35 },
      decisiones: [fila(1, 'comprar', 0.3504), fila(2, 'ninguna', 0.3496), fila(3, 'ninguna', 0.12),
        // Con posición solo cuenta el umbral de vender, como en su traza y sus
        // razones: «+0,35», no «+0,3496» (revisión 9).
        { ...fila(4, 'mantener', 0.3497), umbrales_puntuacion: [-0.35] }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(respuesta), { status: 200 })))
    render(<HistorialSection symbol="ACME" />)
    expect(await screen.findByText('+0,3504')).toBeInTheDocument()
    expect(screen.getByText('+0,3496')).toBeInTheDocument()
    expect(screen.getByText('+0,12')).toBeInTheDocument()
    expect(screen.getByText('+0,35')).toBeInTheDocument()
  })
})
