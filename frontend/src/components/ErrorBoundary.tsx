import { Component, type ErrorInfo, type ReactNode } from 'react'
import { MarcoTabla } from './MarcoTabla'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Red de seguridad: un error al pintar cualquier vista dejaba la página
 * **en blanco**, sin nada que indicara qué pasó ni cómo salir.
 *
 * Pasó de verdad: al cambiar la forma de la respuesta de /today, una
 * respuesta cacheada por la versión anterior rompía el render y la app
 * desaparecía. La causa está corregida en el backend, pero una pantalla en
 * blanco es una forma de fallar tan mala que conviene que sea imposible.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error al pintar la vista:', error, info.componentStack)
  }

  render() {
    if (this.state.error === null) return this.props.children

    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h1 className="text-sm font-semibold text-amber-900">
            Algo se rompió al pintar esta vista
          </h1>
          <p className="mt-1 text-sm text-amber-800">
            Tus datos no se han tocado. Recargar suele bastar; si el problema
            persiste, pulsa «Actualizar» en la vista Hoy para recalcular la lista
            desde cero.
          </p>
          {/* En el marco de las tablas: con scroll horizontal y sin foco, con
              teclado no se leía el final de un mensaje largo (revisión 3). */}
          <MarcoTabla etiqueta="Mensaje del error" className="mt-3 rounded-lg">
            <pre className="w-max min-w-full bg-amber-100 p-3 text-[11px] text-amber-900">
              {this.state.error.message}
            </pre>
          </MarcoTabla>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-900"
          >
            Recargar
          </button>
        </div>
      </div>
    )
  }
}
