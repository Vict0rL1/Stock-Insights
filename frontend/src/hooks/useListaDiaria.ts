/**
 * La lista del día de un mercado (`/api/signals/today`) sin bloquear la pantalla
 * (docs/PLAN_NAVEGACION.md, «La primera carga, sin bloquear»).
 *
 * Sin lista vigente en la caché del backend (6 h), Hoy se quedaba en «Puntuando
 * el universo…» los minutos que tarda una pasada. Ahora:
 *
 * 1. Se pide la lista GUARDADA (`vencida=aceptar`), que no calcula nada:
 *    - la vigente → es la de siempre y se enseña (`estado: 'lista'`);
 *    - una caducada → se enseña al momento con su antigüedad (`estado: 'vieja'`)
 *      y se pide la normal detrás, que la sustituye al llegar;
 *    - 404, ninguna guardada (primera vez de todas, o más de una semana sin
 *      abrir la app) → la primera pasada se pide CORTA (`PRIMERA_PASADA`) para
 *      enseñar algo en segundos (`estado: 'cargando'`, `primeraVez: true`);
 *    - otro fallo → no se sabe si hay copia: se pide la normal, como antes.
 * 2. Mientras la lista no cubra el mercado entero (`complete: false`), se
 *    encadenan hasta `MAX_PASADAS_AUTO` pasadas `refresh=true`; cada una
 *    sustituye a la anterior sin vaciar lo que ya se ve.
 *
 * CONTRATO (lo usan Hoy, Inicio y Explorar):
 *
 *   const lista = useListaDiaria('us_sp500')
 *
 *   lista.data                La lista que hay que enseñar (la más reciente que
 *                             llegó), o null si aún no hay ninguna.
 *   lista.estado              'cargando'      no hay nada que enseñar y se está pidiendo;
 *                             'vieja'         `data` es la copia caducada y se pide la de ahora;
 *                             'actualizando'  `data` es de ahora y hay una pasada en marcha;
 *                             'lista'         `data` es de ahora y no se está pidiendo nada;
 *                             'error'         falló la última petición (`error`); `data`
 *                                             sigue siendo lo último bueno, si lo hay.
 *   lista.antiguedadSegundos  Solo si `data` es la copia caducada: su edad según el
 *                             backend (null si no la dijo: no saberla no es «de ahora»).
 *   lista.progreso            { puntuadas, total, pendientes, completa } de `data`, o null.
 *   lista.pasada              Pasada automática en curso (1…maxPasadas), 0 si ninguna.
 *   lista.maxPasadas          `MAX_PASADAS_AUTO`.
 *   lista.primeraVez          No había ninguna lista guardada y va la primera pasada corta.
 *   lista.error               { mensaje, reintentar } o null. `reintentar` repite la
 *                             petición que falló (misma pasada).
 *   lista.ocupado             Hay una petición en marcha (para deshabilitar botones).
 *   lista.actualizar()        Recalcula (`refresh=true`) y sigue completando solo.
 *   lista.seguirCompletando() Lo mismo, desde «Seguir completando».
 *
 * TODO SE COMPARTE POR MERCADO, A NIVEL DE MÓDULO, no por componente: las
 * peticiones en vuelo (por mercado y tipo de pasada), la última lista recibida y
 * la cadena de pasadas. Inicio y Explorar montan el hook en momentos distintos,
 * y StrictMode lo monta dos veces: con estado propio eran dos puntuaciones y dos
 * cadenas de hasta cuatro pasadas, el doble de cuota de APIs gratuitas para lo
 * mismo (segunda revisión del 2.1, que lo arregló solo dentro de Hoy). Un
 * componente que monta con la lista ya recibida la enseña sin pedir nada; si
 * tiene más de `REVALIDAR_TRAS_MS`, la vuelve a pedir una vez (el repaso de stops
 * viaja en cada respuesta y es de cuando llegó).
 *
 * Una cadena de pasadas sin nadie mirando (se cambió de mercado o de pantalla)
 * no pide la siguiente: cada pasada gasta cuota para un mercado que nadie ve. La
 * petición que ya iba termina y guarda su lista; al volver alguien, la cadena
 * sigue por donde iba.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { api, ApiError } from '../api/client'
import type { TodayResponse } from '../api/types'
import { mensajeDeError } from '../lib/useDato'

/** Empresas NUEVAS que descarga la primera pasada cuando no hay ninguna lista
 *  guardada (cada una cuenta una vez en el `budget` del backend: su companyfacts
 *  de EDGAR o, si EDGAR no la tiene, sus fundamentales de Finnhub).
 *
 *  - Segundos, no minutos: un companyfacts pesa varios MB y tarda de 0,3 a 1 s,
 *    así que 40 son unos 15-40 s, frente a los uno o dos minutos de las 120 de
 *    una pasada normal (`DEFAULT_FETCH_BUDGET`).
 *  - Cuota: aunque EDGAR fallara entero y las 40 fueran a Finnhub (60/min), quedan
 *    20 llamadas en ese minuto para lo que Inicio pide a la vez (cotizaciones de
 *    la cartera, calendario, noticias). Con 120 no quedaría ninguna. Contra la SEC
 *    (300/min que se permite la app) las pasadas van una detrás de otra, nunca a
 *    la vez, y no llegan a ese ritmo.
 *  - Cobertura: 40 + 4 pasadas de 120 son 520 ≥ 502, el S&P 500 (el universo más
 *    grande), así que las pasadas automáticas lo completan sin pulsar nada.
 *  - El presupuesto se gasta sector a sector, en el orden del universo: en el
 *    S&P 500, 40 cubren el primer sector entero (22) y parte del segundo; con
 *    menos de 25 la primera lista sería de un solo sector, porque uno con menos
 *    de 3 puntuadas se descarta entero. Es una lista PARCIAL y lo dice
 *    (`ProgresoAnalisis`: «40 de 502 empresas»). */
export const PRIMERA_PASADA = 40

/** Pasadas `refresh=true` que se encadenan solas (cada una con el presupuesto
 *  por defecto del backend, 120). Completar la cobertura a mano era pulsar el
 *  mismo botón tres o cuatro veces para llegar a lo que la app ya sabe que
 *  falta; el tope existe porque cada pasada gasta cuota de APIs gratuitas y
 *  agotarla en silencio dejaría el resto del día sin datos. */
export const MAX_PASADAS_AUTO = 4

/** Una lista recibida hace menos de esto se enseña tal cual a quien monta el
 *  hook; más vieja, se vuelve a pedir una vez. Un minuto es lo que vive una
 *  cotización en la caché del backend: antes, la petición traería el mismo
 *  repaso de stops. */
export const REVALIDAR_TRAS_MS = 60_000

export type EstadoLista = 'cargando' | 'vieja' | 'actualizando' | 'lista' | 'error'

export interface ProgresoLista {
  puntuadas: number
  total: number
  /** null si la respuesta no lo trae (versión antigua): no es «ninguna». */
  pendientes: number | null
  completa: boolean
}

export interface ErrorDeLista {
  mensaje: string
  reintentar: () => void
}

export interface ListaDiaria {
  data: TodayResponse | null
  estado: EstadoLista
  antiguedadSegundos: number | null
  progreso: ProgresoLista | null
  pasada: number
  maxPasadas: number
  primeraVez: boolean
  error: ErrorDeLista | null
  ocupado: boolean
  actualizar: () => void
  seguirCompletando: () => void
}

type Vista = Omit<ListaDiaria, 'actualizar' | 'seguirCompletando'>

/** Qué se pide: la guardada (`vencida=aceptar`), la primera pasada corta, la
 *  normal o una pasada `refresh=true`. Es también la clave de las peticiones en
 *  vuelo, con el mercado. */
type Paso = 'guardada' | 'primera' | 'normal' | 'refresh'

/** Una revalidación (montar con una lista de hace rato) solo encadena pasadas
 *  si el backend la recalculó: una lista guardada a medias ya tuvo su cadena, y
 *  repetirla en cada cambio de pantalla gastaría cuota cada vez. Para eso está
 *  «Seguir completando». */
type Encadenar = 'siempre' | 'si_recalculada'

interface Interno {
  data: TodayResponse | null
  vieja: boolean
  ocupado: boolean
  paso: Paso | null
  pasada: number
  error: ErrorDeLista | null
  /** Cuándo llegó la última respuesta, buena o mala (`Date.now()`). */
  respuestaEn: number | null
}

interface Entrada {
  interno: Interno
  vista: Vista
  oyentes: Set<() => void>
  /** Cada carga que se inicia es una cadena con su número; una respuesta de una
   *  cadena que ya no es la vigente se descarta (revisión del 2.1: el aviso de
   *  una pasada vieja quedaba encima de la lista buena). */
  cadena: number
  /** La pasada con la que seguir cuando vuelva alguien a mirar. */
  reanudar: number | null
}

const INICIAL: Interno = {
  data: null, vieja: false, ocupado: false, paso: null, pasada: 0, error: null, respuestaEn: null,
}

const entradas = new Map<string, Entrada>()
const enVuelo = new Map<string, Promise<TodayResponse>>()

function vistaDe(i: Interno): Vista {
  const d = i.data
  const estado: EstadoLista = i.error
    ? 'error'
    : !d
      ? 'cargando'
      : i.vieja
        ? 'vieja'
        : i.ocupado
          ? 'actualizando'
          : 'lista'
  // Una respuesta con otra forma (versión antigua) no trae las cuentas: sin
  // ellas no hay progreso que enseñar, y no se rellena con ceros.
  const progreso =
    d && typeof d.scored === 'number' && typeof d.requested === 'number'
      ? {
          puntuadas: d.scored,
          total: d.requested,
          pendientes: typeof d.pending === 'number' ? d.pending : null,
          completa: d.complete === true,
        }
      : null
  return {
    data: d,
    estado,
    antiguedadSegundos: i.vieja ? (d?.antiguedad_segundos ?? null) : null,
    progreso,
    pasada: i.pasada,
    maxPasadas: MAX_PASADAS_AUTO,
    primeraVez: i.paso === 'primera',
    error: i.error,
    ocupado: i.ocupado,
  }
}

function entrada(market: string): Entrada {
  let e = entradas.get(market)
  if (!e) {
    e = { interno: INICIAL, vista: vistaDe(INICIAL), oyentes: new Set(), cadena: 0, reanudar: null }
    entradas.set(market, e)
  }
  return e
}

function cambiar(e: Entrada, parcial: Partial<Interno>): void {
  e.interno = { ...e.interno, ...parcial }
  e.vista = vistaDe(e.interno)
  for (const avisar of e.oyentes) avisar()
}

/** La petición de `paso` para `market`; si ya hay una igual en vuelo, esa. */
function pedir(market: string, paso: Paso): Promise<TodayResponse> {
  const clave = `${market}|${paso}`
  const previa = enVuelo.get(clave)
  if (previa) return previa
  const promesa =
    paso === 'guardada'
      ? api.todayGuardada(market)
      : paso === 'primera'
        ? api.today(market, false, PRIMERA_PASADA)
        : api.today(market, paso === 'refresh')
  enVuelo.set(clave, promesa)
  // Solo saca la petición del mapa: su fallo lo atiende la cadena.
  const soltar = () => {
    if (enVuelo.get(clave) === promesa) enVuelo.delete(clave)
  }
  void promesa.then(soltar, soltar)
  return promesa
}

function esVigente(market: string, e: Entrada, mia: number): boolean {
  return entradas.get(market) === e && e.cadena === mia
}

function iniciar(market: string, paso: Paso, pasada = 0, encadenar: Encadenar = 'siempre'): void {
  const e = entrada(market)
  const mia = ++e.cadena
  e.reanudar = null
  cambiar(e, { ocupado: true, error: null })
  dar(market, e, mia, paso, pasada, encadenar)
}

function dar(market: string, e: Entrada, mia: number, paso: Paso, pasada: number, encadenar: Encadenar): void {
  cambiar(e, { paso, pasada })
  pedir(market, paso).then(
    (d) => {
      if (!esVigente(market, e, mia)) return
      const vieja = paso === 'guardada' && d.estado === 'viejo'
      cambiar(e, { data: d, vieja, respuestaEn: Date.now() })
      // La copia caducada se enseña y se pide la de ahora detrás.
      if (vieja) dar(market, e, mia, 'normal', 0, encadenar)
      else seguir(market, e, mia, d, pasada, encadenar)
    },
    (err: unknown) => {
      if (!esVigente(market, e, mia)) return
      if (paso === 'guardada') {
        // 404: no hay ninguna guardada, y la primera pasada va corta. Otro fallo
        // no dice si la hay: la normal, como antes de existir la guardada.
        dar(market, e, mia, err instanceof ApiError && err.status === 404 ? 'primera' : 'normal', 0, encadenar)
        return
      }
      cambiar(e, {
        ocupado: false,
        paso: null,
        pasada: 0,
        respuestaEn: Date.now(),
        error: { mensaje: mensajeDeError(err), reintentar: () => iniciar(market, paso, pasada, encadenar) },
      })
    },
  )
}

function seguir(market: string, e: Entrada, mia: number, d: TodayResponse, pasada: number, encadenar: Encadenar): void {
  const toca =
    d.complete === false && pasada < MAX_PASADAS_AUTO && (encadenar === 'siempre' || d.cached === false)
  if (toca && e.oyentes.size > 0) {
    dar(market, e, mia, 'refresh', pasada + 1, 'siempre')
    return
  }
  cambiar(e, { ocupado: false, paso: null, pasada: 0 })
  if (toca) e.reanudar = pasada + 1
}

/** Lo que hace falta al montar: nada si ya va algo o la lista es reciente. */
function asegurar(market: string): void {
  const e = entrada(market)
  const i = e.interno
  if (i.ocupado) return
  if (e.reanudar !== null) {
    iniciar(market, 'refresh', e.reanudar)
    return
  }
  if (!i.data && !i.error) {
    iniciar(market, 'guardada')
    return
  }
  if (i.respuestaEn !== null && Date.now() - i.respuestaEn < REVALIDAR_TRAS_MS) return
  if (i.error) i.error.reintentar()
  else iniciar(market, 'normal', 0, 'si_recalculada')
}

function suscribir(market: string, avisar: () => void): () => void {
  const e = entrada(market)
  e.oyentes.add(avisar)
  return () => {
    e.oyentes.delete(avisar)
  }
}

export function useListaDiaria(market: string): ListaDiaria {
  const suscribirse = useCallback((avisar: () => void) => suscribir(market, avisar), [market])
  const leer = useCallback(() => entrada(market).vista, [market])
  const vista = useSyncExternalStore(suscribirse, leer, leer)
  useEffect(() => {
    asegurar(market)
  }, [market])
  const actualizar = useCallback(() => iniciar(market, 'refresh'), [market])
  return useMemo(() => ({ ...vista, actualizar, seguirCompletando: actualizar }), [vista, actualizar])
}

/** Solo para los tests (`src/test/setup.ts`): olvida listas, cadenas y peticiones
 *  en vuelo, para que un test no herede la lista del anterior. Lo que llegue
 *  después de una cadena olvidada se descarta. */
export function olvidarListasDiarias(): void {
  entradas.clear()
  enVuelo.clear()
}
