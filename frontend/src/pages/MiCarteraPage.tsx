import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Portfolio } from '../api/types'
import { ErrorDeCarga } from '../components/EstadoDato'
import { atencionDeCartera } from '../components/cartera/atencion'
import { Posiciones } from '../components/cartera/Posiciones'
import { Riesgo } from '../components/cartera/Riesgo'
import { TesisYVigilancia } from '../components/cartera/TesisYVigilancia'
import { plural } from '../lib/formato'
import { useDato, type CargaConReintento } from '../lib/useDato'

/** Mi cartera: una sección con tres sub-pestañas en lugar de cuatro entradas
 *  de menú (Portafolio, Cartera, Tesis, Vigilancia; `docs/PLAN_NAVEGACION.md`,
 *  fase 3, 3.1 y 3.2). La pestaña va en la dirección (`?pestana=`) para que se
 *  pueda enlazar desde Inicio o desde una redirección: `/tesis` y `/vigilancia`
 *  van a `?pestana=tesis`. */
export const PESTANAS = [
  { id: 'posiciones', label: 'Posiciones' },
  { id: 'riesgo', label: 'Riesgo' },
  { id: 'tesis', label: 'Tesis y vigilancia' },
] as const

export type Pestana = (typeof PESTANAS)[number]['id']

/** Una pestaña desconocida (un enlace viejo, una errata) abre Posiciones en
 *  vez de una página en blanco. */
export function pestanaDe(valor: string | null): Pestana {
  return PESTANAS.find((p) => p.id === valor)?.id ?? 'posiciones'
}

/** La línea de arriba, en lenguaje claro: cuántas posiciones hay y cuántas
 *  necesitan atención (límite de pérdida perforado o sin comprobar,
 *  `atencionDeCartera`). Es la misma en las tres pestañas, y por eso dice
 *  también, una sola vez, si la cartera está cargando o no cargó: sin datos no
 *  se cuenta «0 necesitan atención», se dice que no se sabe. */
function ResumenDeCartera({ cartera }: { cartera: CargaConReintento<Portfolio> }) {
  if (cartera.estado === 'cargando') {
    return (
      <p role="status" className="text-sm text-slate-400">
        Cargando tu cartera…
      </p>
    )
  }
  if (cartera.estado === 'error') {
    return (
      <div className="space-y-1">
        <ErrorDeCarga que="la cartera" error={cartera.error} reintentar={cartera.reintentar} />
        <p className="text-sm font-medium text-amber-900">
          No se sabe cuántas posiciones tienes ni si alguna necesita atención.
        </p>
      </div>
    )
  }
  const { abiertas, avisos } = atencionDeCartera(cartera.datos.positions)
  if (abiertas === 0) {
    return <p className="text-sm text-slate-600">No tienes posiciones abiertas.</p>
  }
  const hayPerforado = avisos.some((a) => a.estado === 'perforado')
  return (
    <div
      className={`rounded-xl border px-3 py-2 ${
        hayPerforado
          ? 'border-red-200 bg-red-50'
          : avisos.length > 0
            ? 'border-amber-200 bg-amber-50'
            : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-sm font-medium text-slate-800">
        {abiertas} {plural(abiertas, 'posición abierta', 'posiciones abiertas')} ·{' '}
        {avisos.length === 0
          ? 'ninguna necesita atención'
          : `${avisos.length} ${plural(avisos.length, 'necesita', 'necesitan')} atención`}
      </p>
      {avisos.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs leading-relaxed">
          {avisos.map((a) => (
            <li key={a.symbol} className={a.estado === 'perforado' ? 'text-red-800' : 'text-amber-900'}>
              <strong className="font-semibold">{a.symbol}</strong>: {a.motivo}.
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MiCarteraPage() {
  const [parametros] = useSearchParams()
  const pestana = pestanaDe(parametros.get('pestana'))
  // Una carga para la línea de arriba, Posiciones y Riesgo: anotar una compra
  // o una venta refresca también el recuento de lo que necesita atención.
  const cartera = useDato(() => api.portfolio(), 'cartera')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Mi cartera</h1>
        <p className="text-xs text-slate-500">Lo que tienes, cuánto arriesgas y por qué lo compraste.</p>
      </div>

      <ResumenDeCartera cartera={cartera} />

      {/* Enlaces y no botones: cada pestaña es una dirección. En una fila
          también a 390 px: las tres etiquetas caben sin partirse. */}
      <nav aria-label="Secciones de Mi cartera" className="flex gap-1 border-b border-slate-200">
        {PESTANAS.map(({ id, label }) => (
          <Link
            key={id}
            to={{ search: `?pestana=${id}` }}
            aria-current={pestana === id ? 'page' : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              pestana === id
                ? 'border-slate-900 font-medium text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {pestana === 'posiciones' && <Posiciones cartera={cartera} />}
      {pestana === 'riesgo' && <Riesgo cartera={cartera} />}
      {pestana === 'tesis' && <TesisYVigilancia />}
    </div>
  )
}
