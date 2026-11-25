import type { Portfolio, PortfolioPosition, RepasoDeCartera } from '../../api/types'
import { avisosDeCartera, carteraRepasada, type AvisoDePosicion, type TipoAviso } from '../../lib/avisos'
import { fmtAntiguedad, fmtNum } from '../../lib/formato'

/** El estado del límite de pérdida (stop) de UN lote, para su fila de la tabla,
 *  con lo que ya sirve `/api/portfolio` (`stop_perforado`, la regla del motor:
 *  en o por debajo, con los mismos precios que el repaso de su símbolo: la
 *  cotización y, de reserva, el último cierre de la lista).
 *
 *  Fail-safe, con el mismo criterio que el repaso de stops
 *  (`contexto_cartera.stops_de_la_cartera`): perforado si un precio lo perfora,
 *  aunque ese precio sea viejo; «en orden» solo con un precio válido por encima;
 *  todo lo demás, «sin comprobar» con su motivo. Un precio viejo por encima del
 *  stop no dice que siga por encima: en Hoy daba «nada urgente» (revisión 13), y
 *  la tabla del Portafolio lo pintaba como un stop intacto. Un `stop_perforado`
 *  que no llega tampoco es «intacto».
 *
 *  Es por lote: lo que se cuenta de la POSICIÓN (la línea de Mi cartera, Inicio)
 *  sale de `atencionDeCartera`, por símbolo. Con la MISMA regla: el backend sirve
 *  el estado de cada lote (`stop_estado`, de `contexto_cartera.estado_del_stop`,
 *  la del repaso). Con la cotización vieja y el cierre de la lista por encima, la
 *  línea decía «ninguna necesita atención» y la fila del mismo lote, «sin
 *  comprobar»; sin ninguna cotización, al revés (revisión 15, cartera H1). La
 *  cuenta de aquí abajo queda para una respuesta sin `stop_estado`. */
export type EstadoDelStop =
  | { estado: 'perforado' }
  | { estado: 'en_orden' }
  | { estado: 'sin_comprobar'; motivo: string }

export function estadoDelStop(p: PortfolioPosition): EstadoDelStop {
  if (p.stop_estado === 'perforado' || p.stop_perforado === true) return { estado: 'perforado' }
  if (p.stop_estado === 'por_encima') return { estado: 'en_orden' }
  if (p.stop_estado === 'sin_comprobar') {
    return { estado: 'sin_comprobar', motivo: p.stop_motivo ?? 'no se ha podido comprobar su límite de pérdida' }
  }
  if (p.stop === null || p.stop === undefined) {
    return { estado: 'sin_comprobar', motivo: 'no tiene límite de pérdida: ni fijado al anotar la compra ni coste con que calcularlo' }
  }
  if (p.stop_perforado !== false || p.price === null || p.precio_estado === 'desconocido') {
    return { estado: 'sin_comprobar', motivo: 'no hay precio con que comparar su límite de pérdida' }
  }
  if (p.precio_estado === 'viejo') {
    return {
      estado: 'sin_comprobar',
      motivo: 'solo hay un precio viejo: estaba por encima de su límite de pérdida, pero no se puede afirmar que lo siga',
    }
  }
  return { estado: 'en_orden' }
}

/** Los avisos que necesitan atención, del más urgente al menos: lo que Explorar
 *  cuenta en «Para vender» y «sin comprobar», y «Reducir». «Mantener» no. */
const URGENCIA: Partial<Record<TipoAviso, number>> = { vender: 0, reducir: 1, sin_comprobar: 2 }

export type AtencionDeCartera =
  | {
      repasada: true
      /** Posiciones abiertas, por SÍMBOLO (varios lotes son una posición). */
      abiertas: number
      /** El aviso de cada posición, una por símbolo, en el orden del repaso. */
      posiciones: AvisoDePosicion[]
      /** Las que necesitan atención (vender, reducir, sin comprobar), la más urgente primero. */
      avisos: AvisoDePosicion[]
      lista: RepasoDeCartera['lista']
    }
  | {
      /** Sin repaso (falló, o la respuesta no lo trae): no se sabe nada de ningún stop. */
      repasada: false
      abiertas: number
      simbolos: string[]
      error: string
    }

/**
 * El estado de cada posición, POR SÍMBOLO, con la MISMA regla y la MISMA fuente
 * que Explorar: el repaso del stop que sirve `/api/portfolio` (`repaso`, el de
 * `contexto_cartera.stops_de_la_cartera` con la lista guardada) pasado por
 * `avisosDeCartera` (`lib/avisos.ts`), que es lo que cuentan el «Para vender» y
 * el panel de Explorar. Lo leen la línea de Mi cartera y las tarjetas de Inicio.
 *
 * Por qué así y no con la fila de cada lote: Mi cartera e Inicio contaban con
 * `stop_perforado` por lote y solo la cotización, y Explorar con el repaso y las
 * decisiones de la lista. KO con el stop en 118, la lista cerrada a 117 y la
 * cotización a 120 era «Vender» en Explorar y «en orden» en las otras dos; una
 * venta por puntuación no salía ni en Mi cartera ni en Inicio («Nada urgente»);
 * Inicio contaba lotes y repetía el aviso de cada uno; y con un lote sin stop, Mi
 * cartera decía que la POSICIÓN no tenía límite (revisión 14).
 */
export function atencionDeCartera(cartera: Pick<Portfolio, 'positions' | 'repaso'>): AtencionDeCartera {
  const repaso = cartera.repaso
  // Antes de la guarda: fuera de ella, sin repaso válido, TypeScript no deja leerlo.
  const error = repaso?.error
  if (!carteraRepasada(repaso)) {
    const simbolos = [...new Set(cartera.positions.map((p) => p.symbol))]
    return {
      repasada: false,
      abiertas: simbolos.length,
      simbolos,
      error: error ?? 'La respuesta no trae el repaso del límite de pérdida de tus posiciones.',
    }
  }
  const posiciones = avisosDeCartera(repaso.senales ?? [], repaso)
  const urgencia = (a: AvisoDePosicion) => URGENCIA[a.aviso.tipo] ?? Infinity
  const avisos = posiciones.filter((a) => urgencia(a) !== Infinity).sort((a, b) => urgencia(a) - urgencia(b))
  return { repasada: true, abiertas: repaso.abiertas ?? posiciones.length, posiciones, avisos, lista: repaso.lista ?? null }
}

/** Si el aviso sale de la decisión de la lista (una venta por puntuación, una
 *  tendencia perdida) y no del repaso del stop, que es de ahora: con una lista
 *  vieja, hay que decir de cuándo es. */
export function deLaLista(a: AvisoDePosicion): boolean {
  return a.senal !== null && a.stop?.estado !== 'perforado' && (a.aviso.tipo === 'vender' || a.aviso.tipo === 'reducir')
}

/** Si la regla de la lista ha decidido sobre la posición (vender por puntuación,
 *  reducir por tendencia o mantener): la lista la trata como posición y tiene
 *  datos para decidir. De las demás solo se ha mirado su límite de pérdida. */
export function decidida(a: AvisoDePosicion): boolean {
  return a.senal !== null && a.senal.decision?.action !== 'sin_datos'
}

/** Por qué de una posición solo se ha mirado su límite de pérdida. */
export function porQueSoloSuStop(a: AvisoDePosicion, lista: RepasoDeCartera['lista']): string {
  if (a.stop?.pendiente) {
    const deCuantas =
      lista?.puntuadas != null && lista?.pedidas != null ? `: ${fmtNum(lista.puntuadas, 0)} de ${fmtNum(lista.pedidas, 0)}` : ''
    return `la lista va a medias y aún no la ha puntuado${deCuantas}`
  }
  if (a.senal?.decision?.action === 'sin_datos') return 'la lista no tiene datos para decidir sobre ella'
  if (a.stop?.en_lista) return 'la lista se calculó antes de que la abrieras'
  return 'no está en la lista del día'
}

/**
 * De qué posiciones habla la regla de la lista y de cuándo es, para no afirmar
 * nada de las que no ha mirado. Inicio decía «Nada urgente: … y la regla no
 * manda vender ni reducir ninguna» y Mi cartera «ninguna necesita atención» de
 * SHOP.TO (fuera de la lista del S&P 500), de una posición abierta después de
 * calcular la lista, de las aún sin puntuar en una lista parcial (40 de 502) y
 * con la lista caducada de hace días, sin decir de cuándo era la regla
 * (revisión 15, cartera H2 y costuras H2).
 *
 * `soloSuStop`: «De SHOP.TO (no está en la lista del día) solo se ha mirado su
 * límite de pérdida.», o `null` si la regla las decide todas. `vieja`: «la lista
 * del día guardada hace 5 días, que ya caducó», o `null` si no lo está.
 */
export function alcanceDeLaRegla(a: Extract<AtencionDeCartera, { repasada: true }>): {
  decididas: number
  soloSuStop: string | null
  vieja: string | null
} {
  const solo = a.posiciones.filter((x) => !decidida(x))
  const porMotivo = new Map<string, string[]>()
  for (const x of solo) {
    const motivo = porQueSoloSuStop(x, a.lista)
    porMotivo.set(motivo, [...(porMotivo.get(motivo) ?? []), x.symbol])
  }
  const partes = [...porMotivo].map(([motivo, simbolos]) => `${unir(simbolos)} (${motivo})`)
  return {
    decididas: a.posiciones.length - solo.length,
    soloSuStop: partes.length > 0 ? `De ${partes.join('; de ')} solo se ha mirado su límite de pérdida.` : null,
    vieja:
      a.lista?.estado === 'viejo'
        ? `la lista del día guardada ${a.lista.as_of ? fmtAntiguedad(a.lista.as_of) : '(sin fecha)'}, que ya caducó`
        : null,
  }
}

/** «a», «a y b», «a, b y c». */
function unir(partes: string[]): string {
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}
