import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { BloqueDatos } from '../components/EstadoDato'
import type { ScenarioRecord, ThesisRecord, TrackRecord } from '../api/types'
import { etiqueta } from '../lib/etiquetas'
import { fmtAntiguedad, fmtFecha, fmtPct, fmtPrecio } from '../lib/formato'
import { leerNumero } from '../lib/entrada'
import { mensajeDeError, useDato } from '../lib/useDato'
import { MarcoTabla } from '../components/MarcoTabla'

const ESCENARIOS = ['bear', 'base', 'bull'] as const

/** Un 404 al borrar es que ya no existía (otro clic, otra pestaña): no es un
 *  fallo que enseñar (segunda revisión del 2.1). */
function yaNoExistia(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404
}


function OutcomeChip({ scenario }: { scenario: ScenarioRecord }) {
  if (!scenario.outcome) {
    return (
      <span
        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500"
        title={scenario.reason ?? 'Escenario sin dirección definida'}
      >
        no evaluable
      </span>
    )
  }
  const hit = scenario.outcome === 'acertado'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        hit ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {scenario.outcome} · dirección {scenario.direction}
    </span>
  )
}

function TrackRecordPanel({ record }: { record: TrackRecord }) {
  const { summary } = record
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-slate-700">Registro de aciertos</h2>
      <p className="mb-3 text-xs text-slate-400">{summary.note}</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-slate-400">Escenarios guardados</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-800">{summary.total}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Evaluables</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-800">
            {summary.evaluable}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Tasa de acierto direccional</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-800">
            {summary.hit_rate !== null ? fmtPct(summary.hit_rate, 0) : '—'}
          </div>
          <div className="text-[10px] text-slate-400">
            {summary.hits} aciertos / {summary.misses} fallos
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Error mediano de estimación</div>
          <div className="text-2xl font-semibold tabular-nums text-slate-800">
            {summary.median_estimate_error_pct !== null
              ? fmtPct(summary.median_estimate_error_pct)
              : '—'}
          </div>
        </div>
      </div>

      {record.scenarios.length > 0 && (
        <MarcoTabla etiqueta="Escenarios de la tesis" className="mt-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                {['Ticker', 'Escenario', 'Creado', 'Precio ancla', 'Estimado', 'Precio hoy', 'Movimiento', 'Resultado'].map(
                  (h) => (
                    <th key={h} className="px-2 py-1 font-normal">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {record.scenarios.map((s) => (
                <tr key={s.scenario_id} className="border-b border-slate-100">
                  <td className="px-2 py-1.5">
                    <Link to={`/ticker/${s.symbol}`} className="font-medium hover:underline">
                      {s.symbol}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{etiqueta(s.kind, { mayuscula: true })}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">
                    {fmtFecha(s.created_at)} ({s.days_elapsed} d)
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {fmtPrecio(s.price_at_creation)}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {s.value_mid !== null ? fmtPrecio(s.value_mid) : '—'}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {fmtPrecio(s.current_price)}
                  </td>
                  <td
                    className={`px-2 py-1.5 tabular-nums ${
                      (s.price_change_pct ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {s.price_change_pct !== null ? fmtPct(s.price_change_pct) : '—'}
                  </td>
                  <td className="px-2 py-1.5">
                    <OutcomeChip scenario={s} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </MarcoTabla>
      )}
    </section>
  )
}

export function ThesesPage() {
  // La lista hacía `setError(e.message)`, y ese error solo se pintaba dentro
  // del formulario de «Nueva tesis», cerrado por defecto: con la base caída la
  // pantalla decía «Sin tesis guardadas» y parecía que las tesis se habían
  // perdido (revisión del 2.1).
  const tesis = useDato(() => api.theses().then((d) => d.theses), 'tesis')
  // El registro de aciertos hacía `() => setRecord(null)`: si fallaba, el panel
  // desaparecía y no se sabía si era un fallo o que aún no había nada (ítem 2.1).
  const registro = useDato(() => api.trackRecord(), 'registro')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ symbol: '', title: '', body: '', invalidation: '' })
  const [error, setError] = useState<string | null>(null)
  // Borrar y «+ Escenario» hacían `await` sin capturar: un rechazo no decía
  // nada y la tesis seguía ahí como si no se hubiera pedido (revisión del 2.1).
  const [fallo, setFallo] = useState<string | null>(null)

  // Tras una acción: la lista y el registro, sin vaciar lo que se ve mientras
  // llegan. Al montar no hace falta: `useDato` ya los pide (antes el registro
  // se pedía dos veces, y cada vez cotizaba todos los símbolos).
  const load = () => {
    tesis.refrescar()
    registro.refrescar()
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await api.createThesis({
        symbol: form.symbol.trim().toUpperCase(),
        title: form.title,
        body_md: form.body,
        invalidation_criteria: form.invalidation || null,
      })
      setForm({ symbol: '', title: '', body: '', invalidation: '' })
      setShowForm(false)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    }
  }

  const addScenario = async (thesisId: number) => {
    // El prompt pedía los códigos en inglés («bear / base / bull») y la
    // pantalla los enseña como «bajista / base / alcista»: escribir lo que se
    // ve salía sin decir nada. Y «12,5» se guardaba como 12 (segunda revisión
    // del 2.1). Cancelar sigue sin decir nada; escribir mal, no.
    const nombres = ESCENARIOS.map((k) => etiqueta(k))
    const escrito = window.prompt(`Escenario (${nombres.join(' / ')}):`, etiqueta('base'))
    if (escrito === null) return
    const buscado = escrito.trim().toLowerCase()
    const kind = ESCENARIOS.find((k) => k === buscado || etiqueta(k).toLowerCase() === buscado)
    if (!kind) {
      setFallo(`«${escrito}» no es un escenario: escribe ${nombres.join(', ')}.`)
      return
    }
    const raw = window.prompt('Valor intrínseco estimado por acción:')
    if (raw === null) return
    const value = leerNumero(raw)
    if (value === null) {
      setFallo(`«${raw}» no es un número: escribe el valor por acción, p. ej. 12,5.`)
      return
    }
    setFallo(null)
    try {
      const result = await api.addScenario(thesisId, {
        kind,
        assumptions: {},
        value_mid: value,
      })
      if (result.warning) window.alert(result.warning)
      load()
    } catch (err) {
      setFallo(`No se pudo añadir el escenario: ${mensajeDeError(err)}`)
    }
  }

  const borrar = async (thesis: ThesisRecord) => {
    if (!window.confirm(`¿Borrar la tesis «${thesis.title}»?`)) return
    setFallo(null)
    try {
      await api.deleteThesis(thesis.id)
      load()
    } catch (err) {
      if (yaNoExistia(err)) load()
      else setFallo(`No se pudo borrar la tesis: ${mensajeDeError(err)}`)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Tesis y escenarios</h1>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          {showForm ? 'Cancelar' : 'Nueva tesis'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={create} className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <input
            className={inputCls}
            placeholder="Ticker"
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value })}
          />
          <input
            className={inputCls}
            placeholder="Título de la tesis"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            className={inputCls}
            rows={4}
            placeholder="Tu tesis: por qué crees lo que crees, y qué supuestos clave la sostienen."
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          <textarea
            className={inputCls}
            rows={2}
            placeholder="¿Qué te haría cambiar de opinión? (criterios de invalidación)"
            value={form.invalidation}
            onChange={(e) => setForm({ ...form, invalidation: e.target.value })}
          />
          <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Guardar tesis
          </button>
          {error && <span className="ml-3 text-sm text-red-600">{error}</span>}
        </form>
      )}

      <BloqueDatos carga={registro} que="el registro de aciertos">
        {(r) => <TrackRecordPanel record={r} />}
      </BloqueDatos>

      {fallo && (
        <p role="alert" className="text-sm text-red-600">
          {fallo}
        </p>
      )}

      <BloqueDatos carga={tesis} que="las tesis">
        {(theses) =>
          theses.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
                Sin tesis guardadas. Escribe una antes de comprar: la app la fechará y te la enseñará
                después junto al resultado real.
              </p>
          ) : (
            <div className="space-y-3">
              {theses.map((thesis) => (
                <article key={thesis.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-800">
                        <Link to={`/ticker/${thesis.symbol}`} className="hover:underline">
                          {thesis.symbol}
                        </Link>
                        <span className="ml-2 font-normal">{thesis.title}</span>
                      </h2>
                      <div className="text-xs text-slate-400">
                        Escrita el {fmtFecha(thesis.created_at, { hora: true })} · {fmtAntiguedad(thesis.created_at)}
                        {thesis.current_price !== null && ` · precio hoy ${fmtPrecio(thesis.current_price)}`}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => addScenario(thesis.id)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        + Escenario
                      </button>
                      <button
                        onClick={() => borrar(thesis)}
                        className="text-xs text-slate-400 hover:text-red-600"
                      >
                        Borrar
                      </button>
                    </div>
                  </div>

                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{thesis.body_md}</p>

                  {thesis.invalidation_criteria && (
                    <div className="mt-2 rounded-lg border-l-2 border-amber-400 bg-amber-50 px-3 py-2">
                      <div className="text-xs font-semibold text-amber-800">
                        Qué me haría cambiar de opinión
                      </div>
                      <p className="text-sm text-amber-900">{thesis.invalidation_criteria}</p>
                    </div>
                  )}

                  {thesis.scenarios.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {thesis.scenarios.map((s) => (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                        >
                          <span className="text-slate-700">
                            <b>{etiqueta(s.kind, { mayuscula: true })}</b>
                            {s.value_mid !== null && ` · valor estimado ${fmtPrecio(s.value_mid)}`}
                            {s.price_at_creation !== null &&
                              ` · precio entonces ${fmtPrecio(s.price_at_creation)}`}
                            <span className="ml-2 text-xs text-slate-400">hace {s.days_elapsed} d</span>
                          </span>
                          <OutcomeChip scenario={s} />
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          )
        }
      </BloqueDatos>
    </div>
  )
}
