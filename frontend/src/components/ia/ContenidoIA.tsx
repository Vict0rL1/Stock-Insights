/**
 * Lo generado por IA, siempre igual y siempre separado de lo calculado (§3 del
 * plan): violeta, con la etiqueta «Generado por IA», el modelo y el aviso.
 *
 * Antes había cuatro copias de este bloque (noticias, señales, informe y «Qué
 * cambió»), todas con el violeta pastel de fondo (el tono 50), que la inversión
 * de paleta de `index.css` no toca: en el tema oscuro salía una mancha blanca con el texto
 * casi invisible encima, y los botones en violeta oscuro apenas se leían (V9).
 * Ahora los colores salen de los tokens `--ai` y `--ai-bg`, y hay una sola
 * versión.
 */
import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useLlmEstado } from '../../lib/llm'
import { MarkdownIA } from './MarkdownIA'

export function EtiquetaIA({ children = 'Generado por IA' }: { children?: ReactNode }) {
  return (
    <span className="rounded bg-(--ai) px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--ai-bg)">
      {children}
    </span>
  )
}

export function BloqueIA({
  modelo,
  nota,
  aviso,
  children,
  className = '',
}: {
  modelo: string
  /** Al lado del modelo: «desde caché (sin coste nuevo)», por ejemplo. */
  nota?: string
  aviso?: string | null
  /** El texto del modelo, en Markdown (`content_md`): se pinta con `MarkdownIA`. */
  children: string
  className?: string
}) {
  return (
    <div data-contenido="ia" className={`rounded-lg border border-(--ai)/30 bg-(--ai-bg) p-3 ${className}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <EtiquetaIA />
        <span className="text-[10px] text-(--ai)">
          {modelo}
          {nota ? ` · ${nota}` : ''}
        </span>
      </div>
      <div className="text-sm leading-relaxed text-(--text)">
        <MarkdownIA texto={children} />
      </div>
      {aviso && <p className="mt-2 text-[10px] text-(--ai)">{aviso}</p>}
    </div>
  )
}

/**
 * El botón que pide algo a la IA (y gasta API): con el mismo violeta, para que se vea qué cuesta.
 *
 * Solo se puede pulsar con la IA encendida; si no, sale desactivado y dice por
 * qué a la vista, no solo en el `title`, que en el móvil no se ve. «Resumir este
 * diff con IA» salía activo con la IA apagada y solo podía acabar en error
 * (revisión 12, visual). Mientras no se sabe el estado, o si no se pudo
 * consultar, tampoco: «no se sabe» no es «encendida».
 */
export function BotonIA({ className = '', disabled, title, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { status, error } = useLlmEstado()
  const idMotivo = useId()
  const motivo = status?.configured
    ? null
    : status
      ? 'IA apagada: sin ANTHROPIC_API_KEY en .env no se puede pedir. El resto de la pantalla no la necesita.'
      : error
        ? `No se pudo comprobar si la IA está encendida (${error}): mientras tanto no se ofrece.`
        : 'Comprobando si la IA está encendida…'
  return (
    <>
      <button
        type="button"
        {...props}
        disabled={disabled || motivo !== null}
        title={motivo ?? title}
        aria-describedby={motivo ? idMotivo : props['aria-describedby']}
        className={`rounded-lg border border-(--ai)/50 px-2.5 py-1.5 text-xs font-medium text-(--ai) hover:bg-(--ai-bg) disabled:opacity-50 ${className}`}
      />
      {motivo && (
        <p id={idMotivo} className="mt-1 text-[11px] text-slate-500">
          {motivo}
        </p>
      )}
    </>
  )
}
