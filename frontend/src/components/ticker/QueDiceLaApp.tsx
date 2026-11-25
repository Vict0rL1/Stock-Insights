/**
 * «Qué dice la app», arriba de la ficha: la acción, una frase en lenguaje
 * claro, la confianza y qué se puede hacer (docs/PLAN_NAVEGACION.md).
 *
 * Es el ÚNICO sitio de la ficha que pinta el aviso de la acción: cuando exista
 * `components/AvisoDeAccion.tsx` (los avisos de compra y venta comunes a todas
 * las pantallas), sustituye a `AccionYFrase` aquí y en ningún otro sitio.
 *
 * La frase sale de la traza del motor (`lib/queDiceLaApp.ts`); la traza
 * completa está en la pestaña Resumen, en «Lo que comprueba la app».
 */
import { useId } from 'react'
import { Link } from 'react-router-dom'
import type { AnalisisEmpresa, AnalisisEmpresaResponse, RepasoDeCartera } from '../../api/types'
import { avisoDe, carteraRepasada, tamanoDelCosteDeOportunidad } from '../../lib/avisos'
import { etiqueta } from '../../lib/etiquetas'
import { fmtPrecio } from '../../lib/formato'
import { rutaCartera } from '../../lib/rutas'
import { useLlmStatus } from '../../lib/llm'
import { fraseDeConfianza, fraseDeLaApp } from '../../lib/queDiceLaApp'
import type { CargaConReintento } from '../../lib/useDato'
import { AvisoDeAccion } from '../AvisoDeAccion'
import { BloqueDatos } from '../EstadoDato'
import { BotonIA } from '../ia/ContenidoIA'
import { ConTerminos, Termino } from '../Termino'
import { FactoresDeConfianza, NIVEL } from './QueCambioSection'

/** El aviso de la ficha, con lo mismo que su tarjeta en Inicio y Explorar:
 *
 *  - si la tienes, el repaso del stop de su posición (`repaso`, el de Inicio y Mi
 *    cartera: el stop de CADA lote, con la cotización y el cierre de la lista).
 *    La decisión del análisis llevaba el stop agregado (el más alto de los
 *    fijados): con un lote viejo sin stop y coste 130, Inicio decía «KO bajó de
 *    tu límite de pérdida», su «Revisar» traía aquí y aquí se leía «Mantener… ni
 *    ha llegado a tu stop» con el mismo precio (revisión 15, costuras H1). El
 *    motor ya agrega el de cada lote; si aun así discrepan, manda el repaso;
 *  - si es una idea, su tamaño del coste de oportunidad de la misma respuesta:
 *    con 0 % y «No cabe», «Sin sitio», como la tarjeta de la que viene «Ver por
 *    qué →»; decía «Comprar» en verde (revisión 15, costuras H4).
 *
 *  `frase`: la del aviso cuando el repaso contradice a la traza (el stop
 *  perforado o sin comprobar con una decisión que no es vender); si no, la de la
 *  traza (`fraseDeLaApp`). */
export function avisoDeLaFicha(a: AnalisisEmpresa, repaso: RepasoDeCartera | undefined, moneda: string | null) {
  const d = a.decision
  const stop = carteraRepasada(repaso) ? (repaso.posiciones.find((p) => p.symbol === a.symbol) ?? null) : null
  const aviso = avisoDe({ decision: d, stop, tamano: tamanoDelCosteDeOportunidad(a.coste_oportunidad), moneda })
  if (stop === null || stop.estado === 'por_encima' || d.action === 'vender') {
    return { aviso, frase: fraseDeLaApp(d, { moneda }) }
  }
  const otroStop = d.levels?.stop
  const nota =
    typeof otroStop === 'number' && otroStop !== stop.stop
      ? `«Lo que comprueba la app» mira otro stop (${fmtPrecio(otroStop, moneda)}); este aviso mira el de cada lote, como Inicio y Mi cartera.`
      : null
  return { aviso, frase: [aviso.frase, ...aviso.pasos, nota].filter(Boolean).join(' ') }
}

function AccionYFrase({ a, repaso, moneda }: { a: AnalisisEmpresa; repaso: RepasoDeCartera | undefined; moneda: string | null }) {
  const { aviso, frase } = avisoDeLaFicha(a, repaso, moneda)
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* El mismo verbo, icono y color que en Inicio y Explorar (`AvisoDeAccion`):
            la ficha tenía su propia paleta de acciones copiada de Hoy. */}
        <AvisoDeAccion aviso={aviso} tamano="compacto" conFrase={false} />
        <span className={`rounded-md px-2 py-1 text-xs font-medium ${NIVEL[a.confianza.nivel] ?? ''}`}>
          <Termino clave="confianza">Confianza</Termino> {a.confianza.nivel}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-800 sm:text-base">
        <ConTerminos texto={frase} />
      </p>
    </>
  )
}

export function QueDiceLaApp({
  carga,
  moneda,
  alExplicar,
}: {
  carga: CargaConReintento<AnalisisEmpresaResponse>
  /** La de la cotización, por si el análisis no la trae. */
  moneda: string | null
  /** «Explícamelo con IA»: abre el informe completo y lo redacta con IA. */
  alExplicar: () => void
}) {
  const titulo = useId()
  const llm = useLlmStatus()
  return (
    <section aria-labelledby={titulo} className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 id={titulo} className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Qué dice la app
      </h2>
      <BloqueDatos carga={carga} que="lo que dice la app">
        {({ analisis: a, repaso }) => (
          <>
            <AccionYFrase a={a} repaso={repaso} moneda={a.mercado.precio.moneda ?? moneda} />
            {/* Un sistema probado y perdedor no avisa en gris: es lo más valioso
                que la app puede decir (como en Hoy). */}
            {a.decision.confidence === 'refutada' && (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs leading-snug text-red-700">
                <strong>Estas reglas se probaron con el histórico y perdieron dinero</strong> (o ganaron menos que comprar
                a ciegas): lo de arriba es lo que dictan, no una recomendación.
              </p>
            )}
            {a.faltan.length > 0 && (
              <p className="mt-2 text-xs text-amber-800">
                Datos que faltan (no cuentan como cero): {a.faltan.map((f) => etiqueta(f.dato)).join(', ')}.
              </p>
            )}
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-slate-600">
                Por qué la confianza es {a.confianza.nivel}: {fraseDeConfianza(a.confianza)}
              </summary>
              <FactoresDeConfianza confianza={a.confianza} />
              <p className="mt-1 text-[10px] text-slate-400">{a.confianza.nota}</p>
            </details>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* Solo con la IA encendida (la maqueta): apagada, el botón no lleva a nada. */}
              {llm?.configured && (
                <BotonIA onClick={alExplicar} className="px-3 py-2 text-sm">
                  Explícamelo con IA
                </BotonIA>
              )}
              <Link
                to={rutaCartera()}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Anotar una compra
              </Link>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-slate-400">
              Sale de reglas escritas aplicadas a los datos de hoy: no es una predicción ni la escribe la IA.
              {llm?.configured ? ' «Explícamelo con IA» redacta el informe completo con IA (gasta API).' : ''}
            </p>
          </>
        )}
      </BloqueDatos>
    </section>
  )
}
