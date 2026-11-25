/**
 * El resumen del único DCF de la app (ítem 3.3): un rango por escenario, si va
 * mal, base y si va bien, y el enlace al módulo completo con la empresa elegida.
 *
 * Había tres DCF con supuestos distintos: la pestaña Valoración de la ficha
 * (WACC 11/10/9 % escritos en el frontend y un valor puntual por escenario), el
 * «precargado» del informe (WACC 12/10/9 %) y el módulo Valoración. Ahora la
 * ficha pinta aquí la respuesta de `POST /api/valuation/{s}` y el informe su
 * campo `dcf`, que el backend calcula con las mismas funciones: los tres dicen lo
 * mismo. `BarraRango` y `textoRango` los usa también el módulo, para que un
 * rango se escriba igual en todas partes.
 */
import { Link } from 'react-router-dom'
import type { RangoGlobal, ResumenValoracion } from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { fmtPct, fmtPrecio, fmtValorRedondo } from '../../lib/formato'
import { rutaValoracion } from './ruta'

/** «18,3 – 27,5»: los extremos de un rango del DCF, que llegan ya redondeados a
 *  tres cifras significativas. */
export function textoRango(bajo: number | null | undefined, alto: number | null | undefined): string {
  return `${fmtValorRedondo(bajo)} – ${fmtValorRedondo(alto)}`
}

/** La barra del rango, con el precio actual marcado encima.
 *
 *  Es deliberadamente una BARRA y no un número: enseñar «vale 280 $» sería el
 *  precio objetivo que este módulo no produce. Lo que se ve es la horquilla y
 *  dónde cae el precio dentro (o fuera) de ella. */
export function BarraRango({
  bajo,
  alto,
  actual,
  tono = 'bg-slate-400',
}: {
  bajo: number
  alto: number
  actual?: number | null
  tono?: string
}) {
  const min = Math.min(bajo, actual ?? bajo)
  const max = Math.max(alto, actual ?? alto)
  const span = max - min || 1
  const izq = ((bajo - min) / span) * 100
  const ancho = ((alto - bajo) / span) * 100
  const marca = actual !== null && actual !== undefined ? ((actual - min) / span) * 100 : null
  return (
    <div className="relative h-6">
      <div className="absolute top-2.5 h-1 w-full rounded-full bg-slate-200" />
      <div
        className={`absolute top-2.5 h-1 rounded-full ${tono}`}
        style={{ left: `${izq}%`, width: `${Math.max(ancho, 1)}%` }}
      />
      {marca !== null && (
        <div
          className="absolute top-0.5 h-5 w-0.5 bg-slate-900"
          style={{ left: `calc(${marca}% - 1px)` }}
          title={`Precio actual: ${fmtPrecio(actual)}`}
        />
      )}
    </div>
  )
}

/** Los tres escenarios con el nombre que entiende quien no sabe qué es un DCF. */
const ESCENARIOS = [
  ['bajista', 'Si va mal'],
  ['base', 'Escenario base'],
  ['alcista', 'Si va bien'],
] as const

const POSICION: Record<NonNullable<RangoGlobal['posicion']>, string> = {
  dentro: 'dentro del rango',
  'por encima': 'por encima del rango',
  'por debajo': 'por debajo del rango',
}

export function ResumenDcf({ datos, symbol }: { datos: ResumenValoracion; symbol: string }) {
  const g = datos.rango_global
  const precio = datos.entradas.precio_actual
  // Si el crecimiento no sale de las cuentas de la empresa se dice arriba, como
  // en el módulo: es el supuesto que más mueve el valor.
  const supuesto = Object.values(datos.escenarios).find((e) => e?.procedencia?.crecimiento_supuesto)?.procedencia?.motivo
  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-slate-500">
        Un rango, no un precio objetivo: lo que valdría cada acción si las cosas van mal, normal o bien. Sale
        del mismo cálculo que el análisis completo, así que los dos dicen lo mismo.
      </p>
      {supuesto && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">{supuesto}</p>
      )}
      {/* Con el FCF de partida negativo, el backend intercambia los supuestos del
          bajista y del alcista (`escenarios_por_defecto`): crecer es quemar más
          caja. Sin esta línea, «Si va mal» enseñaba el crecimiento alto y el WACC
          bajo sin decir por qué; el módulo lo dice en `nota_supuestos`, que este
          resumen no recibe. Aquí solo llegan escenarios propuestos: la ficha no
          manda los suyos y el informe no precarga el DCF con FCF ≤ 0. */}
      {datos.entradas.base_fcf < 0 && (
        <p className="text-xs leading-relaxed text-slate-500">
          El FCF de partida es negativo: la empresa quema caja, y crecer es quemar más. Por eso «Si va mal» lleva el
          crecimiento y la perpetuidad más altos y el WACC más bajo, y «Si va bien», al revés.
        </p>
      )}

      {g ? (
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xl font-semibold tabular-nums text-slate-900">{textoRango(g.bajo, g.alto)}</span>
            {precio !== null && (
              <span className="text-sm text-slate-500">
                cotiza a <span className="font-medium tabular-nums text-slate-800">{fmtPrecio(precio)}</span>
                {g.posicion && `, ${POSICION[g.posicion]}`}
              </span>
            )}
          </div>
          <BarraRango bajo={g.bajo} alto={g.alto} actual={precio} />
          <p className="text-[11px] leading-relaxed text-slate-500">{g.nota}</p>
        </div>
      ) : (
        <p className="text-xs text-amber-800">
          Ningún escenario da un rango con estas entradas: abajo, el motivo de cada uno.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {ESCENARIOS.filter(([nombre]) => datos.escenarios[nombre]).map(([nombre, titulo]) => {
          const e = datos.escenarios[nombre]
          const s = e.supuestos
          return (
            <div key={nombre} className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">
                {titulo} <span className="text-slate-400">· {etiqueta(nombre)}</span>
              </div>
              {e.rango.disponible ? (
                <div className="text-lg font-semibold tabular-nums text-slate-900">
                  {textoRango(e.rango.bajo, e.rango.alto)}
                </div>
              ) : (
                <div className="text-xs text-amber-800">sin rango calculable</div>
              )}
              {/* Cada supuesto con su cifra en la misma línea: a 390 px «1,5 %»
                  se quedaba solo debajo de «perpetuidad». */}
              <div className="text-[11px] leading-relaxed text-slate-400">
                <span className="whitespace-nowrap">crecimiento del FCF {fmtPct(s.growth_rate)}</span> ·{' '}
                <span className="whitespace-nowrap">WACC {fmtPct(s.discount_rate)}</span> ·{' '}
                <span className="whitespace-nowrap">perpetuidad {fmtPct(s.terminal_growth)}</span>
              </div>
              {/* Qué mide: «terminal 63,8 %» se leía como el crecimiento a
                  perpetuidad (revisión 12, visual). */}
              {e.rango.disponible && e.rango.peso_terminal !== null && e.rango.peso_terminal !== undefined && (
                <div className="text-[11px] leading-relaxed text-slate-400">
                  el valor terminal es el {fmtPct(e.rango.peso_terminal)} del valor de empresa
                </div>
              )}
              {!e.rango.disponible && <p className="mt-1 text-[11px] leading-relaxed text-amber-800">{e.rango.nota}</p>}
              {/* El crecimiento acotado al −50 % se dice en su escenario (el
                  3 % supuesto, arriba, una vez para los tres). */}
              {!e.procedencia?.crecimiento_supuesto && e.procedencia?.motivo && (
                <p className="mt-1 text-[11px] leading-relaxed text-amber-800">{e.procedencia.motivo}</p>
              )}
            </div>
          )
        })}
      </div>

      {datos.entradas.nota_deuda && (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Deuda parcial. {datos.entradas.nota_deuda}
        </p>
      )}
      <p className="text-[11px] text-slate-400">
        Estados financieros de {datos.entradas.source}, ejercicio {String(datos.entradas.fiscal_year ?? '—')};
        proyección a {datos.entradas.years} años.
      </p>
      <Link
        to={rutaValoracion(symbol)}
        className="inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Abrir el análisis completo
      </Link>
    </div>
  )
}
