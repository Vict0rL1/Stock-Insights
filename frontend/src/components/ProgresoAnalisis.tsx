/**
 * Cómo va la lista del día (`useListaDiaria`), dicho en una línea: lo que se
 * enseña mientras se analiza el mercado en segundo plano, en vez de una pantalla
 * en blanco con «Puntuando el universo…» (docs/PLAN_NAVEGACION.md, «Nada
 * bloquea»).
 *
 * - Sin nada que enseñar aún: un estado de carga breve que dice qué espera.
 * - Con una lista que no es de ahora a la vista (la copia caducada, o la de
 *   memoria pasadas sus 6 h): «Lista de hace 9 h; actualizando…», también si
 *   la de ahora falla («…, sin actualizar.»), con la edad al día.
 * - Con pasadas en marcha: la barra «Analizando el mercado en segundo plano: 312
 *   de 502 empresas. Ya puedes usar la app; las ideas se completan solas.»
 * - Con las pasadas paradas sin cubrir todo: la cobertura parcial y, si se pasa
 *   `onSeguir`, el botón «Seguir completando».
 * - Lista completa y nada en marcha: nada.
 *
 * Un fallo no se dice aquí: lo dice `ErrorDeCarga` con su «Reintentar».
 */
import { useEffect, useReducer } from 'react'
import type { ListaDiaria } from '../hooks/useListaDiaria'
import { PRIMERA_PASADA, REVALIDAR_TRAS_MS } from '../hooks/useListaDiaria'
import { fmtAntiguedad, plural } from '../lib/formato'

type Props = {
  lista: Pick<
    ListaDiaria,
    | 'estado' | 'progreso' | 'vieja' | 'calculadaEn' | 'recibidaEn' | 'pasada' | 'maxPasadas' | 'primeraVez'
    | 'ocupado'
  >
  /** «Seguir completando»: sin él no se pinta el botón. */
  onSeguir?: () => void
}

function Barra({ puntuadas, total }: { puntuadas: number; total: number }) {
  // Sin total no hay proporción: la barra vacía, no un NaN en el estilo.
  const ancho = total > 0 ? Math.min(100, (puntuadas / total) * 100) : 0
  return (
    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sky-200" aria-hidden="true">
      <div className="h-full bg-sky-500 transition-all" style={{ width: `${ancho}%` }} />
    </div>
  )
}

/** «Lista de hace 9 h», desde cuándo se calculó (`calculadaEn`): la edad se
 *  calcula al pintar, así que avanza con la pantalla abierta. En la copia
 *  caducada, `calculadaEn` sale de la edad que dio el backend. */
export function textoDeAntiguedad(calculadaEn: number | null, ahora: Date = new Date()): string {
  if (calculadaEn === null) return 'Lista guardada, de antigüedad desconocida'
  return `Lista de ${fmtAntiguedad(new Date(calculadaEn), ahora)}`
}

/** Vuelve a pintar cada minuto mientras `activo`: la edad que se enseña no se
 *  queda en la de cuando llegó la lista. */
function usePintarCadaMinuto(activo: boolean): void {
  const [, pintar] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!activo) return
    const id = setInterval(pintar, 60_000)
    return () => clearInterval(id)
  }, [activo])
}

export function ProgresoAnalisis({ lista, onSeguir }: Props) {
  const { estado, progreso, vieja, calculadaEn, recibidaEn, ocupado } = lista
  usePintarCadaMinuto(vieja)

  if (!progreso) {
    if (estado !== 'cargando') return null
    return (
      <div role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        {lista.primeraVez ? (
          <>
            <p className="text-sm text-slate-600">Preparando la primera lista…</p>
            <p className="mt-1 text-xs text-slate-400">
              No hay ninguna guardada: primero se analizan {PRIMERA_PASADA} empresas, unos segundos,
              y el resto se completa solo en segundo plano.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600">Cargando la lista de hoy…</p>
        )}
      </div>
    )
  }

  const empresas = `${progreso.puntuadas} de ${progreso.total} ${plural(progreso.total, 'empresa', 'empresas')}`

  if (vieja) {
    // El repaso de stops viaja con la lista y es de cuando llegó: recién llegada
    // es de ahora; con la pantalla abierta horas (o al volver a ella), no.
    const ahora = new Date()
    const repasoDeAhora = recibidaEn !== null && ahora.getTime() - recibidaEn < REVALIDAR_TRAS_MS
    return (
      <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="text-xs font-medium text-amber-900">
          {textoDeAntiguedad(calculadaEn, ahora)}
          {ocupado ? '; actualizando…' : ', sin actualizar.'}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-amber-800">
          Es la que se calculó entonces{progreso.completa ? '' : `, con ${empresas}`}: sus ideas,
          precios y tamaños son de aquel momento.{' '}
          {repasoDeAhora
            ? 'El repaso del stop de tus posiciones sí es de ahora.'
            : recibidaEn !== null
              ? `El repaso del stop de tus posiciones es de cuando llegó, ${fmtAntiguedad(new Date(recibidaEn), ahora)}.`
              : 'El repaso del stop de tus posiciones es de cuando llegó la lista.'}
          {ocupado ? ' La de hoy la sustituye en cuanto llegue.' : ''}
        </p>
      </div>
    )
  }

  if (progreso.completa) {
    if (!ocupado) return null
    return (
      <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
        Actualizando la lista en segundo plano. Ya puedes usar la app.
      </div>
    )
  }

  if (ocupado) {
    return (
      <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
        <div className="text-xs font-medium text-sky-900">
          Analizando el mercado en segundo plano: {empresas}. Ya puedes usar la app; las ideas se
          completan solas.
        </div>
        <Barra puntuadas={progreso.puntuadas} total={progreso.total} />
        {lista.pasada > 0 && (
          <p className="mt-1.5 text-[11px] leading-snug text-sky-800">
            Pasada {lista.pasada} de {lista.maxPasadas}. Lo descargado queda en caché 24 h, así que
            ninguna pasada repite trabajo.
          </p>
        )}
      </div>
    )
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-sky-900">Cobertura parcial: {empresas}</div>
        <Barra puntuadas={progreso.puntuadas} total={progreso.total} />
        <p className="mt-1.5 text-[11px] leading-snug text-sky-800">
          Las APIs gratuitas limitan cuántos fundamentales se descargan de una vez. Lo descargado
          queda en caché 24 h, así que cada pasada avanza y ninguna repite trabajo.
        </p>
      </div>
      {onSeguir && (
        <button
          onClick={onSeguir}
          className="shrink-0 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700"
        >
          Seguir completando
        </button>
      )}
    </div>
  )
}
