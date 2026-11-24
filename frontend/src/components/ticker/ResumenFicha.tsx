/**
 * Las piezas de la pestaña Resumen que salen del análisis de la empresa: «Lo
 * que comprueba la app», el aviso de tesis rota y «Cifras clave, explicadas».
 * El gráfico es de la ficha (`TickerPage`), que ya tiene su histórico.
 */
import { useId } from 'react'
import { Link } from 'react-router-dom'
import type { AnalisisEmpresa, Decision } from '../../api/types'
import { rutaCartera } from '../../lib/rutas'
import { cifrasClave } from '../../lib/cifrasClave'
import { fmtFecha } from '../../lib/formato'
import { QUE_COMPRUEBA, reglasQueCuentan } from '../../lib/queDiceLaApp'
import { DecisionExplicada, RESULTADO, cifrasDeRegla, umbralesDeTraza } from '../DecisionExplicada'
import { ConTerminos, Termino } from '../Termino'
import { TesisInvalidada } from './QueCambioSection'

const tarjeta = 'rounded-xl border border-slate-200 bg-white p-4'

/** Las reglas que decidieron, bloquearon o empujaron, cada una con ✓ / ✗ / ? y
 *  una frase; debajo, plegada, la traza entera. Las marcas y las cifras son las
 *  de «¿Por qué esta decisión?» (`DecisionExplicada`): esto es su resumen. */
export function LoQueCompruebaLaApp({ decision }: { decision: Decision }) {
  const titulo = useId()
  const reglas = reglasQueCuentan(decision.reglas)
  const umbrales = umbralesDeTraza(decision.reglas ?? [])
  return (
    <section aria-labelledby={titulo} className={tarjeta}>
      <h2 id={titulo} className="mb-3 text-sm font-semibold text-slate-800">
        Lo que comprueba la app
      </h2>
      {reglas.length === 0 ? (
        <p className="text-sm text-slate-500">Esta decisión no trae la traza de sus reglas.</p>
      ) : (
        <ul className="space-y-3">
          {reglas.map((r) => {
            const res = RESULTADO[r.resultado] ?? RESULTADO.desconocido
            const [marca, ...palabras] = res.texto.split(' ')
            const propia = QUE_COMPRUEBA[r.id]
            const cifras = cifrasDeRegla(r, umbrales)
            const fecha = typeof r.datos?.fecha === 'string' ? ` (el ${fmtFecha(r.datos.fecha)})` : ''
            return (
              <li key={r.id} className="flex gap-2 text-sm leading-snug">
                <span aria-hidden="true" className={`w-4 shrink-0 text-center font-bold ${res.tono}`}>
                  {marca}
                </span>
                <span className="min-w-0">
                  <span className="sr-only">{palabras.join(' ')}: </span>
                  <span className="font-medium text-slate-800">{propia ?? r.regla}.</span>{' '}
                  <span className="text-xs text-slate-500">
                    {propia ? <ConTerminos texto={r.regla} /> : null}
                    {cifras !== null ? `${propia ? ' ' : ''}(${cifras})` : ''}
                    {fecha}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-sky-700 hover:underline">
          Ver todas las reglas y qué cambiaría la decisión
        </summary>
        <div className="mt-2 space-y-2">
          {decision.reasons.length > 0 && (
            <ul className="space-y-1 text-xs text-slate-600">
              {decision.reasons.map((r, i) => (
                <li key={i}>· {r}</li>
              ))}
            </ul>
          )}
          <DecisionExplicada decision={decision} abierta />
        </div>
      </details>
    </section>
  )
}

/** Si una tesis tuya tiene un punto de invalidación cruzado, se dice aquí, en
 *  el Resumen: el motor no la mira y la decisión de arriba no la tiene en cuenta. */
export function AvisoDeTesis({ analisis }: { analisis: AnalisisEmpresa }) {
  return (
    <TesisInvalidada
      a={analisis}
      pie={
        <Link to={rutaCartera('tesis')} className="mt-1 inline-block font-medium underline">
          Revisar mi tesis
        </Link>
      }
    />
  )
}

/** Cuatro cifras del análisis, cada una con su frase y su fuente. */
export function CifrasClaveExplicadas({ analisis, alVerMas }: { analisis: AnalisisEmpresa; alVerMas?: () => void }) {
  const titulo = useId()
  return (
    <section aria-labelledby={titulo} className={tarjeta}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={titulo} className="text-sm font-semibold text-slate-800">
          Cifras clave, explicadas
        </h2>
        {alVerMas && (
          <button type="button" onClick={alVerMas} className="text-sm font-medium text-sky-700 hover:underline">
            Más cifras en «Números»
          </button>
        )}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cifrasClave(analisis).map((c) => (
          <div key={c.clave} className="flex flex-col rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-xs font-medium text-slate-500">
              {c.termino ? <Termino clave={c.termino}>{c.titulo}</Termino> : c.titulo}
            </span>
            <span className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{c.valor}</span>
            <p className="mt-1 text-sm leading-snug text-slate-700">{c.frase}</p>
            <p className="mt-auto pt-2 text-[11px] text-slate-400">Fuente: {c.fuente}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-snug text-slate-400">
        Calculadas por la app con las cuentas presentadas ante la SEC (EDGAR) y la cotización; ninguna la escribe la IA.
        Análisis del {fmtFecha(analisis.analizado_en, { hora: true })}.
      </p>
    </section>
  )
}
