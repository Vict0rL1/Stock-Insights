/**
 * Las rutas de la app, en un solo sitio (rediseño de la navegación,
 * `docs/PLAN_NAVEGACION.md`).
 *
 * Había 15 entradas de menú y cada pantalla escribía sus enlaces a mano
 * («/ticker/${s}», «/screener»…): al renombrar una ruta quedaban enlaces
 * apuntando a la vieja. Ahora las pantallas piden la ruta aquí y las rutas
 * viejas redirigen (`REDIRECCIONES`), así que un enlace olvidado sigue llevando
 * a su sitio.
 */

export const RUTAS = {
  inicio: '/',
  explorar: '/explorar',
  empresa: '/empresa',
  cartera: '/cartera',
  avanzado: '/avanzado',
  mercado: '/avanzado/mercado',
  senales: '/avanzado/senales',
  valoracion: '/avanzado/valoracion',
  resultados: '/avanzado/resultados',
  noticias: '/avanzado/noticias',
} as const

/** La ficha de una empresa o un ETF. El símbolo va codificado: «BRK.B» y
 *  «SHOP.TO» llevan punto, y uno escrito a mano puede traer cualquier cosa. */
export function rutaEmpresa(simbolo: string): string {
  return `${RUTAS.empresa}/${encodeURIComponent(simbolo.trim().toUpperCase())}`
}

/** Las vistas de Explorar: acciones (la lista del día) o ETFs, y los filtros
 *  propios (los que antes eran Screener y Multifactor) abiertos. */
export type VistaExplorar = 'acciones' | 'etfs'
export type FiltrosExplorar = 'simples' | 'factores'

export function rutaExplorar(opciones: { tipo?: VistaExplorar; filtros?: FiltrosExplorar } = {}): string {
  const q = new URLSearchParams()
  if (opciones.tipo && opciones.tipo !== 'acciones') q.set('tipo', opciones.tipo)
  if (opciones.filtros) q.set('filtros', opciones.filtros)
  const s = q.toString()
  return s ? `${RUTAS.explorar}?${s}` : RUTAS.explorar
}

export type PestanaCartera = 'posiciones' | 'riesgo' | 'tesis'

export function rutaCartera(pestana?: PestanaCartera): string {
  return pestana && pestana !== 'posiciones' ? `${RUTAS.cartera}?pestana=${pestana}` : RUTAS.cartera
}

/**
 * Ruta vieja → ruta nueva. La consulta de la vieja se conserva y se le suman
 * los parámetros de la nueva (`/valoracion?symbol=X` → `/avanzado/valoracion?symbol=X`).
 * `/ticker/:symbol` no está aquí porque lleva parámetro: la redirige `App`.
 */
export const REDIRECCIONES: Record<string, string> = {
  '/hoy': RUTAS.inicio,
  '/dashboard': RUTAS.mercado,
  '/ticker': RUTAS.explorar,
  '/screener': rutaExplorar({ filtros: 'simples' }),
  '/multifactor': rutaExplorar({ filtros: 'factores' }),
  '/etfs': rutaExplorar({ tipo: 'etfs' }),
  '/portafolio': RUTAS.cartera,
  '/tesis': rutaCartera('tesis'),
  '/vigilancia': rutaCartera('tesis'),
  '/senales': RUTAS.senales,
  '/valoracion': RUTAS.valoracion,
  '/resultados': RUTAS.resultados,
  '/noticias': RUTAS.noticias,
}

/** Junta la consulta de la ruta vieja con la de la nueva (la nueva manda). */
export function destinoConConsulta(destino: string, consultaVieja: string): string {
  const [ruta, consultaNueva = ''] = destino.split('?')
  const q = new URLSearchParams(consultaVieja)
  new URLSearchParams(consultaNueva).forEach((v, k) => q.set(k, v))
  const s = q.toString()
  return s ? `${ruta}?${s}` : ruta
}
