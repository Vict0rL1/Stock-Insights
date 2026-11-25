import { useState } from 'react'
import { api } from '../../api/client'
import type { ConcentracionReal, Estres, Portfolio, RiesgoDeCartera } from '../../api/types'
import { plural } from '../../lib/formato'
import { useDato, type CargaConReintento } from '../../lib/useDato'
import { BloqueDatos } from '../EstadoDato'
import { Aviso, Caracteristicas, Concentracion, Correlacion, Crisis, Exposicion, LookThrough, Seccion } from './AnalisisDeCartera'
import { EstresHistorico, RiesgoAbiertoPanel } from './RiesgoAbierto'
import { ContribucionAlRiesgoPanel, CosteOportunidadPanel } from './RiesgoYOportunidad'

/** Lo que el análisis deja fuera de los pesos, y lo que no tiene histórico. */
function AvisosDelAnalisis({ d }: { d: RiesgoDeCartera }) {
  const faltanHistoricos = Object.keys(d.sin_historico ?? {}).length
  // Lo que no entra en los pesos. `sin_precio` viajaba en la respuesta desde el
  // principio y no se pintaba: una posición sin cotización desaparecía del
  // análisis sin que la pantalla lo dijera.
  const fuera = [
    ...(d.sin_precio ?? []).map((s) => `${s} (sin precio)`),
    ...(d.sin_convertir ?? []).map((s) => `${s.symbol} (${s.moneda ?? 'moneda desconocida'})`),
  ]
  if (fuera.length === 0 && faltanHistoricos === 0) return null
  return (
    <div className="space-y-3">
      {fuera.length > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
          <p className="text-sm text-amber-900">
            {fuera.length} {plural(fuera.length, 'posición queda', 'posiciones quedan')} FUERA de todos los pesos de esta
            página: {fuera.join(', ')}. La concentración, la exposición y el estrés
            se calculan sin ellas — tu cartera real es más grande de lo que se ve
            aquí.
          </p>
        </div>
      )}

      {faltanHistoricos > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <p className="text-sm text-sky-900">
            {faltanHistoricos} {plural(faltanHistoricos, 'posición', 'posiciones')} sin histórico largo:{' '}
            {Object.keys(d.sin_historico ?? {}).join(', ')}. El estrés de las
            crisis las cuenta como no cubiertas — pulsa «Descargar histórico
            completo» para incluirlas.
          </p>
        </div>
      )}
    </div>
  )
}

/** La concentración, UNA vez (fase 3, 3.1). Salía dos veces: en el Portafolio,
 *  como avisos por peso («KO representa el 60 % de la cartera»,
 *  `concentration_warnings` de `/api/portfolio`), y en Cartera, como
 *  «Concentración real» (`/api/portfolio/riesgo`).
 *
 *  Se queda la de Cartera: es la más completa y la que contesta la pregunta de
 *  verdad, cuántas apuestas independientes hay detrás de N tickers (diez
 *  posiciones que se mueven juntas son una), y la que suma los lotes de un mismo
 *  símbolo y convierte a dólares antes de pesar. El peso de una sola posición,
 *  que es lo único que daba la otra, no se pierde: va dentro de este mismo
 *  bloque como su primera línea. Y va aparte de la carga del análisis porque no
 *  necesita histórico: la concentración real sin matriz de correlación es una
 *  nota, y sin esto una posición del 60 % se quedaba sin aviso justo cuando el
 *  análisis no carga (ante la duda, avisar). */
function SeccionConcentracion({ real, porPeso }: { real: ConcentracionReal | null; porPeso: string[] }) {
  if (!real && porPeso.length === 0) return null
  return (
    <Seccion
      titulo="Concentración"
      subtitulo="Diez posiciones que se mueven juntas son una apuesta repartida en diez recibos."
    >
      {porPeso.length > 0 && (
        <ul className="mb-3 space-y-1">
          {porPeso.map((w) => (
            <li key={w} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs leading-relaxed text-amber-900">
              {w}
            </li>
          ))}
        </ul>
      )}
      {real && <Concentracion c={real} />}
    </Seccion>
  )
}

/** El estrés, en un solo bloque: el peor tramo del histórico guardado con los
 *  pesos de hoy (`/api/portfolio`, sin descargar nada) y las tres crisis reales
 *  (`/api/portfolio/riesgo`, con el histórico largo). Contestan dos preguntas
 *  distintas —lo peor que dio tiempo a pasar y lo que pasó en 2008, 2020 y
 *  2022— y antes estaban en dos pantallas; cada mitad dice lo suyo si la otra no
 *  carga. */
function SeccionEstres({
  historico,
  sinPosiciones,
  crisis,
}: {
  historico: Estres | null
  sinPosiciones: boolean
  crisis: RiesgoDeCartera['estres'] | null
}) {
  if (!historico && !crisis) return null
  return (
    <Seccion
      titulo="Estrés: qué le habría pasado a esta cartera"
      subtitulo="Los pesos que tienes hoy aplicados al pasado. No son escenarios inventados."
    >
      <div className="space-y-5">
        {historico && <EstresHistorico estres={historico} sinPosiciones={sinPosiciones} />}
        {crisis && (
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Esta mezcla en 2008, 2020 y 2022</h3>
            <p className="mt-0.5 text-xs text-slate-500">Crisis reales, fechas públicas, pesos de hoy.</p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {crisis.crisis.map((c) => (
                <Crisis key={c.clave} c={c} />
              ))}
            </div>
            <Aviso>{crisis.aviso_general}</Aviso>
          </div>
        )}
      </div>
    </Seccion>
  )
}

/** La pestaña Riesgo de Mi cartera: riesgo abierto, contribución al riesgo,
 *  concentración, correlación, exposición, estrés y coste de oportunidad, una
 *  vez cada uno. Junta lo que era la pantalla «Cartera» con los paneles de
 *  riesgo del Portafolio (fase 3, 3.1).
 *
 *  `cartera` (de `/api/portfolio`) llega de la página: su fallo y su «Cargando»
 *  los dice la línea de arriba, una vez para todas las pestañas. */
export function Riesgo({ cartera }: { cartera: CargaConReintento<Portfolio> }) {
  // La primera carga no descarga: veinte años por posición no se piden sin que
  // nadie los haya pedido. El botón lo hace explícito y vuelve a pedir, ya
  // descargando, sin quitar el análisis anterior mientras dura la descarga
  // (con una clave por pulsación desaparecía durante minutos; revisión del 2.1).
  const [descargas, setDescargas] = useState(0)
  // El fallo salía como un motivo suelto, sin decir qué no había cargado y sin
  // forma de reintentar (ítem 2.1).
  const riesgo = useDato(() => api.riesgoDeCartera(descargas > 0), 'riesgo')
  const cargando = riesgo.estado === 'cargando' || riesgo.refrescando
  const datos = cartera.estado === 'listo' ? cartera.datos : null
  const sinAbiertas = datos !== null && datos.positions.length === 0
  // Mientras se refresca, lo anterior sigue a la vista: el estado sigue «listo».
  const analisis = riesgo.estado === 'listo' && riesgo.datos.disponible ? riesgo.datos : null

  return (
    <div className="space-y-4">
      {datos?.risk_budget ? (
        <BloqueDatos carga={cartera} que="el riesgo abierto">
          {(d) => <RiesgoAbiertoPanel risk={d.risk_budget} sinPosiciones={d.positions.length === 0} />}
        </BloqueDatos>
      ) : (
        cartera.estado === 'error' && (
          // Fail-safe: el riesgo abierto no desaparece sin decir por qué.
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-800">Riesgo abierto</h2>
            <p className="mt-1 text-xs text-slate-500">
              Sin la cartera no se puede sumar el riesgo abierto: no ha cargado (el motivo está arriba).
            </p>
          </section>
        )
      )}

      {/* Riesgo por posición: pide lo suyo y no depende de la descarga de
          décadas de precios de abajo. */}
      <ContribucionAlRiesgoPanel />

      <div className="flex flex-wrap items-baseline justify-between gap-2 pt-2">
        <div>
          <h2 className="text-base font-semibold text-slate-800">La cartera como una sola cosa</h2>
          <p className="text-xs text-slate-500">
            Ocho análisis buenos de ocho empresas no son un análisis de la cartera:
            las preguntas cambian.
          </p>
        </div>
        {/* Sin ninguna posición no hay histórico que descargar: con la cartera
            vacía se ofrecía igual (revisión 12, visual). Sin precio sí sale:
            reintentar puede traerlo. */}
        {!riesgo.datos?.sin_posiciones && (
          <button
            type="button"
            onClick={() => {
              setDescargas((n) => n + 1)
              riesgo.refrescar()
            }}
            disabled={cargando}
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {cargando ? 'Descargando…' : 'Descargar histórico completo'}
          </button>
        )}
      </div>

      <BloqueDatos carga={riesgo} que="el análisis de la cartera">
        {(d) =>
          d.disponible ? (
            <AvisosDelAnalisis d={d} />
          ) : (
            <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">{d.nota}</p>
          )
        }
      </BloqueDatos>

      <SeccionConcentracion real={analisis?.concentracion ?? null} porPeso={datos?.concentration_warnings ?? []} />

      {analisis?.correlacion && (
        <Seccion
          titulo="Correlación entre posiciones"
          subtitulo="Si suben y bajan a la vez, tener ocho no es tener ocho."
        >
          <Correlacion c={analisis.correlacion} />
        </Seccion>
      )}

      {/* La exposición por sector, UNA vez (fase 3, 3.1). Salía en el Portafolio
          (`allocation_by_sector`, barras de sector y nada más) y aquí. Se queda
          esta: convierte y suma los lotes igual que la otra, pero lo que no
          tiene sector o país va a su propio cubo y se cuenta con su nota en vez
          de repartirse, añade la geografía, y la pantalla nombra arriba lo que
          queda fuera de los pesos (sin precio o sin tipo de cambio) en vez de
          omitirlo en silencio. */}
      {analisis?.exposicion && (
        <Seccion
          titulo="Exposición por sector y por país"
          subtitulo="Dónde está el dinero cuando se suman todas las posiciones."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <Exposicion e={analisis.exposicion.sector} titulo="Por sector" />
            <Exposicion e={analisis.exposicion.geografia} titulo="Por geografía" />
          </div>
          <Aviso>{analisis.nota_geografia}</Aviso>
        </Seccion>
      )}

      {analisis?.look_through && (
        <Seccion
          titulo="Lo que llevas dentro de los ETFs"
          subtitulo="Tu exposición a una empresa es la directa más la que va dentro del fondo."
        >
          <LookThrough lt={analisis.look_through} />
        </Seccion>
      )}

      {analisis?.caracteristicas && (
        <Seccion
          titulo="Características de factor"
          subtitulo="Hacia qué se inclina la cartera. Descriptivo, no estimado por regresión."
        >
          <Caracteristicas c={analisis.caracteristicas} />
        </Seccion>
      )}

      <SeccionEstres historico={datos?.estres ?? null} sinPosiciones={sinAbiertas} crisis={analisis?.estres ?? null} />

      <CosteOportunidadPanel />
    </div>
  )
}
