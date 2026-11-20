import type { AlternativaDecision, Decision, ReglaTraza } from '../api/types'
import { etiqueta } from '../lib/etiquetas'
import { ESPACIO_DURO, decimalesFrente, fmtFrente, fmtNum, fmtPct, fmtPrecio } from '../lib/formato'

// Todo lo que se pinta aquí sale de la traza del motor de reglas: qué regla se
// evaluó, con qué valor, contra qué umbral y qué papel tuvo. No hay texto
// generado: si la explicación no está en la traza, no está.

const PAPEL: Record<string, { texto: string; tono: string }> = {
  decide: { texto: 'decide', tono: 'bg-slate-900 text-white' },
  bloquea: { texto: 'bloquea', tono: 'bg-amber-100 text-amber-800' },
  a_favor: { texto: 'a favor', tono: 'bg-emerald-100 text-emerald-800' },
  modifica: { texto: 'modifica', tono: 'bg-sky-100 text-sky-800' },
  informa: { texto: 'informa', tono: 'bg-slate-100 text-slate-800' },
  evaluada: { texto: 'evaluada', tono: 'bg-slate-100 text-slate-500' },
}

const RESULTADO: Record<string, { texto: string; tono: string }> = {
  cumple: { texto: '✓ cumple', tono: 'text-emerald-700' },
  no_cumple: { texto: '✗ no cumple', tono: 'text-slate-500' },
  desconocido: { texto: '? desconocido', tono: 'text-amber-800' },
}

// Las reglas cuyo valor y umbral son precios. Con `fmtNum(v, 2)` el caso de la
// auditoría (precio 0,003, stop 0,004) se leía «0,00 frente a 0,00» justo en la
// traza, que ES la explicación (revisión de A1).
const REGLAS_DE_PRECIO = new Set(['stop_perforado', 'tendencia_perdida', 'tendencia_a_favor'])

function valor(v: unknown, esPrecio = false, umbrales: number[] = []): string {
  if (v === null || v === undefined) return '—'
  // Una puntuación, de su lado de su umbral: con dos decimales, 0,3496 frente a
  // 0,35 salía «0,35 frente a 0,35 ✗ no cumple» (revisión 7).
  if (typeof v === 'number') return esPrecio ? fmtPrecio(v) : umbrales.length ? fmtFrente(v, umbrales) : fmtNum(v, 2)
  return etiqueta(String(v))
}

// Los umbrales de cada cifra, de todas las reglas que la comparan. La puntuación
// se compara con dos: escrita frente al suyo, -0,3496 salía «-0,35» junto a
// «≥ +0,35» y «-0,3496» dos líneas más abajo, junto a «≤ -0,35» (revisión 8).
function umbralesPorCifra(pares: { valor: unknown; umbral: unknown; precio: boolean }[]): Map<number, number[]> {
  const mapa = new Map<number, number[]>()
  for (const { valor: v, umbral: u, precio } of pares) {
    if (precio || typeof v !== 'number' || typeof u !== 'number') continue
    mapa.set(v, [...(mapa.get(v) ?? []), u])
  }
  return mapa
}

const deSuCifra = (mapa: Map<number, number[]>, v: unknown, u: unknown): number[] =>
  (typeof v === 'number' ? mapa.get(v) : undefined) ?? (typeof u === 'number' ? [u] : [])

// Una distancia en puntos porcentuales que no se escribe como cero si no lo es:
// con dos decimales fijos, 509,99 frente a «≥ 510,00» decía «falta 0,00 %»
// (revisión 8).
function distanciaPct(d: number): string {
  const decimales = decimalesFrente(d, [0])
  return fmtPct(d, decimales, { enPuntos: true, signo: true, ceros: decimales === 2 })
}

export function PorQue({ reglas }: { reglas: ReglaTraza[] }) {
  // Primero lo que movió la decisión; lo meramente evaluado, al final.
  const orden = ['decide', 'modifica', 'bloquea', 'a_favor', 'informa', 'evaluada']
  const ordenadas = [...reglas].sort((a, b) => orden.indexOf(a.papel) - orden.indexOf(b.papel))
  const umbrales = umbralesPorCifra(
    reglas.map((r) => ({ valor: r.datos?.valor, umbral: r.datos?.umbral, precio: REGLAS_DE_PRECIO.has(r.id) })),
  )
  return (
    // Más aire entre reglas que dentro de una: en móvil cada regla ocupa dos o
    // tres líneas y, con `space-y-1` frente a `gap-2`, la etiqueta de una parecía
    // de la siguiente (revisión del 2.12).
    <ul className="space-y-2">
      {ordenadas.map((r) => {
        const p = PAPEL[r.papel] ?? PAPEL.evaluada
        const res = RESULTADO[r.resultado] ?? RESULTADO.desconocido
        const tieneCifras = r.datos?.valor !== undefined && r.datos?.umbral !== undefined
        return (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${p.tono}`}>{p.texto}</span>
            <span className="text-slate-700">{r.regla}</span>
            {tieneCifras && (
              <span className="tabular-nums text-slate-500">
                ({valor(r.datos.valor, REGLAS_DE_PRECIO.has(r.id), deSuCifra(umbrales, r.datos.valor, r.datos.umbral))}{' '}
                frente a {valor(r.datos.umbral, REGLAS_DE_PRECIO.has(r.id), typeof r.datos.umbral === 'number' ? [r.datos.umbral] : [])})
              </span>
            )}
            <span className={`font-medium ${res.tono}`}>{res.texto}</span>
            {r.efecto && r.papel !== 'evaluada' && (
              <span className="text-slate-400">→ {etiqueta(r.efecto, { mayuscula: true })}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function QueLaCambiaria({ cambiaria }: { cambiaria: AlternativaDecision[] }) {
  const umbrales = umbralesPorCifra(
    cambiaria.flatMap((alt) => alt.condiciones.map((c) => ({ valor: c.actual, umbral: c.umbral, precio: c.unidad === '%' }))),
  )
  return (
    <ul className="space-y-2">
      {cambiaria.map((alt, i) => (
        <li key={i} className="text-xs">
          <div className="font-medium text-slate-800">
            → {etiqueta(alt.hacia, { mayuscula: true })}{' '}
            <span className="font-normal text-slate-400">
              {alt.condiciones.length > 1 ? (alt.requiere === 'todas' ? 'si se cumplen TODAS:' : 'si se cumple ALGUNA:') : 'si:'}
            </span>
          </div>
          <ul className="ml-3 mt-0.5 space-y-0.5">
            {alt.condiciones.map((c, j) => (
              <li key={j} className="text-slate-600">
                · {c.condicion}
                {c.distancia !== null && c.distancia !== undefined && (
                  <span className="ml-1 tabular-nums text-slate-400">
                    (ahora {valor(c.actual, c.unidad === '%', deSuCifra(umbrales, c.actual, c.umbral))}; falta{' '}
                    {c.unidad === '%'
                      ? distanciaPct(c.distancia)
                      : fmtFrente(c.distancia, 0, { signo: true }) + (c.unidad ? `${ESPACIO_DURO}${c.unidad}` : '')})
                  </span>
                )}
                {c.nota && <span className="ml-1 text-amber-800">{c.nota}</span>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

/** «¿Por qué esta decisión?» y «¿Qué la cambiaría?», plegados por defecto. */
export function DecisionExplicada({ decision, abierta = false }: { decision: Decision; abierta?: boolean }) {
  if (!decision.reglas?.length && !decision.cambiaria?.length) return null
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {decision.reglas?.length ? (
        <details open={abierta} className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            ¿Por qué esta decisión?
          </summary>
          <div className="mt-2">
            <PorQue reglas={decision.reglas} />
            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              El motor es una lista de reglas con prioridad: la primera que se cumple decide. Esto es su
              traza, no una explicación redactada.
            </p>
          </div>
        </details>
      ) : null}
      {decision.cambiaria?.length ? (
        <details open={abierta} className="rounded-lg border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            ¿Qué la cambiaría?
          </summary>
          <div className="mt-2">
            <QueLaCambiaria cambiaria={decision.cambiaria} />
          </div>
        </details>
      ) : null}
    </div>
  )
}
