/**
 * «Qué dice la app», en lenguaje claro: la decisión del motor contada a alguien
 * sin experiencia (docs/PLAN_NAVEGACION.md, «Primero la frase, después la cifra»).
 *
 * No hay reglas nuevas ni otra explicación: todo sale de lo que el motor ya
 * sirve (`backend/app/analysis/decision.py`). La situación, de qué regla
 * decidió, bloqueó o estuvo a favor en su traza (`reglas`, con su `papel` y su
 * `resultado`); el «cuándo cambiaría», de `cambiaria`, con sus umbrales y
 * distancias exactas. Si una combinación no está prevista aquí, se cuenta con
 * las palabras del propio motor (`label` y `reasons`), nunca con una suposición.
 * La traza completa sigue debajo (`DecisionExplicada`): esto la resume.
 */
import type { AlternativaDecision, CondicionDecision, ConfianzaEvidencia, Decision, ReglaTraza } from '../api/types'
import { decimalesFrente, fmtFecha, fmtFrente, fmtNum, fmtPct, fmtPrecio, plural } from './formato'

type DecisionDelMotor = Decision & { faltan?: string[] }

export interface LoQueDiceLaApp {
  /** Cómo está la empresa frente a las reglas, en una frase. */
  situacion: string
  /** Qué tendría que pasar para que la app sugiriera otra cosa; `null` si no aplica. */
  cuando: string | null
}

const regla = (d: Decision, id: string): ReglaTraza | undefined => d.reglas?.find((r) => r.id === id)

/** «a», «a y b», «a, b y c». */
function enLista(partes: string[], y = 'y'): string {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} ${y} ${partes[partes.length - 1]}`
}

/** Una distancia en %, sin signo y sin escribirse cero si no lo es (como la
 *  traza: «falta +0,002 %», no «0,00 %»). */
function distancia(d: number): string {
  const decimales = decimalesFrente(Math.abs(d), [0])
  return fmtPct(Math.abs(d), decimales, { enPuntos: true, ceros: decimales === 2 })
}

/** Los umbrales de puntuación de la traza: cada puntuación se escribe frente a
 *  todos, como en «¿Por qué esta decisión?» (revisión 8). */
function umbralesDePuntuacion(d: Decision): number[] {
  return (d.reglas ?? [])
    .filter((r) => r.id.startsWith('puntuacion'))
    .map((r) => r.datos?.umbral)
    .filter((u): u is number => typeof u === 'number')
}

const OPERADOR = /[≥≤<>]/

/** Una condición de `cambiaria` en palabras. Lo que no se reconoce va con el
 *  texto del motor (`condicion`), que ya es legible. */
function condicionEnPalabras(c: CondicionDecision, umbrales: number[], moneda: string | null): string {
  const op = OPERADOR.exec(c.condicion)?.[0]
  if (c.regla.startsWith('puntuacion') && typeof c.actual === 'number' && c.umbral !== null && op) {
    const u = fmtNum(c.umbral, 2, { signo: true, ceros: false })
    const ahora = ` (ahora ${fmtFrente(c.actual, umbrales.length ? umbrales : c.umbral, { signo: true })})`
    if (op === '≥') return `su puntuación llegue a ${u} o más${ahora}`
    if (op === '>') return `su puntuación suba por encima de ${u}${ahora}`
    if (op === '≤') return `su puntuación baje a ${u} o menos${ahora}`
    return `su puntuación baje de ${u}${ahora}`
  }
  if (c.unidad === '%' && op) {
    if (c.umbral === null) return 'haya una media de 200 sesiones con que medir su tendencia'
    const precio = fmtPrecio(c.umbral, moneda)
    const stop = c.regla === 'stop_perforado' ? ', tu stop' : ''
    const falta =
      c.distancia !== null && c.distancia !== 0
        ? ` (le falta ${c.distancia > 0 ? 'subir' : 'bajar'} un ${distancia(c.distancia)})`
        : ''
    if (op === '≥') return `el precio llegue a ${precio} o más${stop}${falta}`
    if (op === '>') return `el precio vuelva por encima de ${precio}${stop}${falta}`
    if (op === '≤') return `el precio baje a ${precio} o menos${stop}${falta}`
    return `el precio baje de ${precio}${stop}${falta}`
  }
  if (c.regla === 'resultados_proximos' && typeof c.actual === 'string') return `pasen sus resultados del ${fmtFecha(c.actual)}`
  if (c.regla === 'precio_viejo') return 'vuelva a haber un precio actual'
  return c.condicion.replace(/^que /, '')
}

/** Hacia qué otra acción se cuenta el «cuándo» de cada acción, y con qué verbo. */
const HACIA: Partial<Record<Decision['action'], { hacia: string; verbo: string }>> = {
  vigilar: { hacia: 'comprar', verbo: 'sugerirá comprar' },
  ninguna: { hacia: 'comprar', verbo: 'sugerirá comprar' },
  evitar: { hacia: 'ninguna', verbo: 'dejará de desaconsejarla' },
  // Sobre lo que ya tienes, lo que importa es cuándo saldría: el stop.
  mantener: { hacia: 'vender', verbo: 'sugerirá vender' },
  reducir: { hacia: 'vender', verbo: 'sugerirá vender' },
}

function cuando(d: Decision, moneda: string | null): string | null {
  const destino = HACIA[d.action]
  const alt: AlternativaDecision | undefined = destino && d.cambiaria?.find((a) => a.hacia === destino.hacia)
  if (!destino || !alt?.condiciones.length) return null
  const umbrales = umbralesDePuntuacion(d)
  const partes = alt.condiciones.map((c) => condicionEnPalabras(c, umbrales, moneda))
  return `La app ${destino.verbo} cuando ${enLista(partes, alt.requiere === 'alguna' ? 'o' : 'y')}.`
}

const FALTA: Record<string, string> = { precio: 'el precio', puntuación: 'la puntuación frente a su sector' }

/** Lo que el motor dejó sin comprobar sobre una posición: se dice siempre. Un
 *  stop que no se pudo comprobar no se calla por faltar un dato. */
const SOBRE_LA_POSICION: [string, string][] = [
  ['puntuacion_desfavorable', 'queda por detrás de las de su sector'],
  ['stop_perforado', 'ha llegado a tu stop'],
  ['tendencia_perdida', 'ha perdido su tendencia'],
]

/** Lo que la traza dice aparte de la decisión y no puede callarse: un precio
 *  rescatado de caché (sobre lo que ya tienes se decide igual, y no avisarlo
 *  sería el error caro) y unos resultados a la vista. */
function avisos(d: Decision): string {
  const viejo = regla(d, 'precio_viejo')
  const resultados = regla(d, 'resultados_proximos')
  const salida: string[] = []
  if (resultados?.resultado === 'cumple' && resultados.papel === 'informa') {
    const fecha = resultados.datos?.fecha
    salida.push(`Presenta resultados${typeof fecha === 'string' ? ` el ${fmtFecha(fecha)}` : ' muy pronto'}: espera movimientos fuertes del precio.`)
  }
  if (viejo?.resultado === 'cumple' && viejo.papel !== 'modifica')
    salida.push('Ojo: el precio es antiguo (todas las fuentes fallaron); compruébalo en tu broker antes de actuar.')
  return salida.length ? ` ${salida.join(' ')}` : ''
}

/** La situación con una frase propia, o `null` si la traza trae una
 *  combinación que aquí no está prevista (entonces hablan el motor y sus
 *  razones). Exportada para comprobarla contra el golden master del motor. */
export function situacionDeLaApp(d: DecisionDelMotor, moneda: string | null = null): string | null {
  const s = situacion(d, moneda)
  return s === null ? null : s + avisos(d)
}

function situacion(d: DecisionDelMotor, moneda: string | null): string | null {
  const precio = (v: unknown) => (typeof v === 'number' ? fmtPrecio(v, moneda) : null)
  const r = (id: string) => regla(d, id)
  switch (d.action) {
    case 'sin_datos': {
      const faltan = d.faltan ?? (r('datos_minimos')?.datos?.faltan as string[] | undefined) ?? []
      return faltan.length
        ? `La app no puede decidir: le ${faltan.length > 1 ? 'faltan' : 'falta'} ${enLista(faltan.map((f) => FALTA[f] ?? f))}.`
        : null
    }
    case 'evitar':
      return 'Queda claramente por detrás de las empresas de su sector, así que la app sugiere no comprarla.'
    case 'ninguna':
      return 'Frente a las empresas de su sector ni destaca ni preocupa, así que la app no sugiere hacer nada.'
    case 'comprar': {
      const n = d.levels
      const zona =
        n && n.entrada_desde !== null && n.entrada_hasta !== null
          ? ` La app sugiere comprar entre ${fmtPrecio(n.entrada_desde)} y ${fmtPrecio(n.entrada_hasta, moneda)}, y salir si cierra a ${fmtPrecio(n.stop, moneda)} o menos (su stop).`
          : ' La app sugiere comprar.'
      return `Es una buena empresa frente a las de su sector y su precio va al alza.${zona}`
    }
    case 'vigilar': {
      if (r('resultados_proximos')?.papel === 'modifica') {
        const fecha = r('resultados_proximos')?.datos?.fecha
        // Cuándo compraría lo dice `cambiaria` («cuando pasen sus resultados…»).
        return `Es una buena empresa y su precio va al alza, pero presenta resultados${typeof fecha === 'string' ? ` el ${fmtFecha(fecha)}` : ' muy pronto'} y comprar justo antes es apostar a una sorpresa.`
      }
      if (r('precio_viejo')?.papel === 'modifica')
        return 'La idea es buena, pero el precio es antiguo (todas las fuentes fallaron): la app no sugiere comprar con un precio que quizá ya no existe.'
      const tendencia = r('tendencia_a_favor')
      if (r('puntuacion_favorable')?.resultado !== 'cumple' || !tendencia) return null
      return tendencia.resultado === 'desconocido'
        ? 'Es una buena empresa frente a las de su sector, pero no se puede saber si su precio va al alza: falta su media de 200 sesiones.'
        : 'Es una buena empresa frente a las de su sector, pero su precio todavía no va al alza.'
    }
    case 'vender': {
      const decide = d.reglas?.find((x) => x.papel === 'decide')
      const stop = r('stop_perforado')
      if (decide?.id === 'stop_perforado')
        return `El precio ha caído hasta tu stop (${precio(stop?.datos?.umbral) ?? 'el que fijaste'}): la app sugiere vender.`
      if (decide?.id === 'puntuacion_desfavorable')
        return (
          'Ya queda claramente por detrás de las empresas de su sector, así que la razón para tenerla no se sostiene: la app sugiere vender.' +
          (stop?.resultado === 'cumple' ? ` Además, el precio está en o por debajo de tu stop (${precio(stop.datos?.umbral) ?? '—'}).` : '')
        )
      return null
    }
    case 'reducir':
      return regla(d, 'tendencia_perdida')?.papel === 'decide'
        ? 'Su precio ha perdido la tendencia (está por debajo de su media de 200 sesiones): la app sugiere vender una parte.'
        : null
    case 'mantener': {
      const no = SOBRE_LA_POSICION.filter(([id]) => r(id)?.resultado === 'no_cumple').map(([, t]) => t)
      const sinComprobar = SOBRE_LA_POSICION.filter(([id]) => !r(id) || r(id)?.resultado === 'desconocido').map(([, t]) => t)
      const base = no.length
        ? `La tienes en cartera y nada pide tocarla: ni ${no.join(' ni ')}.`
        : 'La tienes en cartera y la app sugiere mantenerla.'
      return sinComprobar.length
        ? `${base} Pero la app no pudo comprobar si ${sinComprobar.join(' ni si ')}: revísalo tú.`
        : base
    }
    default:
      return null
  }
}

/** La frase de «Qué dice la app». `moneda`, la de la cotización: cada precio
 *  la lleva escrita. */
export function queDiceLaApp(d: DecisionDelMotor, { moneda = null }: { moneda?: string | null } = {}): LoQueDiceLaApp {
  const propia = situacionDeLaApp(d, moneda)
  // Sin una frase prevista para lo que dice la traza, las palabras del motor.
  const s = propia ?? [`${d.label}.`, d.reasons[0]].filter(Boolean).join(' ')
  return { situacion: s, cuando: d.action === 'comprar' || d.action === 'vender' || d.action === 'sin_datos' ? null : cuando(d, moneda) }
}

/** Las dos partes, juntas: lo que se lee bajo «Qué dice la app». */
export function fraseDeLaApp(d: DecisionDelMotor, opciones?: { moneda?: string | null }): string {
  const { situacion: s, cuando: c } = queDiceLaApp(d, opciones)
  return c ? `${s} ${c}` : s
}

/** «Confianza media: 2 puntos débiles…». De la evaluación de la evidencia
 *  (`app/analysis/confianza.py`): un factor crítico se nombra, con su motivo. */
export function fraseDeConfianza(c: ConfianzaEvidencia): string {
  if (c.nivel === 'alta') return 'los datos que la respaldan están completos y al día'
  const criticos = c.factores.filter((f) => f.estado === 'critico')
  if (criticos.length) return criticos[0].detalle
  const n = c.factores.filter((f) => f.estado === 'debil' || f.estado === 'desconocido').length
  return n
    ? `${n} ${plural(n, 'punto débil', 'puntos débiles')} en los datos que la respaldan`
    : 'mira los factores para saber por qué'
}

/** Lo que comprueba cada regla, dicho como una afirmación: la marca de al lado
 *  (✓, ✗ o ?) dice si se cumple. Las cifras y el texto exacto, de la traza. Lo
 *  que no está aquí se rotula con el texto de la propia regla. */
export const QUE_COMPRUEBA: Record<string, string> = {
  puntuacion_favorable: 'Es mejor que las empresas de su sector',
  puntuacion_desfavorable: 'Queda muy por detrás de las empresas de su sector',
  tendencia_a_favor: 'Su precio va al alza',
  tendencia_perdida: 'Su precio ha perdido la tendencia',
  stop_perforado: 'El precio ha llegado a tu stop',
  resultados_proximos: 'Presenta resultados muy pronto',
  precio_viejo: 'El precio es antiguo',
  datos_minimos: 'Hay precio y puntuación',
}

const ORDEN_PAPEL = ['decide', 'modifica', 'bloquea', 'a_favor', 'informa', 'evaluada']

/** Las reglas que cuentan para el resumen: las que decidieron, cambiaron,
 *  bloquearon, empujaron a favor o informan, y siempre las que no se pudieron
 *  comprobar («?» nunca se esconde). Si ninguna movió la decisión (mantener:
 *  nada pidió tocarla), todas: lo comprobado es justo lo que la explica. */
export function reglasQueCuentan(reglas: ReglaTraza[] | undefined): ReglaTraza[] {
  const todas = reglas ?? []
  const mueven = todas.filter((r) => ['decide', 'modifica', 'bloquea', 'a_favor'].includes(r.papel))
  const lista = mueven.length ? todas.filter((r) => r.papel !== 'evaluada' || r.resultado === 'desconocido') : todas
  return [...lista].sort((a, b) => ORDEN_PAPEL.indexOf(a.papel) - ORDEN_PAPEL.indexOf(b.papel))
}
