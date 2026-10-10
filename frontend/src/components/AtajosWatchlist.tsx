import { api } from '../api/client'
import { useDato } from '../lib/useDato'
import { ErrorDeCarga } from './EstadoDato'

/** Atajos a las empresas de la watchlist («para cada empresa seguida»).
 *
 *  Resultados y Valoración tenían cada una su copia, y las dos convertían un
 *  fallo al cargar la watchlist en una lista vacía: los atajos desaparecían sin
 *  decir nada (ítem 2.1). Una watchlist vacía sigue sin pintar nada; un fallo
 *  se dice. */
export function AtajosWatchlist({ actual, elegir }: { actual: string; elegir: (symbol: string) => void }) {
  const seguidas = useDato(() => api.watchlist().then((w) => w.items.map((i) => i.symbol)), 'watchlist')

  if (seguidas.estado === 'error') {
    return (
      <div className="mt-3">
        <ErrorDeCarga que="los atajos de tu watchlist" error={seguidas.error} reintentar={seguidas.reintentar} />
      </div>
    )
  }
  if (seguidas.estado === 'cargando' || seguidas.datos.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-400">De tu watchlist:</span>
      {seguidas.datos.map((s) => (
        <button
          key={s}
          onClick={() => elegir(s)}
          className={`rounded-full px-2 py-0.5 text-xs ${
            actual === s ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  )
}
