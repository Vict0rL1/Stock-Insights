import { useState, type ReactNode } from 'react'
import { api } from '../../api/client'
import type { AnalisisEmpresaResponse, CambioMetrica, CosteOportunidad, RiesgoEnCartera } from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { leerNumero } from '../../lib/entrada'
import { fmtFecha, fmtFrente, fmtNum, fmtPct, plural } from '../../lib/formato'
import { fmtMetrica } from '../../lib/metricas'
import { mensajeDeError, useDato } from '../../lib/useDato'
import { DecisionExplicada } from '../DecisionExplicada'
import { BloqueDatos } from '../EstadoDato'
import { BloqueIA, BotonIA } from '../ia/ContenidoIA'

export const NIVEL: Record<string, string> = {
  alta: 'bg-emerald-100 text-emerald-800',
  media: 'bg-amber-100 text-amber-800',
  baja: 'bg-red-100 text-red-800',
}

const FACTOR: Record<string, string> = {
  ok: 'text-emerald-700',
  debil: 'text-amber-800',
  critico: 'text-red-700',
  desconocido: 'text-amber-800',
}

// La puntuación, frente a los umbrales de las reglas de la decisión que se pinta
// al lado: con dos decimales, 0,15 → 0,3496 salía «0,15 → 0,35» junto a una traza
// que decía 0,3496 (revisión 9).
function valorDe(v: number | string | null, c: CambioMetrica, umbrales: number[]): string {
  return c.clave === 'score' && typeof v === 'number' && umbrales.length
    ? fmtFrente(v, umbrales, { signo: true })
    : fmtMetrica(v, c.unidad)
}

// Una fracción como se lee en la fila (`fmtMetrica`: en puntos, con un decimal).
const puntosEscritos = (v: number) => leerNumero(fmtNum(v * 100, 1)) ?? v * 100

// La diferencia en pp, de lo que se lee: con la de los valores sin redondear,
// «33,4 % → 30,1 %» decía «(-3,4 pp)», y la resta de lo escrito da -3,3
// (revisión 12, visual).
function diferenciaEnPuntos(c: CambioMetrica): number | null {
  if (typeof c.antes !== 'number' || typeof c.ahora !== 'number') return c.absoluto === undefined ? null : c.absoluto * 100
  return puntosEscritos(c.ahora) - puntosEscritos(c.antes)
}

function Cambio({ c, umbrales }: { c: CambioMetrica; umbrales: { antes: number[]; ahora: number[] } }) {
  const tono =
    c.tipo === 'dato_perdido' ? 'text-amber-800' : c.direccion === 'baja' ? 'text-red-700' : c.direccion === 'sube' ? 'text-emerald-700' : 'text-slate-700'
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-1 text-xs last:border-0">
      <span className="text-slate-700">{c.etiqueta}</span>
      {/* `ml-auto`: al bajar de línea (rótulo largo en móvil) el valor seguía a
          la derecha solo en unas filas y en otras se pegaba a la izquierda. */}
      <span className={`ml-auto tabular-nums ${tono}`}>
        {valorDe(c.antes, c, umbrales.antes)} → {valorDe(c.ahora, c, umbrales.ahora)}
        {c.tipo === 'material' && c.unidad === 'fracción' && diferenciaEnPuntos(c) !== null && (
          <span className="ml-1 text-slate-400">({fmtNum(diferenciaEnPuntos(c), 1, { signo: true })} pp)</span>
        )}
        {c.tipo === 'material' && c.unidad === 'puntos' && c.absoluto !== undefined && (
          <span className="ml-1 text-slate-400">({c.absoluto >= 0 ? '+' : ''}{fmtNum(c.absoluto, 2)} puntos)</span>
        )}
        {c.tipo === 'material' && c.unidad !== 'fracción' && c.unidad !== 'puntos' && c.relativo != null && (
          <span className="ml-1 text-slate-400">({fmtPct(c.relativo, 1, { signo: true })})</span>
        )}
        {c.tipo === 'dato_nuevo' && <span className="ml-1 rounded bg-sky-100 px-1 text-[10px] text-sky-800">dato nuevo</span>}
        {c.tipo === 'dato_perdido' && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">dato perdido</span>}
      </span>
    </li>
  )
}

export function RiesgoResumen({ r }: { r: RiesgoEnCartera }) {
  if (r.estado === 'sin_cartera') return <p className="text-xs text-slate-500">Sin posiciones valoradas: no hay riesgo de cartera que medir.</p>
  if (r.estado !== 'valido') return <p className="text-xs text-amber-800">Riesgo en cartera DESCONOCIDO: {r.motivo}</p>
  return (
    <div className="text-xs text-slate-700">
      <p>
        {r.en_cartera ? (
          <>Pesa el <strong>{fmtPct(r.peso)}</strong> y aporta el <strong>{fmtPct(r.contribucion)}</strong> del riesgo medido.</>
        ) : (
          <>Si la añadieras al {fmtPct(r.peso_supuesto)}, aportaría el <strong>{fmtPct(r.contribucion)}</strong> del riesgo
            (volatilidad de la cartera {fmtPct(r.volatilidad_cartera_antes)} → {fmtPct(r.volatilidad_cartera_despues)}).</>
        )}
      </p>
      <p className="mt-1 text-slate-500">
        Correlación con la cartera {fmtNum(r.correlacion_con_cartera ?? null, 2)} · clúster {r.cluster_nivel ?? '—'} ·
        riesgo por unidad de peso {fmtNum(r.riesgo_por_peso ?? null, 2)}
      </p>
      {/* Con posiciones sin valorar, «pesa el 100 %» no era verdad (revisión 6). */}
      {r.aviso && <p className="mt-1 text-amber-800">{r.aviso}</p>}
    </div>
  )
}

const VEREDICTO: Record<string, string> = {
  NO_ACCION: 'bg-slate-100 text-slate-800',
  COMPRAR_CON_EFECTIVO: 'bg-emerald-100 text-emerald-800',
  REVISAR_PARA_FINANCIAR: 'bg-sky-100 text-sky-800',
  NO_TRADE: 'bg-amber-100 text-amber-800',
  INDETERMINADO: 'bg-amber-100 text-amber-800',
}

export function CosteOportunidadResumen({ oc }: { oc: CosteOportunidad }) {
  if (!oc.veredicto) return <p className="text-xs text-amber-800">Coste de oportunidad no disponible: {oc.motivo}</p>
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 font-medium ${VEREDICTO[oc.veredicto.accion] ?? ''}`}>
          {etiqueta(oc.veredicto.accion, { mayuscula: true })}
        </span>
        {oc.tamano && (
          <span className="text-slate-500">
            tamaño máximo {fmtPct(oc.tamano.maximo_permitido)} · efectivo{' '}
            {oc.tamano.efectivo_disponible == null ? 'DESCONOCIDO' : fmtPct(oc.tamano.efectivo_disponible)}
            {oc.tamano.financiacion_necesaria != null && ` · a financiar ${fmtPct(oc.tamano.financiacion_necesaria)}`}
          </span>
        )}
      </div>
      <p className="text-slate-700">{oc.veredicto.motivo}</p>
      {oc.candidatos_a_revisar && oc.candidatos_a_revisar.length > 0 && (
        <table className="w-full text-left">
          <thead className="text-[10px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1">Posición</th>
              <th>Prioridad</th>
              <th>Mejora / exigida</th>
              <th>Coste del cambio</th>
              <th>Por qué</th>
            </tr>
          </thead>
          <tbody>
            {oc.candidatos_a_revisar.map((f) => (
              <tr key={f.symbol} className="border-t border-slate-100 align-top">
                <td className="py-1 font-medium text-slate-800">{f.symbol}</td>
                <td className="tabular-nums">{fmtNum(f.prioridad.puntos, 2, { ceros: false })}</td>
                <td className={`tabular-nums ${f.supera_umbral ? 'text-sky-800' : 'text-slate-500'}`}>
                  {fmtNum(f.mejora, 2, { ceros: false })} / {fmtNum(f.mejora_requerida, 2, { ceros: false })}
                </td>
                <td className="tabular-nums text-slate-500">
                  {fmtPct(f.coste_del_cambio.total_conocido_pct, 2, { enPuntos: true })}
                  {f.coste_del_cambio.impuestos === 'desconocidos' && f.coste_del_cambio.nota && (
                    <span className="block text-[10px] text-amber-800">+ impuestos desconocidos</span>
                  )}
                </td>
                <td className="text-slate-500">
                  {f.elegible
                    ? f.prioridad.desglose.map((d) => `${d.nota} (${d.puntos >= 0 ? '+' : '−'}${Math.abs(d.puntos)})`).join(' · ') || '—'
                    : <span className="text-amber-800">{f.motivo}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {oc.impuestos?.nota && <p className="text-[10px] text-slate-400">{oc.impuestos.nota}</p>}
    </div>
  )
}

type Analisis = AnalisisEmpresaResponse['analisis']

/** Cada factor de la confianza con su estado y su motivo, y la regla que los
 *  junta. Aquí y en la cabecera de la ficha («Qué dice la app»). */
export function FactoresDeConfianza({ confianza }: { confianza: Analisis['confianza'] }) {
  return (
    <>
      <ul className="mt-2 space-y-0.5 text-xs">
        {confianza.factores.map((f) => (
          <li key={f.id}>
            <span className={`font-medium ${FACTOR[f.estado]}`}>{etiqueta(f.estado)}</span>{' '}
            <span className="text-slate-700">{f.factor}:</span> <span className="text-slate-500">{f.detalle}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] text-slate-400">Regla: {confianza.regla}</p>
    </>
  )
}
type Impacto = NonNullable<NonNullable<Analisis['expectativas']['ultimo']>['impacto_en_tesis']>[number]

/** Un punto de invalidación cruzado, con sus dos lecturas: la de la vigilancia
 *  (ejercicio) y la de los resultados del último trimestre. */
interface PuntoCruzado {
  id: number | null
  descripcion: string
  enEjercicio: boolean
  /** Lo que dice la vigilancia del ejercicio; `null` si no dice nada. */
  detalle: string | null
  enTrimestre: boolean
}

// La descripción, para reconocer el mismo punto en las dos lecturas cuando el
// backend no dice de qué punto sale la trimestral: las dos salen del mismo texto
// del punto, pero una puede llegar con otras mayúsculas o espacios.
const normalizar = (texto: string) => texto.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es')

// El punto del que sale la lectura trimestral: `disparador_id`, el id del punto
// de la tesis (el mismo que `tesis.disparadores[].id`; revisión 13).
function idDelPunto(i: Impacto): number | null {
  return typeof i.disparador_id === 'number' ? i.disparador_id : null
}

/** Qué lecturas trimestrales son de la tesis que se enseña y cuáles no. Con
 *  `tesis_id`, lo dice el backend; sin él, un punto que no está entre los de esta
 *  tesis es de otra del mismo valor (las reglas del trimestre salen de todas).
 *  Sin la lista de puntos de la tesis no se puede saber, y cuenta como suyo,
 *  como antes. */
function esDeEstaTesis(i: Impacto, tesis: Analisis['tesis'] | undefined): boolean {
  if (i.tesis_id != null && tesis?.id != null) return i.tesis_id === tesis.id
  const suyos = tesis?.disparadores
  if (!suyos?.length) return true
  const id = idDelPunto(i)
  return suyos.some((t) => (id !== null ? t.id === id : normalizar(t.descripcion) === normalizar(i.punto)))
}

/** Los puntos cruzados de la tesis, uno por punto: el mismo punto que cruza en la
 *  vigilancia (ejercicio) y en los resultados del trimestre se contaba dos veces
 *  («tiene 2 puntos» con uno solo), y los de otra tesis del mismo valor se
 *  contaban como de esta (revisión 13). */
function puntosCruzados(a: Analisis): { propios: PuntoCruzado[]; ajenos: PuntoCruzado[] } {
  const propios: PuntoCruzado[] = (a.tesis?.disparadores ?? [])
    .filter((t) => t.salta)
    .map((t) => ({ id: t.id, descripcion: t.descripcion, enEjercicio: true, detalle: t.detalle, enTrimestre: false }))
  const ajenos: PuntoCruzado[] = []
  for (const i of a.expectativas?.ultimo?.impacto_en_tesis ?? []) {
    if (i.estado !== 'invalidado') continue
    const lista = esDeEstaTesis(i, a.tesis) ? propios : ajenos
    const id = idDelPunto(i)
    const mismo = lista.find((p) => (id !== null && p.id !== null ? p.id === id : normalizar(p.descripcion) === normalizar(i.punto)))
    if (mismo) mismo.enTrimestre = true
    else lista.push({ id, descripcion: i.punto, enEjercicio: false, detalle: null, enTrimestre: true })
  }
  return { propios, ajenos }
}

function textoDelPunto(p: PuntoCruzado, periodo: string): string {
  const trimestre = `según los resultados de ${periodo}: trimestre, no ejercicio`
  if (!p.enEjercicio) return `${p.descripcion} (${trimestre})`
  const ejercicio = `${p.descripcion}${p.detalle ? ` (${p.detalle})` : ''}`
  return p.enTrimestre ? `${ejercicio}; también ${trimestre}` : ejercicio
}

/**
 * Los puntos de la tesis que hoy están cruzados, junto a la decisión. Salían
 * solo en rojo al final del diff, debajo de nueve cambios, y el bloque de
 * «Vigilar», «¿Por qué esta decisión?» y «¿Qué la cambiaría?» no los nombraba
 * (revisión 12, visual). De lo que dice el análisis de ahora, no del diff: un
 * trimestre ya comparado deja de salir en el diff, y la tesis sigue rota.
 */
export function TesisInvalidada({ a, pie }: { a: Analisis; pie?: ReactNode }) {
  const ultimo = a.expectativas?.ultimo
  const periodo = ultimo?.evento.periodo ?? 'el último evento'
  const { propios, ajenos } = puntosCruzados(a)
  if (!propios.length && !ajenos.length) return null
  return (
    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
      {propios.length > 0 && (
        <>
          <p className="font-semibold">
            Tu tesis{a.tesis?.titulo ? ` «${a.tesis.titulo}»` : ''} tiene {propios.length}{' '}
            {plural(propios.length, 'punto de invalidación cruzado', 'puntos de invalidación cruzados')}:
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {propios.map((p, i) => (
              <li key={i}>· {textoDelPunto(p, periodo)}</li>
            ))}
          </ul>
        </>
      )}
      {/* Los de otra tesis del mismo valor no se callan (un punto cruzado es un
          aviso), pero tampoco se cuentan como de la que se enseña. */}
      {ajenos.length > 0 && (
        <>
          <p className={propios.length ? 'mt-1 font-semibold' : 'font-semibold'}>
            {ajenos.length} {plural(ajenos.length, 'punto cruzado', 'puntos cruzados')} en los resultados del trimestre, de
            otra de tus tesis sobre este valor:
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {ajenos.map((p, i) => (
              <li key={i}>· {textoDelPunto(p, periodo)}</li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-1 text-[11px]">El motor de decisión no mira la tesis: esta decisión no la tiene en cuenta.</p>
      {pie}
    </div>
  )
}

export function QueCambioSection({ symbol }: { symbol: string }) {
  const carga = useDato(() => api.analisisEmpresa(symbol), symbol)
  // Al cambiar de símbolo el bloque vuelve a «cargando» y `QueCambio` se monta
  // de nuevo: el resumen por IA del anterior no puede quedarse colgado aquí.
  return (
    <BloqueDatos carga={carga} que={`el análisis de ${symbol}`}>
      {(datos) => <QueCambio symbol={symbol} datos={datos} />}
    </BloqueDatos>
  )
}

function QueCambio({ symbol, datos }: { symbol: string; datos: AnalisisEmpresaResponse }) {
  const [resumenIa, setResumenIa] = useState<{ content_md: string; model: string; aviso: string } | null>(null)
  const [pidiendoIa, setPidiendoIa] = useState(false)
  // El fallo del resumen es del resumen: antes sustituía la sección entera, y
  // un 503 de la IA borraba de la pantalla el análisis ya calculado (ítem 2.1).
  const [errorIa, setErrorIa] = useState<string | null>(null)

  const { analisis: a, cambios } = datos
  const d = a.decision
  const umbralesPuntuacion = (d?.reglas ?? [])
    .filter((r) => r.id.startsWith('puntuacion'))
    .map((r) => r.datos?.umbral)
    .filter((u): u is number => typeof u === 'number')
  const pedirResumen = () => {
    setPidiendoIa(true)
    setErrorIa(null)
    api
      .resumenCambiosIa(symbol, cambios)
      .then(setResumenIa, (e: unknown) => setErrorIa(mensajeDeError(e)))
      .finally(() => setPidiendoIa(false))
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">
            Decisión del motor: <span className="text-slate-900">{d.label}</span>
            <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${NIVEL[a.confianza.nivel]}`}>
              confianza {a.confianza.nivel.toUpperCase()}
            </span>
          </h2>
          {/* La existente, sin «sin cambios materiales»: justo debajo, «¿Qué cambió?»
              cuenta 9 cambios materiales frente a OTRA instantánea, la anterior, y
              las dos frases parecían contradecirse (revisión 12, visual). */}
          <span className="text-[11px] text-slate-400">
            {datos.instantanea
              ? `${datos.instantanea.nueva ? 'Instantánea nueva' : 'Instantánea'} #${datos.instantanea.id} · ${fmtFecha(datos.instantanea.creado_en, { hora: true })}` +
                (datos.instantanea.nueva ? '' : ' · ya congelada: desde ella no ha cambiado nada que pida otra')
              : 'sin congelar'}
          </span>
        </div>
        {datos.sin_congelar && <p className="mt-1 text-[11px] leading-relaxed text-amber-800">{datos.sin_congelar}</p>}
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {d.reasons.map((r, i) => (
            <li key={i}>· {r}</li>
          ))}
        </ul>
        <TesisInvalidada a={a} />
        <div className="mt-3">
          <DecisionExplicada decision={d} abierta />
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            Confianza {a.confianza.nivel}: calidad de la evidencia (no convicción de nadie)
          </summary>
          <FactoresDeConfianza confianza={a.confianza} />
        </details>
        {a.faltan.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            Desconocido (no vale cero): {a.faltan.map((f) => etiqueta(f.dato)).join(', ')}.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800">¿Qué cambió desde el último análisis?</h2>
          {datos.anterior && (
            <span className="text-[11px] text-slate-400">
              frente a la instantánea #{datos.anterior.id} del {fmtFecha(datos.anterior.creado_en, { hora: true })}
            </span>
          )}
        </div>
        {cambios.primer_analisis ? (
          <p className="mt-2 text-xs text-slate-500">{cambios.nota}</p>
        ) : (
          <div className="mt-2 space-y-3">
            {cambios.decision?.cambio && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs">
                <div className="font-semibold text-sky-900">
                  {etiqueta(cambios.decision.antes, { mayuscula: true })} → {etiqueta(cambios.decision.ahora, { mayuscula: true })}
                </div>
                <ul className="mt-1 space-y-0.5 text-sky-900">
                  {cambios.decision.explicacion.map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[10px] text-sky-800">Sale de comparar las dos trazas del motor, no de un modelo de lenguaje.</p>
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              {Object.entries(cambios.categorias ?? {}).map(([cat, lista]) => (
                <div key={cat}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">{etiqueta(cat)}</div>
                  <ul>
                    {lista.map((c) => (
                      <Cambio
                        key={c.clave}
                        c={c}
                        // Cada lado con los de su traza, como la explicación de
                        // arriba y las razones de cada decisión: con los de ahora
                        // solo, el valor de antes se escribía con otros umbrales
                        // (revisión 10); con los de las dos juntas, el de ahora
                        // salía «+0,3496» junto a razones que decían «+0,35»
                        // (revisión 11).
                        // Sin ellos (una traza vacía o una respuesta de antes), los
                        // de la decisión que se pinta.
                        umbrales={{
                          antes: cambios.decision?.umbrales_puntuacion_antes?.length
                            ? cambios.decision.umbrales_puntuacion_antes
                            : umbralesPuntuacion,
                          ahora: cambios.decision?.umbrales_puntuacion_ahora?.length
                            ? cambios.decision.umbrales_puntuacion_ahora
                            : umbralesPuntuacion,
                        }}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {cambios.tesis && (
              <div className="text-xs">
                <div className="text-[10px] uppercase tracking-wide text-slate-400">Tesis</div>
                {(
                  [
                    ['Invalidaciones', cambios.tesis.invalidaciones, 'text-red-700'],
                    ['Deteriorados', cambios.tesis.deteriorados, 'text-amber-800'],
                    ['Nuevos riesgos', cambios.tesis.nuevos_riesgos, 'text-amber-800'],
                    ['Confirmados', cambios.tesis.confirmados, 'text-emerald-700'],
                  ] as const
                ).map(([t, l, tono]) =>
                  l.length ? (
                    <p key={t} className={tono}>
                      {t}:{' '}
                      {/* Con su motivo: «Nuevos riesgos: Si hay un recall» a secas parecía que
                          el recall había aparecido, cuando solo fallaron las noticias (revisión de M1). */}
                      {l
                        .map((x) => {
                          const extra = 'detalle' in x && x.detalle ? x.detalle : 'motivo' in x && x.motivo ? x.motivo : null
                          return `${x.punto}${extra ? ` (${extra})` : ''}`
                        })
                        .join('; ')}
                    </p>
                  ) : null,
                )}
                {!cambios.tesis.invalidaciones.length && !cambios.tesis.deteriorados.length &&
                  !cambios.tesis.nuevos_riesgos.length && !cambios.tesis.confirmados.length && (
                    <p className="text-slate-500">Sin cambios en los puntos de la tesis.</p>
                  )}
              </div>
            )}
            {cambios.materiales == null || cambios.irrelevantes == null ? (
              <p className="text-[10px] text-slate-400">Esta comparación no trae el recuento de cambios por debajo de su umbral.</p>
            ) : (
              <p className="text-[10px] text-slate-400">
                {cambios.materiales} {plural(cambios.materiales, 'cambio material', 'cambios materiales')};{' '}
                {cambios.irrelevantes} por debajo de su umbral no se {plural(cambios.irrelevantes, 'enseña', 'enseñan')}
                {/* Faltaba el espacio («enseñan(umbrales v…)») y el identificador iba
                    entero; corto, como un commit, sigue sirviendo para cotejar. */}
                {cambios.umbrales?.version ? ` (versión de los umbrales ${cambios.umbrales.version.slice(0, 7)})` : ''}.
              </p>
            )}
            <div>
              {/* Con el resumen ya a la vista, el botón se va, como en Noticias:
                  cada toque volvía a llamar al modelo y a gastar API. */}
              {!resumenIa && (
                <BotonIA onClick={pedirResumen} disabled={pidiendoIa}>
                  {pidiendoIa ? 'Resumiendo…' : 'Resumir este diff con IA (opcional, gasta API)'}
                </BotonIA>
              )}
              {errorIa && <p className="mt-2 text-xs text-red-700">No se pudo resumir con IA: {errorIa}</p>}
              {resumenIa && (
                <BloqueIA className="mt-2" modelo={resumenIa.model} aviso={resumenIa.aviso}>
                  {resumenIa.content_md}
                </BloqueIA>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Riesgo dentro de tu cartera</h2>
          <RiesgoResumen r={a.riesgo} />
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">¿Mejor que lo que ya tienes? (coste de oportunidad)</h2>
          <CosteOportunidadResumen oc={a.coste_oportunidad} />
        </section>
      </div>
    </div>
  )
}
