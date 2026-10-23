import type { ReactNode } from 'react'

/**
 * El marco con desplazamiento horizontal de una tabla (ítem 2.12): en móvil la
 * tabla se desplaza dentro de él en vez de apretarse o empujar la página. Es la
 * única forma de hacerlo; `className` solo añade márgenes.
 *
 * Enfocable y con nombre: en Safari un contenedor con scroll no recibe el foco,
 * y con teclado las columnas que quedaban fuera (los otros ETF, los ejercicios
 * antiguos) no se alcanzaban (revisión del 2.12, WCAG 2.1.1).
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
    <div
      className={`overflow-x-auto rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${className}`.trim()}
      tabIndex={0}
      role="region"
      aria-label={etiqueta}
    >
      {children}
    </div>
  )
}
