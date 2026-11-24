import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type {
  DeepDiveNarrative,
  DeepDiveReport,
  LlmStatus,
  MultipleStats,
  UmbralInforme,
} from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { fmtCompacto, fmtFecha, fmtFrente, fmtNum, fmtPct, plural } from '../../lib/formato'
import { useLlmStatus } from '../../lib/llm'
import { ausenteSi404, mensajeDeError, useDato } from '../../lib/useDato'
import { BloqueDatos } from '../EstadoDato'
import { BloqueIA, BotonIA } from '../ia/ContenidoIA'
import { DeudaParcial } from './DeudaParcial'
import { ResumenDcf } from '../valoracion/ResumenDcf'
import { Ventana } from '../Ventana'

const STANCE_STYLES: Record<string, string> = {
  constructiva: 'bg-emerald-50 border-emerald-300 text-emerald-900',
  mixta: 'bg-slate-50 border-slate-300 text-slate-800',
  cautelosa: 'bg-amber-50 border-amber-300 text-amber-900',
}

const SEVERITY_STYLES: Record<string, string> = {
  alto: 'bg-red-100 text-red-800',
  medio: 'bg-amber-100 text-amber-800',
}

// La flecha es estilo; la palabra, su etiqueta.
const FLECHA: Record<string, string> = { mejorando: '▲', 'deteriorándose': '▼', estable: '→' }

/** «a, b y c», como `_lista` en el backend. */
const enLista = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)

function Section({ title, reading, children }: { title: string; reading?: string; children?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      {reading && <p className="mt-1 text-sm text-slate-600">{reading}</p>}
      {children}
    </section>
  )
}

/** Barra que sitúa el múltiplo actual dentro de su rango histórico. */
function RangeBar({ stats }: { stats: MultipleStats }) {
  if (!stats.available || stats.current == null || stats.min == null || stats.max == null) {
    return null
  }
  const span = stats.max - stats.min
  const pos = span > 0 ? ((stats.current - stats.min) / span) * 100 : 50
  const medianPos = span > 0 && stats.median != null ? ((stats.median - stats.min) / span) * 100 : 50
  return (
    <div className="relative mt-1 h-6">
      <div className="absolute top-2.5 h-1 w-full rounded bg-gradient-to-r from-emerald-200 via-slate-200 to-red-200" />
      <div
        className="absolute top-1 h-4 w-px bg-slate-400"
        style={{ left: `${medianPos}%` }}
        title={`Mediana ${fmtNum(stats.median)}`}
      />
      <div
        className="absolute top-0.5 h-5 w-1 rounded bg-slate-900"
        style={{ left: `calc(${Math.min(Math.max(pos, 0), 100)}% - 2px)` }}
        title={`Actual ${fmtNum(stats.current)}`}
      />
    </div>
  )
}

function ValuationBlock({ report }: { report: DeepDiveReport }) {
  return (
    <Section title="Valoración frente a su propia historia" reading={report.valuation.reading}>
      <div className="mt-3 space-y-4">
        {Object.entries(report.valuation.multiples).map(([key, stats]) => (
          <div key={key}>
            {/* Con `gap` y el rótulo sin encoger: a 390 px el motivo ocupaba todo
                el ancho y se leía «P/ESolo 10 observaciones…» (ítem 2.12). */}
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
              <span className="shrink-0 font-medium text-slate-700">{etiqueta(key, { mayuscula: true })}</span>
              {stats.available ? (
                <span className="tabular-nums text-slate-600">
                  actual{' '}
                  <b>
                    {key === 'fcf_yield' ? fmtPct(stats.current) : fmtNum(stats.current)}
                  </b>{' '}
                  · mediana{' '}
                  {key === 'fcf_yield' ? fmtPct(stats.median) : fmtNum(stats.median)} ·
                  percentil {fmtPct(stats.percentile, 0)}
                </span>
              ) : (
                <span className="text-xs text-slate-400">{stats.reason}</span>
              )}
            </div>
            <RangeBar stats={stats} />
            {stats.available && (
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>
                  mín {key === 'fcf_yield' ? fmtPct(stats.min) : fmtNum(stats.min)}
                </span>
                <span>{stats.n} {plural(stats.n, 'observación', 'observaciones')} · {report.valuation.years_covered} {plural(report.valuation.years_covered, 'año', 'años')}</span>
                <span>
                  máx {key === 'fcf_yield' ? fmtPct(stats.max) : fmtNum(stats.max)}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {report.valuation.cheapness_score !== null && (
        <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
          Índice de baratura frente a su historia:{' '}
          <b>{fmtPct(report.valuation.cheapness_score, 0)}</b> (100&nbsp;% = lo más barata que
          ha estado en el periodo).
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {report.valuation.caveats.map((c, i) => (
          <li key={i} className="text-[11px] leading-snug text-amber-800">
            ⚠ {c}
          </li>
        ))}
      </ul>
    </Section>
  )
}

/** `redactarAlAbrir`: la ficha llega aquí desde «Explícamelo con IA» y la
 *  narrativa se pide sola, una vez, en cuanto el informe está (y se avisa con
 *  `alRedactar` para que volver a esta sección no la pida otra vez). */
export function DeepDiveSection({
  symbol,
  redactarAlAbrir = false,
  alRedactar,
}: {
  symbol: string
  redactarAlAbrir?: boolean
  alRedactar?: () => void
}) {
  // Un 404 es que EDGAR no tiene sus estados (desde que la ruta da 502 si EDGAR
  // no respondió): ausencia, sin «Reintentar» (segunda revisión del 2.1).
  const carga = useDato(() => ausenteSi404(api.deepDive(symbol)), symbol)
  const llm = useLlmStatus()
  // Al cambiar de símbolo el bloque vuelve a «cargando» e `Informe` se monta de
  // nuevo: la narrativa del anterior no se queda bajo el informe del nuevo.
  return (
    <BloqueDatos carga={carga} que="el informe" ausente={(m) => m}>
      {(report) => (
        <Informe symbol={symbol} report={report} llm={llm} redactarAlAbrir={redactarAlAbrir} alRedactar={alRedactar} />
      )}
    </BloqueDatos>
  )
}

function Informe({
  symbol,
  report,
  llm,
  redactarAlAbrir,
  alRedactar,
}: {
  symbol: string
  report: DeepDiveReport
  llm: LlmStatus | null
  redactarAlAbrir: boolean
  alRedactar?: () => void
}) {
  const [narrative, setNarrative] = useState<DeepDiveNarrative | null>(null)
  // El fallo de la narrativa es de la narrativa: antes sustituía la sección
  // entera y el informe calculado desaparecía por un 503 de la IA (ítem 2.1).
  const [errorNarrativa, setErrorNarrativa] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seccionNarrativa = useRef<HTMLElement>(null)
  // Una sola vez aunque el efecto corra dos (StrictMode): cada pedida gasta API.
  const pedida = useRef(false)

  const writeNarrative = useCallback(async () => {
    setBusy(true)
    setErrorNarrativa(null)
    try {
      setNarrative(await api.deepDiveNarrative(symbol, report))
    } catch (e) {
      setErrorNarrativa(mensajeDeError(e))
    } finally {
      setBusy(false)
    }
  }, [symbol, report])

  const configurada = llm?.configured === true
  useEffect(() => {
    if (!redactarAlAbrir || !configurada || pedida.current) return
    pedida.current = true
    alRedactar?.()
    // La narrativa va al final del informe: sin esto, el toque no se veía hacer nada.
    seccionNarrativa.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    void writeNarrative()
  }, [redactarAlAbrir, configurada, alRedactar, writeNarrative])

  const { business, growth, margins, debt, cash_flow: cash, verdict } = report
  const sinComprobar = report.riesgos_sin_comprobar ?? []
  const catalizadoresSinComprobar = report.catalysts_sin_comprobar ?? []
  // La cifra de la casilla, igual que en la lectura de encima: frente a las mismas
  // fronteras. Con decimales fijos, «cobertura de intereses 4,996× — ajustada»
  // llevaba al lado «Cobertura 5,0×», con holgada por encima de 5 (revisión 11).
  const frente = (clave: UmbralInforme, valor: number | null, opciones?: { pct?: boolean; ceros?: boolean }) =>
    fmtFrente(valor, report.umbrales?.[clave] ?? [], opciones)

  return (
    <div className="space-y-4">
      {/* Veredicto arriba: es la síntesis, no un adorno final */}
      <section className={`rounded-xl border-2 p-4 ${STANCE_STYLES[verdict.stance] ?? ''}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide">
            Lectura conjunta: postura {verdict.stance}
          </h2>
          {verdict.quant_label && (
            <span className="text-xs">
              señal cuantitativa vs. pares: <b>{verdict.quant_label}</b>
            </span>
          )}
        </div>
        <p className="mt-2 text-sm">{verdict.summary}</p>
        {/* De qué sale y qué no entra: el recuadro verde convivía sin decirlo con
            un DCF muy por debajo del precio y con un trimestre que invalidaba la
            tesis en «Qué cambió» (revisión 12, visual). */}
        {verdict.alcance && <p className="mt-1 text-xs opacity-80">{verdict.alcance}</p>}

        <div className="mt-3">
          <div className="text-xs font-semibold">Qué rompería esta lectura</div>
          <ul className="mt-1 space-y-0.5">
            {verdict.what_would_change_it.map((c, i) => (
              <li key={i} className="text-xs">
                · {c}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-3 text-[11px] leading-snug opacity-80">{verdict.disclaimer}</p>
      </section>

      <Section title="El negocio">
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-400">Sector</dt>
            <dd>{business.sector ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Capitalización</dt>
            <dd className="tabular-nums">{fmtCompacto(business.market_cap)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">
              Ingresos ({business.latest_fiscal_year})
            </dt>
            <dd className="tabular-nums">{fmtCompacto(business.latest_revenue)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Años de histórico</dt>
            <dd className="tabular-nums">{business.years_of_history}</dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-slate-400">{business.note}</p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Crecimiento" reading={growth.reading}>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            {(
              [
                ['ingresos', 'Ingresos, crec. anual', <Ventana anos={growth.years} />, growth.revenue_cagr],
                ['ingresos3', 'Ingresos, crec. anual', '3A', growth.revenue_cagr_3y],
                ['bpa', 'BPA, crec. anual', <Ventana anos={growth.years} />, growth.eps_cagr],
              ] as const
            ).map(([clave, rotulo, ventana, valor]) => (
              <div key={clave}>
                <dt className="text-xs text-slate-400">
                  {rotulo} {ventana}
                </dt>
                <dd className="tabular-nums">
                  {clave === 'ingresos' ? frente('revenue_cagr', valor, { pct: true }) : fmtPct(valor)}
                </dd>
              </div>
            ))}
          </dl>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
            {growth.yoy.slice(-5).map((y) => (
              <li key={y.year} className="flex justify-between">
                <span>{y.year}</span>
                <span className="tabular-nums">{fmtPct(y.growth)}</span>
              </li>
            ))}
          </ul>
        </Section>

        {/* Anuales, y de qué ejercicio: «21,0 %» a secas se leía como el de hoy
            junto a un trimestre al 12,0 % en «Qué cambió» (revisión 12, visual). */}
        <Section title={margins.ejercicio ? `Márgenes del ejercicio ${margins.ejercicio}` : 'Márgenes'} reading={margins.reading}>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            {(['gross_margin', 'operating_margin', 'net_margin'] as const).map((key) => (
              <div key={key}>
                <dt className="text-xs text-slate-400">
                  {etiqueta(key, { mayuscula: true })}
                </dt>
                <dd className="tabular-nums">
                  {key === 'operating_margin'
                    ? frente('operating_margin', margins.current[key], { pct: true })
                    : fmtPct(margins.current[key])}
                </dd>
                <dd className="text-[10px] text-slate-400">
                  {margins.trends[key] ? `${FLECHA[margins.trends[key]] ?? ''} ${etiqueta(margins.trends[key])}`.trim() : ''}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Deuda y solidez" reading={debt.reading}>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-400">Deuda neta</dt>
              <dd className="tabular-nums">{fmtCompacto(debt.net_debt)}</dd>
              <DeudaParcial falta={debt.deuda_parcial} />
            </div>
            <div>
              <dt className="text-xs text-slate-400">Deuda/Capital</dt>
              <dd className="tabular-nums">{frente('debt_to_equity', debt.debt_to_equity)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Cobertura</dt>
              <dd className="tabular-nums">
                {debt.interest_coverage !== null ? `${frente('interest_coverage', debt.interest_coverage, { ceros: false })}×` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Altman Z</dt>
              <dd className="tabular-nums">
                {fmtFrente(debt.altman_z.score, debt.altman_z.umbrales ?? [])}
                {debt.altman_z.zone && (
                  <span className="ml-1 text-[10px] text-slate-500">({debt.altman_z.zone})</span>
                )}
              </dd>
            </div>
          </dl>
        </Section>

        <Section title="Flujo de caja" reading={cash.reading}>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-xs text-slate-400">FCF</dt>
              <dd className="tabular-nums">{fmtCompacto(cash.current.fcf as number | null)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Conversión</dt>
              <dd className="tabular-nums">
                {frente('fcf_conversion', cash.current.fcf_conversion as number | null, { pct: true, ceros: false })}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Capex/Ingresos</dt>
              <dd className="tabular-nums">
                {fmtPct(cash.current.capex_intensity as number | null)}
              </dd>
            </div>
          </dl>
        </Section>
      </div>

      <ValuationBlock report={report} />

      {/* El mismo DCF que la pestaña Valoración y el módulo (ítem 3.3): antes
          era un tercero, con WACC 12/10/9 % y un valor puntual por escenario. */}
      {report.dcf && (
        <Section title="¿Cuánto podría valer? (DCF)">
          <div className="mt-2">
            <ResumenDcf datos={report.dcf} symbol={symbol} />
          </div>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Riesgos detectados en los datos">
          {report.risks.length === 0 ? (
            <p className="mt-1 text-sm text-slate-400">
              {sinComprobar.length ? 'Ninguno de los umbrales comprobados se dispara.' : 'Ninguno de los umbrales del modelo se dispara.'}{' '}
              No significa ausencia de riesgo: los riesgos cualitativos (competencia, regulación,
              gestión) no salen de las cifras.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {report.risks.map((r, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_STYLES[r.severity] ?? ''}`}
                    >
                      {r.severity}
                    </span>
                    <span className="text-sm font-medium text-slate-700">{r.type}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600">{r.evidence}</p>
                  <p className="text-xs text-slate-400">{r.why}</p>
                </li>
              ))}
            </ul>
          )}
          {/* Un umbral sin dato no se dispara, pero tampoco se ha mirado: «ninguno
              se dispara» salía con la deuda/capital y la cobertura sin calcular
              (revisión 12, visual). */}
          {sinComprobar.length > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              Sin comprobar por falta de datos: {enLista(sinComprobar)}.
            </p>
          )}
        </Section>

        {/* Lo que hay, no un plazo: «(6-18 meses)» encabezaba unos resultados a
            24 días y los últimos filings, que ya pasaron (revisión 12, visual). */}
        <Section title="Catalizadores y fechas a vigilar" reading={report.catalysts_note}>
          {/* Con una fuente caída, la lista vacía no es «ninguno»: el calendario o la
              SEC no respondieron y no se sabe si hay algo (revisión 13). */}
          {report.catalysts.length === 0 ? (
            catalizadoresSinComprobar.length > 0 ? (
              <p className="mt-1 text-sm text-amber-800">
                Sin comprobar. Fuentes que no respondieron: {enLista(catalizadoresSinComprobar)}.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-400">Ninguno identificado en los datos.</p>
            )
          ) : (
            <ul className="mt-2 space-y-1 text-sm">
              {report.catalysts.map((c, i) => (
                <li key={i} className="flex justify-between gap-3 border-b border-slate-100 py-1">
                  <span className="text-slate-700">
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {c.type}
                      </a>
                    ) : (
                      c.type
                    )}
                    <span className="ml-2 text-xs text-slate-400">{c.detail}</span>
                  </span>
                  {/* Con `fmtFecha`: salía «2026-10-06» en crudo. Y con su verbo: un
                      filing ya presentado y unos resultados por venir se leían igual. */}
                  <span className="shrink-0 text-xs text-slate-400">
                    {c.when ? `${c.source === 'edgar' ? 'presentado el' : 'previsto el'} ${fmtFecha(c.when)}` : fmtFecha(c.when)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {report.catalysts.length > 0 && catalizadoresSinComprobar.length > 0 && (
            <p className="mt-2 text-xs text-amber-800">
              La lista puede estar incompleta. Fuentes que no respondieron: {enLista(catalizadoresSinComprobar)}.
            </p>
          )}
        </Section>
      </div>

      {/* Narrativa por IA, siempre al final y siempre etiquetada.
          Sin ANTHROPIC_API_KEY la sección entera desaparece: el informe
          calculado se sostiene solo. */}
      {(narrative || llm?.configured) && (
      <section ref={seccionNarrativa} className="rounded-xl border border-slate-200 bg-white p-4">
        {!narrative ? (
          <>
            <h3 className="text-sm font-semibold text-slate-700">Narrativa del informe</h3>
            <p className="mt-1 text-sm text-slate-500">
              Claude puede escribir el informe en prosa a partir de las cifras de arriba.
              No genera ningún número: solo los interpreta.
            </p>
            <BotonIA onClick={writeNarrative} disabled={busy} className="mt-2 px-3 text-sm">
              {busy ? 'Redactando…' : 'Redactar informe (IA)'}
            </BotonIA>
            {errorNarrativa && (
              <p className="mt-2 text-sm text-red-700">No se pudo redactar el informe: {errorNarrativa}</p>
            )}
          </>
        ) : (
          <BloqueIA modelo={narrative.model} aviso={narrative.disclaimer}>
            {narrative.content_md}
          </BloqueIA>
        )}
      </section>
      )}

      <p className="text-[11px] text-slate-400">
        Informe calculado a partir de SEC EDGAR ({report.data_sources.financials}) y precios
        de {report.data_sources.quote ?? 'n/d'}. Generado el{' '}
        {fmtFecha(report.generated_at, { hora: true, zona: 'UTC' })}.
      </p>
    </div>
  )
}
