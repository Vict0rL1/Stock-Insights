import { useCallback, useId, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { HistoryRange, Quote } from '../api/types'
import { FundamentalsGrid } from '../components/FundamentalsGrid'
import { CompanyLogo } from '../components/CompanyLogo'
import { FranjaDesplazable } from '../components/MarcoTabla'
import { PriceChart } from '../components/PriceChart'
import { BloqueDatos, EstadoDato, ErrorDeCarga } from '../components/EstadoDato'
import { Termino } from '../components/Termino'
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
import { QueDiceLaApp } from '../components/ticker/QueDiceLaApp'
import { AvisoDeTesis, CifrasClaveExplicadas, LoQueCompruebaLaApp } from '../components/ticker/ResumenFicha'
import { decimalesPrecio, fmtCompacto, fmtNum, fmtPct, fmtPrecio, signoLeido } from '../lib/formato'
import {
  NOMBRE_MAS_DETALLE,
  PESTANAS,
  SECCIONES,
  leerPestana,
  parametroDe,
  vistaDe,
  type PestanaFicha,
  type VistaFicha,
} from '../lib/pestanasFicha'
// Un 404 del backend es «ninguna fuente lo tiene» (`DataNotFoundError`), no un
// fallo: se resuelve a `null` y la pantalla lo dice como ausencia. Cualquier
// otro error sigue siendo un error, con su motivo y «Reintentar» (ítem 2.1).
import { nullSi404, useDato, type CargaConReintento } from '../lib/useDato'

// La traducción de las once pestañas de antes a las de ahora, para quien
// redirige las rutas viejas (vive en `lib/pestanasFicha.ts`).
export { PESTANAS_VIEJAS, pestanaNueva } from '../lib/pestanasFicha'

const RANGES: HistoryRange[] = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', '10Y']

function lastNonNull(values: (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null) return values[i]
  }
  return null
}

/** El cambio del día como se escribe en la cabecera, y su color de lo escrito.
 *  Con `change >= 0`, un «0,00 (0,00 %)» salía en verde, como una subida; Hoy y
 *  Mercado ya seguían a `signoLeido` (revisión 13). Un cambio desconocido («—»)
 *  tampoco es verde. Si el cambio se escribe cero y el porcentaje no (o al
 *  revés), manda el que no es cero: los dos tienen siempre el mismo signo. */
function cambioDelDia(q: Quote) {
  // Con los decimales del PRECIO, no los del propio cambio: una acción de 0,003
  // que sube 0,0004 salía «+0,00» (revisión 5), y con los suyos el ruido de
  // float32 de Yahoo salía «+0,06999» sobre 172,87 (revisión 6).
  const cambio = fmtNum(q.change, q.price != null ? decimalesPrecio(q.price) : 2, {
    signo: true,
    ceros: q.price == null || decimalesPrecio(q.price) === 2,
  })
  const pct = fmtPct(q.change_pct, 2, { signo: true, enPuntos: true })
  const delCambio = signoLeido(cambio)
  const signo = delCambio !== 0 ? delCambio : signoLeido(pct)
  return { cambio, pct, tono: signo === 0 ? 'text-slate-500' : signo > 0 ? 'text-emerald-600' : 'text-red-600' }
}

/** Las cuatro pestañas en una fila y, al lado, «Más detalle». Teclado como en
 *  unas pestañas de verdad: las flechas mueven el foco y Intro o espacio la
 *  abren. Abrir no es moverse: cada pestaña pide sus datos (y «Qué cambió»
 *  congela una instantánea), así que pasar por encima con las flechas no abre
 *  nada (activación manual). */
function PestanasDeLaFicha({ vista, irA, ids }: { vista: VistaFicha; irA: (v: VistaFicha) => void; ids: Ids }) {
  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const destino =
      e.key === 'ArrowRight' ? (i + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : null
    if (destino === null) return
    e.preventDefault()
    tabs[destino].focus()
  }
  // Con «Más detalle» abierto no hay pestaña elegida: el Tab entra por la primera.
  const conFoco = vista.pestana === 'detalle' ? 'resumen' : vista.pestana
  return (
    // Cuatro caben en una fila a 390 px (antes once: cinco filas, unos 200 px
    // antes del contenido; revisión 12, visual). La fila no se parte nunca y,
    // por si una pantalla aún más estrecha no las cupiera, se desplaza.
    <nav aria-label="Secciones de la ficha" className="flex flex-wrap items-center justify-between gap-x-3 border-b border-slate-200">
      <FranjaDesplazable role="tablist" aria-label="Pestañas de la ficha" onKeyDown={alTeclear} className="flex min-w-0">
        {PESTANAS.map(({ id, nombre }) => {
          const elegida = vista.pestana === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={ids.tab(id)}
              aria-selected={elegida}
              aria-controls={ids.panel(id)}
              tabIndex={id === conFoco ? 0 : -1}
              onClick={() => irA(vistaDe(id))}
              className={`shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-sm sm:px-4 ${
                elegida ? 'border-slate-900 font-semibold text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {nombre}
            </button>
          )
        })}
      </FranjaDesplazable>
      <button
        type="button"
        aria-pressed={vista.pestana === 'detalle'}
        aria-controls={ids.panel('detalle')}
        onClick={() => irA(vistaDe('detalle'))}
        className={`ml-auto whitespace-nowrap py-2 text-sm ${
          vista.pestana === 'detalle' ? 'font-semibold text-slate-900' : 'text-sky-700 hover:underline'
        }`}
      >
        {NOMBRE_MAS_DETALLE}
      </button>
    </nav>
  )
}

type Ids = { tab: (p: PestanaFicha) => string; panel: (p: PestanaFicha) => string }

/** Las secciones de una pestaña que junta varias, como botones que se pulsan
 *  (una abierta cada vez: cada una pide sus datos al abrirse). */
function SeccionesDe({
  pestana,
  vista,
  irA,
}: {
  pestana: 'numeros' | 'novedades' | 'detalle'
  vista: VistaFicha
  irA: (v: VistaFicha) => void
}) {
  const secciones = SECCIONES[pestana]
  const abierta = secciones.find((s) => s.id === vista.seccion)
  const nombre = PESTANAS.find((p) => p.id === pestana)?.nombre ?? NOMBRE_MAS_DETALLE
  return (
    <div className="space-y-1">
      <div role="group" aria-label={`Partes de «${nombre}»`} className="flex flex-wrap gap-2">
        {secciones.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={vista.seccion === s.id}
            onClick={() => irA({ pestana, seccion: s.id })}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              vista.seccion === s.id
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {s.nombre}
          </button>
        ))}
      </div>
      {abierta ? (
        <p className="text-xs text-slate-500">
          {abierta.nombre}: {abierta.resumen}.
        </p>
      ) : (
        <ul className="space-y-0.5 text-xs text-slate-500">
          {secciones.map((s) => (
            <li key={s.id}>
              <span className="font-medium text-slate-700">{s.nombre}</span>: {s.resumen}.
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** El símbolo de la ficha, en la misma ruta en que se está: `/ticker/X` o
 *  `/empresa/X` (las rutas viejas redirigen a las nuevas), o desde `/ticker`. */
function rutaDe(pathname: string, conSimbolo: boolean, simbolo: string): string {
  const base = conSimbolo ? pathname.slice(0, pathname.replace(/\/+$/, '').lastIndexOf('/')) : pathname.replace(/\/+$/, '')
  return `${base}/${encodeURIComponent(simbolo)}`
}

export function TickerPage() {
  const { symbol: routeSymbol } = useParams()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()
  const symbol = (routeSymbol ?? '').toUpperCase()

  const [input, setInput] = useState(symbol)
  // La pestaña vive en la URL (`?pestana=`, con los identificadores nuevos o
  // los de antes: las rutas viejas redirigen aquí con el suyo). Al cambiar de
  // símbolo la URL nueva no lleva pestaña y se vuelve al Resumen en el mismo
  // render: con un `useEffect` quedaba un render con la pestaña anterior
  // abierta para el símbolo nuevo, y «Qué cambió» llegaba a pedir (y congelar)
  // el análisis de un símbolo que luego resultaba no existir (revisión del
  // 2.1). Y A → B → A no reabre la pestaña que A tenía: la reabría y volvía a
  // pedir «Qué cambió» sin que nadie lo abriera (segunda revisión del 2.1).
  const pedida = leerPestana(params.get('pestana'))
  // «Qué cambió» congela una instantánea al abrirse, así que solo se abre con
  // una pulsación en esta ficha. Desde que la pestaña va en la URL, volver con
  // «atrás», recargar o abrir un enlace guardado con `?pestana=novedades` lo
  // montaba solo y volvía a pedir el análisis que congela (revisión 14, H9; la
  // segunda revisión del 2.1 ya lo había corregido con la pestaña en el estado).
  // Así se abre Novedades sin abrir ninguna parte. Vale para este símbolo: otro
  // símbolo lo olvida en ese mismo render (ni uno con el de antes, que ya pedía).
  const [cambiosPulsado, setCambiosPulsado] = useState<{ symbol: string } | null>(null)
  if (cambiosPulsado !== null && cambiosPulsado.symbol !== symbol) setCambiosPulsado(null)
  const vista: VistaFicha =
    pedida.seccion === 'cambios' && cambiosPulsado?.symbol !== symbol ? { ...pedida, seccion: null } : pedida
  const irA = (v: VistaFicha) => {
    if (v.seccion === 'cambios') setCambiosPulsado({ symbol })
    setParams(
      (antes) => {
        const nuevos = new URLSearchParams(antes)
        const valor = parametroDe(v)
        if (valor) nuevos.set('pestana', valor)
        else nuevos.delete('pestana')
        return nuevos
      },
      { replace: true },
    )
  }
  const [range, setRange] = useState<HistoryRange>('1Y')
  // «Explícamelo con IA» abre el informe y pide su narrativa una vez, para este
  // símbolo: volver luego a la sección no la vuelve a pedir.
  const [redactar, setRedactar] = useState<string | null>(null)
  const yaRedactando = useCallback(() => setRedactar(null), [])
  const base = useId()
  const ids: Ids = { tab: (p) => `${base}-pestana-${p}`, panel: (p) => `${base}-panel-${p}` }

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

  // Un símbolo que ninguna fuente conoce («AAPLL», un error de tecleo) no es
  // una empresa sin datos: no existe. Sin esto la ficha abría las pestañas y
  // «Qué cambió» congelaba una instantánea inmutable de un símbolo inexistente,
  // que los triggers de la 0004 ya no dejan borrar (revisión del 2.1). Pero sin
  // cotización, perfil ni fundamentales EDGAR puede tener sus estados (VACIA en
  // la captura `empresa_sin_datos`): solo entonces se le pregunta, y solo si
  // tampoco los tiene es «no encontrado». Las pestañas esperan a saberlo:
  // pulsar una antes llevaba al mismo sitio. Un fallo (502) no es «no existe»:
  // ahí sí se abren.
  const piezas = [cotizacion, perfil, fundamentales]
  const tresAusentes = piezas.every((c) => c.estado === 'listo' && c.datos === null)
  const edgar = useDato(() => nullSi404(api.financials(symbol)), tresAusentes ? symbol : null)
  const noEncontrado = tresAusentes && edgar.estado === 'listo' && edgar.datos === null
  // Un valor que ya no está en ninguna fuente (deslistado, sin SEC) puede tener
  // decisiones congeladas: son datos del usuario, y el historial es la única
  // entrada a sus replays (segunda revisión del 2.1).
  const guardadas = useDato(
    () => api.historialEmpresa(symbol).then((r) => r.decisiones.length),
    noEncontrado ? symbol : null,
  )
  const hayEmpresa =
    piezas.some((c) => c.estado === 'error' || (c.estado === 'listo' && c.datos !== null)) ||
    (tresAusentes && (edgar.estado === 'error' || (edgar.estado === 'listo' && edgar.datos !== null)))
  // «Qué dice la app»: el análisis entero, SIN congelar (abrir la ficha es
  // leer) y solo cuando se sabe que la empresa existe, por lo mismo que las
  // pestañas.
  const analisis = useDato(() => api.leerAnalisisEmpresa(symbol), hayEmpresa ? symbol : null)

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const cleaned = input.trim().toUpperCase()
    if (cleaned) void navigate(rutaDe(pathname, Boolean(routeSymbol), cleaned))
  }

  const quote = cotizacion.estado === 'listo' ? cotizacion.datos : null
  const profile = perfil.estado === 'listo' ? perfil.datos : null
  const history = historico.estado === 'listo' ? historico.datos : null
  const rsi = history ? lastNonNull(history.indicators.rsi14) : null
  const cap = profile?.market_cap ?? null
  const moneda = quote?.currency ?? profile?.currency ?? null
  const explicar = () => {
    setRedactar(symbol)
    irA({ pestana: 'detalle', seccion: 'informe' })
  }
  const panel = (p: PestanaFicha) => ({ role: 'tabpanel', id: ids.panel(p), 'aria-labelledby': p === 'detalle' ? undefined : ids.tab(p), 'aria-label': p === 'detalle' ? NOMBRE_MAS_DETALLE : undefined })

  return (
    <div className="space-y-4">
      {/* Solo sin empresa elegida: con una abierta, la búsqueda de arriba (la de
          todas las pantallas) ya está justo encima y eran dos cajas seguidas. */}
      {!routeSymbol && (
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Símbolo de la empresa"
          placeholder="Símbolo (p. ej. AAPL, MSFT, SHOP.TO)"
          className="w-64 min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Analizar
        </button>
      </form>
      )}

      {symbol && noEncontrado && (
        <>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            No se encontró el símbolo «{symbol}» en las fuentes configuradas.
          </p>
          {/* Si la consulta falla se dice, con «Reintentar»: callarlo era pintar
              «no hay nada» justo con los datos del usuario (tercera pasada). */}
          <BloqueDatos carga={guardadas} que="las decisiones guardadas">
            {(n) => (n > 0 ? <HistorialSection symbol={symbol} /> : null)}
          </BloqueDatos>
        </>
      )}

      {symbol && !noEncontrado && (
        <>
          <header className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <CompanyLogo symbol={symbol} size="lg" className="mt-1" />
                <div className="min-w-0 space-y-1">
                  <h1 className="text-xl font-semibold text-slate-900">
                    {/* El nombre sale del perfil o, si no lo hay, del símbolo. */}
                    {profile?.name ?? symbol}
                    <span className="ml-2 text-sm font-normal text-slate-500">
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
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <BloqueDatos
                      carga={cotizacion}
                      que="la cotización"
                      vacio={(q) => q === null}
                      mensajeVacio={`Precio no disponible: ninguna fuente configurada tiene cotización de ${symbol}.`}
                    >
                      {(q) => {
                        if (!q) return null
                        const c = cambioDelDia(q)
                        return (
                          <>
                            <span className="text-3xl font-semibold tabular-nums text-slate-900">
                              {fmtPrecio(q.price)}
                              <span className="ml-1 text-base font-normal text-slate-500">{moneda ?? ''}</span>
                            </span>
                            <span className="whitespace-nowrap">
                              <span className={`text-lg font-medium tabular-nums ${c.tono}`}>
                                {c.cambio} ({c.pct})
                              </span>
                              <span className="ml-1 text-sm text-slate-500">hoy</span>
                            </span>
                          </>
                        )
                      }}
                    </BloqueDatos>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-start gap-1 sm:items-end sm:text-right">
                {/* La fuente y su retraso: «finnhub · retrasado ~15 min». */}
                {quote && <EstadoDato data={quote} freshness={quote.freshness} />}
                <div className="text-xs text-slate-500">
                  {quote && (
                    <>
                      Cierre anterior: {fmtPrecio(quote.prev_close)} · Hoy, entre {fmtPrecio(quote.day_low)} y{' '}
                      {fmtPrecio(quote.day_high)}
                    </>
                  )}
                  {cap !== null && (
                    <>
                      {quote ? ' · ' : ''}
                      <Termino clave="capitalizacion">Capitalización</Termino>: {fmtCompacto(cap)}
                    </>
                  )}
                </div>
              </div>
            </div>
          </header>

          {hayEmpresa && <QueDiceLaApp carga={analisis} moneda={moneda} alExplicar={explicar} />}

          {hayEmpresa && <PestanasDeLaFicha vista={vista} irA={irA} ids={ids} />}

          {/* El Resumen se queda montado (oculto) al cambiar de pestaña: el
              gráfico no se vuelve a dibujar ni a pedir al volver. */}
          <div {...panel('resumen')} hidden={vista.pestana !== 'resumen'} className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Periodo del gráfico">
                    {RANGES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        aria-pressed={r === range}
                        onClick={() => setRange(r)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                          r === range ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
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
                <p className="mt-2 text-xs text-slate-500">
                  La línea «SMA 200» es su <Termino clave="media_200">media de 200 sesiones</Termino>: con ella
                  mide la app si el precio va al alza o a la baja.
                </p>
              </section>
              {hayEmpresa && (
                <DelAnalisis carga={analisis} que="lo que comprueba la app">
                  {(a) => <LoQueCompruebaLaApp decision={a.decision} />}
                </DelAnalisis>
              )}
            </div>
            {hayEmpresa && analisis.estado === 'listo' && <AvisoDeTesis analisis={analisis.datos.analisis} />}
            {hayEmpresa && (
              <DelAnalisis carga={analisis} que="las cifras clave">
                {(a) => <CifrasClaveExplicadas analisis={a} alVerMas={() => irA(vistaDe('numeros'))} />}
              </DelAnalisis>
            )}
          </div>

          {/* Las demás cargan sus datos solo al abrirse: no se gastan llamadas de
              API en análisis que no estás mirando. */}
          {hayEmpresa && vista.pestana === 'numeros' && (
            <div {...panel('numeros')} className="space-y-4">
              <SeccionesDe pestana="numeros" vista={vista} irA={irA} />
              {vista.seccion === 'fundamentales' && (
                <>
                  <FundamentalsGrid carga={fundamentales} symbol={symbol} />
                  <FinancialsSection symbol={symbol} />
                </>
              )}
              {vista.seccion === 'salud' && <HealthSection symbol={symbol} />}
              {vista.seccion === 'calidad' && <CalidadSection symbol={symbol} />}
            </div>
          )}
          {hayEmpresa && vista.pestana === 'valoracion' && (
            <div {...panel('valoracion')}>
              <ValuationSection symbol={symbol} />
            </div>
          )}
          {hayEmpresa && vista.pestana === 'novedades' && (
            <div {...panel('novedades')} className="space-y-4">
              <SeccionesDe pestana="novedades" vista={vista} irA={irA} />
              {vista.seccion === 'cambios' && <QueCambioSection symbol={symbol} />}
              {vista.seccion === 'expectativas' && <ExpectativasSection symbol={symbol} />}
              {vista.seccion === 'filings' && <FilingsSection symbol={symbol} />}
            </div>
          )}
          {hayEmpresa && vista.pestana === 'detalle' && (
            <div {...panel('detalle')} className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="mb-2 text-sm font-semibold text-slate-800">Más detalle, para usuarios avanzados</h2>
                <SeccionesDe pestana="detalle" vista={vista} irA={irA} />
              </div>
              {vista.seccion === 'informe' && (
                <DeepDiveSection symbol={symbol} redactarAlAbrir={redactar === symbol} alRedactar={yaRedactando} />
              )}
              {vista.seccion === 'opciones' && <OptionsSection symbol={symbol} />}
              {vista.seccion === 'historial' && <HistorialSection symbol={symbol} />}
            </div>
          )}
        </>
      )}

      {!symbol && (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          <p className="text-sm">
            Escribe el símbolo de una empresa para ver qué dice la app de ella, su precio y sus cifras.
          </p>
          <p className="mt-1 text-xs">
            Toda cifra lleva su fuente y su fecha. La app no hace predicciones ni pone precios objetivo.
          </p>
        </div>
      )}
    </div>
  )
}

/** Una pieza del Resumen que sale del análisis. Su fallo ya lo dice «Qué dice
 *  la app», con su «Reintentar»: aquí se nombra sin repetir el aviso entero. */
function DelAnalisis({
  carga,
  que,
  children,
}: {
  carga: CargaConReintento<Awaited<ReturnType<typeof api.leerAnalisisEmpresa>>>
  que: string
  children: (a: Awaited<ReturnType<typeof api.leerAnalisisEmpresa>>['analisis']) => React.ReactNode
}) {
  if (carga.estado === 'listo') return <>{children(carga.datos.analisis)}</>
  return (
    <p role={carga.estado === 'cargando' ? 'status' : undefined} className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
      {carga.estado === 'cargando'
        ? `Cargando ${que}…`
        : `Sin el análisis no se puede enseñar ${que}: el motivo y «Reintentar» están arriba, en «Qué dice la app».`}
    </p>
  )
}
