import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError, faltaUnDato, type ErrorDeValidacion } from '../api/client'
import { AtajosWatchlist } from '../components/AtajosWatchlist'
import type {
  Comparables,
  DcfInverso,
  RangoGlobal,
  Sensibilidad,
  SupuestosEscenario,
  Valoracion,
} from '../api/types'
import { leerNumero, textoDeCampo } from '../lib/entrada'
import { etiqueta } from '../lib/etiquetas'
import { fmtCompacto, fmtNum, fmtPct, fmtPrecio, fmtValorRedondo } from '../lib/formato'
import { Ventana } from '../components/Ventana'
import { MarcoTabla } from '../components/MarcoTabla'
import { DeudaParcial } from '../components/ticker/DeudaParcial'
import { BarraRango, textoRango } from '../components/valoracion/ResumenDcf'
import { PARAM_SIMBOLO } from '../components/valoracion/ruta'

const ESCENARIOS = ['bajista', 'base', 'alcista'] as const
type NombreEscenario = (typeof ESCENARIOS)[number]

const TONO: Record<NombreEscenario, string> = {
  bajista: 'text-red-700',
  base: 'text-slate-800',
  alcista: 'text-emerald-700',
}

const pct = (v: number | null | undefined, d = 1) => fmtPct(v, d)

function RangoGlobalPanel({ g }: { g: RangoGlobal }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Rango de valor, del escenario más pesimista al más optimista
      </h2>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-2xl font-semibold tabular-nums text-slate-900">
          {textoRango(g.bajo, g.alto)}
        </span>
        {g.precio_actual !== null && (
          <span className="text-sm text-slate-500">
            cotiza a{' '}
            <span className="font-medium tabular-nums text-slate-800">
              {fmtPrecio(g.precio_actual)}
            </span>{' '}
            ({g.posicion})
          </span>
        )}
      </div>
      <div className="mt-2">
        <BarraRango bajo={g.bajo} alto={g.alto} actual={g.precio_actual} />
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{g.nota}</p>
    </section>
  )
}

const CAMPOS: [keyof SupuestosEscenario, string][] = [
  ['growth_rate', 'Crecimiento FCF'],
  ['discount_rate', 'WACC'],
  ['terminal_growth', 'Perpetuidad'],
]

/** Si un escenario sigue siendo el que llegó (sin tocar). */
function mismosSupuestos(a: SupuestosEscenario, b: SupuestosEscenario | undefined): boolean {
  return b !== undefined && CAMPOS.every(([c]) => Math.abs(a[c] - b[c]) < 1e-9)
}

/** Los tres escenarios, cada uno con su rango y sus supuestos editables.
 *
 *  Los campos eran `type="number"` leídos con `Number(...)`: un campo borrado, o
 *  un «8,5» que el navegador no acepta y entrega vacío, recalculaba con un 0 %
 *  sin avisar. Ahora son texto con la coma de la app, leído con `leerNumero`
 *  como el DCF de la ficha; lo que no se lee no llega a los supuestos y no deja
 *  recalcular (revisión 12, visual). Se monta de nuevo con cada valoración
 *  (`key`), así que lo escrito no sobrevive a otra respuesta. Al recalcular solo
 *  se mandan los escenarios tuyos (`escenariosTuyos`): los demás los propone el
 *  backend con las entradas de esa llamada (revisión 15, H1). */
export function Escenarios({
  data,
  supuestos,
  onCambiar,
  onAplicar,
  busy,
  bloqueado = false,
}: {
  data: Valoracion
  supuestos: Record<string, SupuestosEscenario>
  onCambiar: (n: string, campo: keyof SupuestosEscenario, v: number) => void
  onAplicar: () => void
  busy: boolean
  /** Algo fuera de los escenarios no se puede leer (tus entradas): no se recalcula. */
  bloqueado?: boolean
}) {
  const precio = data.entradas.precio_actual
  const [textos, setTextos] = useState<Record<string, string>>({})
  const nombreCampo = (clave: string) => {
    const [escenario, campo] = clave.split('|')
    return `${CAMPOS.find(([c]) => c === campo)?.[1] ?? campo} ${escenario}`
  }
  const vacios = Object.entries(textos).filter(([, t]) => t.trim() === '').map(([k]) => nombreCampo(k))
  const ilegibles = Object.entries(textos)
    .filter(([, t]) => t.trim() !== '' && leerNumero(t) === null)
    .map(([k, t]) => `${nombreCampo(k)} («${t}»)`)
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Escenarios, con sus supuestos
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        {data.nota_supuestos}
      </p>
      {/* Tus escenarios mandan aunque no vayan de menos a más (pensados para un
          FCF del otro signo, p. ej.): se avisa en vez de callarlo con el bajista
          en rojo por encima del alcista en verde (revisión 15, H1). */}
      {data.aviso_orden && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {data.aviso_orden}
        </p>
      )}
      {/* Si el crecimiento no sale de las cuentas de la empresa, se dice arriba
          del todo: es el parámetro que más mueve el valor, y «3 %» con cara de
          dato histórico era indistinguible de «3 %» puesto a falta de uno. */}
      {(() => {
        const supuesto = Object.values(data.escenarios).find(
          (e) => e?.procedencia?.crecimiento_supuesto,
        )
        return supuesto?.procedencia?.motivo ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            {supuesto.procedencia.motivo}
          </p>
        ) : null
      })()}

      <div className="mt-4 space-y-4">
        {ESCENARIOS.filter((n) => data.escenarios[n]).map((nombre) => {
          const e = data.escenarios[nombre]
          const s = supuestos[nombre] ?? e.supuestos
          return (
            <div key={nombre} className="rounded-lg border border-slate-100 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={`text-sm font-medium capitalize ${TONO[nombre]}`}>
                  {nombre}
                </span>
                {e.rango.disponible ? (
                  <span className="tabular-nums text-slate-900">
                    {fmtValorRedondo(e.rango.bajo)}{' '}
                    <span className="text-slate-400">–</span>{' '}
                    <span className="font-medium">{fmtValorRedondo(e.rango.centro)}</span>{' '}
                    <span className="text-slate-400">–</span> {fmtValorRedondo(e.rango.alto)}
                  </span>
                ) : (
                  <span className="text-xs text-amber-800">sin rango calculable</span>
                )}
              </div>

              {e.rango.disponible && (
                <div className="mt-1">
                  <BarraRango
                    bajo={e.rango.bajo!}
                    alto={e.rango.alto!}
                    actual={precio}
                    tono={
                      nombre === 'bajista'
                        ? 'bg-red-400'
                        : nombre === 'alcista'
                          ? 'bg-emerald-400'
                          : 'bg-slate-400'
                    }
                  />
                </div>
              )}

              <div className="mt-2 grid grid-cols-3 gap-3">
                {CAMPOS.map(([campo, etiqueta]) => {
                  const clave = `${nombre}|${campo}`
                  return (
                    <label key={campo} className="block">
                      <span className="block text-[10px] uppercase tracking-wide text-slate-400">
                        {etiqueta}
                      </span>
                      <div className="flex items-baseline gap-1">
                        {/* Solo el WACC con `inputMode="decimal"`: el teclado de
                            ese modo en iOS no trae «-», y el crecimiento y la
                            perpetuidad admiten negativos (revisión 13). */}
                        <input
                          inputMode={campo === 'discount_rate' ? 'decimal' : undefined}
                          value={textos[clave] ?? textoDeCampo(s[campo] * 100, 1)}
                          onChange={(ev) => {
                            const texto = ev.target.value
                            setTextos((prev) => ({ ...prev, [clave]: texto }))
                            const n = texto.trim() === '' ? null : leerNumero(texto)
                            if (n !== null) onCambiar(nombre, campo, n / 100)
                          }}
                          className="w-16 rounded border border-slate-300 px-1.5 py-0.5 text-sm tabular-nums focus:border-sky-500 focus:outline-none"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                    </label>
                  )
                })}
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                {e.rango.nota}
              </p>
              {/* Un crecimiento medido que no es el que se ve (el suelo del
                  −50 %): se dice en su escenario. El 3 % supuesto va arriba. */}
              {!e.procedencia?.crecimiento_supuesto && e.procedencia?.motivo && (
                <p className="mt-1 text-[11px] leading-relaxed text-amber-800">{e.procedencia.motivo}</p>
              )}
            </div>
          )
        })}
      </div>

      {ilegibles.length > 0 && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          No se puede leer {ilegibles.join(', ')}. Escribe el porcentaje como en el resto de la app, p.&nbsp;ej.
          8,5: no se recalcula con un número a medias.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={onAplicar}
          disabled={busy || bloqueado || vacios.length > 0 || ilegibles.length > 0}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Calculando…' : 'Recalcular con mis supuestos'}
        </button>
        {vacios.length > 0 && (
          <span className="text-xs text-slate-500">Para recalcular falta: {vacios.join(', ')}.</span>
        )}
      </div>
    </section>
  )
}

function SensibilidadPanel({ s }: { s: Sensibilidad }) {
  if (!s.disponible || !s.supuestos?.length) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs text-slate-500">{s.nota}</p>
      </section>
    )
  }
  const mayor = s.supuestos[0].recorrido_pct || 1
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Qué supuesto mueve más el resultado
      </h2>
      <ul className="mt-3 space-y-2">
        {s.supuestos.map((f) => (
          <li key={f.supuesto}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="text-slate-700">{f.etiqueta}</span>
              <span className="tabular-nums text-slate-900">
                {fmtPct(f.recorrido_pct, 0, { enPuntos: true })}
                {f.asimetrico && (
                  <span
                    className="ml-1.5 text-[10px] text-amber-800"
                    title="Mueve más hacia un lado que hacia el otro"
                  >
                    asimétrico
                  </span>
                )}
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full rounded-full bg-slate-100">
              <div
                className="h-1.5 rounded-full bg-slate-500"
                style={{ width: `${(f.recorrido_pct / mayor) * 100}%` }}
              />
            </div>
            <div className="mt-0.5 text-[11px] tabular-nums text-slate-400">
              {fmtValorRedondo(f.valor_abajo)} → {fmtValorRedondo(f.valor_arriba)}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">{s.nota}</p>
    </section>
  )
}

/** La pregunta más útil de las cuatro: qué hay que creerse. */
function InversoPanel({ inv }: { inv: DcfInverso }) {
  if (!inv.disponible || !inv.curva?.disponible) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-800">DCF inverso</h2>
        <p className="mt-1 text-xs text-slate-500">
          {inv.nota ?? inv.curva?.nota ?? 'No disponible.'}
        </p>
      </section>
    )
  }
  const puntos = inv.curva.puntos.filter((p) => p.crecimiento_implicito !== null)
  const maxAbs = Math.max(...puntos.map((p) => Math.abs(p.crecimiento_implicito!)), 0.01)
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        DCF inverso: qué descuenta el precio de hoy
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{inv.resumen}</p>

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wide text-slate-400">
          Crecimiento del FCF implícito, según la tasa de descuento
        </div>
        <ul className="mt-1 space-y-1">
          {inv.curva.puntos.map((p) => (
            <li key={p.discount_rate} className="flex items-center gap-2 text-sm">
              <span className="w-14 text-xs tabular-nums text-slate-400">
                {pct(p.discount_rate, 0)}
              </span>
              {p.crecimiento_implicito === null ? (
                <span className="text-xs text-amber-800">fuera de rango</span>
              ) : (
                <>
                  <div className="relative h-2 flex-1 rounded-full bg-slate-100">
                    <div
                      className={`absolute top-0 h-2 rounded-full ${
                        p.crecimiento_implicito >= 0 ? 'bg-sky-500' : 'bg-amber-500'
                      }`}
                      style={{
                        left: '50%',
                        width: `${(Math.abs(p.crecimiento_implicito) / maxAbs) * 50}%`,
                        transform:
                          p.crecimiento_implicito < 0
                            ? `translateX(-${(Math.abs(p.crecimiento_implicito) / maxAbs) * 100}%)`
                            : undefined,
                      }}
                    />
                  </div>
                  <span className="w-16 text-right tabular-nums text-slate-800">
                    {pct(p.crecimiento_implicito)}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>

      {inv.contraste?.disponible && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs leading-relaxed text-slate-700">{inv.contraste.nota}</p>
          {inv.contraste.referencias && (
            <p className="mt-1 text-[11px] text-slate-400">
              Crecimiento histórico:{' '}
              {Object.entries(inv.contraste.referencias)
                .map(([k, v]) => `${k} ${pct(v)}`)
                .join(' · ')}
            </p>
          )}
        </div>
      )}

      {inv.margen?.disponible && (
        <p className="mt-3 text-xs leading-relaxed text-slate-600">{inv.margen.nota}</p>
      )}
    </section>
  )
}

export function ComparablesPanel({ c }: { c: Comparables }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Comparables, ajustados por crecimiento y calidad
      </h2>

      {c.disponible && c.fiable && c.intervalo ? (
        <>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
            <span className="text-lg font-semibold tabular-nums text-slate-900">
              {/* Con los dos decimales con que se sirven: con uno, 22,44 fuera de
                  15,02–22,36 se leía «15,0 – 22,4 · cotiza a 22,4 (fuera)» (revisión 11). */}
              {c.etiqueta_multiplo} {fmtNum(c.intervalo.bajo)} – {fmtNum(c.intervalo.alto)}
            </span>
            <span className="text-sm text-slate-500">
              cotiza a{' '}
              <span className="font-medium text-slate-800">{fmtNum(c.multiplo_objetivo)}</span>{' '}
              ({c.dentro_del_intervalo ? 'dentro' : 'fuera'})
            </span>
          </div>
          <div className="mt-1">
            <BarraRango
              bajo={c.intervalo.bajo}
              alto={c.intervalo.alto}
              actual={c.multiplo_objetivo}
              tono="bg-sky-400"
            />
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-slate-400">
            {c.pares_usables} pares · {c.grados_libertad} grados de libertad · R²{' '}
            {fmtNum(c.r2)}
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-amber-800">{c.nota}</p>
      )}

      {c.precio_implicito?.disponible && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2">
          <p className="text-xs leading-relaxed text-slate-700">
            {c.precio_implicito.nota}
          </p>
          {c.precio_implicito.aviso && (
            <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
              {c.precio_implicito.aviso}
            </p>
          )}
        </div>
      )}

      {c.pares && c.pares.length > 0 && (
        <MarcoTabla etiqueta="Comparación con los pares" className="mt-3">
          <table className="w-full min-w-[420px] text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-400">
              <tr className="border-b border-slate-200">
                <th className="py-1.5 text-left font-medium">Par</th>
                <th className="py-1.5 text-right font-medium">Múltiplo</th>
                <th className="py-1.5 text-right font-medium">Crecimiento</th>
                <th className="py-1.5 text-right font-medium">Calidad (ROE)</th>
                <th className="py-1.5 text-right font-medium">Residuo</th>
              </tr>
            </thead>
            <tbody>
              {c.pares.map((p) => (
                <tr key={p.symbol} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 text-slate-700">{p.symbol}</td>
                  <td className="py-1.5 text-right tabular-nums text-slate-900">
                    {fmtNum(p.multiplo, 1)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">
                    {pct(p.crecimiento)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-slate-500">
                    {pct(p.calidad)}
                  </td>
                  <td
                    className={`py-1.5 text-right tabular-nums ${
                      p.residuo > 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {fmtNum(p.residuo, 1, { signo: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </MarcoTabla>
      )}
    </section>
  )
}

type CampoEntrada = 'net_debt' | 'base_fcf' | 'shares_outstanding' | 'years'
type EntradasPropias = Partial<Record<CampoEntrada, number>>
type TextosEntrada = Partial<Record<CampoEntrada, string>>

/** Las entradas que se pueden escribir encima de las del filing: las que tenía el
 *  DCF de la ficha y le faltaban al módulo (ítem 3.3). Sobre todo la deuda neta:
 *  sin ella en el filing, el backend se niega a valorar («escríbela en el campo de
 *  deuda neta») y aquí no había campo. Nunca se rellena con cero: vacío es «la del
 *  filing», y si el filing no la trae, no se calcula. */
const CAMPOS_ENTRADA: { campo: CampoEntrada; rotulo: string; modo?: 'decimal' | 'numeric' }[] = [
  // Sin `inputMode="decimal"`: la deuda neta de una empresa con más caja que
  // deuda y el FCF de una que quema caja son negativos, y ese teclado de iOS no
  // trae «-» (revisión 13).
  { campo: 'net_debt', rotulo: 'Deuda neta' },
  { campo: 'base_fcf', rotulo: 'FCF de partida' },
  { campo: 'shares_outstanding', rotulo: 'Acciones en circulación', modo: 'decimal' },
  { campo: 'years', rotulo: 'Años de proyección', modo: 'numeric' },
]

/** Lo escrito, con la convención de la app (`leerNumero`). Lo que no se lee —o
 *  unos años fuera de 3 a 10, o acciones que no son positivas— va a `ilegibles`
 *  con su nombre y no se manda: no se calcula con un número a medias. */
export function leerEntradas(textos: TextosEntrada): { valores: EntradasPropias; ilegibles: string[] } {
  const valores: EntradasPropias = {}
  const ilegibles: string[] = []
  for (const { campo, rotulo } of CAMPOS_ENTRADA) {
    const t = (textos[campo] ?? '').trim()
    if (t === '') continue
    const n = leerNumero(t)
    const valido =
      n !== null &&
      (campo === 'years' ? Number.isInteger(n) && n >= 3 && n <= 10 : campo === 'shares_outstanding' ? n > 0 : true)
    if (valido) valores[campo] = n
    else ilegibles.push(`${rotulo.toLowerCase()} («${t}»)`)
  }
  return { valores, ilegibles }
}

/** Las entradas del filing (y los años por defecto) de una empresa: las que el
 *  backend usó en una valoración en que no mandaste las tuyas. */
type EntradasDelFiling = { symbol: string; valores: Partial<Record<CampoEntrada, number | null>> }

/** Cómo se nombra cada campo que el backend valida, y los que van en porcentaje. */
const NOMBRE_DE_CAMPO: Record<string, string> = {
  growth_rate: 'el crecimiento del FCF',
  discount_rate: 'el WACC',
  terminal_growth: 'la perpetuidad',
  years: 'los años de proyección',
  base_fcf: 'el FCF de partida',
  net_debt: 'la deuda neta',
  shares_outstanding: 'las acciones en circulación',
}
const EN_PORCENTAJE = new Set(['growth_rate', 'discount_rate', 'terminal_growth'])
const LIMITE: Record<string, string> = { ge: 'como mínimo', le: 'como máximo', gt: 'más de', lt: 'menos de' }

/** Un 422 de validación del módulo, en español y con las unidades de pantalla:
 *  «el cálculo admite como mínimo -50 % en el crecimiento del FCF del escenario
 *  bajista (hay -75 %)». El mensaje de Pydantic decía «Input should be greater
 *  than or equal to -0.5», en inglés y en tanto por uno (revisión 14, H3). */
export function textoDeValidacion(errores: ErrorDeValidacion[]): string {
  const partes = errores.flatMap((e) => {
    const campo = String(e.loc[e.loc.length - 1])
    const nombre = NOMBRE_DE_CAMPO[campo]
    if (!nombre) return []
    const cifra = (v: unknown) =>
      typeof v !== 'number' ? null : EN_PORCENTAJE.has(campo) ? fmtPct(v, 1, { ceros: false }) : fmtNum(v, 2, { ceros: false })
    const escenario = e.loc[1] === 'escenarios' && typeof e.loc[2] === 'string' ? ` del escenario ${etiqueta(e.loc[2])}` : ''
    const hay = cifra(e.input)
    const limite = Object.entries(e.ctx ?? {}).flatMap(([k, v]) => {
      const c = cifra(v)
      return Object.hasOwn(LIMITE, k) && c !== null ? [`${LIMITE[k]} ${c}`] : []
    })
    return [`${limite.length ? limite.join(' y ') : 'otro valor'} en ${nombre}${escenario}${hay ? ` (hay ${hay})` : ''}`]
  })
  const que = partes.length ? `el cálculo admite ${partes.join('; ')}` : 'lo enviado no es válido'
  return `No se puede calcular: ${que}. Corrige lo escrito y vuelve a calcular.`
}

function EntradasPanel({
  textos,
  onCambiar,
  delFiling,
  abierto,
}: {
  textos: TextosEntrada
  onCambiar: (campo: CampoEntrada, texto: string) => void
  delFiling: EntradasDelFiling['valores']
  abierto: boolean
}) {
  // De partida, el dato del filing: escribir encima es una decisión, no un
  // campo que ya venga relleno. El del filing, no el que se usó: tras valorar
  // con tu deuda, vaciar el campo enseñaba tu cifra de antes como si fuera la
  // del filing (revisión 14, H8). Sin una valoración sin la tuya, no se sabe. Y
  // si el backend dijo que el filing no lo trae (`null`), no se promete: la
  // deuda vacía decía «la del filing» al lado del 422 que decía que no la trae
  // (revisión 15, H8).
  const ayuda = (campo: CampoEntrada): string =>
    Object.hasOwn(delFiling, campo) ? textoDeCampo(delFiling[campo], 0) || 'sin dato en el filing' : 'la del filing'
  return (
    <details open={abierto} className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-slate-600">
        Tus entradas (opcional): deuda neta, FCF, acciones y años
      </summary>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
        Vacío es el dato del filing. Lo que escribas sustituye al del filing en los tres escenarios; la deuda
        neta puede ser negativa si la empresa tiene más caja que deuda.
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {CAMPOS_ENTRADA.map(({ campo, rotulo, modo }) => (
          <label key={campo} className="flex flex-col justify-between gap-0.5 text-xs text-slate-500">
            {rotulo}
            <input
              inputMode={modo}
              value={textos[campo] ?? ''}
              placeholder={ayuda(campo)}
              onChange={(e) => onCambiar(campo, e.target.value)}
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm tabular-nums focus:border-sky-500 focus:outline-none"
            />
          </label>
        ))}
      </div>
    </details>
  )
}

export function ValuationPage() {
  // El símbolo llega por la URL (`?simbolo=ACME`, el enlace «Abrir el análisis
  // completo» de la ficha) y cada valoración lo deja en ella: la URL dice qué
  // empresa se está viendo, y atrás vuelve a la anterior.
  const [params, setParams] = useSearchParams()
  const pedido = (params.get(PARAM_SIMBOLO) ?? '').trim().toUpperCase()
  const [entrada, setEntrada] = useState(pedido)
  const [symbol, setSymbol] = useState('')
  const [data, setData] = useState<Valoracion | null>(null)
  const [supuestos, setSupuestos] = useState<Record<string, SupuestosEscenario>>({})
  const [textosEntrada, setTextosEntrada] = useState<TextosEntrada>({})
  // Las entradas tuyas con que se calculó lo que se ve, para decir cuáles son tuyas.
  const [usadas, setUsadas] = useState<EntradasPropias>({})
  const [delFiling, setDelFiling] = useState<EntradasDelFiling | null>(null)
  // El backend no pudo valorar por un dato que falta en el filing (422).
  const [faltaDato, setFaltaDato] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Los escenarios tuyos en lo que se ve: los que mandaste en esa valoración.
  // Siguen siendo tuyos al recalcular aunque no los vuelvas a tocar.
  const [propios, setPropios] = useState<string[]>([])
  // Un fallo al recalcular la misma empresa deja lo que se veía (revisión 15, H3).
  const [seQueda, setSeQueda] = useState(false)
  // La empresa de lo que se ve; `correr` no depende del estado (`useCallback`).
  const vista = useRef<string | null>(null)
  // Cada valoración monta los escenarios de nuevo: lo escrito a medias en un
  // campo no se queda encima de los supuestos que acaban de llegar.
  const [version, setVersion] = useState(0)
  const leidas = leerEntradas(textosEntrada)

  const correr = useCallback(
    async (s: string, escenarios?: Record<string, SupuestosEscenario>, entradas: EntradasPropias = {}) => {
      setBusy(true)
      setError(null)
      setFaltaDato(false)
      setSeQueda(false)
      try {
        const d = await api.valorar(s, { ...(escenarios ? { escenarios } : {}), ...entradas })
        setData(d)
        setSymbol(s)
        vista.current = s
        setUsadas(entradas)
        setPropios(Object.keys(escenarios ?? {}))
        // Lo que no mandaste salió del filing: se guarda para la ayuda de cada
        // campo. Lo que mandaste no lo cambia (es tuyo, no del filing).
        setDelFiling((antes) => ({
          symbol: s,
          valores: {
            ...(antes?.symbol === s ? antes.valores : {}),
            ...Object.fromEntries(
              CAMPOS_ENTRADA.filter(({ campo }) => entradas[campo] === undefined).map(({ campo }) => [campo, d.entradas[campo]]),
            ),
          },
        }))
        setSupuestos(
          Object.fromEntries(
            Object.entries(d.escenarios).map(([k, v]) => [k, { ...v.supuestos }]),
          ),
        )
        setVersion((v) => v + 1)
      } catch (e) {
        // Un 422 de validación es lo escrito, que no cabe en lo que admite el
        // cálculo (un crecimiento por debajo del −50 %): se dice en español y la
        // valoración de antes se queda, con lo escrito en sus campos. Antes
        // borraba la valoración, salía el mensaje de Pydantic en inglés y en
        // tanto por uno, y se abrían «Tus entradas» como si faltara la deuda
        // (revisión 14, H3).
        if (e instanceof ApiError && e.status === 422 && e.validacion) {
          setError(textoDeValidacion(e.validacion))
          return
        }
        setError(e instanceof Error ? e.message : 'Error')
        // Cualquier otro fallo de la misma empresa (un 502 de EDGAR) también deja
        // lo que se veía, con tus supuestos escritos, para volver a pulsar.
        // Borraba la valoración y con ella «Recalcular con mis supuestos»: solo
        // quedaba «Valorar», que vuelve a lo propuesto, y lo escrito se perdía
        // (revisión 15, H3). Un dato que falta sí la quita: no hay valoración con
        // estas entradas hasta que lo escribas.
        if (vista.current === s && !faltaUnDato(e)) {
          setSeQueda(true)
          return
        }
        setData(null)
        vista.current = null
        // Un 422 con texto del backend es un dato que falta en el filing: se
        // abren los campos para escribirlo. «Reintentar» tal cual daría lo mismo.
        setFaltaDato(faltaUnDato(e))
        // Y el campo que el filing no trae, si el backend lo dice, se apunta como
        // sin dato: su ayuda ya no promete «la del filing» (revisión 15, H8).
        const falta = faltaUnDato(e) ? CAMPOS_ENTRADA.find(({ campo }) => campo === e.datoQueFalta)?.campo : undefined
        if (falta) {
          setDelFiling((antes) => ({
            symbol: s,
            valores: { ...(antes?.symbol === s ? antes.valores : {}), [falta]: null },
          }))
        }
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  // Con `?simbolo=` se valora al abrir, sin pulsar nada, y sin las entradas
  // escritas para otra empresa. Una vez por símbolo: React monta dos veces en
  // StrictMode y sin la guarda la valoración llegaba dos veces al backend.
  const valorado = useRef<string | null>(null)
  useEffect(() => {
    if (!pedido || valorado.current === pedido) return
    valorado.current = pedido
    setEntrada(pedido)
    setTextosEntrada({})
    void correr(pedido)
  }, [pedido, correr])

  // La misma empresa se vuelve a valorar con tus entradas; otra cambia la URL y
  // el efecto de arriba la valora desde cero.
  const valorar = (s: string) => {
    if (s === pedido) void correr(s, undefined, leidas.valores)
    else setParams({ [PARAM_SIMBOLO]: s })
  }
  const tuya = (campo: CampoEntrada) => (usadas[campo] !== undefined ? ' (la tuya)' : '')
  // «Recalcular con mis supuestos» manda solo los escenarios tuyos: los que
  // tocaste ahora y los que ya eran tuyos. Mandaba los tres de la respuesta
  // anterior, y con un FCF escrito de otro signo que el del filing se valoraban
  // los propuestos para el otro signo: el bajista salía por encima del alcista
  // (revisión 15, H1). Los no tocados los propone el backend con tus entradas.
  const escenariosTuyos = (): Record<string, SupuestosEscenario> | undefined => {
    const tuyos = Object.keys(supuestos).filter(
      (n) => propios.includes(n) || !mismosSupuestos(supuestos[n], data?.escenarios[n]?.supuestos),
    )
    return tuyos.length ? Object.fromEntries(tuyos.map((n) => [n, supuestos[n]])) : undefined
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-800">Valoración</h1>
      <p className="text-xs leading-relaxed text-slate-500">
        DCF por escenarios, DCF inverso, comparables ajustados por crecimiento y
        calidad, y qué supuesto decide el resultado.{' '}
        <strong>Aquí no hay ningún precio objetivo</strong> — hay rangos, un
        intervalo y una curva.
      </p>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const s = entrada.trim().toUpperCase()
            if (s) valorar(s)
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            placeholder="AAPL"
            aria-label="Símbolo"
            className="w-36 rounded-lg border border-slate-300 px-3 py-1.5 text-sm uppercase focus:border-sky-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || leidas.ilegibles.length > 0}
            className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Calculando…' : 'Valorar'}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
          {error && seQueda && (
            <span className="text-xs text-slate-500">
              Lo que ves es la valoración de antes, con lo que has escrito: vuelve a calcular para reintentarlo.
            </span>
          )}
        </form>
        {/* Solo con una empresa elegida: son entradas de ESA empresa, y al
            cambiar de empresa se vacían. */}
        {pedido && (
          <EntradasPanel
            textos={textosEntrada}
            onCambiar={(campo, texto) => setTextosEntrada((prev) => ({ ...prev, [campo]: texto }))}
            delFiling={delFiling?.symbol === pedido ? delFiling.valores : {}}
            abierto={faltaDato || Object.values(textosEntrada).some((t) => t.trim() !== '')}
          />
        )}
        {leidas.ilegibles.length > 0 && (
          <p className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            No se puede leer {leidas.ilegibles.join(', ')}. Escribe las cifras como en el resto de la app,
            p.&nbsp;ej. 1.250.000 o -3,5, los años en número entero de 3 a 10 y las acciones mayores que cero:
            no se calcula con un número a medias.
          </p>
        )}
        <AtajosWatchlist
          actual={symbol}
          elegir={(s) => {
            setEntrada(s)
            valorar(s)
          }}
        />
      </section>

      {data && (
        <>
          {data.rango_global && <RangoGlobalPanel g={data.rango_global} />}
          <SensibilidadPanel s={data.sensibilidad} />
          <Escenarios
            key={version}
            data={data}
            supuestos={supuestos}
            busy={busy}
            bloqueado={leidas.ilegibles.length > 0}
            onCambiar={(n, campo, v) =>
              setSupuestos((prev) => ({ ...prev, [n]: { ...prev[n], [campo]: v } }))
            }
            onAplicar={() => correr(symbol, escenariosTuyos(), leidas.valores)}
          />
          <InversoPanel inv={data.dcf_inverso} />
          <ComparablesPanel c={data.comparables} />

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              De dónde salen las entradas
            </h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">FCF de partida</dt>
                <dd className="tabular-nums text-slate-800">{fmtCompacto(data.entradas.base_fcf) + tuya('base_fcf')}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">Deuda neta</dt>
                <dd className="tabular-nums text-slate-800">{fmtCompacto(data.entradas.net_debt) + tuya('net_debt')}</dd>
                {/* El mismo marcador que Salud y el informe (Ronda 2): qué partida
                    cuenta como cero. Antes, aquí solo «(parcial)». */}
                <DeudaParcial falta={data.entradas.deuda_parcial} />
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">Acciones</dt>
                <dd className="tabular-nums text-slate-800">
                  {fmtCompacto(data.entradas.shares_outstanding) + tuya('shares_outstanding')}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-400">Ejercicio</dt>
                <dd className="tabular-nums text-slate-800">{String(data.entradas.fiscal_year ?? '—')}</dd>
              </div>
            </dl>
            {data.entradas.nota_deuda && (
              <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                Deuda parcial. {data.entradas.nota_deuda}
              </p>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
              Estados financieros de {data.entradas.source}, ejercicio{' '}
              {String(data.entradas.fiscal_year)}; proyección a {data.entradas.years} años{tuya('years')}.
              Crecimiento histórico (
              <Ventana anos={data.entradas.crecimiento_historico.years} />):{' '}
              ingresos {pct(data.entradas.crecimiento_historico.revenue_cagr)} ·
              FCF {pct(data.entradas.crecimiento_historico.fcf_cagr)} · BPA{' '}
              {pct(data.entradas.crecimiento_historico.eps_cagr)}.
            </p>
          </section>

          <p className="text-[11px] leading-relaxed text-slate-400">
            {data.disclaimer}
          </p>
        </>
      )}
    </div>
  )
}
