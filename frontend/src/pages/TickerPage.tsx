import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import type { HistoryRange } from '../api/types'
import { FundamentalsGrid } from '../components/FundamentalsGrid'
import { CompanyLogo } from '../components/CompanyLogo'
import { PriceChart } from '../components/PriceChart'
import { BloqueDatos, EstadoDato, ErrorDeCarga } from '../components/EstadoDato'
import { DeepDiveSection } from '../components/ticker/DeepDiveSection'
import { FilingsSection } from '../components/ticker/FilingsSection'
import { FinancialsSection } from '../components/ticker/FinancialsSection'
import { HealthSection } from '../components/ticker/HealthSection'
import { OptionsSection } from '../components/ticker/OptionsSection'
import { ValuationSection } from '../components/ticker/ValuationSection'
import { QueCambioSection } from '../components/ticker/QueCambioSection'
import { ExpectativasSection } from '../components/ticker/ExpectativasSection'
import { CalidadSection } from '../components/ticker/CalidadSection'
import { HistorialSection } from '../components/ticker/HistorialSection'
import { fmtCompacto, fmtPct, fmtNum } from '../lib/formato'
import { useDato } from '../lib/useDato'

const RANGES: HistoryRange[] = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y']

type TabName =
  | 'resumen'
  | 'informe'
  | 'fundamentales'
  | 'valoracion'
  | 'opciones'
  | 'salud'
  | 'filings'
  | 'cambios'
  | 'expectativas'
  | 'calidad'
  | 'historial'

// Las pestañas cargan sus datos solo al abrirse: no se gastan llamadas de API
// en análisis que no estás mirando.
const TABS: { id: TabName; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'informe', label: 'Informe completo' },
  { id: 'fundamentales', label: 'Fundamentales' },
  { id: 'valoracion', label: 'Valoración' },
  { id: 'opciones', label: 'Opciones' },
  { id: 'salud', label: 'Salud y riesgo' },
  { id: 'filings', label: 'Filings' },
  { id: 'cambios', label: 'Qué cambió' },
  { id: 'expectativas', label: 'Resultados vs expectativas' },
  { id: 'calidad', label: 'Calidad de beneficios' },
  { id: 'historial', label: 'Decisiones y replay' },
]

function lastNonNull(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i]
  }
  return null
}

/** Un 404 del backend es «ninguna fuente lo tiene» (`DataNotFoundError`), no un
 *  fallo: se resuelve a `null` y la pantalla lo dice como ausencia. Cualquier
 *  otro error sigue siendo un error, con su motivo y «Reintentar» (ítem 2.1). */
function nullSi404<T>(peticion: Promise<T>): Promise<T | null> {
  return peticion.catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  })
}

export function TickerPage() {
  const { symbol: routeSymbol } = useParams()
  const navigate = useNavigate()
  const symbol = (routeSymbol ?? '').toUpperCase()

  const [input, setInput] = useState(symbol)
  const [tab, setTab] = useState<TabName>('resumen')
  const [range, setRange] = useState<HistoryRange>('1Y')

  // Cada pieza de la ficha con su propio estado (ítem 2.1). Antes la cotización
  // era imprescindible (`Promise.all`): si fallaba, la ficha entera era «No se
  // encontró el símbolo» y no había pestañas, aunque EDGAR tuviera estados
  // financieros, análisis e historial (captura `empresa_sin_datos`). Ausente no
  // es «no existe». Perfil y fundamentales hacían `.catch(() => null)` y su
  // fallo no se veía nunca.
  const clave = symbol || null
  const cotizacion = useDato(() => nullSi404(api.quote(symbol)), clave)
  const perfil = useDato(() => nullSi404(api.profile(symbol)), clave)
  const fundamentales = useDato(() => nullSi404(api.fundamentals(symbol)), clave)
  // Clave símbolo + rango: al cambiar de símbolo ya no queda el gráfico del
  // anterior bajo la cabecera del nuevo. Un fallo salía como «Sin histórico
  // disponible…»; ahora solo lo dice un 404, y el resto es un fallo.
  const historico = useDato(() => nullSi404(api.history(symbol, range)), symbol ? `${symbol}|${range}` : null)

  useEffect(() => {
    setTab('resumen')
  }, [symbol])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = input.trim().toUpperCase()
    if (cleaned) navigate(`/ticker/${cleaned}`)
  }

  const quote = cotizacion.estado === 'listo' ? cotizacion.datos : null
  const profile = perfil.estado === 'listo' ? perfil.datos : null
  const history = historico.estado === 'listo' ? historico.datos : null
  const rsi = history ? lastNonNull(history.indicators.rsi14) : null
  // Un cambio desconocido no es verde: `(change ?? 0) >= 0` lo pintaba como subida.
  const colorCambio =
    quote?.change === null || quote?.change === undefined
      ? 'text-slate-500'
      : quote.change >= 0
        ? 'text-emerald-600'
        : 'text-red-600'
  const cap = profile?.market_cap ?? null

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ticker (p. ej. AAPL, MSFT, SHOP.TO)"
          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Analizar
        </button>
      </form>

      {symbol && (
        <>
          <header className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-start gap-3">
                <CompanyLogo symbol={symbol} size="lg" className="mt-1" />
                <div className="space-y-1">
                <h1 className="text-xl font-semibold text-slate-900">
                  {/* El nombre sale del perfil o, si no lo hay, del símbolo. */}
                  {profile?.name ?? symbol}
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    {symbol}
                    {profile?.exchange ? ` · ${profile.exchange}` : ''}
                    {profile?.sector ? ` · ${profile.sector}` : ''}
                    {perfil.estado === 'listo' && profile === null ? ' · sin perfil en las fuentes configuradas' : ''}
                  </span>
                </h1>
                {/* Un perfil viejo, desconocido o con error se dice; uno válido no
                    añade ruido a la cabecera. */}
                {profile && profile.estado !== undefined && profile.estado !== 'valido' && <EstadoDato data={profile} />}
                {perfil.estado === 'error' && (
                  <ErrorDeCarga que="el perfil" error={perfil.error} reintentar={perfil.reintentar} />
                )}
                <div className="flex items-baseline gap-3">
                  <BloqueDatos
                    carga={cotizacion}
                    que="la cotización"
                    vacio={(q) => q === null}
                    mensajeVacio={`Precio no disponible: ninguna fuente configurada tiene cotización de ${symbol}.`}
                  >
                    {(q) =>
                      q && (
                        <>
                          <span className="text-3xl font-semibold tabular-nums text-slate-900">
                            {fmtNum(q.price)}
                            <span className="ml-1 text-base font-normal text-slate-400">
                              {q.currency ?? profile?.currency ?? ''}
                            </span>
                          </span>
                          <span className={`text-lg font-medium tabular-nums ${colorCambio}`}>
                            {q.change !== null && q.change > 0 ? '+' : ''}
                            {fmtNum(q.change)} ({fmtPct(q.change_pct, 2, { signo: true, enPuntos: true })})
                          </span>
                        </>
                      )
                    }
                  </BloqueDatos>
                </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 text-right">
                {quote && <EstadoDato data={quote} freshness={quote.freshness} />}
                <div className="text-xs text-slate-400">
                  {quote && (
                    <>
                      Ant.: {fmtNum(quote.prev_close)} · Rango día:{' '}
                      {fmtNum(quote.day_low)}–{fmtNum(quote.day_high)}
                    </>
                  )}
                  {cap !== null ? `${quote ? ' · ' : ''}Cap.: ${fmtCompacto(cap)}` : ''}
                </div>
              </div>
            </div>
          </header>

          <nav className="flex flex-wrap gap-1 border-b border-slate-200">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  tab === id
                    ? 'border-slate-900 font-medium text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {tab === 'informe' && <DeepDiveSection symbol={symbol} />}
          {tab === 'fundamentales' && <FinancialsSection symbol={symbol} />}
          {tab === 'valoracion' && <ValuationSection symbol={symbol} />}
          {tab === 'opciones' && <OptionsSection symbol={symbol} />}
          {tab === 'salud' && <HealthSection symbol={symbol} />}
          {tab === 'filings' && <FilingsSection symbol={symbol} />}
          {tab === 'cambios' && <QueCambioSection symbol={symbol} />}
          {tab === 'expectativas' && <ExpectativasSection symbol={symbol} />}
          {tab === 'calidad' && <CalidadSection symbol={symbol} />}
          {tab === 'historial' && <HistorialSection symbol={symbol} />}

          <section
            className={`rounded-xl border border-slate-200 bg-white p-4 ${tab === 'resumen' ? '' : 'hidden'}`}
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      r === range
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                {rsi !== null && (
                  <span
                    className="text-xs text-slate-500"
                    title="RSI 14 sobre el intervalo mostrado; calculado por la app a partir de los datos"
                  >
                    RSI 14: <span className="font-medium tabular-nums">{fmtNum(rsi, 1)}</span>
                  </span>
                )}
                {history && <EstadoDato data={history} />}
              </div>
            </div>
            <BloqueDatos
              carga={historico}
              que="el histórico"
              vacio={(h) => h === null}
              mensajeVacio={
                <span className="block py-16 text-center">
                  Sin histórico disponible para {symbol} en las fuentes configuradas.
                </span>
              }
            >
              {(h) => h && <PriceChart history={h} />}
            </BloqueDatos>
          </section>

          {tab === 'resumen' && <FundamentalsGrid carga={fundamentales} symbol={symbol} />}
        </>
      )}

      {!symbol && (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
          <p className="text-sm">
            Escribe un ticker para ver precio, gráfico y fundamentales básicos.
          </p>
          <p className="mt-1 text-xs">
            Toda cifra muestra su fuente y fecha. Esta app no da señales de compra ni
            predicciones.
          </p>
        </div>
      )}
    </div>
  )
}
