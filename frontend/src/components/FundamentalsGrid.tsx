import type { Fundamentals } from '../api/types'
import { fmtCompacto, fmtNum, fmtPct } from '../lib/formato'
import type { CargaConReintento } from '../lib/useDato'
import { BloqueDatos, EstadoDato } from './EstadoDato'

type Kind = 'ratio' | 'pct' | 'big'

const ROWS: { key: string; label: string; kind: Kind }[] = [
  { key: 'market_cap', label: 'Capitalización', kind: 'big' },
  { key: 'pe_ttm', label: 'P/E (TTM)', kind: 'ratio' },
  { key: 'pb', label: 'P/B', kind: 'ratio' },
  { key: 'ps_ttm', label: 'P/S (TTM)', kind: 'ratio' },
  { key: 'roe', label: 'ROE', kind: 'pct' },
  { key: 'gross_margin', label: 'Margen bruto', kind: 'pct' },
  { key: 'operating_margin', label: 'Margen operativo', kind: 'pct' },
  { key: 'net_margin', label: 'Margen neto', kind: 'pct' },
  { key: 'debt_to_equity', label: 'Deuda / Capital', kind: 'ratio' },
  { key: 'current_ratio', label: 'Ratio corriente', kind: 'ratio' },
  { key: 'dividend_yield', label: 'Rentabilidad por dividendo', kind: 'pct' },
  { key: 'eps_growth_5y', label: 'Crec. BPA 5A (anualizado)', kind: 'pct' },
  { key: 'revenue_growth_5y', label: 'Crec. ingresos 5A (anualizado)', kind: 'pct' },
  { key: 'beta', label: 'Beta', kind: 'ratio' },
  { key: 'week52_high', label: 'Máximo 52 semanas', kind: 'ratio' },
  { key: 'week52_low', label: 'Mínimo 52 semanas', kind: 'ratio' },
]

function fmt(value: number | null, kind: Kind): string {
  if (kind === 'pct') return fmtPct(value)
  if (kind === 'big') return fmtCompacto(value)
  return fmtNum(value)
}

/** La tarjeta de fundamentales de la ficha, con su carga (ítem 2.1).
 *
 *  Antes la ficha los pedía con `.catch(() => null)` y, si fallaban o la fuente
 *  no los tenía, la tarjeta desaparecía sin decir nada. Ahora la tarjeta está
 *  siempre: `null` (un 404) dice que ninguna fuente los tiene, y un fallo se
 *  dice como fallo, con su motivo y «Reintentar». */
export function FundamentalsGrid({
  carga,
  symbol,
}: {
  carga: CargaConReintento<Fundamentals | null>
  symbol: string
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          Fundamentales básicos <span className="font-normal text-slate-400">(TTM)</span>
        </h2>
        {carga.estado === 'listo' && carga.datos && <EstadoDato data={carga.datos} />}
      </div>
      <BloqueDatos
        carga={carga}
        que="los fundamentales básicos"
        vacio={(d) => d === null}
        mensajeVacio={`Ninguna fuente configurada tiene fundamentales básicos de ${symbol}.`}
      >
        {(data) =>
          data && (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                {ROWS.map(({ key, label, kind }) => (
                  <div key={key} className="flex flex-col border-b border-slate-100 py-1.5">
                    <dt className="text-xs text-slate-400">{label}</dt>
                    <dd className="text-sm font-medium tabular-nums text-slate-800">
                      {fmt(data.metrics[key] ?? null, kind)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-slate-400">
                Un guion (—) significa que la fuente no reporta el dato; nunca se rellena con
                ceros ni estimaciones.
              </p>
            </>
          )
        }
      </BloqueDatos>
    </section>
  )
}
