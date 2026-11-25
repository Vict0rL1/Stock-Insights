/**
 * El aviso de acción: qué hacer con una empresa, en una frase para alguien sin
 * experiencia («Compra entre 138,18 y 143,82. Si cae a 117,73, vende: es tu
 * límite de pérdida (stop).»).
 *
 * Por qué existe: una idea decía «Comprar» y a la vez «Cuánto de tu cartera
 * 0,0 % · recortado desde 6,1 %» con dos o tres párrafos sobre volatilidad y
 * topes; las acciones eran chips pequeños en mayúsculas, y la venta estaba
 * repartida entre el recuento «Para vender», el panel rojo del stop y chips
 * sueltos (petición de Victor del 24 nov: «que las alertas de compra y venta
 * sean más claras»).
 *
 * Esto NO decide nada: PRESENTA lo que ya decidió el motor (`decision.py`). Cada
 * frase sale de campos que el backend ya sirve —la acción, sus niveles, su traza
 * (`reglas`), «qué la cambiaría» (`cambiaria`), el peso final del dimensionador y
 * el repaso del stop de la posición—, sin reglas ni umbrales nuevos. Lo que el
 * motor no dice, aquí no se inventa: sin `cambiaria` hacia comprar, «Esperar» no
 * pone un precio; sin precio, un stop no está «en orden».
 *
 * Lo que recibe (`DatosDelAviso`):
 * - `decision`: la del motor (`DailySignal.decision`). Si es de una posición
 *   (`owned`), la pregunta es sostener o soltar.
 * - `tamano`: solo si la idea pasó por el dimensionador (lista corta): su peso
 *   final (`peso_final_pct`, `null` = sin tamaño final) y los recortes que la
 *   tocan (`recortesDe`); o, fuera de ella, si no cabe ninguna idea nueva
 *   (`sinHueco`). Ausente = no se dimensionó (`tamanoDeLaLista`).
 * - `stop`: el repaso del stop de la posición (`TodayResponse.cartera`). Es de
 *   ahora y manda sobre la decisión de la lista, que puede ser de hace 6 h.
 * - `precio` y `moneda`: el precio de hoy de la lista y la moneda de los
 *   niveles, si se saben (la del repaso manda en los del stop).
 *
 * Lo que devuelve (`Aviso`): `tipo`, `verbo` (lo que se lee en grande), `frase`,
 * `pasos` (frases cortas que la completan), `tono` (el color, que nunca va solo:
 * el componente pone icono y verbo) y `cifras` (los números para actuar, para la
 * vista completa). Se pinta con `components/AvisoDeAccion.tsx`.
 */
import type {
  AlternativaDecision,
  CondicionDecision,
  DailySignal,
  Decision,
  ReglaTraza,
  Shortlist,
  StopDePosicion,
  StopsDeCartera,
  TodayResponse,
} from '../api/types'
import { ESPACIO_DURO, decimalesFrente, fmtFecha, fmtFrente, fmtNum, fmtPct, fmtPrecio, plural } from './formato'

export type TipoAviso =
  /** Cumple las reglas de compra y el dimensionador le da un peso. */
  | 'comprar'
  /** Cumple las reglas de compra, pero los topes de la cartera la dejan en 0 %. */
  | 'comprar_sin_sitio'
  /** Cumple las reglas de compra, sin peso final (o no se dimensionó). */
  | 'comprar_sin_tamano'
  /** «Vigilar» del motor: buena, pero la regla espera algo antes de comprar. */
  | 'esperar'
  | 'evitar'
  /** Stop perforado (del repaso o de la lista) o la acción «vender» del motor. */
  | 'vender'
  | 'reducir'
  | 'mantener'
  /** Una posición cuyo stop no se pudo comprobar (sin precio, sin stop, precio viejo): nunca «en orden». */
  | 'sin_comprobar'
  | 'sin_datos'
  /** «Sin acción» del motor: ni destaca ni preocupa. */
  | 'sin_accion'

export type TonoAviso = 'verde' | 'ambar' | 'naranja' | 'rojo' | 'gris'

/** Un número para actuar: «Comprar entre» · «138,18–143,82». */
export interface CifraDeAviso {
  rotulo: string
  valor: string
  nota?: string
  tono?: TonoAviso
}

export interface Aviso {
  tipo: TipoAviso
  /** Lo que se lee en grande: «Comprar», «Esperar», «Vender»… */
  verbo: string
  frase: string
  pasos: string[]
  tono: TonoAviso
  cifras: CifraDeAviso[]
}

export interface TamanoDeLaIdea {
  /** En puntos (4 = 4 %); `null` = el dimensionador no le dio tamaño final. */
  pesoFinalPct: number | null | undefined
  /** Los recortes del tamaño que la tocan, en el orden del dimensionador (`recortesDe`). */
  recortes: string[]
  /** La cartera que ya tienes no deja sitio a NINGUNA idea nueva, esté o no en la
   *  lista corta (`Shortlist.sin_hueco_de_riesgo`). Ausente = no se sabe o sí hay. */
  sinHueco?: boolean
}

export interface DatosDelAviso {
  decision?: Decision | null
  tamano?: TamanoDeLaIdea
  stop?: StopDePosicion | null
  precio?: number | null
  moneda?: string | null
}

const VERBO: Record<TipoAviso, string> = {
  comprar: 'Comprar',
  comprar_sin_sitio: 'Sin sitio',
  comprar_sin_tamano: 'Comprar',
  esperar: 'Esperar',
  evitar: 'Evitar',
  vender: 'Vender',
  reducir: 'Reducir',
  mantener: 'Mantener',
  // Un verbo, como los demás: lo que toca es ir a mirarlo.
  sin_comprobar: 'Revisar',
  sin_datos: 'Sin datos',
  sin_accion: 'Sin acción',
}

// Verde actúa, ámbar espera o avisa, rojo sal; gris, nada que hacer. «Mantener»
// no es verde: no es una oportunidad, es no tocar nada.
const TONO: Record<TipoAviso, TonoAviso> = {
  comprar: 'verde',
  comprar_sin_sitio: 'ambar',
  comprar_sin_tamano: 'verde',
  esperar: 'ambar',
  evitar: 'gris',
  vender: 'rojo',
  reducir: 'naranja',
  mantener: 'gris',
  sin_comprobar: 'ambar',
  sin_datos: 'gris',
  sin_accion: 'gris',
}

/** El término, explicado: el glosario dice «stop», y quien empieza no sabe qué es. */
const LIMITE = 'límite de pérdida (stop)'
const AL_BROKER = 'Míralo en tu broker.'

function aviso(tipo: TipoAviso, frase: string, pasos: (string | false | null | undefined)[] = [], cifras: CifraDeAviso[] = []): Aviso {
  return { tipo, verbo: VERBO[tipo], frase, pasos: pasos.filter((p): p is string => typeof p === 'string' && p !== ''), tono: TONO[tipo], cifras }
}

const numero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** «a», «a y b», «a, b y c». */
function unir(partes: string[], conjuncion: 'y' | 'o'): string {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} ${conjuncion} ${partes[partes.length - 1]}`
}

/** Un precio junto al nivel con que se compara, sin cambiar de lado al
 *  escribirlo: 109,999 frente a un stop de 110 se escribía «110,00, por debajo
 *  de 110,00» (el mismo cuidado que `fmtFrente`, revisión 6). */
function precioFrente(precio: number, nivel: number, moneda: string | null | undefined): string {
  if (precio === nivel || fmtPrecio(precio) !== fmtPrecio(nivel)) return fmtPrecio(precio, moneda)
  return `${fmtFrente(precio, nivel)}${moneda ? `${ESPACIO_DURO}${moneda}` : ''}`
}

/** Lo que falta hasta un umbral, en puntos y sin escribirse como cero si no lo es
 *  (como «falta» en «¿Qué la cambiaría?»). */
function falta(distancia: number): string {
  const decimales = decimalesFrente(distancia, [0])
  return fmtPct(distancia, decimales, { enPuntos: true, ceros: decimales === 2 })
}

/** Una condición de `cambiaria`, en subjuntivo para ir detrás de «cuando». */
function clausula(c: CondicionDecision, moneda: string | null | undefined): string {
  if (c.regla === 'tendencia_a_favor') {
    // Sin media no hay precio que pedir: no se inventa uno.
    if (!numero(c.umbral)) return 'haya una media de 200 sesiones con que medir la tendencia'
    const resto = numero(c.distancia) && c.distancia > 0 ? ` (le falta un ${falta(c.distancia)})` : ''
    return `cierre a ${fmtPrecio(c.umbral, moneda)} o más${resto}`
  }
  if (c.regla === 'puntuacion_favorable' && numero(c.umbral)) {
    const ahora = numero(c.actual) ? ` (ahora ${fmtFrente(c.actual, [c.umbral], { signo: true })})` : ''
    return `su puntuación llegue a ${fmtNum(c.umbral, 2, { signo: true })} o más${ahora}`
  }
  if (c.regla === 'resultados_proximos') {
    return typeof c.actual === 'string' && c.actual ? `pasen sus resultados del ${fmtFecha(c.actual)}` : 'pasen sus próximos resultados'
  }
  if (c.regla === 'precio_viejo') return 'vuelva a haber un precio actual'
  return c.condicion
}

function hacia(decision: Decision, accion: string): AlternativaDecision | undefined {
  return (decision.cambiaria ?? []).find((a) => a.hacia === accion && a.condiciones.length > 0)
}

function clausulas(alt: AlternativaDecision, moneda: string | null | undefined): string {
  return unir(alt.condiciones.map((c) => clausula(c, moneda)), alt.requiere === 'alguna' ? 'o' : 'y')
}

/** La regla que decidió (papel «decide»), con sus cifras si las trae. */
function decisiva(decision: Decision, id: string): { valor: number; umbral: number } | null {
  const r: ReglaTraza | undefined = (decision.reglas ?? []).find((x) => x.id === id && x.papel === 'decide')
  return r && numero(r.datos?.valor) && numero(r.datos?.umbral) ? { valor: r.datos.valor, umbral: r.datos.umbral } : null
}

const conPrecioViejo = (decision: Decision) =>
  (decision.reglas ?? []).some((r) => r.id === 'precio_viejo' && r.resultado === 'cumple')

/** Un sistema probado y perdedor no puede avisar con la misma cara que uno sin probar. */
const avisoDeRefutada = (decision: Decision) =>
  decision.confidence === 'refutada' &&
  'Ojo: estas reglas se probaron contra el histórico y no funcionaron. Es lo que dictan, no una recomendación.'

/** La primera frase de un recorte del dimensionador: «Ideas nuevas al 0 %: la
 *  cartera que YA tienes estima un 22,2 % de volatilidad, por encima del
 *  objetivo (12 %).» Sin cortar en «EE. UU.». */
export function resumenDelRecorte(recorte: string): string {
  const m = /^(.+?[^A-Z\s]\.)\s+(?=[A-ZÁÉÍÓÚÑ«¿])/.exec(recorte)
  return m ? m[1] : recorte
}

/** Los recortes del tamaño que tocan a una idea: los que la nombran y los que
 *  no nombran a ninguna (valen para todas, como «Ideas nuevas al 0 %…»). La
 *  tarjeta decía «0,0 % · recortado desde 6,1 %» sin el porqué, que solo estaba
 *  en el panel del tamaño, cientos de píxeles más abajo: leída sola, una idea de
 *  compra al 0 % parecía un error (revisión 12, visual). */
export function recortesDe(symbol: string, recortes: string[], ideas: string[]): string[] {
  // Por palabra entera: «KO» no es parte de «KOF», ni «BRK.B» de «BRK.BX».
  const nombra = (texto: string, s: string) => {
    const literal = s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')
    return new RegExp(`(?<![A-Za-z0-9.])${literal}(?![A-Za-z0-9]|\\.[A-Za-z0-9])`).test(texto)
  }
  return recortes.filter((r) => nombra(r, symbol) || !ideas.some((otra) => nombra(r, otra)))
}

/** El tamaño de una empresa de la lista corta, si lo es: para que su fila en la
 *  tabla diga lo mismo que su tarjeta («Sin sitio», no «Comprar»). Fuera de la
 *  lista corta no hay tamaño, salvo que no quepa ninguna idea nueva
 *  (`sin_hueco_de_riesgo`): entonces tampoco cabe ella, y se dice con el recorte
 *  que vale para todas. Con «Ideas nuevas al 0 %», las 118 que califican fuera
 *  de la lista corta decían «Comprar» en verde bajo «ninguna cabe hoy en tu
 *  cartera» (revisión 15, H12). */
export function tamanoDeLaLista(symbol: string, shortlist: Shortlist | null | undefined): TamanoDeLaIdea | undefined {
  if (!shortlist) return undefined
  const ideas = shortlist.ideas ?? []
  const idea = ideas.find((i) => i.symbol === symbol)
  const sinHueco = shortlist.sin_hueco_de_riesgo === true
  if (!idea && !sinHueco) return undefined
  return {
    pesoFinalPct: idea ? idea.peso_final_pct : null,
    recortes: recortesDe(symbol, shortlist.sizing?.recortes ?? [], ideas.map((i) => i.symbol)),
    ...(sinHueco ? { sinHueco } : {}),
  }
}

/** Si el repaso del stop se pudo hacer: sin él (respuesta antigua, o falló) no
 *  se sabe qué está abierto ahora. */
export function carteraRepasada(repaso: StopsDeCartera | undefined | null): repaso is StopsDeCartera {
  return repaso !== undefined && repaso !== null && repaso.abiertas !== null && !repaso.error
}

/** Lo que una fila de la lista necesita para su aviso: su stop, si la tienes, y
 *  su tamaño, si está en la lista corta. */
export function contextoDeLaFila(
  symbol: string,
  data: Pick<TodayResponse, 'cartera' | 'shortlist'> | null | undefined,
): Pick<DatosDelAviso, 'stop' | 'tamano'> {
  const repaso = data?.cartera
  return {
    stop: carteraRepasada(repaso) ? (repaso.posiciones.find((p) => p.symbol === symbol) ?? null) : null,
    tamano: tamanoDeLaLista(symbol, data?.shortlist),
  }
}

/** El aviso de una empresa de la lista —su fila, su tarjeta de idea, el
 *  recuento de las que no caben— con todo lo que sabe la respuesta
 *  (`contextoDeLaFila`): su stop si la tienes, que es de ahora, y su tamaño si
 *  está en la lista corta. La tarjeta de una idea comprada después de calcular
 *  la lista decía «Comprar … Tamaño sugerido: 7,8 % de tu cartera» y su fila,
 *  «Mantener» (revisión 15, H1): quien pinte una empresa de la lista pide aquí
 *  su aviso, y todas dicen lo mismo. */
export function avisoDeLaFila(
  signal: Pick<DailySignal, 'symbol' | 'decision' | 'price'>,
  data: Pick<TodayResponse, 'cartera' | 'shortlist'> | null | undefined,
): Aviso {
  return avisoDe({ decision: signal.decision, ...contextoDeLaFila(signal.symbol, data), precio: signal.price?.last })
}

/** Qué stop es el que se enseña cuando no es el fijado al abrir de un solo lote:
 *  el más alto de varios lotes, recalculado desde el coste o el punto medio de
 *  su clase. Hoy enseñaba el más alto de los FIJADOS y callaba el lote sin stop
 *  que el Portafolio daba por perforado (revisión 13). */
export function notasDelStop(p: StopDePosicion): string[] {
  const lotes = p.lotes ?? 1
  const recalculados = p.lotes_recalculados ?? 0
  const porClase = p.lotes_por_clase ?? 0
  const notas: string[] = []
  if (p.stop === null) return notas
  const deQue = p.stop_por_clase
    ? 'es el punto medio de su clase, no uno medido'
    : !p.stop_fijado_al_abrir
      ? 'no se fijó al abrir: se recalcula desde el coste, como en Mi cartera'
      : null
  if (lotes > 1) {
    notas.push(`Es el más alto de los de sus ${lotes} lotes${deQue ? `, y ${deQue}` : ''}.`)
    if (recalculados > 0 && p.stop_fijado_al_abrir) {
      notas.push(
        `${recalculados} de sus lotes no ${plural(recalculados, 'tiene', 'tienen')} stop fijado: el suyo se recalcula desde su coste${
          porClase > 0 ? ` (${porClase} con el punto medio de su clase)` : ''
        }.`,
      )
    }
  } else if (deQue) {
    notas.push(`Ese stop ${deQue}.`)
  }
  // Sin comprobar, ya lo dice su motivo; perforada por otro lote, también se dice.
  const sinStop = p.lotes_sin_stop ?? 0
  if (sinStop > 0 && p.estado !== 'sin_comprobar') {
    notas.push(`${sinStop} de sus lotes no ${plural(sinStop, 'tiene', 'tienen')} stop ni coste con que calcularlo.`)
  }
  return notas
}

// --- Las frases ---------------------------------------------------------------

/** «Cotiza a 104,00 USD, por debajo de tu límite de pérdida (stop) de 110,00
 *  USD.» La regla vende «en o por debajo» (`stop_perforado`): en el propio stop
 *  se dice «justo en». */
function fraseDelStopPerforado(precio: number | null, stop: number | null, moneda: string | null | undefined): string {
  const cierre = ' Tu regla dice vender.'
  if (precio === null || stop === null) return `Tu ${LIMITE} está perforado.${cierre}`
  if (precio < stop) return `Cotiza a ${precioFrente(precio, stop, moneda)}, por debajo de tu ${LIMITE} de ${fmtPrecio(stop, moneda)}.${cierre}`
  if (precio === stop) return `Cotiza a ${fmtPrecio(precio, moneda)}, justo en tu ${LIMITE}.${cierre}`
  // Perforado con el precio que se enseña por encima: lo perfora otro precio (fail-safe).
  return `Tu ${LIMITE} de ${fmtPrecio(stop, moneda)} está perforado.${cierre}`
}

function cifrasDelStop(precio: number | null | undefined, stop: number | null | undefined, moneda: string | null | undefined, tonoStop: TonoAviso): CifraDeAviso[] {
  const cifras: CifraDeAviso[] = [{ rotulo: 'Precio', valor: fmtPrecio(precio, moneda) }]
  if (stop !== null && stop !== undefined) cifras.push({ rotulo: 'Límite de pérdida (stop)', valor: fmtPrecio(stop, moneda), tono: tonoStop })
  return cifras
}

/** Una posición con su repaso del stop, que es de ahora. `lista`: la decisión
 *  de la lista sobre ella, si la trata como posición. */
function avisoDePosicion(p: StopDePosicion, lista: Decision | null): Aviso {
  const moneda = p.moneda
  const notas = notasDelStop(p)

  // 1. Perforado manda sobre todo: un stop perforado no se calla por nada.
  if (p.estado === 'perforado') {
    const cotizacion = p.precios?.find((x) => x.fuente === 'cotizacion')
    return aviso(
      'vender',
      fraseDelStopPerforado(p.precio, p.stop, moneda),
      [
        p.precio_estado === 'viejo' && 'Es un precio viejo: compruébalo en tu broker antes de actuar.',
        // Fail-safe: lo perfora el último cierre de la lista aunque la cotización
        // de ahora esté por encima. Se dice, con las dos cifras.
        p.precio_fuente === 'cierre_de_la_lista' &&
          cotizacion !== undefined &&
          `La cotización de ahora (${fmtPrecio(cotizacion.precio, moneda)}) está por encima: compruébalo en tu broker.`,
        ...notas,
      ],
      cifrasDelStop(p.precio, p.stop, moneda, 'rojo'),
    )
  }

  // 2. La lista manda vender (puntuación, o su stop con su precio).
  if (lista?.action === 'vender') {
    const base = avisoDeLaLista(lista, null, moneda)
    const porStop = decisiva(lista, 'stop_perforado') !== null
    return aviso(
      'vender',
      base.frase,
      [
        ...base.pasos,
        porStop &&
          p.estado === 'por_encima' &&
          p.precio !== null &&
          `Con el precio de ahora (${fmtPrecio(p.precio, moneda)}) tu límite no está perforado: la lista es de antes; compruébalo en tu broker.`,
        p.estado === 'sin_comprobar' && p.motivo && `El límite de pérdida no se ha podido comprobar con el precio de ahora: ${p.motivo}.`,
      ],
      base.cifras,
    )
  }

  // 3. Lo que no se pudo comprobar no es «en orden». Tampoco un «por encima» sin
  //    precio válido ni stop: un desconocido no pasa por un aprobado.
  const comprobado = p.estado === 'por_encima' && p.precio !== null && p.precio_estado === 'valido' && p.stop !== null
  if (!comprobado) {
    const frase =
      p.precio === null
        ? `No hay precio de hoy: el ${LIMITE} no se ha podido comprobar.`
        : `El ${LIMITE} no se ha podido comprobar${p.motivo ? `: ${p.motivo}` : ''}.`
    return aviso(
      'sin_comprobar',
      frase,
      [AL_BROKER, lista?.action === 'reducir' && 'La lista dice además «Reducir»: la tendencia se giró en contra.', ...notas],
      cifrasDelStop(p.precio, p.stop, moneda, 'gris'),
    )
  }

  // 4. Por encima del stop, con precio válido: lo que diga la lista de la posición.
  const precio = p.precio as number
  const stop = p.stop as number
  if (lista?.action === 'reducir') {
    const base = avisoDeLaLista(lista, precio, moneda)
    return aviso('reducir', base.frase, [`Si cae a ${fmtPrecio(stop, moneda)}, vende: es tu ${LIMITE}.`, ...notas], base.cifras)
  }
  const porEncima = `Cotiza a ${precioFrente(precio, stop, moneda)}, por encima de tu ${LIMITE} de ${fmtPrecio(stop, moneda)}.`
  if (lista?.action === 'mantener') {
    return aviso('mantener', `${porEncima} Tu regla dice mantener.`, [...pasosDeMantener(lista, moneda), ...notas], cifrasDelStop(precio, stop, moneda, 'rojo'))
  }
  // Sin decisión de la lista sobre ella (fuera de este mercado, o abierta después
  // de calcularla): solo su stop.
  return aviso(
    'mantener',
    `${porEncima} De momento, nada que vender.`,
    // Que es solo su stop lo dice quien la pinta (el título de su grupo); la
    // lista sin datos sobre ella, aquí, que no se ve en otra parte.
    [lista?.action === 'sin_datos' && 'La lista no tiene datos para decidir sobre ella: solo se ha mirado su límite de pérdida.', ...notas],
    cifrasDelStop(precio, stop, moneda, 'rojo'),
  )
}

/** Lo que cambiaría una «mantener» a «reducir», con el umbral del motor. */
function pasosDeMantener(decision: Decision, moneda: string | null | undefined): string[] {
  const reducir = hacia(decision, 'reducir')?.condiciones.find((c) => c.regla === 'tendencia_perdida' && numero(c.umbral))
  return reducir && numero(reducir.umbral) ? [`Si cierra a ${fmtPrecio(reducir.umbral, moneda)} o menos, tu regla dice reducir.`] : []
}

/** Por qué el stop de una posición sin repaso no se ha podido comprobar, o
 *  `null` si se comprobó: con la traza, la regla `stop_perforado` evaluada con un
 *  precio que no es viejo; sin traza (una respuesta antigua), el precio de la
 *  lista por encima del stop. Una regla que falta o no se pudo evaluar no cuenta
 *  como cumplida: es «no se sabe». */
function stopSinComprobar(decision: Decision, precio: number | null | undefined, stop: number | null | undefined): string | null {
  if (conPrecioViejo(decision)) return `El ${LIMITE} no se ha podido comprobar: solo hay un precio viejo (todas las fuentes fallaron).`
  const reglas = decision.reglas ?? []
  const delStop = reglas.find((r) => r.id === 'stop_perforado')
  if (delStop?.resultado === 'desconocido') {
    // El motor la deja sin evaluar cuando no hay stop: ni fijado al abrir ni un coste con que calcularlo.
    return `El ${LIMITE} no se ha podido comprobar: la posición no tiene stop ni coste con que calcularlo.`
  }
  if (delStop) return null
  if (reglas.length > 0) return `El ${LIMITE} no se ha podido comprobar.`
  if (!numero(precio)) return `No hay precio de hoy: el ${LIMITE} no se ha podido comprobar.`
  if (!numero(stop)) return `El ${LIMITE} no se ha podido comprobar: la lista no trae el stop de la posición.`
  return precio > stop ? null : `El ${LIMITE} no se ha podido comprobar.`
}

/** Una posición sin repaso del stop: lo que diga la lista. */
function avisoDeLaLista(decision: Decision, precio: number | null | undefined, moneda: string | null | undefined): Aviso {
  const stop = decision.levels?.stop
  const precioViejo = conPrecioViejo(decision) && 'Es un precio viejo: compruébalo en tu broker antes de actuar.'
  const primera = (decision.reasons ?? [])[0]

  if (decision.action === 'vender') {
    const porStop = decisiva(decision, 'stop_perforado')
    const porPuntuacion = decisiva(decision, 'puntuacion_desfavorable')
    const frase = porStop
      ? fraseDelStopPerforado(porStop.valor, porStop.umbral, moneda)
      : porPuntuacion
        ? `Su puntuación frente a sus comparables cayó a ${fmtFrente(porPuntuacion.valor, [porPuntuacion.umbral], { signo: true })}, ` +
          `en o por debajo de ${fmtNum(porPuntuacion.umbral, 2, { signo: true })}: la razón para tenerla ya no se sostiene. Tu regla dice vender.`
        : `${primera ? `${primera} ` : ''}Tu regla dice vender.`
    return aviso('vender', frase, [precioViejo], cifrasDelStop(porStop?.valor ?? precio, porStop?.umbral ?? stop, moneda, 'rojo'))
  }

  if (decision.action === 'reducir') {
    const tendencia = decisiva(decision, 'tendencia_perdida')
    const frase = tendencia
      ? `La tendencia se giró en contra: cotiza a ${precioFrente(tendencia.valor, tendencia.umbral, moneda)}, ` +
        `en o por debajo de ${fmtPrecio(tendencia.umbral, moneda)}. Tu regla dice reducir.`
      : `La tendencia se giró en contra. Tu regla dice reducir.`
    return aviso(
      'reducir',
      frase,
      [stop !== undefined && stop !== null && `Si cae a ${fmtPrecio(stop, moneda)}, vende: es tu ${LIMITE}.`, precioViejo],
      [
        { rotulo: 'Precio', valor: fmtPrecio(tendencia?.valor ?? precio, moneda) },
        ...(tendencia ? [{ rotulo: 'Reducir en o por debajo de', valor: fmtPrecio(tendencia.umbral, moneda), tono: 'naranja' as const }] : []),
        ...(stop !== undefined && stop !== null ? [{ rotulo: 'Límite de pérdida (stop)', valor: fmtPrecio(stop, moneda), tono: 'rojo' as const }] : []),
      ],
    )
  }

  if (decision.action === 'mantener') {
    // Lo que no se pudo comprobar no es «Mantener», tampoco sin el repaso: con él,
    // un precio viejo o un stop desconocido son «Revisar» (`avisoDePosicion`); sin
    // él —el repaso falló, o la ficha, que no lo tiene— salían «Mantener» con una
    // nota (revisión 15, H13).
    const porque = stopSinComprobar(decision, precio, stop)
    if (porque !== null) {
      return aviso('sin_comprobar', porque, [AL_BROKER, 'Con lo que sí pudo mirar, tu regla dice mantener.'], cifrasDelStop(precio, stop, moneda, 'gris'))
    }
    const frase =
      numero(precio) && numero(stop) && precio > stop
        ? `Cotiza a ${precioFrente(precio, stop, moneda)}, por encima de tu ${LIMITE} de ${fmtPrecio(stop, moneda)}. Tu regla dice mantener.`
        : numero(stop)
          ? `Tu regla dice mantener. Si cae a ${fmtPrecio(stop, moneda)}, vende: es tu ${LIMITE}.`
          : 'Tu regla dice mantener.'
    return aviso('mantener', frase, pasosDeMantener(decision, moneda), numero(stop) ? cifrasDelStop(precio, stop, moneda, 'rojo') : [])
  }

  // Una posición sin datos para decidir: su stop tampoco se ha comprobado.
  return aviso('sin_comprobar', `Sin datos para decidir: el ${LIMITE} no se ha podido comprobar.`, [primera, AL_BROKER])
}

function avisoDeCompra(decision: Decision, tamano: TamanoDeLaIdea | undefined, moneda: string | null | undefined): Aviso {
  const nv = decision.levels
  const zona =
    nv && numero(nv.entrada_desde) && numero(nv.entrada_hasta)
      ? `Compra entre ${fmtPrecio(nv.entrada_desde, moneda)} y ${fmtPrecio(nv.entrada_hasta, moneda)}.`
      : 'Cumple las reglas de compra.'
  const salida = nv && numero(nv.stop) ? ` Si cae a ${fmtPrecio(nv.stop, moneda)}, vende: es tu ${LIMITE}.` : ''
  const bruto = nv?.peso_bruto_pct
  const peso = tamano?.pesoFinalPct
  const refutada = avisoDeRefutada(decision)

  const cifras: CifraDeAviso[] = []
  if (nv && numero(nv.entrada_desde) && numero(nv.entrada_hasta)) {
    cifras.push({ rotulo: 'Comprar entre', valor: `${fmtPrecio(nv.entrada_desde, moneda)}–${fmtPrecio(nv.entrada_hasta, moneda)}` })
  }
  if (nv && numero(nv.stop)) cifras.push({ rotulo: 'Vender si baja a', valor: fmtPrecio(nv.stop, moneda), tono: 'rojo' })

  // «No cabe», con el paso del dimensionador que la deja fuera: el FINAL que la
  // toca. El primero podía ser un «10,9 % → 10,0 % (tope por posición)» que no
  // explica ningún cero (DXCM e ITW en la demostración).
  const sinSitio = () => {
    const motivo = tamano?.recortes.length ? resumenDelRecorte(tamano.recortes[tamano.recortes.length - 1]) : null
    return aviso(
      'comprar_sin_sitio',
      'Buena idea, pero hoy no cabe en tu cartera.',
      [refutada, motivo ?? 'Los topes de tu cartera la dejan en 0 %.', 'Para hacerle sitio tendrías que vender algo antes.'],
      cifras,
    )
  }

  // Sin peso final, el bruto no se enseña como si lo fuera: es lo que permitiría
  // el stop mirando la empresa sola, antes de los topes de la cartera (ítem 2.1).
  if (peso === null || peso === undefined) {
    if (tamano?.sinHueco) {
      // Sin dimensionar (fuera de la lista corta), pero no cabe ninguna idea nueva:
      // ella tampoco. Su tamaño no se calculó, y no se escribe como un cero.
      cifras.push({ rotulo: 'Cuánto de tu cartera', valor: '—', nota: 'sin calcular: hoy no cabe ninguna idea nueva' })
      return sinSitio()
    }
    const deBruto = numero(bruto) ? `; antes de los topes, ${fmtPct(bruto, 1, { enPuntos: true })}` : ''
    cifras.push({ rotulo: 'Cuánto de tu cartera', valor: '—', nota: `sin calcular${deBruto}` })
    return aviso(
      'comprar_sin_tamano',
      zona + salida,
      [
        refutada,
        numero(bruto)
          ? `Tamaño sin calcular para tu cartera: su stop permitiría hasta un ${fmtPct(bruto, 1, { enPuntos: true })}, antes de los topes de la cartera.`
          : 'Tamaño sin calcular para tu cartera.',
      ],
      cifras,
    )
  }

  const recortado = numero(bruto) && peso < bruto
  // Un peso de 0,04 no se escribe «0,0 %»: solo el cero es «no cabe».
  const escrito = fmtFrente(peso / 100, 0, { pct: true })
  cifras.push({
    rotulo: 'Cuánto de tu cartera',
    valor: escrito,
    nota: recortado ? `recortado desde ${fmtPct(bruto, 1, { enPuntos: true })}` : undefined,
  })
  if (peso === 0) return sinSitio()
  return aviso('comprar', zona + salida, [refutada, `Tamaño sugerido: ${escrito} de tu cartera.`], cifras)
}

function avisoDeEspera(decision: Decision, moneda: string | null | undefined): Aviso {
  const alt = hacia(decision, 'comprar')
  const refutada = avisoDeRefutada(decision)
  if (!alt) {
    // Sin «qué la cambiaría» no se calcula un precio a partir de los niveles: se
    // dice lo que dicen sus disparadores, que son del motor.
    return aviso('esperar', 'Todavía no: la regla espera antes de comprar.', [refutada, ...(decision.triggers ?? [])])
  }
  const tendencia = alt.condiciones.find((c) => c.regla === 'tendencia_a_favor' && numero(c.umbral))
  const cifras: CifraDeAviso[] =
    tendencia && numero(tendencia.umbral)
      ? [
          { rotulo: 'Comprar si cierra a', valor: `${fmtPrecio(tendencia.umbral, moneda)} o más`, tono: 'verde' },
          ...(numero(tendencia.distancia) && tendencia.distancia > 0 ? [{ rotulo: 'Le falta', valor: falta(tendencia.distancia) }] : []),
        ]
      : []
  return aviso('esperar', `Compra cuando ${clausulas(alt, moneda)}.`, [refutada], cifras)
}

/**
 * El aviso de una empresa o de una posición. Ver la cabecera del archivo.
 *
 * Con `stop` (la tienes), el repaso del stop manda, y de la lista solo cuenta una
 * decisión de posición (`owned`): una «comprar» de una lista calculada antes de
 * abrirla no es sobre tu posición.
 */
export function avisoDe({ decision, tamano, stop, precio, moneda }: DatosDelAviso): Aviso {
  const deLaPosicion = decision?.owned ? decision : null
  if (stop) return avisoDePosicion(stop, deLaPosicion)
  if (!decision) return aviso('sin_datos', 'No hay decisión sobre esta empresa.')
  if (decision.owned) return avisoDeLaLista(decision, precio, moneda)

  switch (decision.action) {
    case 'comprar':
      return avisoDeCompra(decision, tamano, moneda)
    case 'vigilar':
      return avisoDeEspera(decision, moneda)
    case 'evitar':
      return aviso('evitar', 'No la compres: puntúa por detrás de sus comparables de sector.')
    case 'ninguna': {
      const alt = hacia(decision, 'comprar')
      return aviso(
        'sin_accion',
        'Ni destaca ni preocupa frente a sus comparables: no hay motivo para actuar.',
        [alt && `Pasaría a «Comprar» cuando ${clausulas(alt, moneda)}.`],
      )
    }
    case 'sin_datos':
      return aviso('sin_datos', 'Sin datos suficientes para decidir.', [(decision.reasons ?? [])[0]])
    default:
      // mantener, reducir o vender sin `owned`: una decisión de posición igualmente.
      return avisoDeLaLista(decision, precio, moneda)
  }
}

export interface AvisoDePosicion {
  symbol: string
  aviso: Aviso
  /** El repaso del stop, si lo hay. */
  stop: StopDePosicion | null
  /** Su fila de la lista, si la lista la decide como posición. */
  senal: DailySignal | null
}

/**
 * El aviso de CADA posición abierta: del repaso del stop (de ahora) y, si la
 * lista la decide como posición, de esa decisión. Sin repaso (respuesta antigua
 * o fallido), de las filas que la lista decide como tuyas.
 *
 * El recuento «Para vender» y el panel que lo lista salen de aquí: antes el
 * recuento juntaba las ventas de la lista con los stops perforados y el panel
 * solo enseñaba los stops, así que no cuadraban.
 */
export function avisosDeCartera(signals: DailySignal[] | null | undefined, repaso: StopsDeCartera | null | undefined): AvisoDePosicion[] {
  const propias = new Map((signals ?? []).filter((s) => s.decision?.owned).map((s) => [s.symbol, s]))
  if (!carteraRepasada(repaso)) {
    return [...propias.values()].map((s) => ({
      symbol: s.symbol,
      aviso: avisoDe({ decision: s.decision, precio: s.price?.last }),
      stop: null,
      senal: s,
    }))
  }
  // La lista puede venir de la caché (hasta 6 h): con el repaso, que es de ahora,
  // solo cuenta lo que sigue abierto.
  return repaso.posiciones.map((p) => {
    const s = propias.get(p.symbol) ?? null
    return { symbol: p.symbol, aviso: avisoDe({ decision: s?.decision, stop: p, precio: s?.price?.last, moneda: p.moneda }), stop: p, senal: s }
  })
}
