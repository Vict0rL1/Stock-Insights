/**
 * Las pestañas de la ficha de una empresa: de once a cuatro, más «Más detalle»
 * (docs/PLAN_NAVEGACION.md, «Ficha de empresa: de 11 pestañas a 4»).
 *
 * Ninguna sección se pierde: cada una de las once está dentro de una pestaña
 * nueva (Números junta tres, Novedades otras tres) o en «Más detalle». La URL
 * dice dónde se está (`?pestana=`), y acepta los identificadores nuevos y los
 * viejos, porque las rutas de antes redirigen aquí con el suyo.
 */

export type PestanaFicha = 'resumen' | 'numeros' | 'valoracion' | 'novedades' | 'detalle'

export type SeccionFicha =
  | 'fundamentales'
  | 'salud'
  | 'calidad'
  | 'cambios'
  | 'expectativas'
  | 'filings'
  | 'informe'
  | 'opciones'
  | 'historial'

/** Qué se ve: una pestaña y, en las que juntan varias secciones, cuál. */
export interface VistaFicha {
  pestana: PestanaFicha
  seccion: SeccionFicha | null
}

export const PESTANAS: { id: Exclude<PestanaFicha, 'detalle'>; nombre: string }[] = [
  { id: 'resumen', nombre: 'Resumen' },
  { id: 'numeros', nombre: 'Números' },
  { id: 'valoracion', nombre: 'Valoración' },
  { id: 'novedades', nombre: 'Novedades' },
]

export const NOMBRE_MAS_DETALLE = 'Más detalle (avanzado)'

/** Las secciones de cada pestaña que junta varias, con el nombre que tenían. */
export const SECCIONES: Record<'numeros' | 'novedades' | 'detalle', { id: SeccionFicha; nombre: string; resumen: string }[]> = {
  numeros: [
    { id: 'fundamentales', nombre: 'Fundamentales', resumen: 'ventas, márgenes, deuda y caja de cada año' },
    { id: 'salud', nombre: 'Salud y riesgo', resumen: 'si podría tener problemas para pagar y cuánto se mueve su precio' },
    { id: 'calidad', nombre: 'Calidad de beneficios', resumen: 'si lo que gana se convierte en dinero en caja' },
  ],
  novedades: [
    { id: 'cambios', nombre: 'Qué cambió', resumen: 'qué ha cambiado desde el último análisis guardado' },
    { id: 'expectativas', nombre: 'Resultados vs expectativas', resumen: 'los últimos resultados frente a lo que se esperaba' },
    { id: 'filings', nombre: 'Filings', resumen: 'los documentos presentados ante la SEC' },
  ],
  detalle: [
    { id: 'informe', nombre: 'Informe completo', resumen: 'el informe de analista entero, con su lectura conjunta' },
    { id: 'opciones', nombre: 'Opciones', resumen: 'lo que dice el mercado de opciones sobre esta acción' },
    { id: 'historial', nombre: 'Decisiones y replay', resumen: 'lo que la app dijo antes y cómo lo reconstruye' },
  ],
}

/** La sección que se abre al entrar en cada pestaña. «Más detalle» no abre
 *  ninguna: cada una cuesta su carga y allí se elige. */
const POR_DEFECTO: Record<PestanaFicha, SeccionFicha | null> = {
  resumen: null,
  numeros: 'fundamentales',
  valoracion: null,
  novedades: 'cambios',
  detalle: null,
}

/** Las once pestañas de antes y dónde está ahora cada una. Para el integrador:
 *  `/ticker/:symbol?pestana=<vieja>` lleva aquí con la suya, y esta página la
 *  entiende tal cual (`leerPestana`). */
export const PESTANAS_VIEJAS: Record<string, VistaFicha> = {
  resumen: { pestana: 'resumen', seccion: null },
  informe: { pestana: 'detalle', seccion: 'informe' },
  fundamentales: { pestana: 'numeros', seccion: 'fundamentales' },
  valoracion: { pestana: 'valoracion', seccion: null },
  opciones: { pestana: 'detalle', seccion: 'opciones' },
  salud: { pestana: 'numeros', seccion: 'salud' },
  filings: { pestana: 'novedades', seccion: 'filings' },
  cambios: { pestana: 'novedades', seccion: 'cambios' },
  expectativas: { pestana: 'novedades', seccion: 'expectativas' },
  calidad: { pestana: 'numeros', seccion: 'calidad' },
  historial: { pestana: 'detalle', seccion: 'historial' },
}

const PESTANA_DE: Record<SeccionFicha, PestanaFicha> = Object.fromEntries(
  (Object.entries(SECCIONES) as [PestanaFicha, { id: SeccionFicha }[]][]).flatMap(([p, ss]) => ss.map((s) => [s.id, p])),
) as Record<SeccionFicha, PestanaFicha>

const esPestana = (v: string): v is PestanaFicha => Object.hasOwn(POR_DEFECTO, v)
const esSeccion = (v: string): v is SeccionFicha => Object.hasOwn(PESTANA_DE, v)

/** Lo que pide `?pestana=`: una pestaña nueva, una sección o una pestaña vieja.
 *  Lo que no se reconoce abre el Resumen. */
export function leerPestana(valor: string | null | undefined): VistaFicha {
  const v = (valor ?? '').trim().toLowerCase()
  if (Object.hasOwn(PESTANAS_VIEJAS, v)) return PESTANAS_VIEJAS[v]
  if (esPestana(v)) return { pestana: v, seccion: POR_DEFECTO[v] }
  if (esSeccion(v)) return { pestana: PESTANA_DE[v], seccion: v }
  return { pestana: 'resumen', seccion: null }
}

/** Cómo se escribe una vista en `?pestana=`: la sección si no es la de por
 *  defecto, si no la pestaña; el Resumen, sin parámetro. */
export function parametroDe(vista: VistaFicha): string | null {
  if (vista.pestana === 'resumen') return null
  return vista.seccion && vista.seccion !== POR_DEFECTO[vista.pestana] ? vista.seccion : vista.pestana
}

/** El `?pestana=` nuevo que corresponde a uno viejo (o a cualquiera que esta
 *  página entienda); `null` para el Resumen. */
export const pestanaNueva = (vieja: string | null | undefined): string | null => parametroDe(leerPestana(vieja))

/** La vista al entrar en una pestaña. */
export const vistaDe = (pestana: PestanaFicha): VistaFicha => ({ pestana, seccion: POR_DEFECTO[pestana] })
