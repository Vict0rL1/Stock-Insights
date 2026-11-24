import type { Estres, RiskBudget } from '../../api/types'
import { fmtFecha, fmtFrente, fmtNum, fmtPct, plural, signoLeido } from '../../lib/formato'

/** Las posiciones que el estrés no ve, por nombre y con la parte del dinero que
 *  sí mide: se reponderaba el resto en silencio y la caída de un 9 % de la
 *  cartera pasaba por la de toda (revisión 8). */
function SinHistorico({ estres }: { estres: Estres }) {
  if (!estres.aviso_sin_historico) return null
  return (
    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
      {estres.aviso_sin_historico}
    </p>
  )
}

/** El peor tramo que ESTA composición habría sufrido, con sus fechas.
 *
 *  No son escenarios inventados: son los pesos que tienes hoy aplicados al
 *  histórico guardado, rebalanceando en cada paso para que los pesos simulados
 *  sigan siendo los tuyos. Y lo que el histórico NO vio se dice tan alto como
 *  lo que vio, porque un «peor caso» de cinco años tranquilos no es el peor
 *  caso: es el peor de lo que dio tiempo a pasar.
 *
 *  Va dentro del bloque «Estrés» de Mi cartera › Riesgo, junto a las tres
 *  crisis: sin caja propia. */
export function EstresHistorico({ estres, sinPosiciones = false }: { estres: Estres; sinPosiciones?: boolean }) {
  if (!estres.suficiente) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-slate-800">
          Peor escenario histórico
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {/* Con la cartera vacía, «Sin cartera o sin histórico» hacía pensar en
              una descarga fallida (revisión 12, visual). */}
          {sinPosiciones
            ? 'Sin posiciones abiertas que estresar.'
            : (estres.nota ?? 'Histórico insuficiente para estresar esta cartera.')}
        </p>
        <SinHistorico estres={estres} />
      </div>
    )
  }
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-800">
        Peor escenario histórico de esta cartera
      </h3>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-400">
            Peor caída pico a valle
          </dt>
          <dd className="text-lg font-semibold tabular-nums text-red-700">
            {fmtPct(estres.max_drawdown_pct, 1, { enPuntos: true })}
          </dd>
          <dd className="text-[11px] text-slate-400">
            {fmtFecha(estres.drawdown_desde)} → {fmtFecha(estres.drawdown_hasta)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-400">
            Peor {estres.peor_ventana_meses} meses seguidos
          </dt>
          {estres.peor_ventana_pct !== null &&
          estres.peor_ventana_pct !== undefined ? (
            <>
              {/* Con signo y en rojo solo si es una caída: desde que el estrés
                  puede medir 12 meses (revisión 12, visual) la peor ventana de una
                  cartera que solo subió salía «5,8 %» en rojo, como una pérdida. */}
              <dd
                className={`text-lg font-semibold tabular-nums ${
                  signoLeido(fmtPct(estres.peor_ventana_pct, 1, { enPuntos: true, signo: true })) < 0 ? 'text-red-700' : ''
                }`}
              >
                {fmtPct(estres.peor_ventana_pct, 1, { enPuntos: true, signo: true })}
              </dd>
              <dd className="text-[11px] text-slate-400">
                {fmtFecha(estres.peor_ventana_desde)} → {fmtFecha(estres.peor_ventana_hasta)}
              </dd>
            </>
          ) : (
            <dd className="text-[11px] leading-tight text-slate-500">
              {estres.peor_ventana_nota}
            </dd>
          )}
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-slate-400">
            Histórico usado
          </dt>
          <dd className="text-lg font-semibold tabular-nums text-slate-800">
            {estres.años_cubiertos == null
              ? '—'
              : `${fmtNum(estres.años_cubiertos, 1, { ceros: false })} ${plural(estres.años_cubiertos, 'año', 'años')}`}
          </dd>
          <dd className="text-[11px] text-slate-400">{estres.cobertura}</dd>
        </div>
      </dl>
      <SinHistorico estres={estres} />
      {estres.aviso_cobertura && (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${
            estres.aviso_cobertura.startsWith('ATENCIÓN')
              ? 'bg-amber-50 text-amber-900'
              : 'text-slate-500'
          }`}
        >
          {estres.aviso_cobertura}
        </p>
      )}
    </div>
  )
}

/** Cuánto se pierde a la vez si todas las posiciones tocan su límite de
 *  pérdida (stop). Cada idea se dimensiona para arriesgar poco; lo que no hacía
 *  nadie era sumar. */
export function RiesgoAbiertoPanel({ risk, sinPosiciones = false }: { risk: RiskBudget; sinPosiciones?: boolean }) {
  // Sin posiciones no hay riesgo que sumar, y se dice así: «0,0 %, quedan 6,0 %
  // de margen» junto a un valor de mercado «—» era el mismo vacío contado como
  // cero en una tarjeta y como ausente en la otra (revisión 12, visual).
  if (sinPosiciones) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">Riesgo abierto</h2>
        <p className="mt-1 text-xs text-slate-500">Sin posiciones abiertas: no hay riesgo abierto que sumar.</p>
      </section>
    )
  }
  const excedido = risk.riesgo_total_pct > risk.tope_pct
  // Las que cuentan enteras porque su stop ya está perforado, con nombre: STOP
  // ponía 15,6 de los 31,1 puntos sin que el panel la nombrara, y la nota que lo
  // explica viajaba en la respuesta sin pintarse (revisión 12, visual).
  const conNota = risk.posiciones.filter((p) => p.nota)
  const pct = Math.min(risk.riesgo_total_pct / risk.tope_pct, 1.6) * 100
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Riesgo abierto</h2>
        <span className="text-[11px] text-slate-400">
          tope sugerido {fmtPct(risk.tope_pct, 1, { enPuntos: true, ceros: false })} · por grupo{' '}
          {fmtPct(risk.tope_grupo_pct, 1, { enPuntos: true, ceros: false })}
        </span>
      </div>
      {/* Para quien no sabe qué es: la frase antes que la cifra. */}
      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
        Lo que perderías de la cartera si todas tus posiciones llegaran a la vez a su límite de pérdida (stop).
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`text-3xl font-semibold tabular-nums ${excedido ? 'text-red-600' : 'text-slate-900'}`}>
          {/* De su lado del tope, y el margen sin escribirse como cero: con 5,97,
              «6,0 %» sin rojo y «quedan 0,0 % de margen» (revisión 10). */}
          {fmtFrente(risk.riesgo_total_pct / 100, risk.tope_pct / 100, { pct: true })}
        </span>
        <span className="text-xs text-slate-400">
          {excedido ? 'por encima del tope' : `quedan ${fmtFrente(risk.margen_pct / 100, 0, { pct: true })} de margen`}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${excedido ? 'bg-red-500' : 'bg-emerald-500'}`}
             style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {conNota.map((p, i) => (
        <p key={`${p.symbol}-${i}`} className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
          <span className="font-semibold">{p.symbol}</span> — {p.nota} (un{' '}
          {fmtFrente(p.riesgo_pct / 100, 0, { pct: true })} de la cartera).
        </p>
      ))}
      {risk.avisos.map((a, i) => (
        <p key={i} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">{a}</p>
      ))}
      {Object.keys(risk.por_grupo).length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            Por grupo que se mueve junto
          </div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {Object.entries(risk.por_grupo).sort((a, b) => b[1] - a[1]).map(([grupo, valor]) => (
              <li key={grupo} className="flex justify-between gap-3">
                <span className="text-slate-600">{grupo}</span>
                <span className={`tabular-nums ${valor > risk.tope_grupo_pct ? 'text-red-600' : 'text-slate-700'}`}>
                  {fmtFrente(valor / 100, risk.tope_grupo_pct / 100, { pct: true })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{risk.nota}</p>
    </section>
  )
}
