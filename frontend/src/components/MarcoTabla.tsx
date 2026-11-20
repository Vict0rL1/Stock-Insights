import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'

/** Lo que queda fuera de la vista a cada lado de un marco con desplazamiento
 *  horizontal. `desde` y `hasta` son los anchos de las columnas fijas a la
 *  izquierda y a la derecha (`COLUMNA_FIJA`, `COLUMNA_FIJA_DERECHA`): lo oculto
 *  pasa POR DEBAJO de ellas, así que el fundido empieza en su borde y no las
 *  toca. `barra` es el alto de la barra de desplazamiento, que no se funde. */
export type Ocultos = { izquierda: boolean; derecha: boolean; desde: number; hasta: number; barra: number }

const NADA_OCULTO: Ocultos = { izquierda: false, derecha: false, desde: 0, hasta: 0, barra: 0 }

function anchoSiFija(celda: Element | null | undefined): number {
  return celda instanceof HTMLElement && getComputedStyle(celda).position === 'sticky' ? celda.offsetWidth : 0
}

export function medirOcultos(el: HTMLElement): Ocultos {
  // Con un píxel de margen: con zoom, `scrollLeft` es fraccionario y al final del
  // recorrido se queda a décimas del máximo; la señal derecha no se apagaba nunca.
  const sobra = el.scrollWidth - el.clientWidth
  const fila = el.querySelector('tr')
  return {
    izquierda: el.scrollLeft > 1,
    derecha: el.scrollLeft < sobra - 1,
    desde: anchoSiFija(fila?.firstElementChild),
    hasta: anchoSiFija(fila?.lastElementChild),
    barra: Math.max(0, el.offsetHeight - el.clientHeight),
  }
}

const iguales = (a: Ocultos, b: Ocultos) =>
  a.izquierda === b.izquierda && a.derecha === b.derecha && a.desde === b.desde && a.hasta === b.hasta && a.barra === b.barra

/**
 * Qué lado del marco esconde contenido, al día: al desplazar, al cambiar el
 * tamaño (la ventana, el giro del móvil, una fuente que termina de cargar) y al
 * cambiar el contenido. Sin dependencias a propósito: cada render puede traer
 * otra tabla (llegan los datos, se abre una fila) y hay que volver a medir y a
 * observar a los hijos nuevos.
 */
function useOcultos(ref: RefObject<HTMLElement | null>): Ocultos {
  const [ocultos, setOcultos] = useState(NADA_OCULTO)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => {
      const nuevos = medirOcultos(el)
      setOcultos((antes) => (iguales(antes, nuevos) ? antes : nuevos))
    }
    medir()
    el.addEventListener('scroll', medir, { passive: true })
    window.addEventListener('resize', medir)
    // jsdom y navegadores viejos no lo tienen: queda el `resize` de la ventana.
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null
    if (observador) {
      observador.observe(el)
      for (const hijo of Array.from(el.children)) observador.observe(hijo)
    }
    return () => {
      el.removeEventListener('scroll', medir)
      window.removeEventListener('resize', medir)
      observador?.disconnect()
    }
  })
  return ocultos
}

/** Lo que mide el fundido, y lo que queda de lo que pasa justo por el borde. En
 *  una máscara el color no se pinta: solo cuenta su opacidad. */
const FUNDIDO = 32
const OPACO = 'black'
const TENUE = 'rgb(0 0 0 / 0.15)'

/**
 * La señal de que hay más a un lado (revisión 12, visual): el contenido se
 * funde en el borde que esconde columnas, y el fundido se apaga al llegar al
 * final. Sin ella, a 390 px la contribución al riesgo se cortaba en «RIESGO/PES»
 * y «2,15» sin su «×», la calibración en «Err», la evolución de la calidad en
 * «Días d…» y el Portafolio en «Precio», y nada decía que la tabla se
 * desplazaba; en el comparador de ETFs la columna que asoma a propósito parecía
 * texto roto.
 *
 * Una máscara y no una capa encima: el marco va sobre superficies distintas (la
 * tarjeta, el ámbar del mensaje de error) y una capa de color era una mancha en
 * todas menos en la suya; con la máscara se ve el fondo que haya, en cualquier
 * tema y con colores forzados. Empieza en el borde de las columnas fijas, que no
 * se funden (lo oculto pasa por debajo de ellas), y deja entera la barra de
 * desplazamiento, que también avisa. Sin transición: un fundido que aparece de
 * golpe no molesta a quien pide menos movimiento.
 */
export function mascara(o: Ocultos): CSSProperties | undefined {
  if (!o.izquierda && !o.derecha) return undefined
  const paradas = [`${OPACO} 0`]
  if (o.izquierda) paradas.push(`${OPACO} ${o.desde}px`, `${TENUE} ${o.desde}px`, `${OPACO} ${o.desde + FUNDIDO}px`)
  if (o.derecha)
    paradas.push(`${OPACO} calc(100% - ${o.hasta + FUNDIDO}px)`, `${TENUE} calc(100% - ${o.hasta}px)`, `${OPACO} calc(100% - ${o.hasta}px)`)
  paradas.push(`${OPACO} 100%`)
  const fundido = `linear-gradient(to right, ${paradas.join(', ')})`
  if (o.barra === 0) return { maskImage: fundido }
  return {
    maskImage: `linear-gradient(${OPACO}, ${OPACO}), ${fundido}`,
    maskSize: `100% ${o.barra}px, 100% 100%`,
    maskPosition: '0 100%, 0 0',
    maskRepeat: 'no-repeat',
  }
}

/** Para las pruebas y para quien inspeccione la página: qué lado esconde algo. */
function datosOcultos(o: Ocultos) {
  return { 'data-oculto-izquierda': o.izquierda, 'data-oculto-derecha': o.derecha }
}

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
 * del marco: no se pinta sobre la cabecera de la página al desplazarla. Es un
 * `outline` y no un `ring` (box-shadow): con colores forzados (alto contraste
 * de Windows) la sombra desaparece y no quedaba ningún foco (revisión 5).
 *
 * Y funde el borde que esconde columnas (`mascara`, revisión 12).
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
  const marco = useRef<HTMLDivElement>(null)
  const ocultos = useOcultos(marco)
  return (
    <div className={`relative isolate rounded ${className}`.trim()}>
      <div
        ref={marco}
        className="peer overflow-x-auto rounded-[inherit] focus-visible:outline-none"
        tabIndex={0}
        role="region"
        aria-label={etiqueta}
        style={mascara(ocultos)}
        {...datosOcultos(ocultos)}
      >
        {children}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 hidden rounded-[inherit] outline outline-2 -outline-offset-2 outline-sky-500 peer-focus-visible:block"
      />
    </div>
  )
}

/**
 * Una fila de controles que en móvil se desplaza en vez de partirse, con el
 * mismo fundido en el borde que esconde algo: las once pestañas de la ficha
 * ocupaban cinco filas (unos 200 px) antes del contenido a 390 px (revisión 12,
 * visual). No es enfocable ni región: lo enfocable son sus botones, y el
 * navegador desplaza la franja hasta el que recibe el foco. `className` va en
 * la franja que se desplaza (su `flex`, y `md:overflow-visible` si en escritorio
 * vuelve a partirse en varias filas).
 */
export function FranjaDesplazable({ className = '', children }: { className?: string; children: ReactNode }) {
  const franja = useRef<HTMLDivElement>(null)
  const ocultos = useOcultos(franja)
  return (
    <div ref={franja} className={`overflow-x-auto ${className}`.trim()} style={mascara(ocultos)} {...datosOcultos(ocultos)}>
      {children}
    </div>
  )
}
