import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { BloqueDatos } from '../components/EstadoDato'
import { fmtFecha, fmtNum, fmtPct } from '../lib/formato'
import { useDato } from '../lib/useDato'

function ChangeChip({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className="text-slate-400">—</span>
  const up = pct >= 0
  return (
    <span className={`font-medium tabular-nums ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      {fmtPct(pct, 2, { signo: true, enPuntos: true })}
    </span>
  )
}

export function DashboardPage() {
  // Cada bloque con su propio estado: un fallo se dice como fallo y se puede
  // reintentar. Índices y sectores hacían `() => setX([])`, y un error salía
  // como «no hay datos» (ítem 2.1). Curva, macro y calendario ya lo decían
  // (1.10 y revisión de la Fase 1); ahora con las mismas palabras que el resto.
  const indices = useDato(() => api.marketOverview().then((d) => d.indices), 'indices')
  const sectores = useDato(() => api.marketSectors().then((d) => d.sectors), 'sectores')
  const curva = useDato(() => api.yieldCurve(), 'curva')
  const macro = useDato(() => api.macro().then((d) => d.indicators), 'macro')
  const eventos = useDato(() => api.calendar().then((d) => d.events), 'calendario')

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">Mercado</h1>

      <BloqueDatos carga={indices} que="los índices" vacio={(d) => d.length === 0} mensajeVacio="Ninguna fuente devolvió índices.">
        {(lista) => (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {lista.map((ix) => (
              <div key={ix.symbol} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-400">{ix.label}</div>
                <div className="text-lg font-semibold tabular-nums text-slate-900">
                  {ix.quote ? fmtNum(ix.quote.price) : '—'}
                </div>
                <ChangeChip pct={ix.quote?.change_pct} />
              </div>
            ))}
          </section>
        )}
      </BloqueDatos>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Sectores hoy <span className="font-normal text-slate-400">(ETFs SPDR como proxy)</span>
          </h2>
          <BloqueDatos carga={sectores} que="los sectores" vacio={(d) => d.length === 0} mensajeVacio="Ninguna fuente devolvió sectores.">
            {(lista) => (
              <ul className="space-y-1">
                {lista.map((s) => {
                  const pct = s.change_pct
                  const width = pct === null ? 0 : Math.min(Math.abs(pct) * 25, 100)
                  return (
                    <li key={s.symbol} className="flex items-center gap-2 text-sm">
                      <Link
                        to={`/ticker/${s.symbol}`}
                        className="w-44 shrink-0 truncate text-slate-600 hover:underline"
                      >
                        {s.label}
                      </Link>
                      <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100">
                        <div
                          className={`h-full ${pct !== null && pct >= 0 ? 'bg-emerald-400' : 'bg-red-400'}`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                      <span className="w-16 text-right">
                        <ChangeChip pct={pct} />
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </BloqueDatos>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Curva de rendimientos EE. UU.{' '}
            <span className="font-normal text-slate-400">(FRED, cierre anterior)</span>
          </h2>
          <BloqueDatos carga={curva} que="la curva">
            {(curve) => (
              <>
                <div className="flex items-end gap-2">
                  {curve.curve.map((point) => (
                    <div key={point.series_id} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-xs tabular-nums text-slate-600">
                        {point.value !== null ? fmtNum(point.value, 2) : '—'}
                      </span>
                      {/* Sin dato, sin barra: una barra de altura 0 parece un 0 % (ítem 2.1). */}
                      {point.value !== null && (
                        <div className="w-full rounded-t bg-sky-300" style={{ height: `${point.value * 14}px` }} />
                      )}
                      <span className="text-[10px] text-slate-400">{point.tenor}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Spread 10A−2A:{' '}
                  <span
                    className={`font-medium tabular-nums ${
                      curve.spread_10y_2y !== null && curve.spread_10y_2y < 0 ? 'text-red-600' : 'text-slate-700'
                    }`}
                  >
                    {curve.spread_10y_2y !== null ? `${fmtNum(curve.spread_10y_2y, 2)} pp` : '—'}
                  </span>{' '}
                  · {curve.note}
                </p>
              </>
            )}
          </BloqueDatos>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Macro (FRED)</h2>
          <BloqueDatos carga={macro} que="los indicadores" vacio={(d) => d.length === 0} mensajeVacio="FRED no devolvió ningún indicador.">
            {(lista) => (
              <dl className="grid grid-cols-3 gap-3">
                {lista.map((m) => (
                  <div key={m.series_id}>
                    <dt className="text-xs text-slate-400">{m.label}</dt>
                    <dd className="text-lg font-semibold tabular-nums text-slate-800">
                      {fmtPct(m.value, 1, { enPuntos: true })}
                    </dd>
                    {/* La fecha del dato con el formato de la app: salía en ISO (ítem 2.1). */}
                    <dd className="text-[10px] text-slate-400">{m.ts ? fmtFecha(m.ts) : 'sin fecha'}</dd>
                  </div>
                ))}
              </dl>
            )}
          </BloqueDatos>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Próximos resultados <span className="font-normal text-slate-400">(14 días)</span>
          </h2>
          <BloqueDatos
            carga={eventos}
            que="el calendario de resultados"
            vacio={(d) => d.length === 0}
            mensajeVacio="Ninguna empresa anuncia resultados en los próximos 14 días."
          >
            {(lista) => (
              <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                {lista.slice(0, 40).map((ev) => (
                  <li
                    key={`${ev.symbol}-${ev.date}`}
                    className="flex items-center justify-between border-b border-slate-100 py-1"
                  >
                    <Link to={`/ticker/${ev.symbol}`} className="font-medium text-slate-700 hover:underline">
                      {ev.symbol}
                    </Link>
                    <span className="text-xs text-slate-500">
                      {fmtFecha(ev.date)}
                      {ev.eps_estimate !== null ? ` · BPA est. ${fmtNum(ev.eps_estimate)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </BloqueDatos>
        </section>
      </div>
    </div>
  )
}
