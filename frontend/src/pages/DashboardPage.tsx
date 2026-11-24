import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { BloqueDatos, EstadoDato } from '../components/EstadoDato'
import { fmtFecha, fmtNum, fmtPct, fmtPrecio, signoLeido, ZONA_MERCADO } from '../lib/formato'
import { useDato } from '../lib/useDato'
import type { CalendarioMercado, Quote, SectorEntry } from '../api/types'
import { rutaEmpresa } from '../lib/rutas'

/** Cuántos próximos resultados caben en el bloque; el resto se cuenta. */
const MAX_EVENTOS = 40

/** Verde, rojo o neutro según la variación que se LEE. Con `pct >= 0` un
 *  «0,00 %» salía en verde, como una subida (revisión 12, visual: Nasdaq 100,
 *  Dow Jones, Tecnología). */
const TONO = { '1': 'text-emerald-600', '0': 'text-slate-500', '-1': 'text-red-600' } as const
const BARRA = { '1': 'bg-emerald-400', '0': 'bg-slate-300', '-1': 'bg-red-400' } as const

export function ChangeChip({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className="text-slate-400">—</span>
  const texto = fmtPct(pct, 2, { signo: true, enPuntos: true })
  return <span className={`font-medium tabular-nums ${TONO[signoLeido(texto)]}`}>{texto}</span>
}

/** «finnhub · 11 sept 2026, 16:00 ET»: de dónde y de cuándo es una cotización.
 *  Las seis cotizaciones y los sectores no lo decían, mientras Macro y la curva
 *  sí; con el reloj en sábado, «Sectores hoy» no podía ser una sesión de hoy y
 *  nada lo avisaba (revisión 12, visual). La hora, en la del mercado. */
export function Procedencia({ quotes, className }: { quotes: (Quote | null)[]; className: string }) {
  // Solo las válidas: las viejas o desconocidas ya llevan su `EstadoDato`, con
  // su fuente y su antigüedad, y las que faltan dicen que faltan.
  const validas = quotes.filter((q): q is Quote => q !== null && (q.estado === undefined || q.estado === 'valido'))
  if (validas.length === 0) return null
  const fuentes = [...new Set(validas.map((q) => q.source))].sort().join(', ')
  const instantes = validas.map((q) => q.as_of).sort((a, b) => Date.parse(a) - Date.parse(b))
  const desde = fmtFecha(instantes[0], { hora: true, zona: ZONA_MERCADO })
  const hasta = fmtFecha(instantes[instantes.length - 1], { hora: true, zona: ZONA_MERCADO })
  return (
    <p className={className}>
      {fuentes} · {desde === hasta ? `dato del ${desde}` : `datos del ${desde} al ${hasta}`}
    </p>
  )
}

/** Qué sectores van con la última copia guardada o sin dato. Una variación
 *  rescatada de la caché salía como la de hoy, y un sector sin cotización era
 *  un «—» sin explicación (revisión del 2.1). Una fila por sector no cabe: se
 *  dice junto a la lista. */
function AvisoSectores({ lista }: { lista: SectorEntry[] }) {
  const viejos = lista.filter((s) => s.quote && s.quote.estado !== undefined && s.quote.estado !== 'valido')
  const sinDato = lista.filter((s) => !s.quote)
  if (viejos.length === 0 && sinDato.length === 0) return null
  return (
    <div className="mb-2 space-y-1 text-[11px] text-amber-800">
      {viejos.map((s) => (
        <div key={s.symbol} className="flex flex-wrap items-center gap-1">
          {s.label}: <EstadoDato data={s.quote!} />
        </div>
      ))}
      {sinDato.length > 0 && <p>Sin dato (ninguna fuente dio precio): {sinDato.map((s) => s.label).join(', ')}.</p>}
    </div>
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
  // Un 200 con `error` es un fallo, con su «Reintentar»: solo se leía `events`,
  // que llegaba vacío, y un calendario caído se pintaba «Ninguna empresa anuncia
  // resultados en los próximos 14 días» (revisión 13).
  const eventos = useDato(
    () =>
      api.calendar().then((d: CalendarioMercado) => {
        if (d.error != null || d.events == null) throw new Error(d.error ?? 'la respuesta no trae la lista de resultados')
        return { lista: d.events, total: d.total ?? null }
      }),
    'calendario',
  )

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
                <Procedencia quotes={[ix.quote]} className="mt-1 text-[10px] text-slate-400" />
                {/* Un precio rescatado de la caché parecía de ahora, y uno que
                    ninguna fuente dio era un «—» sin explicación (revisión del 2.1). */}
                {ix.quote && ix.quote.estado !== undefined && ix.quote.estado !== 'valido' && (
                  <div className="mt-1">
                    <EstadoDato data={ix.quote} />
                  </div>
                )}
                {/* Sin precio puede ser un fallo o que ninguna fuente lo tenga: no se afirma cuál. */}
                {!ix.quote && <div className="mt-1 text-[10px] text-slate-400">sin dato: ninguna fuente dio precio</div>}
              </div>
            ))}
          </section>
        )}
      </BloqueDatos>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            {/* Sin «hoy»: la variación es sobre el cierre anterior al dato, y el dato
                puede ser del viernes aunque se mire en sábado (revisión 12, visual). */}
            Sectores{' '}
            <span className="font-normal text-slate-400">(ETFs SPDR como proxy; variación sobre el cierre anterior)</span>
          </h2>
          <BloqueDatos carga={sectores} que="los sectores" vacio={(d) => d.length === 0} mensajeVacio="Ninguna fuente devolvió sectores.">
            {(lista) => (
              <>
                <AvisoSectores lista={lista} />
                <ul className="space-y-1">
                  {lista.map((s) => {
                    const pct = s.change_pct
                    const width = pct === null ? 0 : Math.min(Math.abs(pct) * 25, 100)
                    const signo = pct === null ? 0 : signoLeido(fmtPct(pct, 2, { enPuntos: true }))
                    return (
                      <li key={s.symbol} className="flex items-center gap-2 text-sm">
                        <Link
                          to={rutaEmpresa(s.symbol)}
                          className="w-44 shrink-0 truncate text-slate-600 hover:underline"
                        >
                          {s.label}
                        </Link>
                        <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100">
                          <div
                            className={`h-full ${BARRA[signo]}`}
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
                <Procedencia quotes={lista.map((s) => s.quote)} className="mt-2 text-[11px] text-slate-400" />
              </>
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
            vacio={(d) => d.lista.length === 0}
            mensajeVacio="Ninguna empresa anuncia resultados en los próximos 14 días."
          >
            {({ lista, total }) => (
              <>
                {/* Se recortaba a 40 (y el backend a 120) sin decirlo (revisión 13).
                    Sin `total`, no consta cuántos hay: se dice de cuántos llegaron. */}
                {(total ?? lista.length) > MAX_EVENTOS && (
                  <p className="mb-1 text-[11px] text-slate-400">
                    {total !== null
                      ? `${fmtNum(MAX_EVENTOS, 0)} de ${fmtNum(total, 0)}, los más próximos.`
                      : `Los ${fmtNum(MAX_EVENTOS, 0)} más próximos de los ${fmtNum(lista.length, 0)} que llegaron.`}
                  </p>
                )}
                <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                  {lista.slice(0, MAX_EVENTOS).map((ev) => (
                    <li
                      key={`${ev.symbol}-${ev.date}`}
                      className="flex items-center justify-between border-b border-slate-100 py-1"
                    >
                      <Link to={rutaEmpresa(ev.symbol)} className="font-medium text-slate-700 hover:underline">
                        {ev.symbol}
                      </Link>
                      <span className="text-xs text-slate-500">
                        {fmtFecha(ev.date)}
                        {ev.eps_estimate !== null ? ` · BPA est. ${fmtPrecio(ev.eps_estimate)}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </BloqueDatos>
        </section>
      </div>
    </div>
  )
}
