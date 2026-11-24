import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { CalendarioMercado, IndexEntry, Portfolio, PortfolioPosition, PriceAlert, SectorEntry, Shortlist } from '../api/types'
import { AvisoDeAccion } from '../components/AvisoDeAccion'
import { BloqueDatos, ErrorDeCarga } from '../components/EstadoDato'
import { ProgresoAnalisis } from '../components/ProgresoAnalisis'
import { useListaDiaria } from '../hooks/useListaDiaria'
import { avisoDe, tamanoDeLaLista } from '../lib/avisos'
import { fmtDinero, fmtFecha, fmtPct, fmtPrecio, plural, signoLeido } from '../lib/formato'
import { RUTAS, rutaCartera, rutaEmpresa, rutaExplorar } from '../lib/rutas'
import { listaDeSimbolos } from '../lib/simbolos'
import { useDato, type CargaConReintento } from '../lib/useDato'
import { ChangeChip, Procedencia } from './DashboardPage'

/**
 * Inicio: el día de un vistazo (`docs/PLAN_NAVEGACION.md`). Contesta tres
 * preguntas en este orden — ¿pasa algo con lo mío?, ¿qué hay para invertir
 * hoy?, ¿cómo está el mercado? — y todo lo demás está a un toque.
 *
 * Antes la app abría en «Hoy», una lista de 502 empresas con su panel de
 * tamaño, y la primera vez del día se quedaba en «Puntuando el universo…» un
 * par de minutos sin enseñar nada. Aquí cada tarjeta pide lo suyo y se pinta
 * en cuanto llega: la cartera y el mercado no esperan a la lista.
 */

const MERCADO = 'us_sp500'
const CLAVE_GUIA = 'inicio.guia-oculta'

function guiaOculta(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_GUIA) === '1'
    // eslint-disable-next-line no-restricted-syntax -- sin almacenamiento (ventana privada, datos bloqueados) la guía se enseña: es el lado seguro y no hay nada que decir.
  } catch {
    return false
  }
}

function Tarjeta({
  titulo,
  id,
  enlace,
  children,
  className = '',
}: {
  titulo: string
  id: string
  enlace?: { to: string; texto: string }
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-labelledby={id} className={`rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-base font-semibold text-slate-900">
          {titulo}
        </h2>
        {enlace && (
          <Link to={enlace.to} className="text-sm font-medium text-sky-700 hover:underline">
            {enlace.texto}
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function Guia({ ocultar }: { ocultar: () => void }) {
  const pasos: [string, string][] = [
    ['Mira las ideas del día.', 'La app compara cada empresa con las de su sector y te enseña las mejor situadas.'],
    ['Ábrelas para entender por qué.', 'Cada ficha empieza con una frase en lenguaje claro; los números están debajo.'],
    ['Anota lo que compres.', 'La app vigila cada posición y te avisa aquí si baja de tu límite de pérdida.'],
  ]
  return (
    <section aria-labelledby="guia-t" className="rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="guia-t" className="text-base font-semibold text-slate-900">
          Cómo usar la app, en tres pasos
        </h2>
        <button
          type="button"
          onClick={ocultar}
          className="min-h-11 rounded-lg border border-sky-200 px-3 text-sm text-slate-700 hover:text-slate-900"
        >
          Entendido, ocultar
        </button>
      </div>
      <ol className="grid gap-3 lg:grid-cols-3">
        {pasos.map(([titulo, texto], i) => (
          <li key={titulo} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white"
            >
              {i + 1}
            </span>
            <span className="text-sm leading-relaxed text-slate-700">
              <b className="text-slate-900">{titulo}</b> {texto}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Lo que necesita atención en tu cartera, del más urgente al menos.
 *
 *  Fail-safe (CLAUDE.md): sin precio, con un precio rescatado de la caché o sin
 *  poder pedir la cartera, se dice «sin comprobar»; nunca se calla ni pasa por
 *  «en orden». */
export type Atencion = { tono: 'rojo' | 'ambar'; titulo: string; texto: string; to: string }

export function atencionDeCartera(posiciones: PortfolioPosition[], alertas: PriceAlert[] | null): Atencion[] {
  const rojas: Atencion[] = []
  const ambar: Atencion[] = []
  for (const p of posiciones) {
    const precio = fmtPrecio(p.price, p.currency)
    const stop = fmtPrecio(p.stop, p.currency)
    if (p.stop_perforado === true) {
      rojas.push({
        tono: 'rojo',
        titulo: `${p.symbol} bajó de tu límite de pérdida`,
        texto: `Cotiza a ${precio} y tu límite (el «stop») era ${stop}. Tu regla dice vender.`,
        to: rutaEmpresa(p.symbol),
      })
    } else if (p.stop === null || p.stop === undefined) {
      ambar.push({
        tono: 'ambar',
        titulo: `${p.symbol} no tiene límite de pérdida`,
        texto: 'Sin stop no se puede avisar si cae. Anótalo en tu cartera.',
        to: rutaCartera(),
      })
    } else if (p.stop_perforado === null || p.stop_perforado === undefined || p.price === null) {
      ambar.push({
        tono: 'ambar',
        titulo: `${p.symbol}: sin comprobar`,
        texto: 'No hay precio de hoy: no se ha podido comprobar su límite de pérdida.',
        to: rutaEmpresa(p.symbol),
      })
    } else if (p.precio_estado === 'viejo') {
      ambar.push({
        tono: 'ambar',
        titulo: `${p.symbol}: sin comprobar`,
        texto: `Solo hay un precio guardado (${precio}), no uno de ahora: no se puede asegurar que siga por encima de ${stop}.`,
        to: rutaEmpresa(p.symbol),
      })
    }
  }
  for (const a of alertas ?? []) {
    if (!a.active) continue
    if (a.triggered === true) {
      rojas.push({ tono: 'rojo', titulo: `Saltó tu alerta de ${a.symbol}`, texto: a.motivo, to: rutaEmpresa(a.symbol) })
    } else if (a.triggered === null) {
      ambar.push({ tono: 'ambar', titulo: `Tu alerta de ${a.symbol}: sin comprobar`, texto: a.motivo, to: rutaCartera() })
    }
  }
  return [...rojas, ...ambar]
}

function Atenciones({ cartera, alertas }: { cartera: CargaConReintento<Portfolio>; alertas: CargaConReintento<{ alerts: PriceAlert[] }> }) {
  if (cartera.estado === 'cargando') {
    return (
      <p role="status" className="text-sm text-slate-400">
        Comprobando tu cartera…
      </p>
    )
  }
  if (cartera.estado === 'error') {
    // No poder mirar no es «nada urgente».
    return (
      <div className="space-y-1">
        <ErrorDeCarga que="tu cartera" error={cartera.error} reintentar={cartera.reintentar} />
        <p className="text-sm text-amber-800">Ningún límite de pérdida se ha podido comprobar.</p>
      </div>
    )
  }
  const lista = atencionDeCartera(cartera.datos.positions, alertas.estado === 'listo' ? alertas.datos.alerts : null)
  return (
    <div className="space-y-2">
      {lista.map((a) => (
        <div
          key={a.titulo}
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
            a.tono === 'rojo' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
          }`}
        >
          <div className="min-w-0 flex-1">
            <div className={`text-sm font-semibold ${a.tono === 'rojo' ? 'text-red-800' : 'text-amber-800'}`}>
              {a.tono === 'rojo' ? 'Necesita tu atención: ' : 'Revisa: '}
              {a.titulo}
            </div>
            <p className="mt-0.5 text-sm leading-snug text-slate-700">{a.texto}</p>
          </div>
          <Link
            to={a.to}
            className="inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Revisar
          </Link>
        </div>
      ))}
      {alertas.estado === 'error' && (
        <p className="text-sm text-amber-800">Tus alertas de precio no se han podido comprobar ({alertas.error}).</p>
      )}
      {lista.length === 0 && cartera.datos.positions.length > 0 && alertas.estado !== 'error' && (
        <p className="text-sm text-slate-600">
          Nada urgente: todas tus posiciones siguen por encima de su límite de pérdida.
        </p>
      )}
    </div>
  )
}

/** El estado de una posición en una palabra, con la misma regla que los avisos. */
function estadoDePosicion(p: PortfolioPosition): { texto: string; clase: string } {
  if (p.stop_perforado === true) return { texto: 'Por debajo de su límite', clase: 'bg-red-100 text-red-800' }
  if (p.stop === null || p.stop === undefined) return { texto: 'Sin límite de pérdida', clase: 'bg-amber-100 text-amber-800' }
  if (p.stop_perforado !== false || p.precio_estado === 'viejo') return { texto: 'Sin comprobar', clase: 'bg-amber-100 text-amber-800' }
  return { texto: 'En orden', clase: 'bg-emerald-100 text-emerald-800' }
}

function TuCartera({ cartera }: { cartera: CargaConReintento<Portfolio> }) {
  return (
    <BloqueDatos carga={cartera} que="tu cartera">
      {(c) =>
        c.positions.length === 0 ? (
          <div className="space-y-2 text-sm text-slate-600">
            <p>Todavía no has anotado ninguna posición.</p>
            <p>
              Cuando compres algo, anótalo en{' '}
              <Link to={rutaCartera()} className="font-medium text-sky-700 hover:underline">
                Mi cartera
              </Link>{' '}
              y la app vigilará su límite de pérdida.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {c.positions.length} {plural(c.positions.length, 'posición abierta', 'posiciones abiertas')}
              {c.summary.total_market_value !== null && c.divisas?.base
                ? ` · valor ${fmtDinero(c.summary.total_market_value, c.divisas.base)}`
                : ''}
            </p>
            <ul className="space-y-1.5">
              {c.positions.map((p) => {
                const e = estadoDePosicion(p)
                return (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-100 px-3 py-2">
                    <Link to={rutaEmpresa(p.symbol)} className="min-h-6 font-semibold text-slate-900 hover:underline">
                      {p.symbol}
                    </Link>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.clase}`}>{e.texto}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      }
    </BloqueDatos>
  )
}

/** S&P 500, Nasdaq 100 y el VIX, si están; si no, los tres primeros que lleguen. */
export function indicesDeInicio(lista: IndexEntry[]): IndexEntry[] {
  const preferidos = ['SPY', 'QQQ']
  const elegidos = preferidos.map((s) => lista.find((i) => i.symbol === s)).filter((i): i is IndexEntry => !!i)
  const vix = lista.find((i) => /VIX/i.test(i.symbol) || /VIX/i.test(i.label))
  if (vix) elegidos.push(vix)
  for (const i of lista) if (elegidos.length < 3 && !elegidos.includes(i)) elegidos.push(i)
  return elegidos.slice(0, 3)
}

/** El sector que más sube y el que más baja, solo entre los que tienen dato. */
export function extremosDeSectores(lista: SectorEntry[]): { sube: SectorEntry; baja: SectorEntry } | null {
  const con = lista.filter((s) => s.change_pct !== null)
  if (con.length < 2) return null
  const orden = [...con].sort((a, b) => (b.change_pct as number) - (a.change_pct as number))
  return { sube: orden[0], baja: orden[orden.length - 1] }
}

function Mercado({ indices, sectores }: { indices: CargaConReintento<IndexEntry[]>; sectores: CargaConReintento<SectorEntry[]> }) {
  return (
    <div className="space-y-3">
      <BloqueDatos carga={indices} que="los índices" vacio={(d) => d.length === 0} mensajeVacio="Ninguna fuente devolvió índices.">
        {(lista) => {
          const elegidos = indicesDeInicio(lista)
          return (
            <>
              <div className="grid grid-cols-3 gap-2">
                {elegidos.map((ix) => (
                  <div key={ix.symbol} className="rounded-xl bg-slate-100 px-3 py-2.5">
                    <div className="text-xs text-slate-500">{ix.label}</div>
                    <div className="text-lg font-semibold tabular-nums text-slate-900">
                      {ix.quote ? fmtPrecio(ix.quote.price) : '—'}
                    </div>
                    <div className="text-sm">
                      <ChangeChip pct={ix.quote?.change_pct} />
                    </div>
                  </div>
                ))}
              </div>
              {elegidos.some((i) => /VIX/i.test(i.symbol) || /VIX/i.test(i.label)) && (
                <p className="text-xs text-slate-500">
                  El VIX es el «índice del miedo»: mide cuánto esperan que se mueva la bolsa; cuanto más alto, más nervios.
                </p>
              )}
              <Procedencia quotes={elegidos.map((i) => i.quote)} className="text-[11px] text-slate-400" />
            </>
          )
        }}
      </BloqueDatos>
      <BloqueDatos carga={sectores} que="los sectores" vacio={(d) => extremosDeSectores(d) === null} mensajeVacio="Sin dato de sectores.">
        {(lista) => {
          const e = extremosDeSectores(lista)!
          const linea = (rotulo: string, s: SectorEntry) => {
            const texto = fmtPct(s.change_pct, 2, { signo: true, enPuntos: true })
            const tono = { '1': 'text-emerald-600', '0': 'text-slate-500', '-1': 'text-red-600' }[signoLeido(texto)]
            return (
              <div className="text-sm">
                <span className="text-slate-500">{rotulo}</span> {s.label} <span className={`tabular-nums ${tono}`}>{texto}</span>
              </div>
            )
          }
          return (
            <div className="space-y-1">
              {linea('Sector que más sube:', e.sube)}
              {linea('Sector que más baja:', e.baja)}
            </div>
          )
        }}
      </BloqueDatos>
    </div>
  )
}

type Idea = Shortlist['ideas'][number]

/** Una idea de la lista corta con el mismo aviso que en Explorar
 *  (`AvisoDeAccion`): «Comprar» con sus precios y su tamaño, o «Sin sitio»
 *  cuando la cartera no deja tamaño. Antes decía «Comprar» aunque el tamaño
 *  fuera 0 (petición del 24 nov: alertas de compra y venta más claras). */
function TarjetaIdea({ idea, shortlist }: { idea: Idea; shortlist: Shortlist }) {
  const variacion = idea.price ? fmtPct(idea.price.change_pct, 2, { signo: true, enPuntos: true }) : ''
  const tono = { '1': 'text-emerald-600', '0': 'text-slate-500', '-1': 'text-red-600' }[signoLeido(variacion)]
  const aviso = avisoDe({ decision: idea.decision, tamano: tamanoDeLaLista(idea.symbol, shortlist) })
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-slate-100 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">
            {idea.symbol} <span className="font-normal text-slate-500">{idea.context.name}</span>
          </div>
          <div className="text-xs text-slate-400">{idea.context.sector_name}</div>
        </div>
        {idea.price && (
          <div className="shrink-0 text-right">
            <div className="font-semibold tabular-nums text-slate-900">{fmtPrecio(idea.price.last)}</div>
            <div className={`text-xs tabular-nums ${tono}`}>{variacion}</div>
          </div>
        )}
      </div>
      <AvisoDeAccion aviso={aviso} />
      {idea.conviction.resumen && <p className="text-sm leading-snug text-slate-700">{idea.conviction.resumen}</p>}
      <Link to={rutaEmpresa(idea.symbol)} className="mt-auto text-sm font-semibold text-sky-700 hover:underline">
        Ver por qué →
      </Link>
    </li>
  )
}

function IdeasAcciones() {
  // La misma lista que Explorar, compartida (`useListaDiaria`): abrir Inicio y
  // luego Explorar no repite la puntuación. Con una lista guardada de horas
  // atrás se enseña al momento con su antigüedad y la nueva la sustituye.
  const lista = useListaDiaria(MERCADO)
  const d = lista.data
  if (!d) {
    return (
      <div className="space-y-2">
        <ProgresoAnalisis lista={lista} onSeguir={lista.seguirCompletando} />
        {lista.error && <ErrorDeCarga que="las ideas de hoy" error={lista.error.mensaje} reintentar={lista.error.reintentar} />}
      </div>
    )
  }
  const ideas = (d.shortlist?.ideas ?? []).slice(0, 3)
  return (
    <div className="space-y-3">
      <ProgresoAnalisis lista={lista} onSeguir={lista.seguirCompletando} />
      {lista.error && <ErrorDeCarga que="la lista de hoy" error={lista.error.mensaje} reintentar={lista.error.reintentar} />}
      {ideas.length === 0 ? (
        <p className="text-sm text-slate-600">Hoy ninguna empresa cumple todas las condiciones de compra. No comprar también es una decisión.</p>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-3">
          {ideas.map((i) => (
            <TarjetaIdea key={i.symbol} idea={i} shortlist={d.shortlist} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <p className="max-w-2xl text-xs leading-relaxed text-slate-500">
          Cómo elige: puntúa cada empresa frente a las de su sector en valor, calidad y tendencia del precio, y solo
          sugiere comprar si acompañan. No predice precios.
        </p>
        <Link to={rutaExplorar()} className="text-sm font-semibold text-sky-700 hover:underline">
          Ver la lista completa →
        </Link>
      </div>
    </div>
  )
}

/** Para ETFs no hay una lista del día (no hay universo de ETFs que puntuar):
 *  se explica qué son y se lleva al comparador con los que elija el usuario. */
function IdeasEtfs() {
  const navigate = useNavigate()
  const [texto, setTexto] = useState('')
  const { simbolos } = listaDeSimbolos(texto, 4)
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    if (simbolos.length === 0) return
    void navigate(`${rutaExplorar({ tipo: 'etfs' })}&simbolos=${encodeURIComponent(simbolos.join(','))}`)
  }
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-slate-700">
        Un ETF es una cesta de muchas acciones que se compra de una vez: la forma más sencilla de diversificar. La app
        compara los que le digas por lo que cuestan cada año, si su tendencia acompaña, su tamaño y cuántas empresas
        comparten entre sí.
      </p>
      <form onSubmit={enviar} className="flex flex-wrap gap-2">
        <label htmlFor="etfs-inicio" className="sr-only">
          ETFs que quieres comparar
        </label>
        <input
          id="etfs-inicio"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Hasta 4, separados por comas: SPY, QQQ, VTI"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={simbolos.length === 0}
          className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Comparar
        </button>
      </form>
    </div>
  )
}

function Ideas() {
  const [tipo, setTipo] = useState<'acciones' | 'etfs'>('acciones')
  return (
    <section aria-labelledby="ideas-t" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="ideas-t" className="text-lg font-semibold text-slate-900">
            Ideas para invertir hoy
          </h2>
          <p className="text-sm text-slate-500">Las mejor situadas frente a sus comparables. Son reglas escritas, no predicciones.</p>
        </div>
        <div role="group" aria-label="Tipo de inversión" className="inline-flex gap-1 rounded-xl bg-slate-100 p-1">
          {(['acciones', 'etfs'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tipo === t}
              onClick={() => setTipo(t)}
              className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${
                tipo === t ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t === 'acciones' ? 'Acciones' : 'ETFs'}
            </button>
          ))}
        </div>
      </div>
      {tipo === 'acciones' ? <IdeasAcciones /> : <IdeasEtfs />}
    </section>
  )
}

function ProximosDias({ cartera, calendario }: { cartera: CargaConReintento<Portfolio>; calendario: CargaConReintento<CalendarioMercado> }) {
  const mias = cartera.estado === 'listo' ? new Set(cartera.datos.positions.map((p) => p.symbol)) : null
  return (
    <div className="space-y-2 text-sm text-slate-700">
      <BloqueDatos carga={calendario} que="el calendario de resultados">
        {(c) => {
          if (c.error != null || c.events == null) {
            return <p className="text-amber-800">El calendario de resultados no respondió: no se sabe quién presenta.</p>
          }
          if (!mias) return <p className="text-slate-500">Sin tu cartera no se puede saber cuáles de estos resultados son tuyos.</p>
          const tuyos = c.events.filter((e) => mias.has(e.symbol))
          return tuyos.length === 0 ? (
            <p>
              <b className="text-slate-900">Resultados:</b> ninguna empresa de tu cartera presenta cuentas en el calendario
              de las próximas dos semanas.
            </p>
          ) : (
            <ul className="space-y-1">
              {tuyos.map((e) => (
                <li key={`${e.symbol}-${e.date}`}>
                  <b className="text-slate-900">{e.symbol}</b> presenta resultados el {fmtFecha(e.date)}.
                </li>
              ))}
            </ul>
          )
        }}
      </BloqueDatos>
      <Link to={RUTAS.noticias} className="inline-block font-semibold text-sky-700 hover:underline">
        Noticias de tus empresas →
      </Link>
    </div>
  )
}

export function InicioPage() {
  const [verGuia, setVerGuia] = useState(() => !guiaOculta())
  const cartera = useDato(() => api.portfolio(), 'inicio-cartera')
  const alertas = useDato(() => api.alerts(), 'inicio-alertas')
  const indices = useDato(() => api.marketOverview().then((d) => d.indices), 'inicio-indices')
  const sectores = useDato(() => api.marketSectors().then((d) => d.sectors), 'inicio-sectores')
  const calendario = useDato(() => api.calendar(), 'inicio-calendario')
  const ocultarGuia = () => {
    setVerGuia(false)
    try {
      window.localStorage.setItem(CLAVE_GUIA, '1')
      // eslint-disable-next-line no-restricted-syntax -- sin almacenamiento (ventana privada) se oculta solo esta vez; no hay nada que avisar.
    } catch {
      // Nada: la guía ya está oculta en esta visita.
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Tu día en la bolsa</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
          Lo importante en una página: si algo de tu cartera necesita atención, qué ideas hay para invertir y cómo está
          el mercado. Toca cualquier tarjeta para ver el detalle.
        </p>
      </header>

      {verGuia && <Guia ocultar={ocultarGuia} />}

      <Atenciones cartera={cartera} alertas={alertas} />

      <Ideas />

      <div className="grid gap-5 lg:grid-cols-2">
        <Tarjeta titulo="Tu cartera" id="cartera-t" enlace={{ to: rutaCartera(), texto: 'Ver mi cartera' }}>
          <TuCartera cartera={cartera} />
        </Tarjeta>
        <Tarjeta titulo="El mercado hoy" id="mercado-t" enlace={{ to: RUTAS.mercado, texto: 'Ver más' }}>
          <Mercado indices={indices} sectores={sectores} />
        </Tarjeta>
      </div>

      <Tarjeta titulo="Próximos días" id="proximos-t">
        <ProximosDias cartera={cartera} calendario={calendario} />
      </Tarjeta>

      <p className="text-xs leading-relaxed text-slate-400">
        Herramienta personal: sugiere a partir de reglas escritas y datos con su fuente y su fecha. No es asesoría
        financiera ni predice precios; la decisión es tuya.
      </p>
    </div>
  )
}
