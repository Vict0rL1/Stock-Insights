import { useCallback, useEffect, useRef, useState } from 'react'

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

export type CargaConReintento<T> = Carga<T> & { reintentar: () => void }

const CARGANDO = { estado: 'cargando', datos: null, error: null } as const

export function mensajeDeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Pide `cargar()` cada vez que cambia `clave` (o al reintentar).
 *
 *  - Al cambiar de clave vuelve a «cargando»: antes, al pasar de un símbolo a
 *    otro, el gráfico del anterior seguía bajo la cabecera del nuevo.
 *  - Una respuesta que llega tarde, de una clave anterior, se descarta.
 *  - `clave = null` no pide nada y se queda en «cargando» (sin símbolo aún). */
export function useDato<T>(cargar: () => Promise<T>, clave: string | number | null): CargaConReintento<T> {
  const [carga, setCarga] = useState<Carga<T>>(CARGANDO)
  const [intento, setIntento] = useState(0)
  // `cargar` suele ser una función nueva en cada render; lo que decide cuándo
  // pedir es la clave, no la identidad de la función.
  const ref = useRef(cargar)
  ref.current = cargar

  useEffect(() => {
    if (clave === null) return
    let vigente = true
    setCarga(CARGANDO)
    ref.current().then(
      (datos) => vigente && setCarga({ estado: 'listo', datos, error: null }),
      (e: unknown) => vigente && setCarga({ estado: 'error', datos: null, error: mensajeDeError(e) }),
    )
    return () => {
      vigente = false
    }
  }, [clave, intento])

  const reintentar = useCallback(() => setIntento((n) => n + 1), [])
  return { ...carga, reintentar }
}
