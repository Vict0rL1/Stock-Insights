import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { LlmStatus } from '../api/types'
import { mensajeDeError } from './useDato'

// El estado de la capa de IA no cambia sin reiniciar el backend: se pide una
// sola vez y se comparte entre todos los componentes que lo consultan.
let pending: Promise<LlmStatus> | null = null

function load(): Promise<LlmStatus> {
  if (pending === null) {
    pending = api.llmStatus().catch((err) => {
      pending = null // un fallo puntual no debe fijar el estado para siempre
      throw err
    })
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
export function useLlmEstado(): { status: LlmStatus | null; error: string | null } {
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    load().then(
      (s) => alive && setStatus(s),
      (e: unknown) => alive && setError(mensajeDeError(e)),
    )
    return () => {
      alive = false
    }
  }, [])

  return { status, error }
}

/** El estado de la IA, o `null` si aún no se sabe o no se pudo saber. */
export function useLlmStatus(): LlmStatus | null {
  return useLlmEstado().status
}
