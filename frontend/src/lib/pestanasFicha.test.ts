/**
 * La ficha pasa de once pestañas a cuatro y «Más detalle»
 * (docs/PLAN_NAVEGACION.md). Las rutas viejas redirigen aquí con su pestaña:
 * cada una de las once tiene que encontrar su sitio, y ninguna sección puede
 * quedarse sin una entrada.
 */
import { describe, expect, it } from 'vitest'
import { PESTANAS, PESTANAS_VIEJAS, SECCIONES, leerPestana, parametroDe, pestanaNueva, vistaDe, type VistaFicha } from './pestanasFicha'

// Las once de antes (TABS de TickerPage hasta este cambio), con dónde deben ir.
const ESPERADO: [string, VistaFicha][] = [
  ['resumen', { pestana: 'resumen', seccion: null }],
  ['informe', { pestana: 'detalle', seccion: 'informe' }],
  ['fundamentales', { pestana: 'numeros', seccion: 'fundamentales' }],
  ['valoracion', { pestana: 'valoracion', seccion: null }],
  ['opciones', { pestana: 'detalle', seccion: 'opciones' }],
  ['salud', { pestana: 'numeros', seccion: 'salud' }],
  ['filings', { pestana: 'novedades', seccion: 'filings' }],
  ['cambios', { pestana: 'novedades', seccion: 'cambios' }],
  ['expectativas', { pestana: 'novedades', seccion: 'expectativas' }],
  ['calidad', { pestana: 'numeros', seccion: 'calidad' }],
  ['historial', { pestana: 'detalle', seccion: 'historial' }],
]

describe('pestañas de la ficha', () => {
  it('son cuatro, con los nombres de la maqueta aprobada', () => {
    expect(PESTANAS.map((p) => p.nombre)).toEqual(['Resumen', 'Números', 'Valoración', 'Novedades'])
  })

  it.each(ESPERADO)('la vieja «%s» lleva a su pestaña nueva y a su sección', (vieja, vista) => {
    expect(PESTANAS_VIEJAS[vieja]).toEqual(vista)
    expect(leerPestana(vieja)).toEqual(vista)
    // Mayúsculas o espacios de más en una URL escrita a mano no la pierden.
    expect(leerPestana(` ${vieja.toUpperCase()} `)).toEqual(vista)
  })

  it('la tabla tiene las once y nada más, y cada sección está en la pestaña que dice', () => {
    expect(Object.keys(PESTANAS_VIEJAS).sort()).toEqual(ESPERADO.map(([v]) => v).sort())
    for (const { pestana, seccion } of Object.values(PESTANAS_VIEJAS)) {
      if (seccion === null) continue
      const de = SECCIONES[pestana as keyof typeof SECCIONES]
      expect(de?.map((s) => s.id), `${seccion} en ${pestana}`).toContain(seccion)
    }
  })

  it('ninguna sección se pierde: cada una de las secciones agrupadas viene de una pestaña vieja', () => {
    const agrupadas = Object.values(SECCIONES).flatMap((ss) => ss.map((s) => s.id))
    const viejas = Object.values(PESTANAS_VIEJAS).map((v) => v.seccion)
    expect(new Set(agrupadas)).toEqual(new Set(viejas.filter((s) => s !== null)))
  })

  it('acepta los identificadores nuevos, y lo que no reconoce abre el Resumen', () => {
    expect(leerPestana('numeros')).toEqual({ pestana: 'numeros', seccion: 'fundamentales' })
    expect(leerPestana('novedades')).toEqual({ pestana: 'novedades', seccion: 'cambios' })
    expect(leerPestana('valoracion')).toEqual({ pestana: 'valoracion', seccion: null })
    // «Más detalle» no abre ninguna: cada una cuesta su carga.
    expect(leerPestana('detalle')).toEqual({ pestana: 'detalle', seccion: null })
    for (const raro of [null, undefined, '', 'nada', 'constructor', 'toString'])
      expect(leerPestana(raro)).toEqual({ pestana: 'resumen', seccion: null })
  })

  it('lo que se escribe en la URL se vuelve a leer igual', () => {
    const vistas: VistaFicha[] = [
      vistaDe('resumen'),
      vistaDe('valoracion'),
      vistaDe('detalle'),
      ...Object.entries(SECCIONES).flatMap(([p, ss]) => ss.map((s) => ({ pestana: p as VistaFicha['pestana'], seccion: s.id }))),
    ]
    for (const v of vistas) expect(leerPestana(parametroDe(v)), JSON.stringify(v)).toEqual(v)
    expect(parametroDe(vistaDe('resumen'))).toBeNull()
  })

  it('el integrador traduce una vieja al parámetro nuevo', () => {
    expect(pestanaNueva('resumen')).toBeNull()
    expect(pestanaNueva('fundamentales')).toBe('numeros')
    expect(pestanaNueva('cambios')).toBe('novedades')
    expect(pestanaNueva('salud')).toBe('salud')
    expect(pestanaNueva('informe')).toBe('informe')
    expect(pestanaNueva('valoracion')).toBe('valoracion')
  })
})
