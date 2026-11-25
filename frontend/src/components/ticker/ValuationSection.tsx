import { Link } from 'react-router-dom'
import { api, faltaUnDato } from '../../api/client'
import type { Valoracion } from '../../api/types'
import { ausenteSi404, useDato } from '../../lib/useDato'
import { BloqueDatos } from '../EstadoDato'
import { ResumenDcf } from '../valoracion/ResumenDcf'
import { rutaValoracion } from '../valoracion/ruta'

/** El filing no trae un dato sin el que no hay valor por acción (deuda neta, FCF
 *  o acciones): el backend responde 422 con cuál falta y cómo arreglarlo. No es
 *  un fallo, «Reintentar» no lo arreglaría: se dice, y se lleva al módulo, donde
 *  se puede escribir. */
class FaltaUnDato {
  constructor(readonly motivo: string) {}
}

function faltaSi422(peticion: Promise<Valoracion>): Promise<Valoracion | FaltaUnDato> {
  return peticion.catch((e: unknown) => {
    if (faltaUnDato(e)) return new FaltaUnDato(e.message)
    throw e
  })
}

/** La pestaña Valoración de la ficha: un resumen del único DCF (ítem 3.3).
 *
 *  Antes era un DCF propio contra `/api/stocks/{s}/valuation/dcf`, con supuestos
 *  escritos aquí (WACC 11/10/9 %, crecimiento ±3 puntos) distintos de los del
 *  módulo Valoración y un valor por escenario: la misma empresa tenía dos
 *  valoraciones según la pantalla. Ahora es la respuesta del módulo, sin
 *  supuestos propios, y para cambiarlos se abre el módulo con la empresa. */
export function ValuationSection({ symbol }: { symbol: string }) {
  // Un 404 es que la SEC no tiene sus estados (empresa extranjera o ETF):
  // ausencia, sin «Reintentar». Al cambiar de símbolo vuelve a «cargando».
  const carga = useDato(() => ausenteSi404(faltaSi422(api.valorar(symbol))), symbol)
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">¿Cuánto podría valer?</h2>
      <BloqueDatos carga={carga} que="la valoración" ausente={(m) => `Sin valoración: ${m}`}>
        {(datos) =>
          datos instanceof FaltaUnDato ? (
            <div className="space-y-3">
              <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{datos.motivo}</p>
              <Link
                to={rutaValoracion(symbol)}
                className="inline-block rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                Abrir el análisis completo
              </Link>
            </div>
          ) : (
            <ResumenDcf datos={datos} symbol={symbol} />
          )
        }
      </BloqueDatos>
    </section>
  )
}
