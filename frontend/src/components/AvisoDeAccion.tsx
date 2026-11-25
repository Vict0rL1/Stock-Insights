/**
 * Un único aspecto para todos los avisos de acción (comprar, esperar, vender…).
 *
 * Recibe un `Aviso` de `lib/avisos.ts` (`avisoDe(...)`, o `avisosDeCartera(...)`
 * para las posiciones) y lo pinta; no decide nada. Props:
 * - `aviso`: el aviso.
 * - `tamano`: `completo` (tarjeta: verbo grande, frase, pasos y los números para
 *   actuar) o `compacto` (fila de tabla o de lista: verbo con su icono y, con
 *   `conFrase`, la frase y los pasos en línea, sin las cifras).
 * - `conFrase` (solo compacto, por defecto sí): sin ella, para una celda
 *   estrecha, la frase queda en el `title` del verbo.
 * - `titulo`: de quién es el aviso (el símbolo con su enlace), junto al verbo.
 * - `children`: detalle propio de la pantalla (de dónde es el precio…), al final.
 *
 * El color nunca va solo: cada tipo lleva su icono y su verbo escrito. Los
 * colores son los pares que `index.css` invierte para el tema oscuro (fondo
 * 50/100, texto 800): un fondo de un tono sin invertir junto a un texto
 * invertido sale como un rectángulo de color sin letras. Lo comprueba
 * `AvisoDeAccion.test.tsx`, con el contraste AA de cada texto sobre su fondo.
 */
import type { ReactNode } from 'react'
import type { Aviso, TipoAviso, TonoAviso } from '../lib/avisos'

export const TONOS: Record<TonoAviso, { fondo: string; borde: string; texto: string; chip: string }> = {
  verde: { fondo: 'bg-emerald-50', borde: 'border-emerald-500', texto: 'text-emerald-800', chip: 'bg-emerald-100 text-emerald-800' },
  ambar: { fondo: 'bg-amber-50', borde: 'border-amber-500', texto: 'text-amber-800', chip: 'bg-amber-100 text-amber-800' },
  naranja: { fondo: 'bg-orange-100', borde: 'border-orange-500', texto: 'text-orange-800', chip: 'bg-orange-100 text-orange-800' },
  rojo: { fondo: 'bg-red-50', borde: 'border-red-500', texto: 'text-red-800', chip: 'bg-red-100 text-red-800' },
  gris: { fondo: 'bg-slate-100', borde: 'border-slate-400', texto: 'text-slate-800', chip: 'bg-slate-100 text-slate-800' },
}

// Trazos de 16×16, en el color del texto. Dos tipos con el mismo tono (esperar y
// revisar, ámbar) se distinguen por la forma, no solo por el verbo.
const TRAZOS: Record<TipoAviso, ReactNode> = {
  // Flecha hacia arriba: entrar.
  comprar: <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />,
  comprar_sin_tamano: <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />,
  // Pausa: buena, pero no cabe.
  comprar_sin_sitio: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  // Reloj: esperar a que pase algo.
  esperar: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.3" />
    </>
  ),
  // Prohibido.
  evitar: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="m4.2 11.8 7.6-7.6" />
    </>
  ),
  // Flecha hacia abajo: salir.
  vender: <path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" />,
  // Menos: quitar una parte.
  reducir: <path d="M3.5 8h9" />,
  // Igual: no tocar nada.
  mantener: <path d="M3.5 6h9M3.5 10h9" />,
  // Interrogación: no se ha podido comprobar.
  sin_comprobar: (
    <>
      <path d="M6 6.2a2 2 0 1 1 2.9 1.8c-.6.3-.9.8-.9 1.4v.4" />
      <path d="M8 12.2v.3" />
    </>
  ),
  sin_datos: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.5 8h5" />
    </>
  ),
  sin_accion: <circle cx="8" cy="8" r="1.6" />,
}

function Icono({ tipo, className }: { tipo: TipoAviso; className: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-tipo={tipo}
    >
      {TRAZOS[tipo]}
    </svg>
  )
}

export function AvisoDeAccion({
  aviso,
  tamano = 'completo',
  conFrase = true,
  titulo,
  children,
}: {
  aviso: Aviso
  tamano?: 'completo' | 'compacto'
  conFrase?: boolean
  titulo?: ReactNode
  children?: ReactNode
}) {
  const t = TONOS[aviso.tono]
  const verbo = (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${t.chip}`}
      title={conFrase ? undefined : aviso.frase}
      data-aviso={aviso.tipo}
    >
      <Icono tipo={aviso.tipo} className="h-3.5 w-3.5 shrink-0" />
      {aviso.verbo}
    </span>
  )

  if (tamano === 'compacto') {
    if (!conFrase) return verbo
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {verbo}
        {titulo}
        <span className="min-w-0 text-sm leading-snug text-slate-800">{aviso.frase}</span>
        {aviso.pasos.map((p) => (
          <span key={p} className="text-xs leading-snug text-slate-600">
            {p}
          </span>
        ))}
        {children}
      </div>
    )
  }

  return (
    <div className={`rounded-lg border-l-4 ${t.borde} ${t.fondo} p-3`} data-aviso={aviso.tipo}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${t.chip}`}>
          <Icono tipo={aviso.tipo} className="h-4 w-4" />
        </span>
        <span className={`text-lg font-bold uppercase tracking-wide ${t.texto}`}>{aviso.verbo}</span>
        {titulo}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-800">{aviso.frase}</p>
      {aviso.pasos.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-slate-700">
          {aviso.pasos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {aviso.cifras.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {aviso.cifras.map((c) => (
            <div key={c.rotulo} className="min-w-[7rem]">
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">{c.rotulo}</dt>
              <dd className={`text-sm font-medium tabular-nums ${c.tono ? TONOS[c.tono].texto : 'text-slate-900'}`}>
                {c.valor}
                {c.nota && <span className="block text-[10px] font-normal text-slate-600">{c.nota}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </div>
  )
}
