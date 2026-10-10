import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { LlmStatus } from '../api/types'
import { mensajeDeError } from './useDato'

// El estado de la capa de IA no cambia sin reiniciar el backend: se pide una
// sola vez y se comparte entre todos los componentes que lo consultan.
let pending: Promise<LlmStatus> | null = null
// Quien ya está montado se entera del estado que consiga otro. La barra
// lateral lo pide una vez al abrir la app; si esa vez fallaba y luego Noticias
// lo conseguía, la barra seguía diciendo «IA sin comprobar» junto a unos
// botones de IA que sí se ofrecían (revisión del 2.1).
const oyentes = new Set<(s: LlmStatus) => void>()

function load(): Promise<LlmStatus> {
  if (pending === null) {
    pending = api.llmStatus().then(
      (s) => {
        oyentes.forEach((o) => o(s))
        return s
      },
      (err: unknown) => {
        pending = null // un fallo puntual no debe fijar el estado para siempre
        throw err
      },
    )
  }
  return pending
}

/**
 * Estado de la capa de IA y, si no se pudo consultar, por qué.
 *
 * Sin estado conocido (cargando o error), la IA se trata como apagada: los
 * botones de interpretación solo salen con `configured === true`, porque sin
 * `ANTHROPIC_API_KEY` el endpoint devuelve 503 y ofrecerlos sería ofrecer un
 * error. Pero un fallo de la consulta no es «IA apagada»: antes se tragaba y la
 * barra lateral no decía nada; ahora se distingue (ítem 2.1).
 */
export function useLlmEstado(): { status: LlmStatus | null; error: string | null; reintentar: () => void } {
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    let alive = true
    const oyente = (s: LlmStatus) => {
      if (!alive) return
      setStatus(s)
      setError(null)
    }
    oyentes.add(oyente)
    load().then(oyente, (e: unknown) => alive && setError(mensajeDeError(e)))
    return () => {
      alive = false
      oyentes.delete(oyente)
    }
  }, [intento])

  const reintentar = useCallback(() => setIntento((n) => n + 1), [])
  return { status, error, reintentar }
}

/** El estado de la IA, o `null` si aún no se sabe o no se pudo saber. */
export function useLlmStatus(): LlmStatus | null {
  return useLlmEstado().status
}
