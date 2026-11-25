import { useEffect, useMemo, useState } from 'react'
import { DecisionExplicada } from '../components/DecisionExplicada'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { AvisoDeAccion } from '../components/AvisoDeAccion'
import { CompanyLogo } from '../components/CompanyLogo'
import { BloqueDatos, ErrorDeCarga } from '../components/EstadoDato'
import { ProgresoAnalisis } from '../components/ProgresoAnalisis'
import type {
  DailySignal,
  Conviction,
  Decision,
  ListaDesfasada,
  PrecioDelStop,
  Sizing,
  StopDePosicion,
  StopsDeCartera,
  TodayResponse,
} from '../api/types'
import {
  avisoDe,
  avisoDeLaFila,
  avisosDeCartera,
  carteraRepasada,
  notasDelStop,
  recortesDe,
  type Aviso,
} from '../lib/avisos'
import { etiqueta } from '../lib/etiquetas'
import {
  fmtAntiguedad,
  fmtFecha,
  fmtFrente,
  fmtNum,
  fmtPct,
  fmtPrecio,
  plural,
  signoLeido,
  ZONA_MERCADO,
} from '../lib/formato'
import { coord } from '../lib/svg'
import { useDato } from '../lib/useDato'
import { usePintarCadaMinuto } from '../lib/usePintarCadaMinuto'
import { REVALIDAR_TRAS_MS, useListaDiaria } from '../hooks/useListaDiaria'
import { RUTAS, rutaEmpresa } from '../lib/rutas'

// Los filtros por señal del plan (`docs/PLAN_NAVEGACION.md`): ideas, las que
// califican, vigilar, evitar, tu cartera y todas.
type View = 'ideas' | 'comprar' | 'vigilar' | 'evitar' | 'cartera' | 'todas'

/** Objetivo táctil de 44 px en el móvil, sin cambiar la densidad desde `sm`
 *  (revisión 14, H15: a 390 px las vistas medían 28 px, los sectores 24 y
 *  «Ver el análisis completo →», 16). */
const TACTIL = 'min-h-11 sm:min-h-0'
/** Lo mismo para el `summary` de un `details` con `py-3` en el móvil: con relleno,
 *  no con `flex`, que le quitaría el triángulo de plegado; el margen negativo se
 *  come el relleno del `details`, que así no crece. */
const SUMARIO_TACTIL = '-my-3 py-3.5 sm:my-0 sm:py-0'

/** El compuesto vive de facto en [-2, 2]; se mapea a 0-100 % para la barra. */
function scoreToPct(score: number): number {
  return Math.min(Math.max((score + 2) / 4, 0), 1) * 100
}

/** Minigráfico de un año en SVG. Sin librería: son 32 puntos y una polilínea. */
function Sparkline({ serie, subiendo }: { serie: number[]; subiendo: boolean }) {
  if (serie.length < 2) return <div className="h-6 w-20" />
  const min = Math.min(...serie)
  const max = Math.max(...serie)
  const span = max - min || 1
  const puntos = serie
    .map((v, i) => {
      const x = (i / (serie.length - 1)) * 78 + 1
      const y = 22 - ((v - min) / span) * 20
      return `${coord(x)},${coord(y)}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 80 24" className="h-6 w-20 overflow-visible" aria-hidden>
      <polyline
        points={puntos}
        fill="none"
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={subiendo ? 'stroke-emerald-500' : 'stroke-red-400'}
      />
    </svg>
  )
}

/** Dónde está el precio dentro de su rango de 52 semanas. */
function RangeBar({ position }: { position: number }) {
  return (
    <div className="relative h-1 w-full rounded-full bg-slate-100">
      <div
        className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 rounded-full bg-slate-500"
        style={{ left: `${Math.min(Math.max(position, 0), 1) * 100}%` }}
      />
    </div>
  )
}

/** El color de una variación del día: en neutro si lo que se escribe es cero o
 *  si no hay dato. Con `>= 0`, un «0,00 %» salía en verde, como una subida (FTV
 *  a 140,00, en la tarjeta y en la tabla; revisión 12, visual). Sigue a
 *  `signoLeido`, la única regla del signo que se lee. */
export function tonoDeVariacion(
  valor: number | null | undefined,
  escrito: string,
  sube: string,
  baja: string,
): string {
  const signo = valor === null || valor === undefined ? 0 : signoLeido(escrito)
  return signo === 0 ? 'text-slate-400' : signo > 0 ? sube : baja
}

// `recortesDe` y `notasDelStop` viven con el aviso de acción (`lib/avisos.ts`),
// que es quien los usa; se reexportan para quien los importaba de aquí.
export { notasDelStop, recortesDe }

/**
 * Dónde queda el stop respecto al precio de hoy, con signo: negativo = por
 * debajo. En una idea nueva el backend manda la distancia en positivo y la
 * tarjeta pintaba «+12,8 %» en rojo, mientras el disparador decía «Salir si
 * cierra bajo X (-12,8 %)» (revisión de la Fase 1). Sobre una posición ya
 * viene con signo, y un positivo es un stop perforado: no se toca.
 */
export function distanciaAlStop(decision: Decision): number | null {
  const pct = decision.levels?.stop_pct
  if (pct === null || pct === undefined) return null
  return decision.owned ? pct : -pct
}

/** La distancia al stop, sin escribirse como cero si no lo es: con el stop en
 *  100 y el precio en 100,04 (o 99,96, ya perforado) decía «0,0 %» (revisión 9). */
export function textoDistanciaAlStop(decision: Decision): string {
  const puntos = distanciaAlStop(decision)
  return fmtFrente(puntos === null ? null : puntos / 100, 0, { pct: true, signo: true })
}

/** Los umbrales de puntuación de la propia decisión (con posición, solo el de
 *  vender), como su traza y sus razones: frente a los dos, una «mantener» con
 *  0,3496 decía «+0,3496» junto a «Puntuación +0,35» (revisión 9). */
function umbralesDeSuDecision(decision: Decision | undefined, porDefecto: number[]): number[] {
  const suyos = (decision?.reglas ?? [])
    .filter((r) => r.id.startsWith('puntuacion'))
    .map((r) => r.datos?.umbral)
    .filter((u): u is number => typeof u === 'number')
  return suyos.length ? suyos : porDefecto
}

/** El plan completo: por qué, a qué precio, y cuándo salir. */
function DecisionPlan({ decision, symbol }: { decision: Decision; symbol?: string }) {
  const { levels } = decision
  return (
    <div className="space-y-3">
      <ul className="space-y-1 text-xs leading-snug text-slate-600">
        {decision.reasons.map((r, i) => (
          <li key={i}>· {r}</li>
        ))}
      </ul>

      <DecisionExplicada decision={decision} />
      {/* El enlace abre el Resumen de la ficha, que es donde están: «(pestaña
          «Qué cambió»)» mandaba a una pestaña que ya no existe (es una sección de
          Novedades, y no tiene la traza; revisión 14, H11). */}
      {decision.traza_en_ficha && symbol && (
        <p className="text-[11px] text-slate-500">
          El porqué regla a regla y qué cambiaría esta decisión están en la{' '}
          <Link to={rutaEmpresa(symbol)} className="font-medium underline">
            ficha de {symbol}
          </Link>
          , en su Resumen («Lo que comprueba la app»).
        </p>
      )}

      {levels && (
        // Sobre una posición abierta no hay zona de compra ni peso que sugerir:
        // esos campos llegan nulos y no se pintan. Enseñar «zona de compra» a
        // algo que la app te está diciendo que vendas sería contradecirse.
        <div className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-white p-3 sm:grid-cols-4">
          {levels.entrada_desde !== null && levels.entrada_hasta !== null && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Zona de compra
              </div>
              <div className="text-sm tabular-nums text-slate-800">
                {fmtPrecio(levels.entrada_desde)}–{fmtPrecio(levels.entrada_hasta)}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              Stop
            </div>
            <div className="text-sm tabular-nums text-red-600">
              {fmtPrecio(levels.stop)}{' '}
              <span className="text-xs text-slate-400">
                {textoDistanciaAlStop(decision)}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              Objetivo
            </div>
            <div className="text-sm tabular-nums text-emerald-700">
              {fmtPrecio(levels.objetivo)}{' '}
              <span className="text-xs text-slate-400">
                {fmtFrente(levels.objetivo_pct == null ? null : levels.objetivo_pct / 100, 0, { pct: true, signo: true })}
              </span>
            </div>
          </div>
          {levels.peso_bruto_pct !== null && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                Peso bruto
              </div>
              <div className="text-sm tabular-nums text-slate-800">
                {fmtPct(levels.peso_bruto_pct, 1, { enPuntos: true })}
                <span className="block text-[10px] text-slate-400">
                  antes de límites de cartera
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Un stop y un objetivo dicen dónde SALDRÍAS, no qué sueles ganar: casi
          la mitad de las operaciones no llegan a ninguno de los dos y vencen
          por plazo en un punto intermedio. Estos tres números salen del
          histórico simulado, así que describen lo que pasó. */}
      {decision.escenarios && (
        <div className="rounded-lg bg-slate-100 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            Qué pasó con operaciones como esta ({decision.escenarios.n} simuladas)
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-3">
            {(
              [
                ['Bajista', decision.escenarios.bajista, 'text-red-600'],
                ['Base', decision.escenarios.base, 'text-slate-900'],
                ['Alcista', decision.escenarios.alcista, 'text-emerald-700'],
              ] as const
            ).map(([label, valor, tono]) => (
              <div key={label}>
                <div className="text-[10px] text-slate-400">{label}</div>
                <div className={`text-sm font-medium tabular-nums ${tono}`}>
                  {fmtPct(valor, 1, { signo: true, enPuntos: true })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
            {decision.escenarios.nota}
          </p>
        </div>
      )}

      {decision.triggers.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">
            Cuándo actuar
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
            {decision.triggers.map((t, i) => (
              <li key={i}>→ {t}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Un sistema probado y perdedor no puede avisar con la misma letra
          pequeña gris que uno sin probar: es la información más valiosa que
          la app puede darte y va en rojo, no de pasada. */}
      {decision.confidence === 'refutada' ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] leading-snug text-red-700">
          <strong>Estas reglas se probaron contra histórico y no funcionaron:</strong>{' '}
          aplicarlas en el periodo medido habría perdido dinero, o habría ganado
          menos que comprar a ciegas. La operación de arriba es lo que dictan las
          reglas, no una recomendación. Revisa el detalle en{' '}
          <Link to={RUTAS.senales} className="font-medium underline">
            Señales
          </Link>
          .
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-slate-400">
          {decision.confidence === 'calibrada'
            ? 'Reglas validadas contra el histórico del backtest: en el periodo ' +
              'medido tuvieron esperanza positiva y superaron a comprar a ciegas. ' +
              'Haber funcionado antes no garantiza que funcionen ahora.'
            : 'Reglas mecánicas todavía sin validar contra histórico: ejecuta el ' +
              'backtest de reglas en Señales para saber si han funcionado. Que sean ' +
              'razonables no significa que acierten.'}
        </p>
      )}
    </div>
  )
}

/** Lo que se cuenta de la cartera. `vender` junta lo que la lista manda vender
 *  con los stops perforados del repaso, también los de fuera de este mercado;
 *  `cartera` son TODAS las abiertas, no solo las de la lista: con STOP y SHOP.TO
 *  fuera del S&P 500, Hoy decía «Para vender 0 · nada urgente» con el stop de
 *  STOP perforado y «1 en cartera» con tres (revisión 12, visual). */
type Recuentos = {
  comprar: number
  vigilar: number
  evitar: number
  /** Las abiertas; sin repaso, solo las que están en la lista. */
  cartera: number
  /** Las abiertas que la lista de este mercado no puntúa. */
  fuera: number
  vender: number
  /** Posiciones cuyo stop no se pudo comprobar (sin precio, sin stop). */
  sinComprobar: number
  /** false = la respuesta no trae el repaso o falló: no se sabe si hay algo urgente. */
  repasada: boolean
}

export function recuentos(data: TodayResponse | null): Recuentos {
  const s = data?.signals ?? []
  const repaso = data?.cartera
  const repasada = carteraRepasada(repaso)
  const posiciones = repasada ? repaso.posiciones : []
  // «Para vender» y «sin comprobar» cuentan los avisos que pinta el repaso de
  // arriba (`avisosDeCartera`), los mismos: el recuento juntaba las ventas de la
  // lista con los stops perforados y el panel solo enseñaba los stops, así que
  // con una venta por puntuación decía «Para vender 2» junto a un panel con una.
  // La lista puede venir de la caché (hasta 6 h): con el repaso, que es de ahora,
  // una venta suya solo cuenta si la posición sigue abierta.
  const avisos = avisosDeCartera(s, repaso)
  return {
    comprar: s.filter((x) => x.decision.action === 'comprar').length,
    vigilar: s.filter((x) => x.decision.action === 'vigilar').length,
    evitar: s.filter((x) => x.decision.action === 'evitar').length,
    cartera: repasada ? (repaso.abiertas ?? 0) : s.filter((x) => x.decision.owned).length,
    fuera: posiciones.filter((p) => !p.en_lista).length,
    vender: avisos.filter((a) => a.aviso.tipo === 'vender').length,
    sinComprobar: avisos.filter((a) => a.aviso.tipo === 'sin_comprobar').length,
    repasada,
  }
}

/** Las ideas de la lista corta que hoy no caben en la cartera (aviso «Sin
 *  sitio»: cumplen las reglas de compra, pero los topes dejan su tamaño en 0).
 *  La cabecera decía «5 ideas de compra» con las cinco en «Sin sitio» debajo.
 *  Con el repaso (`cartera`), el mismo aviso que su tarjeta: una idea que ya
 *  tienes no es una idea sin sitio (revisión 14, H1). */
export function ideasSinSitio(
  shortlist: TodayResponse['shortlist'] | null | undefined,
  cartera?: TodayResponse['cartera'],
): number {
  if (!shortlist) return 0
  return shortlist.ideas.filter((i) => avisoDeLaFila(i, { shortlist, cartera }).tipo === 'comprar_sin_sitio').length
}

/** «5 ideas de compra (ninguna cabe hoy en tu cartera)», «(2 sin sitio en tu cartera)». */
export function textoDeIdeas(n: number, sinSitio: number): string {
  const base = `${n} ${plural(n, 'idea', 'ideas')} de compra`
  if (n === 0 || sinSitio === 0) return base
  return sinSitio === n ? `${base} (ninguna cabe hoy en tu cartera)` : `${base} (${sinSitio} sin sitio en tu cartera)`
}

/** «Mi cartera», a partir del repaso, que es de ahora, y no de las decisiones de
 *  la lista, que pueden ser de hace 6 h. Con la lista cacheada, una posición
 *  abierta después no salía en ninguna parte (su decisión no era de posición y
 *  sí estaba en la lista), una cerrada después seguía como fila, y la pantalla
 *  decía «Ninguna de tus posiciones está en EE. UU. — S&P 500» con una que lo
 *  estaba (revisión 13). Sin repaso, como antes: las filas que la lista decide
 *  como tuyas. */
export function miCartera(data: TodayResponse | null): {
  /** Decisiones de la lista sobre posiciones abiertas ahora. */
  filas: DailySignal[]
  /** Abiertas que la lista de este mercado no puntúa. */
  fuera: StopDePosicion[]
  /** En la lista, pero su decisión no es de posición: se abrieron después de calcularla. */
  sinDecision: StopDePosicion[]
} {
  const s = data?.signals ?? []
  const repaso = data?.cartera
  if (repaso === undefined || repaso.abiertas === null || repaso.error) {
    return { filas: s.filter((x) => x.decision.owned), fuera: [], sinDecision: [] }
  }
  const abiertas = new Set(repaso.posiciones.map((p) => p.symbol))
  const filas = s.filter((x) => x.decision.owned && abiertas.has(x.symbol))
  const decididas = new Set(filas.map((x) => x.symbol))
  return {
    filas,
    fuera: repaso.posiciones.filter((p) => !p.en_lista),
    sinDecision: repaso.posiciones.filter((p) => p.en_lista && !decididas.has(p.symbol)),
  }
}

/** De dónde y de cuándo es el precio con que se miró un stop: «cotización de
 *  finnhub, hace 3 min». El repaso daba como de ahora el último cierre de la
 *  lista, de hasta 12 h, y no lo decía (revisión 13). */
export function procedenciaDelPrecio(
  p: Pick<PrecioDelStop, 'fuente' | 'proveedor' | 'fecha'>,
): { texto: string; titulo: string } {
  const de = `${etiqueta(p.fuente)}${p.proveedor ? ` de ${p.proveedor}` : ''}`
  return {
    texto: `${de}, ${p.fecha ? fmtAntiguedad(p.fecha) : 'sin fecha'}`,
    titulo: p.fecha ? `${de} del ${fmtFecha(p.fecha, { hora: true, zona: ZONA_MERCADO })}` : de,
  }
}

/** Fila de resumen: el estado del día en cifras grandes.
 *
 *  Es lo que los paneles de trading ponen arriba del todo, y funciona porque
 *  responde de un vistazo a "¿tengo que hacer algo hoy?". Lo que no lleva es
 *  un medidor de "riesgo: BAJO" ni una "puntuación de salud 87/100": esos
 *  números quedan muy bien y no significan nada — son un promedio de cosas
 *  que no se pueden promediar, presentado con una precisión que no existe.
 *  Aquí cada cifra es un recuento de algo que se puede ir a contar a mano. */
function SummaryStrip({
  data,
  acciones,
  repasoEn,
  onPick,
}: {
  data: TodayResponse
  acciones: Recuentos
  /** Cuándo llegó la respuesta, y con ella el repaso de stops (`lista.recibidaEn`). */
  repasoEn: number | null
  onPick: (v: View) => void
}) {
  // El repaso de stops es de cuando llegó la lista: con la pantalla abierta
  // horas, «nada urgente» seguía diciendo lo de entonces sin decir de cuándo
  // (revisión 15, H2). Pasado lo que vive una cotización (`REVALIDAR_TRAS_MS`),
  // lleva su edad, que avanza.
  usePintarCadaMinuto(repasoEn !== null)
  const repasoViejo = repasoEn !== null && Date.now() - repasoEn >= REVALIDAR_TRAS_MS
  // Sin lista corta no hay «0 ideas»: `?? 0` hacía pasar una respuesta sin
  // lista por un día sin ideas. Ni una cobertura de 0 sobre 0 empresas (ítem 2.1).
  const ideas = data.shortlist ? data.shortlist.ideas.length : null
  const sinSitio = ideasSinSitio(data.shortlist, data.cartera)
  const cobertura = data.requested ? (data.scored / data.requested) * 100 : null
  const celdas: {
    label: string
    valor: string
    tono: string
    sub?: string
    vista?: View
  }[] = [
    {
      label: 'Ideas de compra',
      valor: ideas === null ? '—' : String(ideas),
      tono: ideas === null ? 'text-slate-500' : 'text-emerald-700',
      sub:
        ideas === null
          ? 'sin lista corta'
          : sinSitio > 0
            ? `${sinSitio === ideas ? 'ninguna cabe' : `${sinSitio} sin sitio`} hoy en tu cartera`
            : `de ${acciones.comprar} que califican`,
      vista: 'ideas',
    },
    {
      // «Nada urgente» solo si se miró todo: un stop sin comprobar, o una
      // respuesta sin repaso, no es «nada urgente» (revisión 12, visual).
      label: 'Para vender',
      valor: String(acciones.vender),
      tono:
        acciones.vender > 0
          ? 'text-red-600'
          : acciones.sinComprobar > 0 || !acciones.repasada
            ? 'text-amber-800'
            : 'text-slate-500',
      sub:
        acciones.vender > 0
          ? 'en tu cartera'
          : !acciones.repasada
            ? 'cartera sin repasar'
            : acciones.sinComprobar > 0
              ? `${acciones.sinComprobar} sin comprobar`
              : repasoViejo && repasoEn !== null
                ? `nada urgente · repaso de ${fmtAntiguedad(new Date(repasoEn))}`
                : 'nada urgente',
      vista: 'cartera',
    },
    {
      label: 'En vigilancia',
      valor: String(acciones.vigilar),
      tono: 'text-amber-800',
      sub: 'esperando tendencia',
      vista: 'vigilar',
    },
    {
      label: 'En cartera',
      valor: String(acciones.cartera),
      tono: 'text-slate-900',
      // En singular con una («1 posiciones abiertas»), y diciendo cuántas no
      // están en esta lista (revisión 12, visual).
      sub:
        plural(acciones.cartera, 'posición abierta', 'posiciones abiertas') +
        (!acciones.repasada
          ? ' en esta lista'
          : acciones.fuera > 0
            ? ` · ${acciones.fuera} fuera de esta lista`
            : ''),
      vista: 'cartera',
    },
    {
      label: 'Cobertura',
      valor: fmtPct(cobertura, 0, { enPuntos: true }),
      tono: data.complete ? 'text-slate-900' : 'text-sky-700',
      sub: `${data.scored} de ${data.requested}`,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {celdas.map((c) => {
        const Tag = c.vista ? 'button' : 'div'
        return (
          <Tag
            key={c.label}
            {...(c.vista
              ? { onClick: () => onPick(c.vista as View), type: 'button' as const }
              : {})}
            className={`rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left ${
              c.vista ? 'transition-colors hover:border-slate-300' : ''
            }`}
          >
            <div className="text-[10px] uppercase tracking-wide text-slate-400">
              {c.label}
            </div>
            <div className={`mt-0.5 text-2xl font-semibold tabular-nums ${c.tono}`}>
              {c.valor}
            </div>
            {c.sub && (
              <div className="text-[10px] leading-tight text-slate-400">{c.sub}</div>
            )}
          </Tag>
        )
      })}
    </div>
  )
}

/** Una idea de la lista corta, con su puesto y su porqué.
 *
 *  Se separa de la fila normal a propósito: una fila de tabla invita a
 *  comparar 98 cosas, y una tarjeta invita a leer una. La pregunta que
 *  responde es "¿por qué esta y no otra?", no "¿quién califica?". */
function IdeaCard({
  signal,
  aviso,
  motivosDelRecorte,
  onOpen,
}: {
  signal: DailySignal & { conviction: Conviction; peso_final_pct?: number | null }
  /** El de su fila (`avisoDeLaFila`): con su stop si ya la tienes. La tarjeta
   *  pasaba solo el tamaño, y una idea comprada después de calcular la lista
   *  decía «Comprar … Tamaño sugerido: 7,8 %» mientras su fila decía «Mantener»
   *  (revisión 14, H1). */
  aviso: Aviso
  /** Los recortes del tamaño que la tocan (`recortesDe`). */
  motivosDelRecorte: string[]
  onOpen: () => void
}) {
  const { conviction: c, decision, price } = signal
  const niveles = decision.levels
  const variacion = price ? fmtPct(price.change_pct, 2, { signo: true, enPuntos: true }) : ''
  // El porqué del tamaño, solo mientras es una idea de compra: de una que ya
  // tienes, el aviso habla de su stop y el tamaño de la lista no es el suyo.
  const deCompra = aviso.tipo === 'comprar' || aviso.tipo === 'comprar_sin_sitio' || aviso.tipo === 'comprar_sin_tamano'
  const recortado =
    deCompra &&
    signal.peso_final_pct !== null &&
    signal.peso_final_pct !== undefined &&
    niveles !== null &&
    niveles.peso_bruto_pct !== null &&
    signal.peso_final_pct < niveles.peso_bruto_pct
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            {c.puesto}
          </span>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-slate-900">
                {signal.symbol}
              </span>
              <span className="text-sm text-slate-500">{signal.context.name}</span>
            </div>
            <div className="text-[11px] text-slate-400">
              {signal.context.sector_name}
            </div>
          </div>
        </div>
        {price && (
          <div className="text-right">
            <div className="text-base tabular-nums text-slate-900">
              {fmtPrecio(price.last)}
            </div>
            {/* Sin variación, neutro: `?? 0` la pintaba en verde (ítem 2.1). */}
            <div className={`text-xs tabular-nums ${tonoDeVariacion(price.change_pct, variacion, 'text-emerald-600', 'text-red-600')}`}>
              {variacion}
            </div>
          </div>
        )}
      </div>

      {/* Qué hacer, lo primero y en una frase, con los números para ejecutar.
          Decía «Comprar» y a la vez «Cuánto de tu cartera 0,0 % · recortado
          desde 6,1 %» con dos o tres párrafos sobre topes debajo: con el peso
          en 0 el aviso dice «Sin sitio», y el porqué va plegado (petición del
          24 nov: «que las alertas de compra y venta sean más claras»). */}
      <div className="mt-3">
        <AvisoDeAccion aviso={aviso} />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-700">{c.resumen}</p>

      {/* El porqué del recorte, en la propia tarjeta: sin él, un 0,0 % se leía
          como un error (revisión 12, visual). Plegado: en párrafos sueltos
          tapaba el aviso. */}
      {recortado && (
        <details className="mt-2 rounded-lg border border-slate-200 px-3 py-3 sm:py-2">
          <summary className={`cursor-pointer text-xs font-medium text-slate-700 ${SUMARIO_TACTIL}`}>Por qué este tamaño</summary>
          <div className="mt-1.5 text-[11px] leading-snug text-slate-600">
            {motivosDelRecorte.length > 0 ? (
              <ul className="space-y-1">
                {motivosDelRecorte.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : (
              <p>El motivo del recorte, en «Cómo se repartió el tamaño», más abajo (plegado).</p>
            )}
          </div>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={onOpen}
          className={`text-xs font-medium text-sky-700 hover:underline ${TACTIL}`}
        >
          Ver el análisis completo →
        </button>
        <span className="text-[11px] text-slate-400">
          Acuerdo entre factores: {fmtPct(c.acuerdo, 0)}
        </span>
      </div>
    </li>
  )
}

/** Las que no hay que comprar. Va junto a las ideas a propósito: saber qué
 *  evitar es la mitad del trabajo y normalmente la que nadie enseña. */
function AvoidList({
  signals,
}: {
  signals: (DailySignal & { conviction: Conviction })[]
}) {
  if (signals.length === 0) return null
  // Plegada, como prometía el plan (`docs/PLAN_NAVEGACION.md`): desplegada
  // empujaba la lista hacia abajo (revisión 14, H10). El recuento, a la vista.
  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <summary className={`cursor-pointer ${SUMARIO_TACTIL}`}>
        <h3 className="inline text-sm font-semibold text-slate-800">Lo que NO comprar ahora</h3>{' '}
        <span className="text-xs text-slate-500">({signals.length})</span>
      </summary>
      <p className="mt-1 text-xs text-slate-500">
        Las peor situadas frente a sus comparables de sector. No significa que
        vayan a caer: significa que hay mejores sitios donde poner el dinero.
      </p>
      <ul className="mt-3 space-y-2">
        {signals.map((s) => (
          <li key={s.symbol} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
            {/* El mismo aviso que en el resto de la app, con su icono: un nombre
                suelto en una lista no decía qué hacer con él. */}
            <AvisoDeAccion aviso={avisoDe({ decision: s.decision })} tamano="compacto" conFrase={false} />
            <span className="font-medium text-slate-800">{s.symbol}</span>
            {/* El separador, al final del nombre: al saltar de línea en móvil,
                al principio de la descripción quedaba colgando («· Information
                Technology…»; ítem 2.12). */}
            <span className="text-slate-500">{s.context.name} ·</span>
            <span className="text-xs text-slate-400">
              {s.context.sector_name} · {s.conviction.resumen}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Por qué el peso final no es el que pedía el stop.
 *
 *  El dimensionador ya explicaba cada recorte y esas explicaciones no llegaban
 *  a la pantalla: la tarjeta enseñaba «recortado desde 9 %» sin decir por qué, y
 *  con la cartera abierta contando contra los topes un peso puede salir en 0 %.
 *  Un 0 % sin motivo se lee como un error de la app; con motivo es la respuesta.
 */
/** Un porcentaje en puntos (12.5 → «12,5 %»); lo que falta es «sin dato», no un 0 ni un «undefined». */
function puntos(v: number | null | undefined): string {
  return v === null || v === undefined ? 'sin dato' : fmtPct(v, 1, { enPuntos: true })
}

function SizingPanel({ sizing }: { sizing: Sizing }) {
  const enLibro = Object.entries(sizing.cartera_actual ?? {})
  // Sin ninguna pareja posible (una idea y nada en cartera) no hay nada que
  // comprobar: «Solo se pudieron medir 0 de 0 parejas» era una falsa alarma
  // (revisión 8; igual que en el veredicto de la ficha).
  const sinAplicar = (sizing.controles ?? []).filter((c) => !c.aplicado && c.parejas_posibles !== 0)
  // Un límite que no se pudo aplicar SIEMPRE se enseña, aunque no haya
  // recortado nada. Antes el panel se ocultaba sin recortes, y «no recortó
  // porque no pudo mirar» era indistinguible de «no hacía falta recortar».
  const hayAlgoQueContar =
    sizing.recortes.length > 0 ||
    enLibro.length > 0 ||
    sizing.aviso_cartera ||
    sinAplicar.length > 0
  if (!hayAlgoQueContar) return null
  // Sin candidatas el backend no manda reparto (ni lo que se añade, ni la
  // liquidez, ni la volatilidad): no hay nada que repartir. Antes se pintaba
  // igual y salía «undefined %» (V3); ahora se dice. El panel sigue saliendo si
  // hay un aviso de la cartera o un límite sin comprobar.
  const sinCandidatas = Object.keys(sizing.pesos).length === 0
  // Plegado, como prometía el plan (revisión 14, H10), salvo que haya algo que
  // avisar: un límite sin comprobar o una cartera sin valorar no se esconden
  // detrás de un clic, y el resumen lo dice aunque se pliegue.
  const avisos = sinAplicar.length + (sizing.aviso_cartera ? 1 : 0)

  return (
    <details open={avisos > 0} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <summary className={`cursor-pointer ${SUMARIO_TACTIL}`}>
        <h3 className="inline text-sm font-semibold text-slate-800">Cómo se repartió el tamaño</h3>
        {sinAplicar.length > 0 && (
          <span className="ml-2 text-xs font-medium text-red-700">
            {sinAplicar.length === 1 ? 'un límite sin comprobar' : `${sinAplicar.length} límites sin comprobar`}
          </span>
        )}
      </summary>

      {sinCandidatas ? (
        <p className="mt-2 text-sm text-slate-500">Hoy no hay candidatas que dimensionar.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Se añade', puntos(sizing.invertido_pct)],
            ['Ya en cartera', puntos(sizing.ya_invertido_pct)],
            [
              'Volatilidad estimada',
              sizing.vol_estimada_pct === null || sizing.vol_estimada_pct === undefined
                ? 'sin dato'
                : `${puntos(sizing.vol_estimada_pct)} / ${puntos(sizing.objetivo_vol_pct)}`,
            ],
            ['Liquidez', puntos(sizing.liquidez_pct)],
          ].map(([rotulo, valor]) => (
            <div key={rotulo}>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                {rotulo}
              </dt>
              <dd className="text-sm tabular-nums text-slate-900">{valor}</dd>
            </div>
          ))}
        </dl>
      )}

      {enLibro.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          <span className="font-medium text-slate-700">Lo que ya tienes</span> cuenta
          contra los mismos topes:{' '}
          {enLibro.map(([s, w]) => `${s} ${fmtPct(w, 1, { enPuntos: true })}`).join(' · ')}
        </p>
      )}

      {sizing.recortes.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-amber-900">
          {sizing.recortes.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="text-amber-500">
                ·
              </span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}

      {sizing.aviso_cartera && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {sizing.aviso_cartera}
        </p>
      )}

      {sinAplicar.length > 0 && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-800">
          <p className="font-medium">
            {sinAplicar.length === 1
              ? 'Un límite de riesgo NO se ha podido comprobar:'
              : `${sinAplicar.length} límites de riesgo NO se han podido comprobar:`}
          </p>
          <ul className="mt-1 space-y-1">
            {sinAplicar.map((c) => (
              <li key={c.limite}>
                <span className="font-medium">Tope por {etiqueta(c.limite)}.</span> {c.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sin candidatas, la nota del backend repite el estado vacío de arriba. */}
      {!sinCandidatas && <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{sizing.nota}</p>}
    </details>
  )
}

const FACTOR_KEYS = ['value', 'quality', 'momentum'] as const

/** Tres barras finas: de un vistazo se ve de dónde sale la puntuación.
 *  Los rótulos van una sola vez en la cabecera, no repetidos en cada fila. */
function FactorBars({
  families,
  withLabels = false,
}: {
  families: Record<string, number | null>
  withLabels?: boolean
}) {
  return (
    <div className="flex gap-3">
      {FACTOR_KEYS.map((key) => {
        const raw = families[key]
        return (
          <div key={key} className="w-16">
            {withLabels && (
              <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-400">
                {etiqueta(key, { mayuscula: true })}
              </div>
            )}
            <div
              className="h-1 overflow-hidden rounded-full bg-slate-100"
              title={`${etiqueta(key, { mayuscula: true })}: ${
                raw === null || raw === undefined ? 'sin dato' : fmtNum(raw, 2)
              }`}
            >
              {raw !== null && raw !== undefined && (
                <div
                  className={`h-full ${raw >= 0 ? 'bg-emerald-400' : 'bg-red-300'}`}
                  style={{ width: `${scoreToPct(raw)}%` }}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Cabecera de columnas: alineada con la fila, con las mismas anchuras. */
// La cabecera y la fila comparten columnas: cede «Empresa» (flexible), nunca la
// puntuación ni la acción. Con anchos fijos dentro de un `overflow-hidden`, a
// 390 px y en tableta (768–1140 px, con la barra lateral) desaparecían justo
// la señal y la acción; las barras de factores van desde `xl` y, por debajo,
// en el panel desplegado (revisión de A7).
function ListHeader() {
  return (
    <div className="flex items-center gap-4 border-b border-slate-100 px-4 py-2 text-[10px] uppercase tracking-wide text-slate-400">
      <span className="hidden w-7 shrink-0 sm:block" />
      <span className="min-w-0 flex-1 xl:w-40 xl:flex-none">Empresa</span>
      <span className="hidden w-20 shrink-0 lg:block">Año</span>
      <span className="hidden w-24 shrink-0 text-right sm:block">Precio</span>
      <span className="hidden flex-1 pl-4 xl:block">
        <span className="flex gap-3">
          {FACTOR_KEYS.map((key) => (
            <span key={key} className="w-16">
              {etiqueta(key, { mayuscula: true })}
            </span>
          ))}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-3">
        <span className="w-16 whitespace-nowrap text-right">Puntuación</span>
        <span className="w-28 text-right">Acción</span>
        <span className="w-1.5" aria-hidden />
      </span>
    </div>
  )
}

function SignalRow({
  signal,
  umbrales,
  expanded,
  onToggle,
  aviso,
}: {
  signal: DailySignal
  /** Los de la puntuación: con dos decimales, 0,3496 era «+0,35 · Sin acción» (revisión 8). */
  umbrales: number[]
  expanded: boolean
  onToggle: () => void
  /** `avisoDeLaFila`: con su stop si la tienes (el repaso es de ahora) y con su
   *  tamaño si está en la lista corta. La fila decía «Comprar» de una idea que su
   *  tarjeta da por «Sin sitio», y «Mantener» con el stop perforado en el panel
   *  de arriba; la tarjeta y la fila piden ahora el mismo aviso. */
  aviso: Aviso
}) {
  const positive = signal.score >= 0
  return (
    <li className="border-b border-slate-100 last:border-0">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="hidden w-7 shrink-0 text-xs tabular-nums text-slate-300 sm:block">
          {signal.rank}
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-2 xl:w-40 xl:flex-none">
          <CompanyLogo symbol={signal.symbol} size="sm" />
          <span className="min-w-0">
            <span className="font-medium text-slate-900">{signal.symbol}</span>
            {/* Por debajo de 640 px la columna del puesto no cabe: va junto al
                símbolo, o en las vistas filtradas (Mi cartera, Vigilar) se
                perdía el orden global (revisión 3). */}
            <span className="ml-1.5 text-[10px] tabular-nums text-slate-400 sm:hidden">#{signal.rank}</span>
            <span className="block truncate text-xs text-slate-400">
              {signal.context.name ?? signal.context.sector_name ?? '—'}
            </span>
          </span>
        </span>

        {/* Un año de precio: la forma dice de un vistazo si viene de subida
            o de caída, algo que la puntuación por sí sola no cuenta. */}
        <span className="hidden w-20 shrink-0 lg:block">
          {signal.price?.spark?.length ? (
            <Sparkline
              serie={signal.price.spark}
              subiendo={
                signal.price.spark[signal.price.spark.length - 1] >=
                signal.price.spark[0]
              }
            />
          ) : null}
        </span>

        <span className="hidden w-24 shrink-0 text-right sm:block">
          {signal.price ? (
            <>
              <span className="block text-sm tabular-nums text-slate-800">
                {fmtPrecio(signal.price.last)}
              </span>
              <span
                className={`block text-xs tabular-nums ${tonoDeVariacion(
                  signal.price.change_pct,
                  fmtPct(signal.price.change_pct, 2, { signo: true, enPuntos: true }),
                  'text-emerald-600',
                  'text-red-500',
                )}`}
              >
                {fmtPct(signal.price.change_pct, 2, { signo: true, enPuntos: true })}
              </span>
            </>
          ) : (
            <span className="block text-sm text-slate-300">—</span>
          )}
        </span>

        <span className="hidden flex-1 pl-4 xl:block">
          <FactorBars families={signal.families} />
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-3">
          <span
            className={`w-16 text-right text-sm font-semibold tabular-nums ${
              positive ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {fmtFrente(signal.score, umbralesDeSuDecision(signal.decision, umbrales), { signo: true })}
          </span>
          {/* Más ancha que el chip de antes: «Sin acción» con su icono no cabía en 80 px. */}
          <span className="flex w-28 justify-end">
            <AvisoDeAccion aviso={aviso} tamano="compacto" conFrase={false} />
          </span>
          <span
            className={`w-1.5 text-slate-300 transition-transform ${expanded ? 'rotate-90' : ''}`}
            aria-hidden
          >
            ›
          </span>
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 bg-slate-50/70 px-4 pb-4 pt-1 md:pl-[4.75rem]">
          <div className="max-w-xl">
            <AvisoDeAccion aviso={aviso} />
          </div>
          <div className="xl:hidden">
            <FactorBars families={signal.families} withLabels />
          </div>
          <DecisionPlan decision={signal.decision} symbol={signal.symbol} />

          {signal.price && (
            <div className="max-w-md">
              <div className="flex items-baseline justify-between text-xs text-slate-500">
                <span>Rango de 52 semanas</span>
                <span className="tabular-nums">
                  {fmtPrecio(signal.price.low_52w)} –{' '}
                  {fmtPrecio(signal.price.high_52w)}
                </span>
              </div>
              {signal.price.range_position !== null && (
                <div className="mt-1.5">
                  <RangeBar position={signal.price.range_position} />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Cotiza en el percentil{' '}
                    {Math.round(signal.price.range_position * 100)} de su rango
                    anual · {signal.price.points} sesiones ·{' '}
                    {signal.price.source ?? 'fuente desconocida'}
                    {signal.price.as_of
                      ? `, ${fmtAntiguedad(signal.price.as_of)}`
                      : ''}
                  </p>
                </div>
              )}
            </div>
          )}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            <div>
              <dt className="inline text-slate-400">Sector: </dt>
              <dd className="inline text-slate-700">
                {signal.context.sector_name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="inline text-slate-400">Puesto en su sector: </dt>
              <dd className="inline text-slate-700">{signal.sector_rank ?? '—'}</dd>
            </div>
            <div>
              <dt className="inline text-slate-400">Cobertura de datos: </dt>
              <dd className="inline text-slate-700">
                {fmtPct(signal.coverage, 0)}
              </dd>
            </div>
            <div>
              <dt className="inline text-slate-400">Horizonte: </dt>
              <dd className="inline text-slate-700">{signal.horizon}</dd>
            </div>
          </dl>
          {signal.probability_note && (
            <p className="text-xs leading-snug text-slate-500">
              {signal.probability_note}
            </p>
          )}
          <Link
            to={rutaEmpresa(signal.symbol)}
            className={`inline-flex items-center text-xs font-medium text-sky-700 hover:underline ${TACTIL}`}
          >
            Ver el análisis completo de {signal.symbol} →
          </Link>
        </div>
      )}
    </li>
  )
}

/** Lo que hay que hacer con tus posiciones, arriba y en todas las vistas.
 *
 *  Hoy solo miraba las posiciones del mercado barrido: con STOP fuera del
 *  S&P 500 (stop en 110, cotizando a 104), la cabecera decía «Para vender 0 ·
 *  nada urgente» y STOP solo salía en el aviso del tamaño, que no habla de
 *  stops (revisión 12, visual). Y la venta estaba repartida: el recuento «Para
 *  vender» juntaba las ventas de la lista con los stops perforados, el panel
 *  rojo solo enseñaba los stops y el resto eran chips sueltos en la tabla. Ahora
 *  el panel lista los avisos «Vender» de `avisosDeCartera`, los mismos que
 *  cuenta `recuentos`, esté o no la posición en la lista; lo que no se pudo
 *  comprobar, aparte, en ámbar y con su motivo. */
function RepasoDeStops({
  repaso,
  signals,
  mercado,
}: {
  repaso: StopsDeCartera | undefined
  signals: DailySignal[]
  mercado: string
}) {
  const avisos = avisosDeCartera(signals, repaso)
  const vender = avisos.filter((a) => a.aviso.tipo === 'vender')
  const sinComprobar = avisos.filter((a) => a.aviso.tipo === 'sin_comprobar')
  if (!repaso?.error && vender.length === 0 && sinComprobar.length === 0) return null
  const lista = (cuales: typeof avisos) => (
    <ul className="mt-2 space-y-2">
      {cuales.map(({ symbol, aviso, stop }) => (
        <li key={symbol}>
          <AvisoDeAccion
            aviso={aviso}
            tamano="compacto"
            titulo={
              <Link to={rutaEmpresa(symbol)} className={`inline-flex items-center text-sm font-semibold text-slate-900 underline ${TACTIL}`}>
                {symbol}
              </Link>
            }
          >
            {stop && <Procedencia p={stop} />}
            {stop && !stop.en_lista && (
              <span className="text-xs leading-snug text-slate-600">
                No está en {mercado}: la lista no la puntúa, pero su stop se mira igual.
              </span>
            )}
          </AvisoDeAccion>
        </li>
      ))}
    </ul>
  )
  return (
    <div className="space-y-2">
      {repaso?.error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-800">
          {repaso.error}
        </p>
      )}
      {vender.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-red-800">
            Para vender: {vender.length} {plural(vender.length, 'posición', 'posiciones')}
          </h2>
          {lista(vender)}
        </section>
      )}
      {sinComprobar.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-amber-900">
            Sin comprobar: {sinComprobar.length} {plural(sinComprobar.length, 'posición', 'posiciones')}
          </h2>
          {lista(sinComprobar)}
        </section>
      )}
    </div>
  )
}

/** «Precio: cotización de finnhub, hace 3 min.», con la fecha entera en ET al
 *  pasar el ratón. Nada si la respuesta no lo dice (una anterior a la revisión 13). */
function Procedencia({ p }: { p: StopDePosicion }) {
  // «hace 3 min» avanza con la pantalla abierta (revisión 15, H2).
  usePintarCadaMinuto(Boolean(p.precio_fecha))
  if (!p.precio_fuente) return null
  const { texto, titulo } = procedenciaDelPrecio({
    fuente: p.precio_fuente,
    proveedor: p.precio_proveedor ?? null,
    fecha: p.precio_fecha ?? null,
  })
  return (
    <span className="text-xs leading-snug text-slate-600" title={titulo}>
      Precio: {texto}.
    </span>
  )
}

/** Posiciones de las que Hoy solo sabe su stop, en «Mi cartera»: las que este
 *  mercado no puntúa (la pestaña contaba solo las de la lista, «Mi cartera (1)»
 *  con tres abiertas, y las demás no salían en ninguna vista; revisión 12,
 *  visual) y las que se abrieron después de calcular la lista, que no salían en
 *  ninguna parte (revisión 13). Cada una con su aviso, como en el resto: vender,
 *  mantener o revisar; antes era un chip con el estado del stop («por encima»). */
function SoloSuStop({
  posiciones,
  titulo,
  explicacion,
}: {
  posiciones: StopDePosicion[]
  titulo: string
  explicacion: string
}) {
  if (posiciones.length === 0) return null
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
      <p className="mt-1 text-xs text-slate-500">{explicacion}</p>
      <ul className="mt-2 divide-y divide-slate-100">
        {posiciones.map((p) => (
          <li key={p.symbol} className="py-2">
            <AvisoDeAccion
              aviso={avisoDe({ stop: p })}
              tamano="compacto"
              titulo={
                <Link to={rutaEmpresa(p.symbol)} className={`inline-flex items-center text-sm font-medium text-slate-900 hover:underline ${TACTIL}`}>
                  {p.symbol}
                </Link>
              }
            >
              <Procedencia p={p} />
            </AvisoDeAccion>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** La lista se calculó con otra cartera: se cachea 6 h con la de cuando se
 *  puntuó, y una posición abierta o cerrada después, o el efectivo anotado,
 *  dejaban sus decisiones y su tamaño en otra cartera sin decirlo; la nota del
 *  tamaño decía «no tienes posiciones abiertas» junto a un repaso con dos
 *  (revisión 13). Remite a «Actualizar», que la recalcula. */
export function AvisoListaDesfasada({
  cambios,
  calculada,
  recalcular = 'Pulsa «Actualizar» para recalcularla.',
}: {
  cambios: ListaDesfasada
  calculada: string | undefined
  /** Cómo se recalcula desde donde se pinta (Inicio no tiene «Actualizar»). */
  recalcular?: string
}) {
  const lista = (simbolos: string[]) => simbolos.join(', ')
  const partes = [
    cambios.abiertas.length > 0 && `abriste ${lista(cambios.abiertas)}`,
    cambios.cerradas.length > 0 && `cerraste ${lista(cambios.cerradas)}`,
    cambios.cambiadas.length > 0 && `cambiaste la cantidad, el coste o el stop de ${lista(cambios.cambiadas)}`,
    cambios.efectivo && 'cambió el efectivo anotado',
  ].filter(Boolean)
  return (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
      <span className="font-semibold">
        {cambios.error
          ? 'No se sabe si esta lista es de tu cartera de ahora. '
          : `Esta lista se calculó${calculada ? ` ${fmtAntiguedad(calculada)}` : ''} con otra cartera. `}
      </span>
      {cambios.error ?? `Después ${partes.join('; ')}.`} Sus decisiones sobre tus posiciones y el
      tamaño de las ideas son de entonces; el repaso del stop sí es de ahora. {recalcular}
    </div>
  )
}

/** «Calculado hace 3 h» en la cabecera, con la misma fecha que la línea de
 *  progreso (`lista.calculadaEn`) y repintado cada minuto.
 *
 *  Se calculaba al pintar la página con `fetched_at ?? as_of`, y la página solo
 *  se repinta cuando cambia la lista: con una vigente, «Calculado hace 5 min»
 *  tres horas después; con la copia caducada, «hace 9 h» mientras la línea de
 *  progreso de la misma pantalla ya decía «hace 10 h», y no contaba su edad
 *  desde que llegó, como el hook (revisión 15, H2). */
function EdadDeLaLista({ recalculada, calculadaEn }: { recalculada: boolean; calculadaEn: number | null }) {
  usePintarCadaMinuto(calculadaEn !== null)
  return (
    <span>
      {recalculada ? 'Recalculado ' : 'Calculado '}
      {calculadaEn !== null ? fmtAntiguedad(new Date(calculadaEn)) : '(hora desconocida)'}
    </span>
  )
}

/** `incrustada`: dentro de Explorar › Acciones, con su título como subtítulo (h2). */
export function TodayPage({ incrustada = false }: { incrustada?: boolean } = {}) {
  const [market, setMarket] = useState('us_sp500')
  // La lista no va por `useDato`: se enseña la guardada mientras llega la de
  // ahora, y encadena pasadas sola («Seguir completando») sin vaciar lo que ya
  // se ve. Su fallo sí se dice igual que en el resto, con un «Reintentar» que
  // repite la misma pasada (ítem 2.1). Las peticiones en vuelo y la última lista
  // se comparten por mercado con las demás pantallas que la usan (Inicio,
  // Explorar): `hooks/useListaDiaria.ts`.
  const lista = useListaDiaria(market)
  const { data, error, ocupado: busy } = lista
  const [view, setView] = useState<View>('ideas')
  const [sector, setSector] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  // Un fallo al pedir los mercados se dice: `() => undefined` lo callaba y el
  // selector desaparecía sin más (ítem 2.1).
  const mercados = useDato(() => api.markets().then((d) => d.markets), 'mercados')

  useEffect(() => {
    // Al cambiar de mercado los filtros previos ya no aplican.
    setSector(null)
    setExpanded(null)
  }, [market])

  const cartera = useMemo(() => miCartera(data), [data])

  const rows = useMemo(() => {
    if (!data?.signals || !data.thresholds) return []
    let base = data.signals
    // Las vistas son acciones, no etiquetas: la pregunta que traes es qué
    // comprar y qué vender, no quién puntúa alto.
    if (view === 'comprar') base = base.filter((s) => s.decision.action === 'comprar')
    else if (view === 'vigilar') base = base.filter((s) => s.decision.action === 'vigilar')
    else if (view === 'evitar') base = base.filter((s) => s.decision.action === 'evitar')
    else if (view === 'cartera') base = cartera.filas
    if (sector !== null) base = base.filter((s) => s.context.sector_key === sector)
    const q = query.trim().toUpperCase()
    if (q) {
      base = base.filter(
        (s) =>
          s.symbol.includes(q) || (s.context.name ?? '').toUpperCase().includes(q),
      )
    }
    return base
  }, [data, view, sector, query, cartera])

  const acciones = useMemo(() => recuentos(data), [data])

  // Buscar es para encontrar una empresa concreta, esté en el cubo que esté:
  // filtrar además por vista haría que "no aparece" volviera a ser posible.
  const encontradoFuera = useMemo(() => {
    if (!data?.signals || !query.trim()) return null
    const q = query.trim().toUpperCase()
    const enTodas = data.signals.filter(
      (s) => s.symbol.includes(q) || (s.context.name ?? '').toUpperCase().includes(q),
    )
    return enTodas.length > rows.length ? enTodas.length - rows.length : null
  }, [data, query, rows.length])

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {incrustada ? (
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">Hoy</h2>
          ) : (
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Hoy</h1>
          )}
          {/* Antes explicaba de dónde salen los datos, que es lo último que
              hace falta al abrir. Lo que se quiere saber al llegar es cómo
              está el día: cuántas ideas hay y si toca hacer algo. */}
          <p className="mt-0.5 max-w-3xl text-sm leading-snug text-slate-500">
            {data
              ? [
                  data.shortlist
                    ? textoDeIdeas(data.shortlist.ideas.length, ideasSinSitio(data.shortlist, data.cartera))
                    : 'sin lista corta de ideas',
                  acciones.vender > 0 ? `${acciones.vender} para vender` : null,
                  acciones.sinComprobar > 0 ? `${acciones.sinComprobar} sin comprobar` : null,
                  acciones.cartera > 0 ? `${acciones.cartera} en cartera` : null,
                  `${data.scored} ${plural(data.scored, 'empresa puntuada', 'empresas puntuadas')}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Empresas puntuadas contra sus comparables de sector. Sin elegir nada.'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {data && <EdadDeLaLista recalculada={data.cached === false} calculadaEn={lista.calculadaEn} />}
          <button
            onClick={lista.actualizar}
            disabled={busy}
            className={`rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-600 transition-colors hover:bg-white disabled:opacity-50 ${TACTIL}`}
          >
            {busy ? 'Puntuando…' : 'Actualizar'}
          </button>
        </div>
      </header>

      {/* Un mercado sin estados financieros no puede presentar su puntuación
          con la misma cara que uno de cuatro factores. El aviso vivía en la
          descripción del mercado, que dejó de mostrarse al resumir el día en
          la cabecera: aquí es donde tiene que estar. */}
      {data?.solo_momentum && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <div className="text-xs font-semibold text-amber-900">
            Aquí la puntuación es momentum y nada más
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
            {data.market_name} no tiene estados financieros, así que no hay factor
            de valor ni de calidad: lo único medible es si el precio viene subiendo.
            Una idea sostenida por un solo factor es una apuesta a ese factor, no al
            activo — y comprar algo <em>porque ha subido</em> es exactamente el
            razonamiento que las otras tres familias existen para contrastar. Los
            stops son mucho más anchos (hasta 60&nbsp;%) porque la volatilidad lo exige,
            y por eso el peso sugerido de cartera sale mucho más pequeño.
          </p>
        </div>
      )}

      {data?.signals && (
        <SummaryStrip data={data} acciones={acciones} repasoEn={lista.recibidaEn} onPick={setView} />
      )}

      {data?.signals && <RepasoDeStops repaso={data.cartera} signals={data.signals} mercado={data.market_name} />}

      {data?.signals && data.lista_desfasada && (
        <AvisoListaDesfasada cambios={data.lista_desfasada} calculada={data.as_of} />
      )}

      {/* Con un solo mercado no hay nada que elegir y no se pinta. */}
      <BloqueDatos carga={mercados} que="los mercados">
        {(lista) =>
          lista.length > 1 && (
            // Los selectores saltan de línea y sus etiquetas no se parten: a
            // 390 px los botones se encogían y «Mejores ideas (5)» salía en tres
            // líneas; desplazándose en su marco, la opción activa quedaba
            // recortada contra el borde y las demás, escondidas (ítem 2.12).
            <div className="inline-flex max-w-full flex-wrap rounded-lg border border-slate-200 bg-white p-0.5">
              {lista.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMarket(m.key)}
                  title={`${m.companies} empresas · ${m.sectors} sectores`}
                  className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${TACTIL} ${
                    market === m.key
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )
        }
      </BloqueDatos>

      {/* Antes, sin lista vigente, la pantalla se quedaba aquí en «Puntuando el
          universo…» los minutos de una pasada. Ahora enseña la guardada con su
          antigüedad, o la primera pasada corta, y dice cómo va el resto. */}
      <ProgresoAnalisis lista={lista} onSeguir={lista.seguirCompletando} instantaneas={data?.instantaneas} />

      {error && <ErrorDeCarga que="la lista de hoy" error={error.mensaje} reintentar={error.reintentar} />}

      {data && !data.signals && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          El servidor devolvió una respuesta con un formato que esta versión no
          entiende. Pulsa «Actualizar» para recalcular la lista desde cero.
        </div>
      )}

      {data?.signals && data.thresholds && data.counts && (
        <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex max-w-full flex-wrap rounded-lg border border-slate-200 bg-white p-0.5">
                {(
                  [
                    ['ideas', `Mejores ideas (${data.shortlist ? data.shortlist.ideas.length : 'sin lista'})`],
                    ['comprar', `Todas las que califican (${acciones.comprar})`],
                    ['vigilar', `Vigilar (${acciones.vigilar})`],
                    ['evitar', `Evitar (${acciones.evitar})`],
                    ['cartera', `Mi cartera (${acciones.cartera})`],
                    ['todas', `Todas (${data.scored})`],
                  ] as [View, string][]
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setView(key)}
                    className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${TACTIL} ${
                      view === key
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar ticker o empresa…"
                aria-label="Buscar ticker o empresa"
                className={`w-56 max-w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none ${TACTIL}`}
              />
            </div>

            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setSector(null)}
                className={`rounded-full px-2.5 py-1 text-xs transition-colors ${TACTIL} ${
                  sector === null
                    ? 'bg-slate-200 text-slate-900'
                    : 'text-slate-500 hover:bg-slate-100'
                }`}
              >
                Todos los sectores
              </button>
              {data.sectors
                .filter((s) => s.usable)
                .map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setSector(sector === s.key ? null : s.key)}
                    className={`rounded-full px-2.5 py-1 text-xs transition-colors ${TACTIL} ${
                      sector === s.key
                        ? 'bg-slate-200 text-slate-900'
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
            </div>
          </div>

          {/* Sin lista corta, la vista de ideas lo dice: antes caía a la tabla
              de todas las puntuadas bajo «Mejores ideas (0)» (ítem 2.1). */}
          {view === 'ideas' && !data.shortlist ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Esta respuesta no trae la lista corta de ideas, así que no se puede
              decir cuántas hay: no es lo mismo que ninguna. Pulsa «Actualizar»
              para recalcularla, o mira «Todas las que califican».
            </div>
          ) : view === 'ideas' && data.shortlist ? (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-slate-500">
                {data.shortlist.nota}
              </p>
              {data.shortlist.ideas.length > 0 && (
                <ul className="space-y-3">
                  {data.shortlist.ideas.map((s, _, ideas) => (
                    <IdeaCard
                      key={s.symbol}
                      signal={s}
                      aviso={avisoDeLaFila(s, data)}
                      motivosDelRecorte={recortesDe(
                        s.symbol,
                        data.shortlist.sizing.recortes,
                        ideas.map((i) => i.symbol),
                      )}
                      onOpen={() => {
                        setView('comprar')
                        setQuery(s.symbol)
                      }}
                    />
                  ))}
                </ul>
              )}
              <SizingPanel sizing={data.shortlist.sizing} />
              <AvoidList signals={data.shortlist.evitar} />
            </div>
          ) : (
          <>
          {view === 'cartera' && sector === null && (
            <>
              <SoloSuStop
                posiciones={cartera.sinDecision}
                titulo={`Sin decisión de la lista de ${data.market_name}`}
                explicacion="Están en esta lista, pero se calculó antes de que las abrieras y no las decide como posiciones tuyas: de cada una, solo su stop. Pulsa «Actualizar» para recalcularla."
              />
              <SoloSuStop
                posiciones={cartera.fuera}
                titulo={`Fuera de ${data.market_name}`}
                explicacion="La lista no las puntúa ni decide sobre ellas: de cada una, solo su stop."
              />
            </>
          )}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-slate-400">
                {query.trim() ? (
                  <>
                    <p>
                      «{query.trim()}» no está en {data.market_name}.
                    </p>
                    {/* Mandaba a «Acciones», que ya no está en el menú (revisión 14,
                        H11): el enlace siempre fue a su ficha, y así se dice. */}
                    <p className="mt-1 text-xs">
                      Puede estar en otro mercado, o fuera del universo. Abre la{' '}
                      <Link
                        to={rutaEmpresa(query.trim().toUpperCase())}
                        className={`inline-flex items-center font-medium text-sky-700 hover:underline ${TACTIL}`}
                      >
                        ficha de {query.trim().toUpperCase()}
                      </Link>
                      : ahí se analiza cualquier ticker, esté o no en la lista.
                    </p>
                  </>
                ) : view === 'comprar' && sector === null ? (
                  // Es la vista de entrada y «cero» es un resultado con
                  // significado, no un hueco: hoy ninguna empresa cumple las
                  // dos condiciones a la vez. Decirlo evita que parezca que la
                  // app no cargó, y evita forzar una compra que no toca.
                  <>
                    <p className="text-slate-600">
                      Hoy no hay ninguna compra en {data.market_name}.
                    </p>
                    <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed">
                      Ninguna empresa está hoy en «Comprar»: o no cumple a la vez
                      las dos condiciones (puntuar por encima de{' '}
                      {fmtNum(data.thresholds.favorable, 2, { signo: true })} frente a
                      sus comparables <em>y</em> cerrar por encima de su media de 200
                      sesiones con el margen de su banda) o se aplaza (resultados en
                      los próximos días, precio viejo). Cada una en «Vigilar» dice
                      qué espera. No actuar también es una decisión.
                    </p>
                    {acciones.vigilar > 0 && (
                      <button
                        onClick={() => setView('vigilar')}
                        className={`mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 ${TACTIL}`}
                      >
                        Ver las {acciones.vigilar} en vigilancia →
                      </button>
                    )}
                  </>
                ) : view === 'cartera' && sector === null && acciones.repasada ? (
                  // «Ninguna está en X» solo si es verdad: con la lista cacheada,
                  // una abierta después sí estaba (revisión 13).
                  <p>
                    {acciones.cartera === 0
                      ? 'No tienes posiciones abiertas.'
                      : cartera.sinDecision.length > 0
                        ? `La lista no trae decisión sobre tus posiciones de ${data.market_name}: se calculó antes de que las abrieras.`
                        : `Ninguna de tus posiciones está en ${data.market_name}.`}
                  </p>
                ) : (
                  <p>Nada que mostrar con este filtro.</p>
                )}
              </div>
            ) : (
              <>
                <ListHeader />
                <ul>
                  {rows.map((signal) => (
                    <SignalRow
                      key={signal.symbol}
                      signal={signal}
                      umbrales={data?.thresholds ? [data.thresholds.favorable, data.thresholds.desfavorable] : []}
                      expanded={expanded === signal.symbol}
                      onToggle={() =>
                        setExpanded(expanded === signal.symbol ? null : signal.symbol)
                      }
                      aviso={avisoDeLaFila(signal, data)}
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
          </>
          )}

          <div className="flex flex-wrap justify-between gap-3 text-xs text-slate-400">
            <span>
              {encontradoFuera !== null && (
                <button
                  onClick={() => setView('todas')}
                  className={`mr-2 font-medium text-sky-700 hover:underline ${TACTIL}`}
                >
                  {encontradoFuera} {plural(encontradoFuera, 'coincidencia', 'coincidencias')} más en otras vistas — ver todas
                </button>
              )}
              {data.scored} {plural(data.scored, 'empresa puntuada', 'empresas puntuadas')} de {data.requested}
              {data.data_meta && 'retrieved_at' in data.data_meta
                ? ` · universo actualizado el ${fmtFecha(String(data.data_meta.retrieved_at))}`
                : ''}
            </span>
            {data.unavailable.length > 0 && (
              <span>{data.unavailable.length} sin datos suficientes</span>
            )}
          </div>

          <p className="rounded-xl bg-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-500">
            {data.disclaimer}
          </p>
        </>
      )}
    </div>
  )
}
