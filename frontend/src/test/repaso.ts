/**
 * El repaso de la cartera (`Portfolio.repaso`, el de Explorar) para los tests que
 * cambian las posiciones de una respuesta real: con la forma que sirve
 * `contexto_cartera.stops_de_la_cartera`. Cambiar las filas de los lotes sin
 * cambiar el repaso ya no cambia lo que se cuenta: la línea de Mi cartera e
 * Inicio leen el repaso, por símbolo (revisión 14).
 */
import type { DailySignal, Decision, RepasoDeCartera, StopDePosicion } from '../api/types'

export function posicionDelRepaso(p: Partial<StopDePosicion> & { symbol: string }): StopDePosicion {
  const precio = p.precio === undefined ? 60 : p.precio
  return {
    en_lista: false,
    precio,
    precio_estado: precio === null ? 'desconocido' : 'valido',
    precio_fuente: precio === null ? null : 'cotizacion',
    precio_proveedor: precio === null ? null : 'finnhub',
    precio_fecha: precio === null ? null : '2026-09-12T14:35:00+00:00',
    precios:
      precio === null
        ? []
        : [{ precio, fuente: 'cotizacion', estado: 'valido', proveedor: 'finnhub', fecha: '2026-09-12T14:35:00+00:00' }],
    moneda: 'USD',
    stop: 50,
    stop_fijado_al_abrir: true,
    stop_por_clase: false,
    lotes: 1,
    lotes_recalculados: 0,
    lotes_por_clase: 0,
    lotes_sin_stop: 0,
    estado: 'por_encima',
    motivo: null,
    ...p,
  }
}

const ORDEN = { perforado: 0, sin_comprobar: 1, por_encima: 2 } as const

export function repasoDe(
  posiciones: StopDePosicion[],
  {
    senales = [],
    lista = { mercado: 'us_sp500', as_of: '2026-09-12T14:00:00+00:00', estado: 'valido', antiguedad_segundos: null },
  }: { senales?: DailySignal[]; lista?: RepasoDeCartera['lista'] } = {},
): RepasoDeCartera {
  const ordenadas = [...posiciones].sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado] || a.symbol.localeCompare(b.symbol))
  return {
    abiertas: ordenadas.length,
    en_lista: ordenadas.filter((p) => p.en_lista).length,
    posiciones: ordenadas,
    senales,
    lista,
  }
}

/** La fila de la lista de una posición, con la decisión de posición que trae. */
export function senalDePosicion(symbol: string, decision: Partial<Decision>, precio = 60): DailySignal {
  return {
    symbol,
    price: { last: precio },
    decision: { label: '', reasons: [], levels: null, escenarios: null, triggers: [], confidence: 'sin_calibrar', owned: true, ...decision },
  } as unknown as DailySignal
}
