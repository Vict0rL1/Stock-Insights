import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { FilterSpec, ScreenCheck, ScreenerPreset, ScreenResult, ScreenRow } from '../api/types'
import { BloqueDatos } from '../components/EstadoDato'
import { etiqueta } from '../lib/etiquetas'
import { decimalesFrente, fmtFrente, fmtNum, fmtPct, plural } from '../lib/formato'
import { listaDeSimbolos } from '../lib/simbolos'
import { useDato } from '../lib/useDato'
import { rutaEmpresa } from '../lib/rutas'

/** El tope del backend (`MAX_UNIVERSE` en `routers/screener.py`). */
const MAX_UNIVERSO = 25

const PCT_METRICS = new Set([
  'roe', 'gross_margin', 'operating_margin', 'net_margin',
  'dividend_yield', 'revenue_growth_5y', 'eps_growth_5y',
])

// La cifra de cada comprobación, de su lado de su umbral: con decimales fijos,
// un ROE de 0,1496 salía en rojo «ROE: 15,0 %» junto al filtro «ROE ≥ 15,0 %»
// (revisión 11).
function fmtMetric(metric: string, value: number | null, umbral: number) {
  if (value === null || value === undefined) return '—'
  return fmtFrente(value, umbral, { pct: PCT_METRICS.has(metric) })
}

// El umbral como lo escribe el texto del preset: entero y sin ceros de relleno.
// Con los decimales fijos de `fmtNum` y `fmtPct`, el texto decía «P/E ≤ 18» y
// «ROE ≥ 10 %», y la pastilla de debajo «18,00» y «10,0 %» (revisión 12, visual).
function fmtUmbral(metric: string, value: number) {
  const pct = PCT_METRICS.has(metric)
  const d = decimalesFrente(value, [value], pct)
  return pct ? fmtPct(value, d, { ceros: false }) : fmtNum(value, d, { ceros: false })
}

function describeFilter(metric: string, spec: FilterSpec) {
  const label = etiqueta(metric, { mayuscula: true })
  const op = spec.op === 'gte' ? '≥' : '≤'
  return `${label} ${op} ${fmtUmbral(metric, spec.value)}`
}

// Un dato que falta no se pinta como un suspenso: «Ratio corriente: —» salía en
// rojo y la fila decía «No pasa» (revisión 12, visual).
const ESTILO_CHECK: Record<ScreenCheck['estado'], string> = {
  pasa: 'bg-white text-slate-600 ring-1 ring-slate-200',
  no_pasa: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  sin_dato: 'border border-dashed border-slate-300 bg-slate-50 text-slate-500',
}
const ESTILO_FILA: Record<ScreenRow['estado'], string> = {
  pasa: 'text-emerald-700',
  sin_comprobar: 'text-slate-600',
  no_pasa: 'text-slate-400',
}

/** `incrustada`: dentro de Explorar, con su título como subtítulo (h2) bajo el de la pantalla. */
export function ScreenerPage({ incrustada = false }: { incrustada?: boolean } = {}) {
  // Si los presets no llegan se dice, con «Reintentar»: antes el fallo hacía
  // `setPresets([])` y la pantalla se quedaba en «Cargando presets…» para
  // siempre (ítem 2.1).
  const presets = useDato(
    () => api.screenerPresets().then((d) => [...d.builtin, ...d.saved]),
    'presets',
  )
  const [elegido, setElegido] = useState<ScreenerPreset | null>(null)
  // Sin elección todavía, el primero de la lista, como antes al llegar.
  const active = elegido ?? presets.datos?.[0] ?? null
  const [universe, setUniverse] = useState('AAPL, MSFT, JNJ, KO, XOM, JPM, PG, VZ')
  const [result, setResult] = useState<ScreenResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // El mismo `.slice` callado que en ETFs: el ticker 26 desaparecía sin que nada
  // lo nombrara (revisión 12, visual).
  const { simbolos: symbols, descartados } = listaDeSimbolos(universe, MAX_UNIVERSO)

  const run = async () => {
    if (!active) return
    if (symbols.length === 0) return
    setBusy(true)
    setError(null)
    try {
      setResult(await api.runScreen({ symbols, filters: active.filters }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {incrustada ? (
        <h2 className="text-lg font-semibold text-slate-800">Filtros por cifras</h2>
      ) : (
        <h1 className="text-lg font-semibold text-slate-800">Screener</h1>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Preset</h2>
        <BloqueDatos
          carga={presets}
          que="los presets"
          vacio={(d) => d.length === 0}
          mensajeVacio="No hay presets: ni de serie ni guardados."
        >
          {(lista) => (
            <div className="flex flex-wrap gap-2">
              {lista.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => setElegido(preset)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    active?.name === preset.name
                      ? 'bg-slate-900 font-medium text-white'
                      : 'border border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          )}
        </BloqueDatos>

        {active && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <p className="text-sm text-slate-600">{active.logic_md}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(active.filters).map(([metric, spec]) => (
                <span
                  key={metric}
                  className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200"
                >
                  {describeFilter(metric, spec)}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Universo a evaluar{' '}
          <span className="font-normal text-slate-400">(máx. {MAX_UNIVERSO} tickers, separados por coma)</span>
        </h2>
        <textarea
          value={universe}
          onChange={(e) => setUniverse(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={run}
            disabled={busy || !active}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? 'Evaluando…' : 'Ejecutar screener'}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
        {descartados.length > 0 && (
          <p role="status" className="mt-2 text-xs text-amber-800">
            Solo se evalúan {MAX_UNIVERSO} a la vez: {descartados.join(', ')}{' '}
            {plural(descartados.length, 'queda', 'quedan')} fuera.
          </p>
        )}
      </section>

      {result && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-sm font-semibold text-slate-700">
              {result.passed} de {result.evaluated} {plural(result.passed, 'pasa', 'pasan')} el filtro
            </h2>
            {/* «0 de 8 pasan» no separaba las que suspenden de las que no se
                pudieron comprobar (revisión 12, visual). */}
            <span className="text-xs text-slate-500">
              {[
                result.no_pasan > 0 && `${result.no_pasan} no ${plural(result.no_pasan, 'pasa', 'pasan')}`,
                result.sin_comprobar > 0 &&
                  `${result.sin_comprobar} sin comprobar (les falta un dato; no es un suspenso)`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-400">{result.note}</p>

          <ul className="space-y-2">
            {result.results.map((row) => (
              <li
                key={row.symbol}
                className={`rounded-lg border p-3 ${
                  row.passes ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Link
                    to={rutaEmpresa(row.symbol)}
                    className="font-medium text-slate-800 hover:underline"
                  >
                    {row.symbol}
                  </Link>
                  <span className={`text-xs font-medium ${ESTILO_FILA[row.estado]}`}>
                    {etiqueta(row.estado, { mayuscula: true })}
                    {row.estado === 'sin_comprobar' &&
                      ` · falta ${row.checks
                        .filter((c) => c.estado === 'sin_dato')
                        .map((c) => etiqueta(c.metric))
                        .join(', ')}`}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {row.checks.map((check) => (
                    <span
                      key={check.metric}
                      title={`${etiqueta(check.metric, { mayuscula: true })}: ${
                        check.estado === 'sin_dato'
                          ? etiqueta(check.estado)
                          : fmtMetric(check.metric, check.actual, check.value)
                      }`}
                      className={`rounded-full px-2 py-0.5 text-xs ${ESTILO_CHECK[check.estado]}`}
                    >
                      {etiqueta(check.metric, { mayuscula: true })}:{' '}
                      {fmtMetric(check.metric, check.actual, check.value)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          {result.unavailable.length > 0 && (
            <p className="mt-3 text-xs text-slate-400">
              Sin fundamentales: {result.unavailable.map((u) => u.symbol).join(', ')}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
