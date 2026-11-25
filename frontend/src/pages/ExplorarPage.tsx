import { Link, useSearchParams } from 'react-router-dom'
import { rutaExplorar, type FiltrosExplorar, type VistaExplorar } from '../lib/rutas'
import { EtfsPage } from './EtfsPage'
import { MultifactorPage } from './MultifactorPage'
import { ScreenerPage } from './ScreenerPage'
import { TodayPage } from './TodayPage'

/**
 * Explorar: todas las empresas y fondos que analiza la app, en un solo sitio
 * (`docs/PLAN_NAVEGACION.md`). Antes eran cuatro entradas del menú — Hoy,
 * Screener, Multifactor y ETFs — y no se sabía cuál decidía. Ahora:
 * - Acciones: la lista del día (la que decide) y, aparte, «Con mis propios
 *   filtros» (lo que eran Screener y Multifactor), que exploran pero no deciden;
 * - ETFs: la recomendación, el comparador y el solapamiento.
 *
 * Todo va en la URL (`?tipo=etfs`, `?filtros=simples|factores`): un enlace o
 * «Atrás» vuelven a la misma vista, y las rutas viejas redirigen aquí.
 */

export function vistaDeExplorar(params: URLSearchParams): { tipo: VistaExplorar; filtros: FiltrosExplorar | null } {
  const tipo: VistaExplorar = params.get('tipo') === 'etfs' ? 'etfs' : 'acciones'
  const f = params.get('filtros')
  // Los filtros propios son de acciones: con `?tipo=etfs` no aplican.
  const filtros: FiltrosExplorar | null = tipo === 'acciones' && (f === 'simples' || f === 'factores') ? f : null
  return { tipo, filtros }
}

function Selector<T extends string>({
  etiqueta,
  opciones,
  valor,
  elegir,
  grande = false,
}: {
  etiqueta: string
  opciones: { valor: T; texto: string }[]
  valor: T
  elegir: (v: T) => void
  grande?: boolean
}) {
  return (
    <div role="group" aria-label={etiqueta} className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
      {opciones.map((o) => {
        const activo = o.valor === valor
        return (
          <button
            key={o.valor}
            type="button"
            aria-pressed={activo}
            onClick={() => elegir(o.valor)}
            className={`min-h-11 rounded-lg px-4 font-semibold transition-colors ${grande ? 'text-[15px]' : 'text-sm'} ${
              activo ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {o.texto}
          </button>
        )
      })}
    </div>
  )
}

export function ExplorarPage() {
  const [params, setParams] = useSearchParams()
  const { tipo, filtros } = vistaDeExplorar(params)
  const ir = (t: VistaExplorar, f: FiltrosExplorar | null) => {
    const consulta = rutaExplorar({ tipo: t, filtros: f ?? undefined }).split('?')[1] ?? ''
    setParams(new URLSearchParams(consulta))
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Explorar acciones y ETFs</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
            Todas las empresas y fondos que analiza la app. Cada empresa se compara con las de su propio
            sector, no con el mercado entero; un ETF, por lo que cuesta, su tendencia, su tamaño y cuánto
            se repite con otros.
          </p>
        </div>
        <Selector
          etiqueta="Qué quieres ver"
          grande
          valor={tipo}
          elegir={(t) => ir(t, null)}
          opciones={[
            { valor: 'acciones', texto: 'Acciones' },
            { valor: 'etfs', texto: 'ETFs' },
          ]}
        />
      </header>

      {tipo === 'acciones' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Selector
              etiqueta="Qué lista"
              valor={filtros ? 'propios' : 'app'}
              elegir={(v) => ir('acciones', v === 'propios' ? 'simples' : null)}
              opciones={[
                { valor: 'app', texto: 'Ideas de la app' },
                { valor: 'propios', texto: 'Con mis propios filtros' },
              ]}
            />
            {filtros && (
              <Selector
                etiqueta="Tipo de filtro"
                valor={filtros}
                elegir={(f) => ir('acciones', f)}
                opciones={[
                  { valor: 'simples', texto: 'Por cifras' },
                  { valor: 'factores', texto: 'Por factores' },
                ]}
              />
            )}
          </div>

          {filtros ? (
            <>
              <p className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
                Tus filtros exploran; no deciden. Una empresa que pasa tus filtros no es una idea de compra:
                la decisión sale de{' '}
                <Link to={rutaExplorar()} className="font-medium text-sky-700 hover:underline">
                  Ideas de la app
                </Link>
                , que compara cada empresa con su sector y mira si el precio acompaña.
              </p>
              {filtros === 'simples' ? <ScreenerPage incrustada /> : <MultifactorPage incrustada />}
            </>
          ) : (
            <TodayPage incrustada />
          )}
        </>
      )}

      {tipo === 'etfs' && <EtfsPage incrustada />}
    </div>
  )
}
