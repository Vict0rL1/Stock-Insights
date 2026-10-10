import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'

/** Lo que puede pasar al pedir un bloque de datos: tres estados y ninguno más.
 *
 *  Antes cada pantalla se hacía el suyo con dos o tres `useState`, y una docena
 *  convertía el fallo en vacío (`() => setIndices([])`): un error se pintaba
 *  como «no hay datos», y en Portafolio unas alertas que no cargaban salían
 *  «Sin alertas configuradas» (ítem 2.1). Aquí el error es su propio estado. */
export type Carga<T> =
  | { estado: 'cargando'; datos: null; error: null }
  | { estado: 'listo'; datos: T; error: null }
  | { estado: 'error'; datos: null; error: string }

export type CargaConReintento<T> = Carga<T> & {
  /** Desde un error: vuelve a «cargando» y pide otra vez. */
  reintentar: () => void
  /** Tras una acción que cambia los datos: pide otra vez sin quitar de la
   *  pantalla lo que ya se ve hasta que llega lo nuevo. */
  refrescar: () => void
  /** Hay un `refrescar()` en marcha: lo que se ve es lo anterior. */
  refrescando: boolean
}

const CARGANDO = { estado: 'cargando', datos: null, error: null } as const

type Clave = string | number | null

export function mensajeDeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Lo que la fuente no tiene: un 404 del backend (`DataNotFoundError`), con el
 *  motivo que da («SHOP.TO no está registrado en la SEC», «no cotiza
 *  opciones»). No es un fallo: «Reintentar» no lo arreglaría nunca. Las
 *  secciones de la ficha lo pintaban como «No se pudo cargar…» (revisión del
 *  2.1). El campo `ausencia` la distingue en los tipos: sin él, cualquier tipo
 *  de la API con un `motivo` de texto contaría como ausencia en `Exclude`. */
export class Ausencia {
  readonly ausencia = true as const
  constructor(readonly motivo: string) {}
}

function esNoEncontrado(e: unknown): e is ApiError {
  return e instanceof ApiError && e.status === 404
}

/** Un 404 resuelve a `Ausencia` con su motivo; cualquier otro error sigue
 *  siendo un error. Solo para rutas que separan 404 (no lo tiene) de 502 (no
 *  respondió): el informe completo, por ejemplo, da 404 también si EDGAR cae. */
export function ausenteSi404<T>(peticion: Promise<T>): Promise<T | Ausencia> {
  return peticion.catch((e: unknown) => {
    if (esNoEncontrado(e)) return new Ausencia(e.message)
    throw e
  })
}

/** Igual, pero a `null`: para la cabecera de la ficha, que decide con las tres
 *  piezas si el símbolo existe. */
export function nullSi404<T>(peticion: Promise<T>): Promise<T | null> {
  return peticion.catch((e: unknown) => {
    if (esNoEncontrado(e)) return null
    throw e
  })
}

/** Pide `cargar()` cada vez que cambia `clave` (o al reintentar o refrescar).
 *
 *  - Al cambiar de clave vuelve a «cargando» EN ESE MISMO RENDER: cada carga
 *    guarda de qué clave es, y la de otra clave no se devuelve. Antes el reset
 *    iba en el efecto y quedaba un render con los datos del símbolo anterior
 *    bajo la cabecera del nuevo, y en ese render una pestaña hija ya pedía lo
 *    suyo con el símbolo nuevo (revisión del 2.1).
 *  - Una respuesta que llega tarde, de una clave anterior, se descarta.
 *  - `clave = null` no pide nada y se queda en «cargando» (sin símbolo aún).
 *  - `refrescar()` no pasa por «cargando»: tras «Capturar expectativas» la
 *    lectura, la lista y la calibración desaparecían mientras recargaban y la
 *    página saltaba (revisión del 2.1). */
export function useDato<T>(cargar: () => Promise<T>, clave: Clave): CargaConReintento<T> {
  const [estado, setEstado] = useState<{ de: Clave | undefined; carga: Carga<T>; refrescando: boolean }>({
    de: undefined,
    carga: CARGANDO,
    refrescando: false,
  })
  const [intento, setIntento] = useState(0)
  // `cargar` suele ser una función nueva en cada render; lo que decide cuándo
  // pedir es la clave, no la identidad de la función.
  const ref = useRef(cargar)
  ref.current = cargar
  const conservar = useRef(false)

  useEffect(() => {
    if (clave === null) return
    let vigente = true
    if (conservar.current) setEstado((e) => ({ ...e, refrescando: true }))
    else setEstado({ de: clave, carga: CARGANDO, refrescando: false })
    conservar.current = false
    ref.current().then(
      (datos) => vigente && setEstado({ de: clave, carga: { estado: 'listo', datos, error: null }, refrescando: false }),
      (e: unknown) =>
        vigente &&
        setEstado({ de: clave, carga: { estado: 'error', datos: null, error: mensajeDeError(e) }, refrescando: false }),
    )
    return () => {
      vigente = false
    }
  }, [clave, intento])

  const reintentar = useCallback(() => setIntento((n) => n + 1), [])
  const refrescar = useCallback(() => {
    conservar.current = true
    setIntento((n) => n + 1)
  }, [])
  const propia = estado.de === clave
  return { ...(propia ? estado.carga : CARGANDO), refrescando: propia && estado.refrescando, reintentar, refrescar }
}
