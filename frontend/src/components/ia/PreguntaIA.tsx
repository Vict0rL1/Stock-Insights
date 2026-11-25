/**
 * «Pregúntale a la IA» (Inicio; `docs/PLAN_NAVEGACION.md`, «La IA», fase D).
 *
 * Una pregunta libre, o una sugerencia tocada, contestada por Claude con lo que
 * la app YA calculó (la lista del día, tu cartera, el mercado, la ficha si se
 * pasa `simbolo`) y nada más: el backend arma el contexto desde la caché y no
 * descarga nada (`POST /api/ia/preguntar`, `backend/app/pregunta_ia.py`).
 *
 * Las reglas de la IA de la app, aquí también:
 * - el coste se ve ANTES de enviar (`/preguntar/coste`, sin llamar al modelo),
 *   junto con los datos que se le pasarán, cada uno con su fecha;
 * - la respuesta sale en `BloqueIA` (etiqueta «Generado por IA», modelo, aviso)
 *   y lo calculado que recibió va aparte, fuera del bloque violeta;
 * - sin clave, el bloque explica cómo añadirla en vez de desaparecer, y no
 *   enseña ninguna clave.
 */
import { useEffect, useId, useState } from 'react'
import { ApiError, api } from '../../api/client'
import type { CostePreguntaIA, DatoAusenteIA, DatoContextoIA, RespuestaPreguntaIA } from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { fmtAntiguedad, fmtDinero, fmtFecha, fmtNum, ZONA_MERCADO } from '../../lib/formato'
import { useLlmEstado } from '../../lib/llm'
import { mensajeDeError } from '../../lib/useDato'
import { BloqueIA, BotonIA } from './ContenidoIA'

export const SUGERENCIAS = [
  'Resúmeme el día',
  'Explícame la mejor idea de hoy',
  '¿Qué ETF sirve para empezar?',
] as const

// El tope de verdad es el del backend (`MAX_PREGUNTA`), que llega con el coste;
// hasta entonces, el mismo número. Una pregunta más larga es un 422 igualmente.
const MAX_POR_DEFECTO = 500

/** Sin la clave no hay IA: se explica cómo añadirla, sin enseñar ninguna. */
function ComoActivarla() {
  return (
    <div role="note" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
      <p className="font-medium">La IA está apagada: falta la clave de Anthropic (ANTHROPIC_API_KEY).</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5">
        <li>
          Consigue una clave en{' '}
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="underline">
            console.anthropic.com/settings/keys
          </a>
          . Se paga por uso: cada pregunta cuesta céntimos y aquí se enseña el coste antes de enviarla.
        </li>
        <li>
          Abre el archivo <code>.env</code> de la carpeta del proyecto (si no existe, copia <code>.env.example</code>) y
          pon la clave detrás de <code>ANTHROPIC_API_KEY=</code>. Es tuya: no la pegues en ningún chat ni la subas a git
          (<code>.env</code> ya está fuera del repositorio).
        </li>
        <li>
          Reinicia la app con <code>./start.sh</code>.
        </li>
      </ol>
      <p className="mt-1">El resto de Inicio funciona igual sin ella.</p>
    </div>
  )
}

/** Lo calculado que la IA recibe (o recibirá), con su fuente y su fecha. Fuera del bloque violeta. */
function DatosDelContexto({
  titulo,
  datos,
  ausentes,
}: {
  titulo: string
  datos: DatoContextoIA[]
  ausentes: DatoAusenteIA[]
}) {
  return (
    <div data-contenido="calculado" className="space-y-1 text-xs text-slate-600">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
      <ul className="space-y-1">
        {datos.map((d) => (
          <li key={d.clave}>
            <span className="font-medium text-slate-700">{d.titulo}</span>
            {' · '}
            {d.fuente}
            {' · '}
            {d.fecha ? fmtFecha(d.fecha, { hora: true, zona: ZONA_MERCADO }) : 'sin fecha: son reglas de la app'}
            {d.estado === 'viejo' && (
              <span className="ml-1 rounded bg-amber-100 px-1 font-medium text-amber-900">
                {etiqueta('viejo', { mayuscula: true })}, {fmtAntiguedad(d.fecha)}
              </span>
            )}
            {d.nota && <span className="block text-[11px] text-slate-500">{d.nota}</span>}
          </li>
        ))}
      </ul>
      {ausentes.length > 0 && (
        <>
          <h3 className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Lo que la app no tenía calculado (la IA no lo vio)
          </h3>
          <ul className="space-y-1">
            {ausentes.map((a) => (
              <li key={a.clave}>
                <span className="font-medium text-slate-700">{a.titulo}</span>: {a.motivo}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function costeDeLaRespuesta(r: RespuestaPreguntaIA): string {
  if (r.cached) return 'desde caché (sin coste nuevo)'
  return r.coste.usd !== null ? `coste ${fmtDinero(r.coste.usd, 'USD', 3)}` : 'coste desconocido'
}

export function PreguntaIA({ mercado, simbolo }: { mercado?: string; simbolo?: string }) {
  const { status, error: errorEstado, reintentar } = useLlmEstado()
  const idTitulo = useId()
  const idCampo = useId()
  const idAyuda = useId()
  const [pregunta, setPregunta] = useState('')
  const [estimacion, setEstimacion] = useState<CostePreguntaIA | null>(null)
  const [errorCoste, setErrorCoste] = useState<string | null>(null)
  const [respuesta, setRespuesta] = useState<RespuestaPreguntaIA | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // El backend sin clave (un 503) aunque el estado dijera lo contrario: se
  // reinició sin `.env`, por ejemplo. Se explica igual que con la IA apagada.
  const [sinClave, setSinClave] = useState(false)

  const encendida = status?.configured === true && !sinClave
  const apagada = (status !== null && !status.configured) || sinClave
  const max = estimacion?.max_caracteres ?? MAX_POR_DEFECTO
  const larga = pregunta.trim().length > max

  // El coste antes de enviar: cuenta los tokens del contexto (sin generar nada,
  // sin gasto) en cuanto se sabe que la IA está encendida. Las sugerencias
  // envían al tocarlas, así que el coste tiene que estar a la vista antes.
  useEffect(() => {
    if (!encendida) return
    let vivo = true
    setEstimacion(null)
    setErrorCoste(null)
    api.costePreguntaIA({ mercado, simbolo }).then(
      (c) => {
        if (vivo) setEstimacion(c)
      },
      (e: unknown) => {
        if (!vivo) return
        if (e instanceof ApiError && e.status === 503) setSinClave(true)
        else setErrorCoste(mensajeDeError(e))
      },
    )
    return () => {
      vivo = false
    }
  }, [encendida, mercado, simbolo])

  const enviar = (texto: string) => {
    const limpia = texto.trim()
    if (!limpia || limpia.length > max || enviando) return
    setEnviando(true)
    setError(null)
    setRespuesta(null)
    api
      .preguntarIA({ pregunta: limpia, mercado, simbolo })
      .then(setRespuesta, (e: unknown) => {
        if (e instanceof ApiError && e.status === 503) setSinClave(true)
        else setError(mensajeDeError(e))
      })
      .finally(() => setEnviando(false))
  }

  return (
    <section aria-labelledby={idTitulo} className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 id={idTitulo} className="text-sm font-semibold text-slate-800">
        Pregúntale a la IA
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        Contesta con lo que la app ya calculó (la lista del día, tu cartera y el mercado) y nada más. La respuesta la
        escribe una IA: sale aparte, con su etiqueta, y no es una recomendación.
      </p>

      {apagada ? (
        <ComoActivarla />
      ) : !encendida ? (
        <p className="mt-3 text-xs text-slate-500">
          {errorEstado ? (
            <>
              No se pudo comprobar si la IA está encendida ({errorEstado}): mientras tanto no se ofrece.{' '}
              <button type="button" onClick={reintentar} className="min-h-11 px-2 font-medium text-sky-700 underline">
                Reintentar
              </button>
            </>
          ) : (
            'Comprobando si la IA está encendida…'
          )}
        </p>
      ) : (
        <>
          {/* Cada sugerencia envía al tocarla, y gasta: el botón de la IA, con su violeta. */}
          <div role="group" aria-label="Preguntas sugeridas" className="mt-3 flex flex-wrap gap-2">
            {SUGERENCIAS.map((s) => (
              <BotonIA
                key={s}
                disabled={enviando}
                onClick={() => {
                  setPregunta(s)
                  enviar(s)
                }}
                className="min-h-11"
              >
                {s}
              </BotonIA>
            ))}
          </div>

          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              enviar(pregunta)
            }}
          >
            <label htmlFor={idCampo} className="block text-xs font-medium text-slate-700">
              Tu pregunta
            </label>
            <textarea
              id={idCampo}
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              maxLength={max}
              rows={3}
              aria-describedby={idAyuda}
              aria-invalid={larga || undefined}
              placeholder="Por ejemplo: ¿por qué la app dice «Vigilar» y no «Comprar»?"
              className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none"
            />
            <p id={idAyuda} className={`text-[11px] ${larga ? 'font-medium text-red-700' : 'text-slate-500'}`}>
              {fmtNum(pregunta.trim().length, 0)} de {fmtNum(max, 0)} caracteres
              {larga ? ': acórtala para poder enviarla.' : '.'}
            </p>
            <BotonIA type="submit" disabled={enviando || !pregunta.trim() || larga} className="min-h-11 min-w-11">
              {enviando ? 'Preguntando…' : 'Preguntar'}
            </BotonIA>
            {/* El coste a la vista, debajo del botón y no detrás de la lista de datos:
                a 390 px, con la lista delante, «Preguntar» quedaba a dos pantallas. */}
            <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-500">
              <p className="font-medium text-slate-700">
                Antes de enviar:{' '}
                {estimacion
                  ? estimacion.coste.usd_estimado !== null
                    ? `coste estimado por pregunta ${fmtDinero(estimacion.coste.usd_estimado, 'USD', 3)}`
                    : 'el coste no se puede estimar'
                  : errorCoste
                    ? 'no se pudo estimar el coste'
                    : 'calculando el coste…'}
              </p>
              {estimacion && <p>{estimacion.coste.nota}</p>}
              {errorCoste && <p>{errorCoste}. Puedes preguntar igual: el coste real sale con la respuesta.</p>}
              {estimacion && (
                <details>
                  <summary className="min-h-11 cursor-pointer py-3 font-medium text-sky-700">
                    Qué datos de la app se le pasarán ({fmtNum(estimacion.datos_usados.length, 0)})
                  </summary>
                  <DatosDelContexto
                    titulo="Lo que se le pasará a la IA"
                    datos={estimacion.datos_usados}
                    ausentes={estimacion.datos_ausentes}
                  />
                </details>
              )}
            </div>
          </form>
        </>
      )}

      <div aria-live="polite" aria-busy={enviando} className="mt-3 space-y-3">
        {enviando && <p className="text-xs text-slate-500">Preguntando a la IA con los datos de la app…</p>}
        {error && <p className="text-xs text-red-700">No se pudo preguntar a la IA: {error}</p>}
        {respuesta && (
          <>
            <p className="text-xs text-slate-500">Tu pregunta: «{respuesta.pregunta}»</p>
            <BloqueIA modelo={respuesta.model} nota={costeDeLaRespuesta(respuesta)} aviso={respuesta.aviso}>
              {respuesta.content_md}
            </BloqueIA>
            <p className="text-[11px] text-slate-500">{respuesta.coste.nota}</p>
            <DatosDelContexto
              titulo="Datos de la app que recibió la IA (calculados por la app, no por la IA)"
              datos={respuesta.datos_usados}
              ausentes={respuesta.datos_ausentes}
            />
          </>
        )}
      </div>
    </section>
  )
}
