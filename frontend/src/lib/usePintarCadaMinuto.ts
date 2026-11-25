import { useEffect, useReducer } from 'react'

/** Vuelve a pintar el componente cada minuto mientras `activo`: una edad que se
 *  enseña («hace 5 min») se calcula al pintar, y sin esto se quedaba en la de
 *  cuando llegó el dato.
 *
 *  Vivía dentro de `ProgresoAnalisis` y solo lo usaba su línea de la copia
 *  caducada: la cabecera de Explorar («Calculado hace 5 min») y el precio de
 *  cada stop («cotización de finnhub, hace 3 min») solo se repintaban cuando
 *  cambiaba la vista de la lista, y tres horas después seguían diciendo lo de
 *  entonces; con la copia caducada, la cabecera decía «hace 9 h» y la línea de
 *  progreso de la misma pantalla «hace 10 h» (revisión 15, H2). Va en el
 *  componente pequeño que pinta la edad, no en la página entera. */
export function usePintarCadaMinuto(activo = true): void {
  const [, pintar] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!activo) return
    const id = setInterval(pintar, 60_000)
    return () => clearInterval(id)
  }, [activo])
}
