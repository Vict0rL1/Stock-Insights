import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CompanyLogo } from '../CompanyLogo'
import { BloqueDatos } from '../EstadoDato'
import { CurvaDeCartera, Sparkline } from '../Sparkline'
import { MarcoTabla } from '../MarcoTabla'
import { api } from '../../api/client'
import type { DivisasDeCartera, HistorialDeCartera, Portfolio, PortfolioPosition } from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { decimalesPrecio, fmtAntiguedad, fmtDinero, fmtFecha, fmtNum, fmtPct, fmtPrecio, plural, signoLeido } from '../../lib/formato'
import { leerNumero, textoDeCampo } from '../../lib/entrada'
import { useDato, type CargaConReintento } from '../../lib/useDato'
import { AlertasDePrecio } from './AlertasDePrecio'
import { estadoDelStop } from './atencion'
import { EfectivoPanel } from './RiesgoYOportunidad'
import { tonoLeido } from './tono'
import { rutaEmpresa } from '../../lib/rutas'

// Las cifras que se escriben aquí se guardan: con `parseFloat`, «1.250,50»
// (como la app escribe un importe) era 1,25 y «12,5» era 12, sin aviso. Una
// posición, un stop o una venta guardados mil veces más pequeños (tercera
// pasada de la revisión del 2.1). Lo que no se entiende se dice y no se envía.
const EJEMPLO = 'escribe p. ej. 1.250,50 o 98,5'

/** Qué divisas hay y a qué tipo se convirtieron.
 *
 *  Solo aparece cuando alguna no es la base: en una cartera toda en la base
 *  esto sería ruido, y el caso normal no debe pagar por el caso raro. */
function DivisasPanel({ d }: { d: DivisasDeCartera }) {
  if (!d.mezcla_de_divisas && d.sin_convertir.length === 0) return null
  // También las que no se pudieron convertir: «USD + una fila CAD sin tipo» son dos.
  const divisas = new Set([...Object.keys(d.monedas), ...d.sin_convertir.flatMap((s) => (s.moneda ? [s.moneda] : []))])
  const efectoDivisa = d.efecto_divisa_base == null ? null : fmtDinero(d.efecto_divisa_base, d.base, 0, { signo: true })
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-sky-900">
          {divisas.size} {plural(divisas.size, 'divisa', 'divisas')} · todo convertido a {d.base}
        </h3>
        {/* Estos importes están YA en la base: son «cuánto de tu cartera, medido
            en USD, viene de activos en cada divisa». Ponerlos como «CAD 2903» a
            secas se lee como 2903 dólares canadienses, que es otra cifra. */}
        <span className="text-[11px] tabular-nums text-sky-800">
          en {d.base}, por divisa de origen:{' '}
          {Object.entries(d.monedas)
            .map(([m, v]) => `${m} → ${fmtNum(v, 0)}`)
            .join(' · ')}
        </span>
      </div>

      {Object.keys(d.tipos_usados).length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-sky-900">
          {Object.entries(d.tipos_usados).map(([m, t]) => (
            <li key={m} className="tabular-nums">
              1 {d.base} = {fmtNum(t.por_usd, 4)} {m}
              <span className="ml-2 text-sky-700">
                ({t.serie}{t.fecha ? ` · ${fmtFecha(t.fecha)}` : ''})
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Lo que ha movido SOLO el tipo de cambio desde que compraste. Está
          dentro del P&L de arriba; aquí se separa porque es un riesgo distinto
          del de la acción, y uno que se suele olvidar. */}
      {efectoDivisa !== null && (
        <p className="mt-2 text-[11px] tabular-nums text-sky-900">
          Efecto divisa desde la compra:{' '}
          {/* Un «0 USD» en el color del párrafo, no en verde (revisión 13). */}
          <span className={tonoLeido(efectoDivisa, 'text-emerald-700', 'text-red-700', '')}>{efectoDivisa}</span>{' '}
          <span className="text-sky-700">(incluido en el P&L)</span>
        </p>
      )}

      {d.sin_convertir.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-amber-800">
          {d.sin_convertir.map((x, i) => (
            <li key={i}>
              <strong>{x.symbol}</strong> fuera del total: {x.motivo}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-sky-800">{d.nota}</p>
    </section>
  )
}

/** El recorrido del valor de la cartera, no solo el P&L de hoy.
 *
 *  Su carga vive en `Posiciones` (solo cuando se abre la pestaña: necesita el
 *  histórico largo de cada posición, que puede costar una descarga) para que
 *  añadir o cerrar una posición lo vuelva a pedir. Mientras colgaba de aquí,
 *  solo se volvía a pedir al desmontarse; con `refrescar` no se desmonta y la
 *  curva se quedaba en la cartera de antes (segunda revisión del 2.1). El fallo
 *  salía como el motivo a secas, sin decir qué no había cargado (ítem 2.1). */
function HistorialPanel({
  historial,
  conCodigo,
}: {
  historial: CargaConReintento<HistorialDeCartera>
  conCodigo: boolean
}) {
  return (
    <BloqueDatos carga={historial} que="el recorrido de la cartera">
      {(d) => <Recorrido d={d} conCodigo={conCodigo} />}
    </BloqueDatos>
  )
}

/** `conCodigo`: con varias divisas, cada importe dice la suya, como las
 *  tarjetas de arriba; «37.643,00» a secas no decía que eran dólares (revisión
 *  12, visual). */
function Recorrido({ d, conCodigo = false }: { d: HistorialDeCartera; conCodigo?: boolean }) {
  const moneda = conCodigo ? (d.base ?? null) : null
  if (!d.disponible) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">Recorrido de la cartera</h3>
        <p className="mt-1 text-xs text-slate-500">{d.nota}</p>
      </section>
    )
  }

  const r = d.resumen
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">
          Recorrido de la cartera
        </h3>
        <span className="text-[11px] text-slate-400">
          {fmtFecha(d.desde)} → {fmtFecha(d.hasta)}
          {d.sesiones != null && ` · ${d.sesiones} ${plural(d.sesiones, 'sesión', 'sesiones')}`}
        </span>
      </div>

      {r?.disponible && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <div>
            {/* El último punto de la curva es un CIERRE, no la cotización de
                ahora que usan las tarjetas: «Ahora» hacía comparar dos cifras
                de momentos distintos (revisión 12, visual). */}
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Último cierre</div>
            <div className="text-xl font-semibold tabular-nums text-slate-800">
              {fmtDinero(r.actual, moneda)}
            </div>
            <div className="text-[10px] text-slate-400">{fmtFecha(d.hasta)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">Máximo</div>
            <div className="text-xl tabular-nums text-slate-500">{fmtDinero(r.maximo, moneda)}</div>
            {r.bajo_maximo_pct !== null && r.bajo_maximo_pct !== undefined && (
              <div className="text-[10px] tabular-nums text-slate-400">
                {fmtPct(r.bajo_maximo_pct, 1, { enPuntos: true })} por debajo
              </div>
            )}
          </div>
          <div>
            {/* El encadenado, no el bruto: comprar y vender mueven el valor sin
                que eso sea rentabilidad. */}
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              Rendimiento
            </div>
            {/* Sin dato, en neutro: `?? 0` lo pintaba en verde (ítem 2.1); y un
                «+0,0 %», también (revisión 13). */}
            <div
              className={`text-xl font-semibold tabular-nums ${tonoLeido(
                fmtPct(r.rendimiento_pct, 1, { signo: true, enPuntos: true }),
                'text-emerald-700',
                'text-red-700',
                'text-slate-500',
              )}`}
            >
              {fmtPct(r.rendimiento_pct, 1, { signo: true, enPuntos: true })}
            </div>
            <div className="text-[10px] text-slate-400">sin contar aportes ni ventas</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              Peor caída vivida
            </div>
            <div className="text-xl font-semibold tabular-nums text-red-700">
              {fmtPct(r.max_drawdown_pct, 1, { enPuntos: true })}
            </div>
            <div className="text-[10px] text-slate-400">
              {fmtFecha(r.drawdown_desde)} → {fmtFecha(r.drawdown_hasta)}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3">
        <CurvaDeCartera puntos={d.puntos ?? []} cierres={d.cierres ?? []} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-emerald-500" /> valor
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-4 bg-slate-400" /> invertido
        </span>
        {(d.cierres?.length ?? 0) > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-px bg-slate-400" /> venta
          </span>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{d.aviso}</p>
    </section>
  )
}

function Pnl({ value, pct, moneda = null }: { value: number | null; pct: number | null; moneda?: string | null }) {
  if (value === null) return <span className="text-slate-400">—</span>
  const importe = fmtDinero(value, moneda, 2, { signo: true })
  const porcentaje = pct === null ? null : fmtPct(pct)
  // Con `value >= 0`, un «0,00 USD (0,0 %)» salía en verde (revisión 13). Si el
  // importe se escribe cero y el porcentaje no, manda el porcentaje: los dos
  // tienen el mismo signo.
  const delSigno = signoLeido(importe) !== 0 || porcentaje === null ? importe : porcentaje
  const tono = tonoLeido(delSigno, 'text-emerald-600', 'text-red-600', 'text-slate-500')
  return (
    // Con `flex-wrap`, el porcentaje baja de línea si no cabe: entre el importe y
    // «(9,0 %)» no había por dónde partir, y a 390 px el porcentaje se salía de su
    // tarjeta y lo tapaba la de al lado (ítem 2.12).
    <span className={`inline-flex flex-wrap items-baseline gap-x-1 tabular-nums font-medium ${tono}`}>
      <span>{importe}</span>
      {porcentaje !== null && <span className="text-xs">({porcentaje})</span>}
    </span>
  )
}

/** ¿Hay importes en más de una moneda en pantalla? `mezcla_de_divisas` solo
 *  mira las abiertas: una cerrada en CAD entre abiertas en USD salía «+370,00»
 *  a secas, junto a un realizado que está en USD (ítem 2.1). Una moneda
 *  desconocida tampoco es la base. */
function variasMonedas(data: Portfolio): boolean {
  if (data.divisas?.mezcla_de_divisas) return true
  const base = data.divisas?.base
  return base != null && data.closed_positions.some((c) => c.currency !== base)
}

/** El estado del precio de una fila, si no es el normal.
 *
 *  La tabla se hacía su propio «viejo · N min» con minutos a mano, y el
 *  «desconocido» que manda el backend (ninguna fuente dio precio) no se decía:
 *  la fila quedaba con un «—» sin explicar (ítem 2.1). */
function EstadoDelPrecio({ p }: { p: PortfolioPosition }) {
  if (p.precio_estado === 'viejo') {
    const s = p.precio_antiguedad_segundos
    return (
      <span
        className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800"
        title="Todas las fuentes fallaron: es la última copia guardada."
      >
        viejo · {s == null ? 'antigüedad desconocida' : fmtAntiguedad(new Date(Date.now() - s * 1000))}
      </span>
    )
  }
  if (p.precio_estado === 'desconocido') {
    return (
      <span
        className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-slate-600"
        title="Ninguna fuente dio precio: la posición queda fuera de los totales."
      >
        precio desconocido
      </span>
    )
  }
  return null
}

/** El límite de pérdida (stop) de la fila y si está perforado, con la regla del
 *  motor (lo decide el backend: `stop_perforado`). La tabla no tenía columna de
 *  stop y STOP, a 104 con el stop en 110, salía en verde por su +15,6 % sobre
 *  el coste (revisión 12, visual). Sin precio con que compararlo, o con solo un
 *  precio viejo, «sin comprobar», no «intacto»: el mismo criterio que la línea
 *  de arriba de Mi cartera (`estadoDelStop`), para que lo que esa línea cuenta
 *  se vea en la fila. */
function EstadoDelStop({ p, moneda }: { p: PortfolioPosition; moneda: string | null }) {
  if (p.stop === null || p.stop === undefined) {
    return (
      <span className="text-slate-400" title="Sin stop: ni fijado al abrir ni coste con que calcularlo.">
        —
      </span>
    )
  }
  const e = estadoDelStop(p)
  // Lo perfora otro precio que el de la fila (el último cierre de la lista, con
  // la cotización por encima): se dice cuál, como el aviso de Explorar. Sin
  // decirlo, «Perforado» junto a un precio por encima del stop parecía un error.
  const por = p.stop_perforado_por
  return (
    <span className={e.estado === 'perforado' ? 'font-medium text-red-600' : 'text-slate-700'}>
      {fmtPrecio(p.stop, moneda)}
      {e.estado === 'perforado' && (
        <span className="ml-1 rounded bg-red-100 px-1 text-[10px] font-medium text-red-800">
          {etiqueta('perforado')}
        </span>
      )}
      {e.estado === 'perforado' && por && (
        <span className="block text-[10px] font-normal text-red-800">
          {etiqueta(por.fuente)}: {fmtPrecio(por.precio, moneda)}
          {por.estado === 'viejo' ? ' (viejo)' : ''} · compruébalo en tu broker
        </span>
      )}
      {e.estado === 'sin_comprobar' && (
        <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800" title={`Sin comprobar: ${e.motivo}.`}>
          {etiqueta('sin_comprobar')}
        </span>
      )}
    </span>
  )
}

function Seccion({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">{titulo}</h2>
      {subtitulo && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{subtitulo}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** La pestaña Posiciones de Mi cartera: lo que tienes, con su límite de
 *  pérdida, lo que ya vendiste, el efectivo y las alertas de precio. Era la
 *  pestaña «Portafolio» del Portafolio; el riesgo abierto, el estrés, la
 *  exposición por sector y la concentración se fueron a Riesgo, una vez cada
 *  uno (fase 3, 3.1).
 *
 *  `cartera` llega de la página: la misma carga cuenta arriba qué necesita
 *  atención, y anotar una compra o una venta la refresca también allí. Su fallo
 *  y su «Cargando» los dice esa línea, una vez para todas las pestañas: aquí lo
 *  que depende de ella solo se pinta cuando hay datos. */
export function Posiciones({ cartera }: { cartera: CargaConReintento<Portfolio> }) {
  // Un fallo al cargar salía como un motivo suelto junto al formulario, sin
  // decir qué no había cargado (ítem 2.1). `error` queda para las acciones.
  const historial = useDato(() => api.historialDeCartera(false), 'historial')
  // Tras una acción se refrescan la tabla y el recorrido sin vaciarlos: con
  // `reintentar` pasaba por «Cargando la cartera…» y la página saltaba
  // (revisión del 2.1).
  const load = () => {
    cartera.refrescar()
    historial.refrescar()
  }
  const [form, setForm] = useState({ symbol: '', quantity: '', cost: '' })
  const [error, setError] = useState<string | null>(null)
  // El rechazo de «Fijar stop» o «Anotar venta», con su símbolo y junto a la
  // tabla: con un solo `error`, «No se puede bajar un stop ya fijado» salía bajo
  // «Anotar una compra», debajo de toda la tabla, y se leía como un fallo de la
  // compra (revisión 15).
  const [errorDeFila, setErrorDeFila] = useState<string | null>(null)
  // Abierta sin histórico que medir: su stop es el punto medio de la clase y
  // queda fijado; la respuesta lo decía y nadie lo leía (revisión 9).
  const [avisoStop, setAvisoStop] = useState<string | null>(null)

  const addPosition = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const quantity = leerNumero(form.quantity)
    const cost = leerNumero(form.cost)
    if (quantity === null || cost === null) {
      setError(
        quantity === null
          ? `«${form.quantity}» no es un número de acciones: ${EJEMPLO}.`
          : `«${form.cost}» no es un precio de compra por acción: ${EJEMPLO}.`,
      )
      return
    }
    setAvisoStop(null)
    try {
      const creada = await api.addPosition({
        symbol: form.symbol.trim().toUpperCase(),
        quantity,
        cost_basis: cost,
      })
      if (creada.stop_por_clase) {
        setAvisoStop(
          // Sin «se puede subir»: la fila de una posición con el stop fijado al
          // abrir no tiene «Fijar stop» (revisión 10).
          `${creada.symbol}: no había histórico para medir su volatilidad, así que su límite de pérdida (stop) es el punto medio de su clase, no uno medido, y queda fijado así.`,
        )
      }
      setForm({ symbol: '', quantity: '', cost: '' })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  // Para posiciones abiertas antes de que el stop se fijara al comprar: su stop
  // se recalcula con la volatilidad de hoy y en una caída se aleja solo. Fijarlo
  // lo congela. El servidor rechaza BAJAR un stop ya fijado, y el motivo sale
  // en el mensaje de error.
  const fijarStop = async (id: number, symbol: string, sugerido: number | null | undefined) => {
    setErrorDeFila(null)
    // Propuesto como lo escribe la app («50,25», no «50.25»), con los decimales
    // de su precio: `leerNumero` lee las dos, pero la columna de al lado dice 50,25.
    const raw = window.prompt(
      'Límite de pérdida (stop) para esta posición, como precio por acción. Se podrá subir, nunca bajar:',
      sugerido ? textoDeCampo(sugerido, decimalesPrecio(sugerido)) : '',
    )
    if (!raw) return
    const stop = leerNumero(raw)
    if (stop === null) {
      setErrorDeFila(`${symbol}: «${raw}» no es un precio de stop: ${EJEMPLO}.`)
      return
    }
    try {
      await api.fijarStop(id, stop)
      load()
    } catch (err) {
      setErrorDeFila(`${symbol}: ${err instanceof Error ? err.message : 'Error'}`)
    }
  }

  const close = async (id: number, symbol: string) => {
    setErrorDeFila(null)
    const raw = window.prompt('Precio de venta por acción:')
    if (!raw) return
    const price = leerNumero(raw)
    if (price === null) {
      setErrorDeFila(`${symbol}: «${raw}» no es un precio de venta: ${EJEMPLO}.`)
      return
    }
    // Sin capturar, un cierre rechazado no decía nada (ítem 2.1).
    try {
      await api.closePosition(id, price)
      load()
    } catch (err) {
      setErrorDeFila(`${symbol}: ${err instanceof Error ? err.message : 'Error'}`)
    }
  }

  const inputCls =
    'rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none'
  const datos = cartera.estado === 'listo' ? cartera.datos : null
  // Con varias divisas, cada importe dice la suya: «2.903,00» a secas no dice
  // si son dólares o dólares canadienses (ítem 1.7). Con una sola, sería ruido.
  // Sin la cartera no se sabe cuántas hay: el recorrido, que ya no espera a su
  // carga, iba sin código (revisión 15); ante la duda, con él.
  const conCodigo = datos === null || variasMonedas(datos)
  const monedaDe = (m: string | null | undefined) => (conCodigo ? (m ?? null) : null)

  return (
    <div className="space-y-4">
      {datos && (
        <BloqueDatos carga={cartera} que="la cartera">
          {(data) => {
            // Sin posiciones abiertas, el vacío se dice igual en todas partes: el
            // invertido salía «0,00» y el valor de mercado «—» (revisión 12, visual).
            const sinAbiertas = data.positions.length === 0
            return (
              <>
                {/* Cuatro columnas solo desde `xl`: con la barra lateral, a 820 px
                    cada tarjeta medía ~130 px y cortaba el código de moneda
                    («30.659,76 US»), justo lo que hay que leer con dos divisas
                    (revisión 12, visual). */}
                <section className="grid grid-cols-2 gap-3 xl:grid-cols-4 [&>div]:min-w-0">
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-400">Invertido</div>
                    <div className="text-xl font-semibold tabular-nums">
                      {fmtDinero(sinAbiertas ? null : data.summary.total_invested, monedaDe(data.divisas?.base))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-400">Valor de mercado</div>
                    <div className="text-xl font-semibold tabular-nums">
                      {fmtDinero(data.summary.total_market_value, monedaDe(data.divisas?.base))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-400">No realizado</div>
                    <div className="text-xl">
                      <Pnl value={data.summary.unrealized_pnl} pct={data.summary.unrealized_pct} moneda={monedaDe(data.divisas?.base)} />
                    </div>
                    {/* La rentabilidad no se enseña sola, nunca. Un «+12 %» y un
                        «+12 % con un −45 % por el camino» son propuestas distintas, y
                        quien solo ve la primera abandona en el peor momento. */}
                    <div className="mt-1 text-[11px] leading-tight text-slate-500">
                      {sinAbiertas ? (
                        'Sin posiciones abiertas.'
                      ) : data.summary.max_drawdown_esperado_pct !== null ? (
                        <>
                          Peor caída histórica de esta cartera:{' '}
                          <span className="font-medium text-red-700 tabular-nums">
                            {fmtPct(data.summary.max_drawdown_esperado_pct, 1, { enPuntos: true })}
                          </span>
                        </>
                      ) : (
                        'Sin histórico para estimar la caída máxima.'
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="text-xs text-slate-400">Realizado (cerradas)</div>
                    <div className="text-xl">
                      {/* En la base, como «Valor de mercado» y «No realizado»: sin
                          código no se sabía en qué moneda estaba (ítem 2.1). */}
                      <Pnl value={data.summary.realized_pnl} pct={null} moneda={monedaDe(data.divisas?.base)} />
                    </div>
                    {(data.summary.realizado_sin_convertir?.length ?? 0) > 0 && (
                      <div className="mt-1 text-[11px] text-amber-800">
                        Sin contar {data.summary.realizado_sin_convertir!.join(', ')}: no se pueden
                        convertir (moneda desconocida, en céntimos o sin tipo de cambio).
                      </div>
                    )}
                  </div>
                </section>

                {(data.summary.precios_viejos?.length ?? 0) > 0 && (
                  <p className="rounded-lg border border-amber-100 bg-amber-50 p-2 text-xs text-amber-800">
                    Precios VIEJOS en {data.summary.precios_viejos!.join(', ')}: todas las fuentes
                    fallaron y se usa la última copia guardada. El valor, el P&L y el riesgo de
                    arriba los incluyen, pero no son de ahora.
                  </p>
                )}

                {data.summary.priced_positions < data.summary.total_positions && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    {data.summary.total_positions - data.summary.priced_positions}{' '}
                    {plural(data.summary.total_positions - data.summary.priced_positions, 'posición', 'posiciones')} sin
                    precio disponible{' '}
                    {plural(data.summary.total_positions - data.summary.priced_positions, 'queda', 'quedan')} fuera de los
                    totales. {data.note}
                  </p>
                )}

                {data.divisas && <DivisasPanel d={data.divisas} />}

                <Seccion titulo="Posiciones abiertas">
                  {data.positions.length === 0 ? (
                    <p className="text-sm text-slate-400">Sin posiciones abiertas.</p>
                  ) : (
                    <>
                      {errorDeFila && (
                        <p role="alert" className="mb-2 text-sm text-red-600">
                          {errorDeFila}
                        </p>
                      )}
                      <MarcoTabla etiqueta="Posiciones abiertas">
                        <table className="w-full min-w-[760px] text-sm">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                              {/* «1 año» y no una cabecera vacía: `key={h}` haría colisión
                                  con la columna en blanco del final, y además dice qué
                                  periodo dibuja la línea. Sin partir: «Límite de pérdida
                                  (stop)» en tres líneas es texto palabra a palabra. */}
                              {['Ticker', '1 año', 'Sector', 'Acciones', 'Precio de compra', 'Precio', 'Límite de pérdida (stop)',
                                'Valor', 'No realizado', 'Peso', ''].map((h) => (
                                <th key={h} className="whitespace-nowrap px-2 py-1 font-normal">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {data.positions.map((p) => {
                              // El peso de ESTE lote: `allocation_by_position` es por
                              // símbolo y con dos lotes de KO cada fila decía «100,0 %»
                              // (la columna sumaba 200 %; revisión 15). Sin importe en
                              // la base (sin precio o sin convertir), no tiene peso.
                              const total = data.summary.total_market_value
                              const peso =
                                p.market_value_base != null && total != null && total > 0 ? p.market_value_base / total : null
                              return (
                                <tr
                                  key={p.id}
                                  className={`border-b border-slate-100 ${
                                    p.stop_perforado ? 'bg-red-50' : p.sin_convertir ? 'bg-amber-50' : ''
                                  }`}
                                  title={p.sin_convertir ?? undefined}
                                >
                                  <td className="px-2 py-1.5">
                                    <Link
                                      to={rutaEmpresa(p.symbol)}
                                      className="flex items-center gap-2 font-medium hover:underline"
                                    >
                                      <CompanyLogo symbol={p.symbol} size="sm" />
                                      {p.symbol}
                                      {p.currency && p.currency !== data.divisas?.base && (
                                        <span
                                          className={`rounded px-1 py-0.5 text-[9px] font-medium ${
                                            p.sin_convertir
                                              ? 'bg-amber-100 text-amber-800'
                                              : 'bg-slate-100 text-slate-600'
                                          }`}
                                        >
                                          {p.currency}
                                        </span>
                                      )}
                                    </Link>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Sparkline valores={p.spark} width={64} height={20} />
                                  </td>
                                  <td className="px-2 py-1.5 text-xs text-slate-500">{p.sector}</td>
                                  <td className="px-2 py-1.5 tabular-nums">{fmtNum(p.quantity, 0)}</td>
                                  <td className="px-2 py-1.5 tabular-nums">{fmtPrecio(p.cost_basis, monedaDe(p.currency))}</td>
                                  <td className="px-2 py-1.5 tabular-nums">
                                    {fmtPrecio(p.price, monedaDe(p.currency))}
                                    <EstadoDelPrecio p={p} />
                                  </td>
                                  <td className="px-2 py-1.5 tabular-nums">
                                    <EstadoDelStop p={p} moneda={monedaDe(p.currency)} />
                                  </td>
                                  <td className="px-2 py-1.5 tabular-nums">
                                    {fmtDinero(p.market_value, monedaDe(p.currency))}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <Pnl value={p.unrealized_pnl} pct={p.unrealized_pct} moneda={monedaDe(p.currency)} />
                                  </td>
                                  <td className="px-2 py-1.5 tabular-nums text-slate-600">
                                    {fmtPct(peso)}
                                  </td>
                                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                                    {p.stop_fijado_al_abrir === false && (
                                      <button
                                        // Sin proponer un stop que no se midió: con un Enter se
                                        // congelaba el supuesto (revisión 9).
                                        onClick={() => fijarStop(p.id, p.symbol, p.stop_por_clase ? null : p.stop)}
                                        title={
                                          p.stop_por_clase
                                            ? 'Su stop se recalcula y ahora mismo no hay histórico para medir la volatilidad: es el punto medio de su clase, no uno medido. Mejor fijarlo con el histórico a mano.'
                                            : 'Su stop se recalcula con la volatilidad de hoy y en una caída se aleja solo. Fíjalo.'
                                        }
                                        className="mr-3 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800"
                                      >
                                        Fijar stop
                                      </button>
                                    )}
                                    {/* «Cerrar» se leía como cerrar una ventana: lo que hace
                                        es anotar que vendiste. */}
                                    <button
                                      onClick={() => close(p.id, p.symbol)}
                                      className="text-xs text-slate-500 hover:text-slate-800"
                                    >
                                      Anotar venta
                                    </button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </MarcoTabla>
                      {/* Para quien no ha usado nunca un stop: qué es y qué dicen las
                          dos marcas de la columna. */}
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                        <strong className="font-medium text-slate-600">Límite de pérdida (stop):</strong> el
                        precio al que conviene vender para que una caída no se haga grande. Se fija al anotar la
                        compra, según lo que suele moverse la acción. «{etiqueta('perforado')}» quiere decir que
                        el precio ya ha llegado a él; «{etiqueta('sin_comprobar')}», que falta un precio fiable con
                        que compararlo.
                      </p>
                    </>
                  )}
                </Seccion>
              </>
            )
          }}
        </BloqueDatos>
      )}

      <Seccion
        titulo="Anotar una compra"
        subtitulo="Ticker, número de acciones y precio pagado por cada una. La app le pone su límite de pérdida (stop) al anotarla."
      >
        <form aria-label="Anotar una compra" onSubmit={addPosition} className="flex flex-wrap items-end gap-2">
          <input
            className={`${inputCls} w-36`}
            placeholder="Ticker (p. ej. KO)"
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value })}
          />
          <input
            className={`${inputCls} w-32`}
            placeholder="Nº de acciones"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
          <input
            className={`${inputCls} w-64`}
            placeholder="Precio de compra por acción"
            value={form.cost}
            onChange={(e) => setForm({ ...form, cost: e.target.value })}
          />
          <button className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
            Anotar compra
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {avisoStop && <p className="mt-2 text-sm text-amber-800">{avisoStop}</p>}
      </Seccion>

      <HistorialPanel historial={historial} conCodigo={conCodigo} />

      {datos && datos.closed_positions.length > 0 && (
        <BloqueDatos carga={cartera} que="las posiciones cerradas">
          {(data) => (
            <Seccion titulo="Posiciones cerradas" subtitulo="Lo que ya vendiste y lo que ganaste o perdiste con ello.">
              <ul className="space-y-1 text-sm">
                {data.closed_positions.map((p) => (
                  <li key={p.id} className="flex justify-between border-b border-slate-100 py-1">
                    <span className="text-slate-700">
                      {p.symbol}
                      <span className="ml-2 text-xs text-slate-400">
                        {fmtFecha(p.closed_at)}
                      </span>
                    </span>
                    {/* En la moneda de la posición, con su código si hay más de
                        una; si no se sabe cuál es, se dice (ítem 2.1). */}
                    <span>
                      <Pnl value={p.realized_pnl} pct={null} moneda={monedaDe(p.currency)} />
                      {p.currency == null && p.realized_pnl !== null && (
                        <span className="ml-1 text-[10px] text-amber-800">moneda desconocida</span>
                      )}
                      {p.currency != null && p.sin_convertir && (
                        <span className="ml-1 text-[10px] text-amber-800" title={p.sin_convertir}>
                          sin convertir
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}
        </BloqueDatos>
      )}

      <EfectivoPanel />
      <AlertasDePrecio />
    </div>
  )
}
