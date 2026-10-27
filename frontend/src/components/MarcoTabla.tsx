import type { ReactNode } from 'react'

/**
 * El marco con desplazamiento horizontal de una tabla (ítem 2.12): en móvil la
 * tabla se desplaza dentro de él en vez de apretarse o empujar la página. Es la
 * única forma de hacerlo; `className` solo añade márgenes (y, si acaso, el radio).
 *
 * Enfocable y con nombre: en Safari un contenedor con scroll no recibe el foco,
 * y con teclado las columnas que quedaban fuera (los otros ETF, los ejercicios
 * antiguos) no se alcanzaban (revisión del 2.12, WCAG 2.1.1).
 *
 * El anillo de foco es una capa hermana, por dentro y por encima de todo. Como
 * contorno del marco, por fuera lo recortaba el `overflow-hidden` de la sección
 * del ranking multifactor (revisión 3), y por dentro lo tapaban las celdas de la
 * columna fija (`COLUMNA_FIJA`, `sticky z-10 bg-white`), que se pintan después:
 * en los fundamentales, el comparador de ETFs y la matriz de correlaciones
 * faltaba todo el lado izquierdo (revisión 4). `isolate` deja su `z-20` dentro
 * del marco: no se pinta sobre la cabecera de la página al desplazarla.
 */
export function MarcoTabla({
  etiqueta,
  className = '',
  children,
}: {
  etiqueta: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`relative isolate rounded ${className}`.trim()}>
      <div
        className="peer overflow-x-auto rounded-[inherit] focus-visible:outline-none"
        tabIndex={0}
        role="region"
        aria-label={etiqueta}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 hidden rounded-[inherit] ring-2 ring-inset ring-sky-500 peer-focus-visible:block"
      />
    </div>
  )
}
