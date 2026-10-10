import { api } from '../../api/client'
import type { Health, RiskResponse } from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { fmtCompacto, fmtFecha, fmtNum, fmtPct } from '../../lib/formato'
import { useDato, type CargaConReintento } from '../../lib/useDato'
import { BloqueDatos, EstadoDato } from '../EstadoDato'
import { DeudaParcial } from './DeudaParcial'

const ZONE_STYLES: Record<string, string> = {
  segura: 'bg-emerald-100 text-emerald-700',
  gris: 'bg-amber-100 text-amber-800',
  riesgo: 'bg-red-100 text-red-700',
}

export function HealthSection({ symbol }: { symbol: string }) {
  const salud = useDato(() => api.health(symbol), symbol)
  // El riesgo de mercado hacía `() => setRisk(null)`: si fallaba, beta,
  // volatilidad y drawdown salían «—», como si la fuente no los reportara
  // (ítem 2.1). Ahora su fallo se dice en su sitio.
  const riesgo = useDato(() => api.risk(symbol), symbol)

  return (
    <BloqueDatos carga={salud} que="la salud financiera">
      {(health) => <Salud health={health} riesgo={riesgo} />}
    </BloqueDatos>
  )
}

function Salud({ health, riesgo }: { health: Health; riesgo: CargaConReintento<RiskResponse> }) {
  const risk = riesgo.estado === 'listo' ? riesgo.datos : null
  const z = health.altman_z
  const f = health.piotroski_f

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              Altman Z-score <span className="font-normal text-slate-400">({health.fiscal_year})</span>
            </h2>
            <EstadoDato data={health} />
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums text-slate-900">
              {z.score !== null ? fmtNum(z.score) : '—'}
            </span>
            {z.zone && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ZONE_STYLES[z.zone]}`}>
                zona {z.zone}
              </span>
            )}
          </div>
          <dl className="mt-3 space-y-1 text-xs text-slate-500">
            {Object.entries(z.components).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <dt>{etiqueta(key, { mayuscula: true })}</dt>
                <dd className="tabular-nums">{value !== null ? fmtNum(value, 3) : 'sin dato'}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-slate-400">{z.note}</p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Piotroski F-score{' '}
            <span className="font-normal text-slate-400">
              ({f.fiscal_years?.join(' → ') ?? '—'})
            </span>
          </h2>
          <div className="text-3xl font-semibold tabular-nums text-slate-900">
            {f.score !== null ? `${f.score} / ${f.max_possible}` : '—'}
          </div>
          {f.max_possible < 9 && (
            <p className="text-xs text-amber-600">
              Solo {f.max_possible} de 9 señales evaluables con los datos reportados.
            </p>
          )}
          <ul className="mt-2 space-y-1 text-xs">
            {f.signals.map((s) => (
              <li key={s.name} className="flex items-center gap-2">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    s.passed === null ? 'bg-slate-300' : s.passed ? 'bg-emerald-500' : 'bg-red-400'
                  }`}
                />
                <span className={s.passed === null ? 'text-slate-400' : 'text-slate-600'}>
                  {s.name}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Deuda y riesgo</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <div>
            <dt className="text-xs text-slate-400">Cobertura de intereses</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {health.interest_coverage !== null ? `${fmtNum(health.interest_coverage, 1)}×` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Deuda neta</dt>
            <dd className="text-lg font-semibold tabular-nums">{fmtCompacto(health.net_debt)}</dd>
            <DeudaParcial falta={health.deuda_parcial} />
          </div>
          <div>
            <dt className="text-xs text-slate-400">FCF (último ejercicio)</dt>
            <dd className="text-lg font-semibold tabular-nums">{fmtCompacto(health.fcf)}</dd>
          </div>
          {/* Con el riesgo cargado, «—» es que la fuente no lo da; mientras carga
              o si falla, las tres cifras no se pintan y se dice abajo. */}
          {risk && (
            <>
              <div>
                <dt className="text-xs text-slate-400">Beta vs. SPY (1A)</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {risk.beta_vs_spy != null ? fmtNum(risk.beta_vs_spy) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Volatilidad anualizada</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {risk.annualized_volatility != null ? fmtPct(risk.annualized_volatility) : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-400">Máx. drawdown (1A)</dt>
                {/* Sin dato, sin rojo: un guion rojo parece una caída. */}
                <dd className={`text-lg font-semibold tabular-nums ${risk.max_drawdown ? 'text-red-600' : ''}`}>
                  {risk.max_drawdown ? fmtPct(risk.max_drawdown.max_drawdown) : '—'}
                </dd>
              </div>
            </>
          )}
        </dl>
        {!risk && (
          <div className="mt-3">
            {/* Solo los estados de carga y error: con datos, las cifras van arriba. */}
            <BloqueDatos carga={riesgo} que="las métricas de riesgo (beta, volatilidad y drawdown)">
              {() => null}
            </BloqueDatos>
          </div>
        )}
        {risk && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <p>
              {risk.max_drawdown && (
                <>
                  Drawdown: pico {fmtFecha(risk.max_drawdown.peak)} → valle {fmtFecha(risk.max_drawdown.trough)}.{' '}
                </>
              )}
              Ventana: {risk.window}.
            </p>
            {/* Beta, volatilidad y drawdown salen del histórico de precios, no de
                EDGAR: llevan su propia fuente y fecha. */}
            <EstadoDato data={risk} />
          </div>
        )}
      </section>
    </div>
  )
}
