/**
 * «Qué dice la app» en lenguaje claro, contra lo que el motor decide DE VERDAD:
 * `fixtures/decisiones_motor.json` sale de `decide()` del backend
 * (`tests/fixtures/exportar_frontend.py`, y `test_fixtures_frontend.py` falla si
 * no está al día). La frase no añade reglas: cuenta la traza.
 */
import { describe, expect, it } from 'vitest'
import type { ConfianzaEvidencia, Decision } from '../api/types'
import motor from '../test/fixtures/decisiones_motor.json'
import { fraseDeConfianza, fraseDeLaApp, queDiceLaApp, reglasQueCuentan, situacionDeLaApp } from './queDiceLaApp'

const NBSP = '\u00a0'
const caso = (n: keyof typeof motor.casos) => motor.casos[n] as unknown as Decision
const frase = (n: keyof typeof motor.casos) => fraseDeLaApp(caso(n), { moneda: 'USD' })

describe('la frase de «Qué dice la app»', () => {
  it('la de la maqueta aprobada: buena empresa, precio sin tendencia, y cuánto le falta', () => {
    expect(frase('vigilar_bajo_la_media')).toBe(
      'Es una buena empresa frente a las de su sector, pero su precio todavía no va al alza. ' +
        `La app sugerirá comprar cuando el precio llegue a 96,68${NBSP}USD o más (le falta subir un 5,09${NBSP}%).`,
    )
    // Dentro de la banda la regla tampoco compra: misma frase, otra distancia.
    expect(frase('vigilar_dentro_de_la_banda')).toContain(`le falta subir un 1,24${NBSP}%`)
  })

  it('sin media de 200 sesiones no da la tendencia por buena ni por mala: lo dice', () => {
    expect(frase('vigilar_sin_media')).toBe(
      'Es una buena empresa frente a las de su sector, pero no se puede saber si su precio va al alza: falta su media de 200 sesiones. ' +
        'La app sugerirá comprar cuando haya una media de 200 sesiones con que medir su tendencia.',
    )
  })

  it('comprar trae su zona y su stop, con los niveles del motor', () => {
    const d = caso('comprar')
    expect(frase('comprar')).toBe(
      'Es una buena empresa frente a las de su sector y su precio va al alza. ' +
        `La app sugiere comprar entre 101,92 y 106,08${NBSP}USD, y salir si cierra a 88,71${NBSP}USD o menos (su stop).`,
    )
    expect(d.levels?.stop).toBe(88.71)
  })

  it('lo que aplaza una compra (resultados, precio viejo) se dice, con cuándo se desbloquea', () => {
    expect(frase('vigilar_por_resultados')).toBe(
      'Es una buena empresa y su precio va al alza, pero presenta resultados el 15 sept 2026 y comprar justo antes es apostar a una sorpresa. ' +
        'La app sugerirá comprar cuando pasen sus resultados del 15 sept 2026.',
    )
    expect(frase('vigilar_por_precio_viejo')).toMatch(/el precio es antiguo .* La app sugerirá comprar cuando vuelva a haber un precio actual\.$/)
  })

  it('evitar y no hacer nada dicen por qué y qué lo cambiaría', () => {
    expect(frase('evitar')).toBe(
      'Queda claramente por detrás de las empresas de su sector, así que la app sugiere no comprarla. ' +
        'La app dejará de desaconsejarla cuando su puntuación suba por encima de -0,35 (ahora -0,52).',
    )
    expect(frase('ninguna')).toBe(
      'Frente a las empresas de su sector ni destaca ni preocupa, así que la app no sugiere hacer nada. ' +
        `La app sugerirá comprar cuando su puntuación llegue a +0,35 o más (ahora +0,12) y el precio llegue a 96,68${NBSP}USD o más (le falta subir un 5,09${NBSP}%).`,
    )
    expect(frase('ninguna_con_resultados')).toContain('Presenta resultados el 15 sept 2026: espera movimientos fuertes del precio.')
  })

  it('sobre lo que ya tienes, cuándo saldría: el stop, con lo que falta', () => {
    expect(frase('mantener')).toBe(
      'La tienes en cartera y nada pide tocarla: ni queda por detrás de las de su sector ni ha llegado a tu stop ni ha perdido su tendencia. ' +
        `La app sugerirá vender cuando su puntuación baje a -0,35 o menos (ahora +0,40) o el precio baje a 70,00${NBSP}USD o menos, tu stop (le falta bajar un 30,00${NBSP}%).`,
    )
    expect(frase('reducir')).toMatch(/^Su precio ha perdido la tendencia .*: la app sugiere vender una parte\. La app sugerirá vender cuando/)
  })

  it('fail-safe: un stop que no se pudo comprobar y un precio viejo no se callan', () => {
    expect(frase('mantener_sin_stop')).toContain('Pero la app no pudo comprobar si ha llegado a tu stop: revísalo tú.')
    // También al reducir (revisión 14, H4): la puntuación no es la única salida
    // si el stop puede estar ya perforado. «Lo que comprueba» ya pintaba «?».
    expect(frase('reducir_sin_stop')).toMatch(
      /^Su precio ha perdido la tendencia .*: la app sugiere vender una parte\. Pero la app no pudo comprobar si ha llegado a tu stop: revísalo tú\. La app sugerirá vender cuando/,
    )
    expect(frase('reducir')).not.toContain('no pudo comprobar')
    expect(frase('mantener_con_precio_viejo')).toContain('Ojo: el precio es antiguo (todas las fuentes fallaron); compruébalo en tu broker antes de actuar.')
  })

  it('un stop perforado manda, también el de una acción de céntimos y el que acompaña a otra regla', () => {
    // La auditoría del 19 oct: con dos decimales fijos el stop de 0,004 era «0,00».
    expect(frase('vender_por_stop')).toBe(`El precio ha caído hasta tu stop (0,004${NBSP}USD): la app sugiere vender.`)
    expect(frase('vender_por_puntuacion_y_stop')).toMatch(/la app sugiere vender\. Además, el precio está en o por debajo de tu stop \(70,00\u00a0USD\)\.$/)
  })

  it('sin datos dice cuáles faltan, con la concordancia que toca', () => {
    expect(frase('sin_datos')).toBe('La app no puede decidir: le falta la puntuación frente a su sector.')
    expect(frase('sin_datos_ni_precio')).toBe('La app no puede decidir: le faltan el precio y la puntuación frente a su sector.')
  })

  it('cada combinación de reglas que produce el motor tiene su frase, sin huecos ni códigos', () => {
    const combinaciones = Object.entries(motor.combinaciones)
    expect(combinaciones.length).toBeGreaterThanOrEqual(20)
    for (const [clave, d] of combinaciones) {
      const decision = d as unknown as Decision
      expect(situacionDeLaApp(decision, 'USD'), clave).not.toBeNull()
      const texto = fraseDeLaApp(decision, { moneda: 'USD' })
      expect(texto, clave).not.toMatch(/undefined|null|NaN|\b[a-z]+_[a-z_]+\b|\d{4}-\d{2}-\d{2}/)
      // Lo que se cuenta del «cuándo» sale de las condiciones del motor, en palabras.
      const { cuando } = queDiceLaApp(decision, { moneda: 'USD' })
      if (cuando) expect(cuando, clave).not.toMatch(/cuando que |≥|≤/)
    }
  })

  it('una combinación sin frase prevista habla con las palabras del motor, no inventa', () => {
    const rara = { ...caso('vigilar_bajo_la_media'), reglas: [] } as Decision
    expect(queDiceLaApp(rara).situacion).toBe(`${rara.label}. ${rara.reasons[0]}`)
  })
})

describe('lo que comprueba la app', () => {
  it('las reglas que movieron la decisión, con lo que no se pudo comprobar siempre a la vista', () => {
    expect(reglasQueCuentan(caso('vigilar_bajo_la_media').reglas).map((r) => r.id)).toEqual(['tendencia_a_favor', 'puntuacion_favorable'])
    expect(reglasQueCuentan(caso('comprar').reglas).map((r) => r.id)).toEqual(['puntuacion_favorable', 'tendencia_a_favor'])
    // Un «?» de una regla solo evaluada no se esconde.
    expect(reglasQueCuentan(caso('mantener_sin_stop').reglas).map((r) => `${r.id}:${r.resultado}`)).toContain('stop_perforado:desconocido')
  })

  it('si nada movió la decisión (mantener), enseña todo lo comprobado', () => {
    // Con lo que se lee solo «nada pide tocarla» quedaría sin explicar.
    const reglas = caso('mantener').reglas ?? []
    expect(reglas.every((r) => r.papel === 'evaluada')).toBe(true)
    expect(reglasQueCuentan(reglas).map((r) => r.id)).toEqual(
      expect.arrayContaining(['puntuacion_desfavorable', 'stop_perforado', 'tendencia_perdida']),
    )
    expect(reglasQueCuentan(reglas)).toHaveLength(reglas.length)
  })
})

describe('la confianza, en una frase', () => {
  const confianza = (nivel: ConfianzaEvidencia['nivel'], estados: ConfianzaEvidencia['factores'][number]['estado'][]): ConfianzaEvidencia => ({
    nivel,
    factores: estados.map((estado, i) => ({ id: `f${i}`, factor: `Factor ${i}`, estado, detalle: `detalle ${i}` })),
    razones: [],
    regla: 'r',
    nota: 'n',
  })

  it('alta, con datos completos; un factor crítico se nombra; si no, cuántos débiles', () => {
    expect(fraseDeConfianza(confianza('alta', ['ok', 'ok']))).toBe('los datos que la respaldan están completos y al día')
    expect(fraseDeConfianza(confianza('baja', ['ok', 'debil', 'critico']))).toBe('detalle 2')
    expect(fraseDeConfianza(confianza('media', ['ok', 'debil', 'desconocido']))).toBe('2 puntos débiles en los datos que la respaldan')
    expect(fraseDeConfianza(confianza('media', ['debil']))).toBe('1 punto débil en los datos que la respaldan')
  })
})
