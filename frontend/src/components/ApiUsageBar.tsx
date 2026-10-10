import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ProviderUsage } from '../api/types'
import { useLlmEstado } from '../lib/llm'
import { mensajeDeError } from '../lib/useDato'

function windowLabel(seconds: number): string {
  if (seconds <= 60) return 'min'
  if (seconds <= 3600) return 'h'
  return 'día'
}

// Contador visible de llamadas restantes por API: con tiers gratuitos,
// saber cuánto queda es parte del flujo de trabajo, no un adorno.
export function ApiUsageBar() {
  const [usage, setUsage] = useState<ProviderUsage[]>([])
  // El contador nunca rompe la UI, pero un fallo tampoco se calla: antes, si la
  // primera consulta fallaba, la barra desaparecía sin decir nada (ítem 2.1).
  // Si ya había cifras, se quedan las últimas y el fallo va en el título.
  const [errorUso, setErrorUso] = useState<string | null>(null)
  const { status: llm, error: errorIa } = useLlmEstado()

  useEffect(() => {
    let alive = true
    const load = () => {
      api.usage().then(
        (data) => {
          if (!alive) return
          setUsage(data)
          setErrorUso(null)
        },
        (e: unknown) => alive && setErrorUso(mensajeDeError(e)),
      )
    }
    load()
    const timer = setInterval(load, 30_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  if (usage.length === 0 && !errorUso) return null
  return (
    <div
      className="flex flex-wrap items-center gap-1 text-[10px] text-slate-400"
      title={errorUso && usage.length ? `Últimas cifras conocidas: la consulta del uso falló (${errorUso}).` : undefined}
    >
      <span className="w-full uppercase tracking-wider text-slate-300">APIs</span>
      {usage.length === 0 && errorUso && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800" title={errorUso}>
          uso desconocido: no se pudo consultar
        </span>
      )}
      {usage.map((u) => (
        <span
          key={u.provider}
          title={
            u.configured
              ? `${u.used} usadas de ${u.limit} por ${windowLabel(u.window_seconds)}`
              : 'Sin API key configurada (.env)'
          }
          className={`rounded-full px-2 py-0.5 ${
            !u.configured
              ? 'bg-slate-100 text-slate-400 line-through'
              : u.remaining < u.limit * 0.2
                ? 'bg-red-50 text-red-700'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          {u.provider} {u.remaining}/{u.limit}
        </span>
      ))}
      {llm && (
        <span
          title={
            llm.configured
              ? `Capa de IA activa (${llm.model ?? 'modelo sin nombre'}). Se factura por tokens: solo corre cuando pulsas un botón de interpretación.`
              : 'Sin ANTHROPIC_API_KEY en .env. La app funciona igual; solo faltan las interpretaciones escritas.'
          }
          className={`rounded-full px-2 py-0.5 ${
            llm.configured
              ? 'bg-(--ai-bg) text-(--ai)'
              : 'bg-slate-100 text-slate-400 line-through'
          }`}
        >
          IA {llm.configured ? 'activa' : 'off'}
        </span>
      )}
      {!llm && errorIa && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800" title={`No se pudo comprobar la capa de IA: ${errorIa}. Mientras tanto no se ofrecen interpretaciones.`}>
          IA sin comprobar
        </span>
      )}
    </div>
  )
}
