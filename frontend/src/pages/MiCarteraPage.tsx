import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Portfolio, RepasoDeCartera } from '../api/types'
import { AvisoDeAccion } from '../components/AvisoDeAccion'
import { ErrorDeCarga } from '../components/EstadoDato'
import { alcanceDeLaRegla, atencionDeCartera, deLaLista } from '../components/cartera/atencion'
import { Posiciones } from '../components/cartera/Posiciones'
import { Riesgo } from '../components/cartera/Riesgo'
import { TesisYVigilancia } from '../components/cartera/TesisYVigilancia'
import { fmtAntiguedad, plural } from '../lib/formato'
import { rutaEmpresa } from '../lib/rutas'
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
 *  necesitan atención, POR SÍMBOLO y con el aviso de Explorar
 *  (`atencionDeCartera`: el repaso del stop y la decisión de la lista; vender,
 *  reducir o sin comprobar). Es la misma en las tres pestañas, y por eso dice
 *  también, una sola vez, si la cartera está cargando o no cargó: sin datos no
 *  se cuenta «0 necesitan atención», se dice que no se sabe. Sin repaso, igual:
 *  ningún stop se ha comprobado. */
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
  const a = atencionDeCartera(cartera.datos)
  if (a.abiertas === 0) {
    return <p className="text-sm text-slate-600">No tienes posiciones abiertas.</p>
  }
  const cuantas = `${a.abiertas} ${plural(a.abiertas, 'posición abierta', 'posiciones abiertas')}`
  if (!a.repasada) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
        <p className="text-sm font-medium text-slate-800">
          {cuantas} · no se sabe si alguna necesita atención
        </p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900">
          Ningún límite de pérdida se ha podido comprobar: {a.error}
        </p>
      </div>
    )
  }
  const { avisos, lista } = a
  const tono = avisos.some((x) => x.aviso.tono === 'rojo')
    ? 'border-red-200 bg-red-50'
    : avisos.some((x) => x.aviso.tono === 'naranja')
      ? 'border-orange-200 bg-orange-100'
      : avisos.length > 0
        ? 'border-amber-200 bg-amber-50'
        : 'border-slate-200 bg-white'
  return (
    <div className={`rounded-xl border px-3 py-2 ${tono}`}>
      <p className="text-sm font-medium text-slate-800">
        {cuantas} ·{' '}
        {avisos.length === 0
          ? 'ninguna necesita atención'
          : `${avisos.length} ${plural(avisos.length, 'necesita', 'necesitan')} atención`}
      </p>
      {avisos.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {avisos.map((x) => (
            <li key={x.symbol}>
              <AvisoDeAccion
                aviso={x.aviso}
                tamano="compacto"
                titulo={
                  <Link to={rutaEmpresa(x.symbol)} className="text-sm font-semibold text-slate-900 hover:underline">
                    {x.symbol}
                  </Link>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <NotaDeLaLista lista={lista} deLaLista={avisos.some(deLaLista)} alcance={alcanceDeLaRegla(a)} />
    </div>
  )
}

/** De qué lista salen las decisiones que se cuentan (las ventas por
 *  puntuación): sin lista guardada no se han mirado, y se dice; de una lista
 *  vieja, de cuándo es. El repaso del stop sí es de ahora.
 *
 *  Con `alcance` (la línea de Mi cartera), también cuando la regla no manda
 *  nada: «ninguna necesita atención» con un «Mantener» de la lista de hace 3
 *  días se leía como de hoy, y de las posiciones que la regla no decide (fuera
 *  de la lista, abiertas después, aún sin puntuar) no decía que solo se había
 *  mirado su stop (revisión 15, cartera H2 y costuras H2). */
export function NotaDeLaLista({
  lista,
  deLaLista,
  alcance,
}: {
  lista: RepasoDeCartera['lista']
  deLaLista: boolean
  alcance?: ReturnType<typeof alcanceDeLaRegla>
}) {
  if (lista === null) {
    return (
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        Sin la lista del día guardada solo se ha mirado el límite de pérdida, no si la regla manda vender o reducir
        alguna: Explorar la calcula.
      </p>
    )
  }
  if (alcance) {
    const vieja =
      alcance.vieja && alcance.decididas > 0
        ? `Lo que dice la regla (vender, reducir o mantener) sale de ${alcance.vieja}; el límite de pérdida sí es de ahora. Explorar la recalcula.`
        : null
    if (!vieja && !alcance.soloSuStop) return null
    return <p className="mt-1 text-xs leading-relaxed text-slate-600">{[vieja, alcance.soloSuStop].filter(Boolean).join(' ')}</p>
  }
  if (!deLaLista || lista.estado !== 'viejo') return null
  return (
    <p className="mt-1 text-xs leading-relaxed text-slate-600">
      Las ventas y reducciones por la regla salen de la lista del día guardada{' '}
      {lista.as_of ? fmtAntiguedad(lista.as_of) : '(sin fecha)'}, que ya caducó; el límite de pérdida sí es de ahora.
      Explorar la recalcula.
    </p>
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
