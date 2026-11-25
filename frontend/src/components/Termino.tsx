/**
 * Un término con su explicación del glosario (`lib/glosario.ts`) al pasar el
 * ratón, al llegar con el teclado o al tocarlo en el móvil.
 *
 * Un `title` no sirve: en el móvil no se ve y con el teclado no se abre. Aquí
 * es un botón (se llega con Tab), la definición va enlazada con
 * `aria-describedby` (el lector de pantalla la lee al enfocarlo, abierta o no),
 * Escape la cierra y un toque la fija hasta el siguiente o hasta salir. Un
 * toque enfoca y pulsa a la vez: si el foco la abriera, el clic la cerraría en
 * el mismo gesto; por eso el foco solo la abre cuando no viene de un puntero.
 * Y pasar por encima es cosa de un ratón de verdad: un toque emula también la
 * entrada del ratón (`mouseenter`) y nunca su salida, así que con
 * `onMouseEnter` la definición quedaba «encima» para siempre y el segundo
 * toque no la cerraba (revisión 14, H10; visto con Playwright: un toque
 * dispara pointerenter → pointerdown → mouseover → mouseenter → focus → click).
 */
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { DecisionAction } from '../api/types'
import { FORMAS, GLOSARIO, QUE_SIGNIFICA_LA_ACCION, type ClaveGlosario } from '../lib/glosario'

type Fuente = { clave: ClaveGlosario; accion?: undefined } | { accion: DecisionAction; clave?: undefined }

const MARGEN = 8
const ANCHO = 288

export function Termino({ children, className = '', ...fuente }: Fuente & { children?: ReactNode; className?: string }) {
  const entrada = fuente.clave ? GLOSARIO[fuente.clave] : null
  const definicion = entrada ? entrada.definicion : QUE_SIGNIFICA_LA_ACCION[fuente.accion as DecisionAction]
  const id = useId()
  const boton = useRef<HTMLButtonElement>(null)
  const caja = useRef<HTMLSpanElement>(null)
  const deUnPuntero = useRef(false)
  const [encima, setEncima] = useState(false)
  const [enfocado, setEnfocado] = useState(false)
  const [fijado, setFijado] = useState(false)
  const [sitio, setSitio] = useState<CSSProperties>({})
  const abierto = encima || enfocado || fijado

  // Fija a la ventana y dentro de ella: a 390 px un término cerca del borde
  // derecho sacaba la caja de la pantalla y la página se desplazaba de lado.
  useLayoutEffect(() => {
    if (!abierto) return
    const colocar = () => {
      const b = boton.current?.getBoundingClientRect()
      if (!b) return
      const ancho = Math.min(ANCHO, window.innerWidth - 2 * MARGEN)
      const alto = caja.current?.offsetHeight ?? 0
      const izquierda = Math.max(MARGEN, Math.min(b.left, window.innerWidth - ancho - MARGEN))
      const debajo = b.bottom + 6
      const arriba = debajo + alto > window.innerHeight - MARGEN && b.top - alto - 6 > MARGEN
      setSitio({ position: 'fixed', left: izquierda, top: arriba ? b.top - alto - 6 : debajo, width: ancho })
    }
    colocar()
    window.addEventListener('scroll', colocar, true)
    window.addEventListener('resize', colocar)
    return () => {
      window.removeEventListener('scroll', colocar, true)
      window.removeEventListener('resize', colocar)
    }
  }, [abierto])

  const cerrar = () => {
    setEncima(false)
    setEnfocado(false)
    setFijado(false)
  }

  return (
    <span className="relative">
      <button
        ref={boton}
        type="button"
        aria-describedby={id}
        aria-expanded={abierto}
        className={`cursor-help text-left underline decoration-slate-400 decoration-dotted underline-offset-2 hover:decoration-slate-700 focus:outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-sky-500 ${className}`}
        onPointerDown={() => {
          deUnPuntero.current = true
        }}
        onFocus={() => {
          if (!deUnPuntero.current) setEnfocado(true)
        }}
        onBlur={() => {
          deUnPuntero.current = false
          cerrar()
        }}
        onClick={() => {
          deUnPuntero.current = false
          setFijado((f) => !f)
          // Cerrar con un toque cierra también lo que abrió el foco.
          if (fijado) setEnfocado(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && abierto) {
            e.stopPropagation()
            cerrar()
          }
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') setEncima(true)
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setEncima(false)
        }}
      >
        {children ?? entrada?.termino}
      </button>
      <span
        ref={caja}
        id={id}
        role="tooltip"
        hidden={!abierto}
        style={sitio}
        // `block` solo abierta: con el atributo `hidden` y `block` a la vez, gana la clase.
        className={`z-50 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-700 shadow-lg ${
          abierto ? 'block' : 'hidden'
        }`}
      >
        {definicion}
      </span>
    </span>
  )
}

const LETRA = /[\p{L}\p{N}]/u

/** Dónde aparece cada término en `texto`: la primera vez de cada uno, sin
 *  solaparse. Un término en minúscula se reconoce también con mayúscula
 *  inicial («Stop»), pero no en mayúsculas: STOP es un símbolo de la demo. */
export function terminosEn(texto: string): { desde: number; hasta: number; clave: ClaveGlosario }[] {
  const hallados: { desde: number; hasta: number; clave: ClaveGlosario }[] = []
  for (const clave of Object.keys(FORMAS) as ClaveGlosario[]) {
    for (const forma of FORMAS[clave]) {
      const variantes = forma === forma.toLowerCase() ? [forma, forma.slice(0, 1).toUpperCase() + forma.slice(1)] : [forma]
      const desde = Math.min(
        ...variantes.map((v) => {
          for (let i = texto.indexOf(v); i >= 0; i = texto.indexOf(v, i + 1)) {
            const antes = texto.slice(i - 1, i)
            const despues = texto.slice(i + v.length, i + v.length + 1)
            if (!LETRA.test(antes) && !LETRA.test(despues)) return i
          }
          return Infinity
        }),
      )
      if (desde === Infinity) continue
      const hasta = desde + forma.length
      if (!hallados.some((h) => desde < h.hasta && hasta > h.desde)) hallados.push({ desde, hasta, clave })
      break
    }
  }
  return hallados.sort((a, b) => a.desde - b.desde)
}

/** Un texto ya escrito (la frase de «Qué dice la app», una regla de la traza)
 *  con sus términos explicables: el texto sigue siendo el mismo, letra a letra. */
export function ConTerminos({ texto }: { texto: string }) {
  const partes: ReactNode[] = []
  let cursor = 0
  for (const { desde, hasta, clave } of terminosEn(texto)) {
    if (desde > cursor) partes.push(texto.slice(cursor, desde))
    partes.push(
      <Termino key={desde} clave={clave}>
        {texto.slice(desde, hasta)}
      </Termino>,
    )
    cursor = hasta
  }
  if (cursor < texto.length) partes.push(texto.slice(cursor))
  return <>{partes}</>
}
