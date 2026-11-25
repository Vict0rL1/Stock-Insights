/**
 * El Markdown que escribe el modelo, pintado como elementos de React.
 *
 * Los prompts piden Markdown (el informe, «máximo 600 palabras, Markdown» y con
 * encabezados «##»; noticias y señales, «Markdown sencillo») y el campo se llama
 * `content_md`, pero `BloqueIA` lo pintaba como texto plano: salían los
 * asteriscos de «**Lectura de demostración.**» y, con un modelo real, saldrían
 * también los «##» y los guiones de las listas (revisión 12, visual).
 *
 * Solo un subconjunto, y nunca HTML: párrafos, **negrita**, *cursiva*,
 * `código`, encabezados de # a ### (con más almohadillas cuentan como ###),
 * listas con «-», «*» o «+» y numeradas con «1.» o «1)», y la raya «---». Lo
 * demás sale como el texto que es. El texto del modelo viaja siempre como texto
 * de React, que lo escapa: un «<script>» o un «<img onerror>» se leen, no se
 * ejecutan. Sin `dangerouslySetInnerHTML` y sin dependencias: un renderizador
 * completo traería HTML en bruto y enlaces que habría que sanear después.
 *
 * La cursiva va solo con asteriscos: con guiones bajos, «ANTHROPIC_API_KEY» o un
 * código como «tesis_estado» saldrían partidos y en cursiva.
 */
import type { ReactNode } from 'react'

type Lista = { tipo: 'lista'; ordenada: boolean; inicio: number; items: string[] }
type Bloque =
  | { tipo: 'parrafo'; texto: string }
  | { tipo: 'titulo'; nivel: 1 | 2 | 3; texto: string }
  | { tipo: 'raya' }
  | Lista

const TITULO = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
// La raya antes que la viñeta: «* * *» también empieza por «* ».
const RAYA = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
// Un espacio detrás de la marca: «**Lectura…**» o «*Nota:*» al principio de una
// línea son negrita y cursiva, no una viñeta; «-5 %» es una cifra.
const VINETA = /^[ \t]*[-*+][ \t]+(.*)$/
const NUMERO = /^[ \t]*(\d{1,9})[.)][ \t]+(.*)$/

function bloques(md: string): Bloque[] {
  const salida: Bloque[] = []
  let parrafo: string[] = []
  let lista: Lista | null = null

  for (const linea of md.replace(/\r\n?/g, '\n').split('\n')) {
    const vineta = VINETA.exec(linea)
    const numero = vineta ? null : NUMERO.exec(linea)
    // Una lista numerada solo corta un párrafo si empieza en 1, como en
    // CommonMark: «2025. Fue un año…» a media prosa no es una lista que empiece
    // en el 2025. Dentro de una viñeta, igual: «- a» seguido de «2026. Abrió»
    // abría una `<ol start="2026">` en vez de seguir la viñeta (revisión 13).
    // Dentro de una lista numerada, cualquier número es el siguiente punto.
    const empiezaLista = lista === null ? parrafo.length === 0 : lista.ordenada
    const esItem = vineta !== null || (numero !== null && (empiezaLista || numero[1] === '1'))
    const esCorte = !linea.trim() || RAYA.test(linea) || TITULO.test(linea) || esItem

    if (esCorte && parrafo.length) {
      salida.push({ tipo: 'parrafo', texto: parrafo.join('\n') })
      parrafo = []
    }
    if (!linea.trim()) {
      lista = null
      continue
    }
    if (RAYA.test(linea)) {
      salida.push({ tipo: 'raya' })
      lista = null
      continue
    }
    const titulo = TITULO.exec(linea)
    if (titulo) {
      // «# » a secas (o «## ##», solo con el cierre) corta el párrafo, pero no
      // es un título: salía un `<h4>` vacío, que el lector de pantalla anuncia
      // como encabezado (revisión 13).
      const texto = titulo[2].replace(/^#+$/, '')
      if (texto) salida.push({ tipo: 'titulo', nivel: Math.min(titulo[1].length, 3) as 1 | 2 | 3, texto })
      lista = null
      continue
    }
    if (esItem) {
      const ordenada = numero !== null
      if (lista === null || lista.ordenada !== ordenada) {
        lista = { tipo: 'lista', ordenada, inicio: numero ? Number(numero[1]) : 1, items: [] }
        salida.push(lista)
      }
      lista.items.push(vineta ? vineta[1] : (numero as RegExpExecArray)[2])
      continue
    }
    if (lista !== null) {
      // Continuación de la última viñeta: el modelo parte una frase larga en dos líneas.
      lista.items[lista.items.length - 1] += `\n${linea.trim()}`
      continue
    }
    parrafo.push(linea.trim())
  }
  if (parrafo.length) salida.push({ tipo: 'parrafo', texto: parrafo.join('\n') })
  return salida
}

// Por orden: el código primero (lo de dentro es literal), luego negrita con
// cursiva, negrita y cursiva. Cada marca necesita un carácter que no sea blanco
// pegado por dentro: «3 * 4 * 5» no es cursiva, y un «**» sin cerrar se queda
// como está. La cursiva no cruza otro asterisco, para no tragarse una negrita.
//
// Y el código manda dentro de las marcas: un código entero cuenta como una sola
// pieza, y un acento grave solo va suelto si no cierra un código en su línea.
// En «*a `b*` c*» la cursiva se cerraba en el asterisco de dentro del código y
// lo partía; ahora es «a `b*` c» en cursiva, con «b*» como código (revisión 13).
const G = '`'
const CODIGO = String.raw`${G}([^${G}\n]+)${G}`
// Lo que va dentro de una marca, pieza a pieza: un código entero, un acento
// grave que no cierra ningún código en su línea, o cualquier otro carácter que
// no esté en `excluidos`. La última pieza, además, no puede ser un blanco.
const pieza = (excluidos: string) => String.raw`(?:${G}[^${G}\n]+${G}|${G}(?![^${G}\n]*${G})|[^${G}${excluidos}])`
const marca = (m: string, primero: string, excluidos: string) =>
  String.raw`${m}(?=${primero})(${pieza(excluidos)}*?${pieza(String.raw`\s` + excluidos)})${m}`
const EN_LINEA = new RegExp(
  [
    CODIGO,
    marca(String.raw`\*\*\*`, String.raw`\S`, ''),
    marca(String.raw`\*\*`, String.raw`\S`, ''),
    marca(String.raw`\*`, String.raw`[^\s*]`, '*'),
  ].join('|'),
)

function enLinea(texto: string): ReactNode[] {
  const salida: ReactNode[] = []
  let resto = texto
  for (let m = EN_LINEA.exec(resto), i = 0; m; m = EN_LINEA.exec(resto), i++) {
    if (m.index > 0) salida.push(resto.slice(0, m.index))
    const [, codigo, fuerteCursiva, fuerte, cursiva] = m
    if (codigo !== undefined) {
      salida.push(
        <code key={i} className="rounded border border-(--ai)/30 px-1 font-mono text-[0.92em]">
          {codigo}
        </code>,
      )
    } else if (fuerteCursiva !== undefined) {
      salida.push(
        <strong key={i} className="font-semibold text-(--text-strong)">
          <em>{enLinea(fuerteCursiva)}</em>
        </strong>,
      )
    } else if (fuerte !== undefined) {
      salida.push(
        <strong key={i} className="font-semibold text-(--text-strong)">
          {enLinea(fuerte)}
        </strong>,
      )
    } else {
      salida.push(<em key={i}>{enLinea(cursiva)}</em>)
    }
    resto = resto.slice(m.index + m[0].length)
  }
  if (resto) salida.push(resto)
  return salida
}

// Los encabezados del modelo, de h4 a h6: el bloque de IA vive dentro de
// secciones con su h2 o h3, y un «#» del modelo como h1 competiría con el título
// de la página.
const ENCABEZADO = {
  1: ['h4', 'text-base font-semibold text-(--text-strong)'],
  2: ['h5', 'text-sm font-semibold text-(--text-strong)'],
  3: ['h6', 'text-sm font-medium text-(--text-strong)'],
} as const

export function MarkdownIA({ texto }: { texto: string }) {
  return (
    <div className="space-y-2">
      {bloques(texto).map((b, i) => {
        if (b.tipo === 'titulo') {
          const [Etiqueta, clase] = ENCABEZADO[b.nivel]
          return (
            <Etiqueta key={i} className={`${i > 0 ? 'pt-1 ' : ''}${clase}`}>
              {enLinea(b.texto)}
            </Etiqueta>
          )
        }
        if (b.tipo === 'raya') return <hr key={i} className="border-(--ai)/30" />
        if (b.tipo === 'lista') {
          const items = b.items.map((t, j) => (
            <li key={j} className="whitespace-pre-line">
              {enLinea(t)}
            </li>
          ))
          return b.ordenada ? (
            <ol key={i} start={b.inicio === 1 ? undefined : b.inicio} className="list-decimal space-y-1 pl-5">
              {items}
            </ol>
          ) : (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {items}
            </ul>
          )
        }
        return (
          <p key={i} className="whitespace-pre-line">
            {enLinea(b.texto)}
          </p>
        )
      })}
    </div>
  )
}
