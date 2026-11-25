import { useState } from 'react'
import { api } from '../../api/client'
import type { PriceAlert, Vigilancia } from '../../api/types'
import { fmtPrecio, plural } from '../../lib/formato'
import { leerNumero } from '../../lib/entrada'
import { useDato } from '../../lib/useDato'
import { BloqueDatos } from '../EstadoDato'

// Como en las posiciones: «1.050» es mil cincuenta, no 1,05 (tercera pasada de
// la revisión del 2.1).
const EJEMPLO = 'escribe p. ej. 1.250,50 o 98,5'

/** El aviso de arriba de las alertas: quién las vigila y desde cuándo.
 *
 * Antes esto era una frase fija — «no hay notificaciones, es una app local» —
 * que dejó de ser verdad en cuanto existió el comando programado, pero que
 * tampoco se puede sustituir por la contraria: depende de si el usuario llegó a
 * programarlo. Así que se dice lo que el backend encuentra, que es lo único que
 * no miente en ninguno de los dos casos.
 */
function AvisoDeVigilancia({ v }: { v: Vigilancia | null }) {
  if (!v) return null

  // Bordes en el tono 100, no 200: solo 50/100/800/900 se invierten en oscuro
  // (ver index.css), y un borde 200 se queda pastel — el aviso tranquilo
  // acabaría siendo lo más llamativo de la pantalla, que es justo al revés.
  const tono = v.activa
    ? 'border-emerald-100 bg-emerald-50 text-emerald-900'
    : v.nunca
      ? 'border-slate-200 bg-slate-100 text-slate-600'
      : 'border-amber-100 bg-amber-50 text-amber-900'

  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${tono}`}>
      <p>{v.nota}</p>
      {v.activa && v.revisadas != null && (
        <p className="mt-1 opacity-80">
          {v.revisadas} {plural(v.revisadas, 'alerta revisada', 'alertas revisadas')},{' '}
          {v.nuevas == null ? 'nuevas: sin dato' : `${v.nuevas} ${plural(v.nuevas, 'nueva', 'nuevas')}`}
          {v.no_evaluables ? `, ${v.no_evaluables} sin poder comprobar` : ''}.
        </p>
      )}
      {!v.activa && (
        <p className="mt-1 opacity-80">
          Mientras no lo esté, las alertas solo se evalúan cuando abres esta pestaña — y si
          estás mirando la pantalla, no necesitas la alerta.
        </p>
      )}
    </div>
  )
}

/** La condición en palabras, sin adivinar el operador.
 *
 * Antes cualquier operador que no fuera `lt` se pintaba como «sube de», así que
 * una condición guardada con un operador raro se leía al revés y con total
 * aplomo. Si no se reconoce, se dice.
 */
function textoDeCondicion(c: PriceAlert['condition']): string {
  const verbo = c.op === 'lt' ? 'baja de' : c.op === 'gt' ? 'sube de' : null
  if (verbo === null) return `condición no reconocida (${c.op ?? 'sin operador'})`
  return `${verbo} ${fmtPrecio(c.price)}`
}

/** Lo que no se puede comprobar no se pinta como tranquilo. */
function EstadoDeAlerta({ a }: { a: PriceAlert }) {
  if (a.estado === 'ok') {
    return a.triggered ? (
      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
        Cumplida
      </span>
    ) : null
  }
  const etiqueta = {
    sin_precio: 'Sin comprobar',
    error: 'Error al comprobar',
    condicion_invalida: 'Condición inválida',
    desactivada: 'Desactivada',
  }[a.estado]
  const tono =
    a.estado === 'desactivada' ? 'bg-slate-100 text-slate-800' : 'bg-red-100 text-red-800'
  return (
    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${tono}`} title={a.last_error ?? a.motivo}>
      {etiqueta}
      {/* Cuántas revisiones seguidas lleva sin poder mirarse: una es un
          tropiezo, cinco es una alerta que no te está protegiendo. */}
      {a.consecutive_errors != null && a.consecutive_errors > 1 && ` · ${a.consecutive_errors} seguidas`}
    </span>
  )
}

/** Las alertas de precio, dentro de Mi cartera › Posiciones (era la pestaña
 *  «Alertas» del Portafolio). */
export function AlertasDePrecio() {
  // Un control de riesgo que se callaba: con la carga fallida, `() => setAlerts([])`
  // pintaba «Sin alertas configuradas.» y quien tenía un stop vigilado creía
  // que no había ninguno (ítem 2.1). Ahora el fallo se dice, con su motivo.
  const alertas = useDato(() => api.alerts(), 'alertas')
  const load = alertas.refrescar
  const [form, setForm] = useState<{ symbol: string; op: 'lt' | 'gt'; price: string }>({
    symbol: '',
    op: 'lt',
    price: '',
  })
  const [error, setError] = useState<string | null>(null)

  // Crear y borrar tampoco capturaban: una alerta que no se guardaba no decía nada.
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const price = leerNumero(form.price)
    if (price === null) {
      setError(`«${form.price}» no es un precio: ${EJEMPLO}.`)
      return
    }
    try {
      await api.addAlert({
        symbol: form.symbol.trim().toUpperCase(),
        op: form.op,
        price,
      })
      setForm({ symbol: '', op: 'lt', price: '' })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  const borrar = async (id: number) => {
    setError(null)
    try {
      await api.deleteAlert(id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  const inputCls =
    'rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none'

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">Alertas de precio</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          Un aviso cuando una acción baja o sube de un precio que eliges.
        </p>
      </div>
      <form aria-label="Crear una alerta de precio" onSubmit={add} className="flex flex-wrap gap-2">
        <input
          className={`${inputCls} w-32`}
          placeholder="Ticker"
          value={form.symbol}
          onChange={(e) => setForm({ ...form, symbol: e.target.value })}
        />
        <select
          className={inputCls}
          value={form.op}
          onChange={(e) => setForm({ ...form, op: e.target.value as 'lt' | 'gt' })}
        >
          <option value="lt">baja de</option>
          <option value="gt">sube de</option>
        </select>
        <input
          className={`${inputCls} w-32`}
          placeholder="Precio"
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />
        <button className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700">
          Crear alerta
        </button>
        {error && <span className="self-center text-sm text-red-600">{error}</span>}
      </form>

      <BloqueDatos carga={alertas} que="las alertas">
        {({ alerts, vigilancia }) => (
          <div className="space-y-3">
            <AvisoDeVigilancia v={vigilancia} />

            {alerts.length === 0 ? (
              <p className="text-sm text-slate-400">Sin alertas configuradas.</p>
            ) : (
              <ul className="space-y-2">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className={`flex items-center justify-between rounded-xl border p-3 ${
                      a.triggered ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="text-sm">
                      <span className="font-medium text-slate-800">{a.symbol}</span>
                      <span className="ml-2 text-slate-500">{textoDeCondicion(a.condition)}</span>
                      <EstadoDeAlerta a={a} />
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm tabular-nums text-slate-600">
                        {fmtPrecio(a.current_price)}
                      </span>
                      <button
                        onClick={() => borrar(a.id)}
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Borrar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </BloqueDatos>
    </section>
  )
}
