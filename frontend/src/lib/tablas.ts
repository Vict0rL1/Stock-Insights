/**
 * Las tablas pequeñas de las fichas y la cartera en móvil (ítem 2.12).
 *
 * A 390 px una tabla `w-full` sin relleno se apretaba hasta juntar columnas
 * («SesgoCerca», «-24,3 %25 %», «CARTERACOBERTURA») o partir cada celda casi
 * palabra a palabra («análisis / de las / 14:35 / UTC»). Con estas clases la
 * tabla no parte sus celdas, separa las columnas y, dentro de `<MarcoTabla>`
 * (components/MarcoTabla.tsx), se desplaza en su marco en vez de apretarse o
 * empujar la página.
 */
export const TABLA_COMPACTA =
  'w-full whitespace-nowrap [&_td]:pl-3 [&_td:first-child]:pl-0 [&_th]:pl-3 [&_th:first-child]:pl-0'

/** La primera columna (el rótulo de cada fila) queda fija al desplazar: en el
 *  comparador de ETFs y en los fundamentales a 390 px solo se veía el rótulo y
 *  las cifras quedaban fuera sin ninguna pista de que hubiera más. */
export const COLUMNA_FIJA = 'sticky left-0 z-10 bg-white'
