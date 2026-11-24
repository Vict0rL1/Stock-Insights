import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { fmtPct, fmtPrecio } from '../../lib/formato'
import { useDato } from '../../lib/useDato'
import { CompanyLogo } from '../CompanyLogo'
import { BloqueDatos, EstadoDato } from '../EstadoDato'
import { Sparkline } from '../Sparkline'
import { tonoLeido } from './tono'

/** La lista de seguimiento (antes «Watchlist», pestaña del Portafolio): lo que
 *  sigues sin tenerlo. Vive en Mi cartera › Tesis y vigilancia porque añadir
 *  algo aquí le abre una tesis y cuenta en el aviso de «sin tesis»: `alCambiar`
 *  refresca esas cargas de la pestaña. */
export function ListaDeSeguimiento({ alCambiar }: { alCambiar?: () => void }) {
  // Con la carga fallida, la lista se quedaba en su `[]` inicial y decía
  // «Watchlist vacía.» (ítem 2.1). `error` queda para las acciones.
  const watchlist = useDato(() => api.watchlist().then((d) => d.items), 'watchlist')
  const load = () => {
    watchlist.refrescar()
    alCambiar?.()
  }
  const [symbol, setSymbol] = useState('')
  const [error, setError] = useState<string | null>(null)

  const quitar = async (id: number) => {
    setError(null)
    // Sin capturar, un borrado rechazado no decía nada (ítem 2.1).
    try {
      await api.removeFromWatchlist(id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await api.addToWatchlist({ symbol: symbol.trim().toUpperCase(), notes: null })
      setSymbol('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-800">Lista de seguimiento</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          Empresas que sigues sin tenerlas, con su precio de hoy.
        </p>
      </div>
      <form aria-label="Añadir a la lista de seguimiento" onSubmit={add} className="flex flex-wrap gap-2">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Añadir ticker"
          className="w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
        />
        <button className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
          Añadir
        </button>
        {error && <span className="self-center text-sm text-red-600">{error}</span>}
      </form>

      <BloqueDatos
        carga={watchlist}
        que="la lista de seguimiento"
        vacio={(d) => d.length === 0}
        mensajeVacio="Lista de seguimiento vacía."
      >
        {(items) => (
          <ul className="space-y-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex items-center gap-2.5">
                  <CompanyLogo symbol={item.symbol} size="md" />
                  <div>
                    <Link to={`/ticker/${item.symbol}`} className="font-medium hover:underline">
                      {item.symbol}
                    </Link>
                    <span className="ml-2 text-xs text-slate-400">
                      {item.name ?? ''} {item.sector ? `· ${item.sector}` : ''}
                    </span>
                  </div>
                  <Sparkline valores={item.spark} width={64} height={20} className="ml-1" />
                </div>
                <div className="flex items-center gap-4">
                  {item.quote ? (
                    <span className="tabular-nums text-slate-700">
                      {fmtPrecio(item.quote.price)}
                      {/* Sin variación, en neutro: `?? 0` la pintaba en verde (ítem 2.1);
                          y un «+0,00 %», también (revisión 13). */}
                      <span
                        className={`ml-2 text-sm ${tonoLeido(
                          fmtPct(item.quote.change_pct, 2, { signo: true, enPuntos: true }),
                          'text-emerald-600',
                          'text-red-600',
                          'text-slate-400',
                        )}`}
                      >
                        {fmtPct(item.quote.change_pct, 2, { signo: true, enPuntos: true })}
                      </span>
                      {/* Un precio rescatado de la caché (o sin estado fiable) se
                          dice: salía igual que uno en vivo (revisión del 2.1),
                          como ya hace la tabla de posiciones. */}
                      {item.quote.estado !== undefined && item.quote.estado !== 'valido' && (
                        <span className="ml-2">
                          <EstadoDato data={item.quote} />
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-sm text-slate-400">sin precio</span>
                  )}
                  <button
                    onClick={() => quitar(item.id)}
                    className="text-xs text-slate-400 hover:text-red-600"
                  >
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </BloqueDatos>
    </section>
  )
}
