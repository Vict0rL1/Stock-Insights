import { api } from '../../api/client'
import type { Financials, PeersResponse } from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { fmtCompacto, fmtNum, fmtPct } from '../../lib/formato'
import { useDato } from '../../lib/useDato'
import { BloqueDatos, EstadoDato } from '../EstadoDato'
import { Ventana } from '../Ventana'

const METRIC_ROWS: { key: string; label: string; kind: 'big' | 'ratio' | 'pct' }[] = [
  { key: 'revenue', label: 'Ingresos', kind: 'big' },
  { key: 'net_income', label: 'Beneficio neto', kind: 'big' },
  { key: 'eps_diluted', label: 'BPA diluido', kind: 'ratio' },
  { key: 'fcf', label: 'Free cash flow', kind: 'big' },
  { key: 'gross_margin', label: 'Margen bruto', kind: 'pct' },
  { key: 'operating_margin', label: 'Margen operativo', kind: 'pct' },
  { key: 'net_margin', label: 'Margen neto', kind: 'pct' },
  { key: 'roe', label: 'ROE', kind: 'pct' },
  { key: 'roic', label: 'ROIC (impuesto 21 % supuesto)', kind: 'pct' },
  { key: 'current_ratio', label: 'Ratio corriente', kind: 'ratio' },
  { key: 'debt_to_equity', label: 'Deuda / Capital', kind: 'ratio' },
  { key: 'interest_coverage', label: 'Cobertura de intereses', kind: 'ratio' },
]

const PCT_KEYS = new Set([
  'roe', 'operating_margin', 'net_margin', 'dividend_yield', 'revenue_growth_5y',
])

function fmtCell(value: number | null | undefined, kind: 'big' | 'ratio' | 'pct') {
  if (kind === 'pct') return fmtPct(value)
  if (kind === 'big') return fmtCompacto(value)
  return fmtNum(value)
}

export function FinancialsSection({ symbol }: { symbol: string }) {
  const financieros = useDato(() => api.financials(symbol), symbol)
  // Los pares hacían `() => setPeers(null)`: si fallaban, la sección de
  // comparables desaparecía sin decir nada (ítem 2.1). Ahora tiene su propia
  // carga y no depende de los estados financieros, ni al revés.
  const pares = useDato(() => api.peers(symbol), symbol)

  return (
    <div className="space-y-4">
      <BloqueDatos carga={financieros} que="los estados financieros de EDGAR">
        {(data) => <EstadosFinancieros data={data} symbol={symbol} />}
      </BloqueDatos>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            Comparativa con pares{' '}
            <span className="font-normal text-slate-400">(percentil de {symbol} en la muestra)</span>
          </h2>
          {pares.estado === 'listo' && <EstadoDato data={pares.datos} />}
        </div>
        <BloqueDatos
          carga={pares}
          que="la comparativa con pares"
          // Con una sola fila (la propia empresa) no hay con quién comparar.
          vacio={(p) => p.peers.length <= 1}
          mensajeVacio={`Ninguna fuente devolvió pares con fundamentales para comparar ${symbol}.`}
        >
          {(peers) => <Pares peers={peers} symbol={symbol} />}
        </BloqueDatos>
      </section>
    </div>
  )
}

function EstadosFinancieros({ data, symbol }: { data: Financials; symbol: string }) {
  const merged = data.ratios.map((r, i) => ({ ...data.periods[i], ...r }))

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          Estados financieros anuales{' '}
          <span className="font-normal text-slate-400">({data.entity ?? symbol})</span>
        </h2>
        <EstadoDato data={data} />
      </div>
      <div className="mb-3 flex gap-4 text-xs text-slate-500">
        <span>
          CAGR ingresos <Ventana anos={data.growth.years} />:{' '}
          <b className="tabular-nums">{fmtPct(data.growth.revenue_cagr)}</b>
        </span>
        <span>
          CAGR BPA <Ventana anos={data.growth.years} />:{' '}
          <b className="tabular-nums">{fmtPct(data.growth.eps_cagr)}</b>
        </span>
        <span>
          CAGR FCF <Ventana anos={data.growth.years} />:{' '}
          <b className="tabular-nums">{fmtPct(data.growth.fcf_cagr)}</b>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
              <th className="py-1 pr-2 font-normal">Métrica</th>
              {merged.map((p) => (
                <th key={p.fiscal_year} className="px-2 py-1 text-right font-normal">
                  {p.fiscal_year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRIC_ROWS.map(({ key, label, kind }) => (
              <tr key={key} className="border-b border-slate-100">
                <td className="py-1.5 pr-2 text-slate-500">{label}</td>
                {merged.map((p) => (
                  <td
                    key={p.fiscal_year}
                    className="px-2 py-1.5 text-right tabular-nums text-slate-800"
                  >
                    {fmtCell(p[key] as number | null | undefined, kind)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Fuente primaria: filings 10-K en SEC EDGAR. “—” = la empresa no reporta esa
        partida con etiquetas XBRL estándar.
      </p>
    </section>
  )
}

function Pares({ peers, symbol }: { peers: PeersResponse; symbol: string }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
              <th className="py-1 pr-2 font-normal">Símbolo</th>
              {peers.comparison_keys.map((k) => (
                <th key={k} className="px-2 py-1 text-right font-normal">
                  {etiqueta(k, { mayuscula: true })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {peers.peers.map((row) => (
              <tr
                key={row.symbol}
                className={`border-b border-slate-100 ${row.symbol === symbol ? 'bg-sky-50 font-medium' : ''}`}
              >
                <td className="py-1.5 pr-2">{row.symbol}</td>
                {peers.comparison_keys.map((k) => (
                  <td key={k} className="px-2 py-1.5 text-right tabular-nums">
                    {PCT_KEYS.has(k) ? fmtPct(row.metrics[k]) : fmtNum(row.metrics[k])}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="text-xs text-slate-500">
              <td className="py-1.5 pr-2">Percentil {symbol}</td>
              {peers.comparison_keys.map((k) => (
                <td key={k} className="px-2 py-1.5 text-right tabular-nums">
                  {/* Sin fundamentales de la propia empresa el backend manda
                      `percentiles: {}`: `!== null` dejaba pasar `undefined` y
                      salía «Pundefined» (ítem 2.1). */}
                  {peers.percentiles[k] != null ? `P${peers.percentiles[k]}` : '—'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">{peers.note}</p>
    </>
  )
}
