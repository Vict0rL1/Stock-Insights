import { api } from '../../api/client'
import { useDato } from '../../lib/useDato'
import { ListaDeSeguimiento } from './ListaDeSeguimiento'
import { MisTesis } from './Tesis'
import { AvisosDeTesis, DiarioDeDecisiones, PuntosDeVigilancia } from './Vigilancia'

/** La pestaña Tesis y vigilancia de Mi cartera: lo que eran las pantallas Tesis
 *  y Vigilancia, y la lista de seguimiento del Portafolio (fase 3, 3.2).
 *
 *  Las cargas que comparten las secciones viven aquí, una vez: las tesis (la
 *  lista y el selector del diario), la vigilancia (los avisos y los puntos), las
 *  posiciones sin tesis y las decisiones. En dos pantallas, cada una pedía las
 *  tesis por su cuenta; juntas se pedirían dos veces. Y lo que cambia una
 *  sección lo ve la otra: una tesis nueva sale en los puntos de vigilancia sin
 *  salir de la pestaña. Tras cualquier acción se refresca todo sin vaciarlo:
 *  con una clave por versión, «Decisiones pasadas» y el aviso pasaban por
 *  «Cargando» y el selector de tesis se quedaba sin opciones (revisión del 2.1). */
export function TesisYVigilancia() {
  const tesis = useDato(() => api.theses().then((d) => d.theses), 'tesis')
  const vigilancia = useDato(() => api.vigilancia(), 'vigilancia')
  const sin = useDato(() => api.sinTesis(), 'sin-tesis')
  const dec = useDato(() => api.decisiones(), 'decisiones')
  const refrescar = () => {
    tesis.refrescar()
    vigilancia.refrescar()
    sin.refrescar()
    dec.refrescar()
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3 empty:hidden">
        <AvisosDeTesis vigilancia={vigilancia.datos} sin={sin} />
      </div>
      <MisTesis tesis={tesis} alCambiar={refrescar} />
      <PuntosDeVigilancia vigilancia={vigilancia} alCambiar={refrescar} />
      <DiarioDeDecisiones tesis={tesis} dec={dec} alCambiar={refrescar} />
      <ListaDeSeguimiento alCambiar={refrescar} />
    </div>
  )
}
