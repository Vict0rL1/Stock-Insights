import { useState } from 'react'
import { api } from '../../api/client'
import type { DcfResponse, ScenarioAssumptions, ValuationDefaults } from '../../api/types'
import { etiqueta } from '../../lib/etiquetas'
import { leerNumero, textoDeCampo } from '../../lib/entrada'
import { fmtCifras, fmtCompacto, fmtPct, fmtPrecio } from '../../lib/formato'
import { ausenteSi404, useDato } from '../../lib/useDato'
import { BloqueDatos, EstadoDato } from '../EstadoDato'
import { Ventana } from '../Ventana'
import { MarcoTabla } from '../MarcoTabla'

type ScenarioName = 'bear' | 'base' | 'bull'

interface Inputs {
  base_fcf: string
  net_debt: string
  shares_outstanding: string
  years: string
  scenarios: Record<ScenarioName, { growth: string; wacc: string; terminal: string }>
}

function pctInput(value: number): string {
  return textoDeCampo(value * 100, 1)
}

const ESCENARIOS: ScenarioName[] = ['bear', 'base', 'bull']
const CAMPOS_ESCENARIO = { growth: 'crecimiento FCF', wacc: 'WACC', terminal: 'crecimiento terminal' } as const

/** Los supuestos de partida, sacados de los datos. Lo que no se sabe va vacío.
 *  Con la coma decimal y el punto de miles de la app: los campos llevaban «8.1»
 *  y «108807000000» (revisión 12, visual). */
function inputsIniciales(d: ValuationDefaults): Inputs {
  // Sin crecimiento sugerido (el backend no puede medirlo con menos de dos
  // ejercicios o con extremos negativos), el crecimiento va vacío. Antes se
  // rellenaba con un 5 % que no se decía en ningún sitio, en los tres
  // escenarios (ítem 2.1).
  const g = d.suggested_growth_capped
  const crecimiento = (desde: (g: number) => number) => (g === null ? '' : pctInput(desde(g)))
  return {
    base_fcf: textoDeCampo(d.base_fcf, 0),
    // Deuda desconocida = campo vacío, nunca '0': con cero la empresa se
    // valoraba como si no debiera nada. Hay que escribirla para calcular.
    net_debt: textoDeCampo(d.net_debt, 0),
    shares_outstanding: textoDeCampo(d.shares_outstanding, 0),
    years: '5',
    scenarios: {
      bear: { growth: crecimiento((x) => Math.max(x - 0.03, -0.05)), wacc: pctInput(0.11), terminal: pctInput(0.02) },
      base: { growth: crecimiento((x) => x), wacc: pctInput(0.1), terminal: pctInput(0.025) },
      bull: { growth: crecimiento((x) => x + 0.03), wacc: pctInput(0.09), terminal: pctInput(0.03) },
    },
  }
}

/** Lo escrito en cada campo, leído con la convención de la app (`leerNumero`).
 *  Con `parseFloat`, «8,5» era 8 y «1.250» era 1,25, y se calculaba sin avisar;
 *  `parseInt('5,5') || 5` hacía lo mismo con los años (revisión 12, visual). Un
 *  campo vacío es `null` («no sé»); uno que no se puede leer va a `ilegibles`
 *  con su nombre y lo escrito, y no se calcula. */
function leerInputs(inputs: Inputs) {
  const ilegibles: string[] = []
  const vacios: string[] = []
  const leer = (texto: string, nombre: string, obligatorio = true): number | null => {
    if (texto.trim() === '') {
      if (obligatorio) vacios.push(nombre)
      return null
    }
    const n = leerNumero(texto)
    if (n === null) ilegibles.push(`${nombre} («${texto}»)`)
    return n
  }
  // En el orden del formulario, para que el aviso los nombre como se ven.
  const base_fcf = leer(inputs.base_fcf, 'FCF base')
  const net_debt = leer(inputs.net_debt, 'deuda neta')
  // Sin acciones se calcula igual: sale el valor de la empresa, no por acción.
  const shares_outstanding = leer(inputs.shares_outstanding, 'acciones en circulación', false)
  const years = leer(inputs.years, 'años de proyección')
  if (years !== null && (!Number.isInteger(years) || years < 1)) ilegibles.push(`años de proyección («${inputs.years}»)`)
  const scenarios = Object.fromEntries(
    ESCENARIOS.map((n) => [
      n,
      Object.fromEntries(
        (Object.keys(CAMPOS_ESCENARIO) as (keyof typeof CAMPOS_ESCENARIO)[]).map((campo) => [
          campo,
          leer(inputs.scenarios[n][campo], `${CAMPOS_ESCENARIO[campo]} ${etiqueta(n)}`),
        ]),
      ) as Record<keyof typeof CAMPOS_ESCENARIO, number | null>,
    ]),
  ) as Record<ScenarioName, Record<keyof typeof CAMPOS_ESCENARIO, number | null>>
  return { base_fcf, net_debt, shares_outstanding, years, scenarios, ilegibles, vacios }
}

export function ValuationSection({ symbol }: { symbol: string }) {
  // Un fallo al traer los valores de partida es un fallo, con «Reintentar»: antes
  // decía «No hay datos para prellenar el DCF», como si faltaran (ítem 2.1). Un
  // 404 sí es que faltan (sin estados de EDGAR), y se dice así (revisión del 2.1).
  const carga = useDato(() => ausenteSi404(api.valuationDefaults(symbol)), symbol)
  // Al cambiar de símbolo el bloque vuelve a «cargando» y `Dcf` se monta de
  // nuevo con los supuestos del nuevo: nada del anterior se queda en los campos.
  return (
    <BloqueDatos carga={carga} que="los valores de partida del DCF" ausente={(m) => `No hay datos para prellenar el DCF: ${m}`}>
      {(defaults) => <Dcf symbol={symbol} defaults={defaults} />}
    </BloqueDatos>
  )
}

function Dcf({ symbol, defaults }: { symbol: string; defaults: ValuationDefaults }) {
  const [inputs, setInputs] = useState<Inputs>(() => inputsIniciales(defaults))
  const [result, setResult] = useState<DcfResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Sin un supuesto escrito en cada campo no se calcula: con el campo vacío no
  // hay supuesto que valorar (salía un NaN hacia el backend). Y lo que no se
  // puede leer tampoco: antes se calculaba con lo que `parseFloat` sacara.
  const leido = leerInputs(inputs)
  const listo = leido.vacios.length === 0 && leido.ilegibles.length === 0

  const run = async () => {
    const { base_fcf, years, net_debt, shares_outstanding } = leido
    const scenarios: Record<string, ScenarioAssumptions> = {}
    for (const name of ESCENARIOS) {
      const { growth, wacc, terminal } = leido.scenarios[name]
      if (growth === null || wacc === null || terminal === null) return
      scenarios[name] = { growth_rate: growth / 100, discount_rate: wacc / 100, terminal_growth: terminal / 100 }
    }
    if (!listo || base_fcf === null || years === null || net_debt === null) return
    setBusy(true)
    setError(null)
    try {
      const resp = await api.dcf(symbol, { base_fcf, years, net_debt, shares_outstanding, scenarios })
      setResult(resp)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error en el cálculo')
    } finally {
      setBusy(false)
    }
  }

  const setScenario = (name: ScenarioName, field: 'growth' | 'wacc' | 'terminal', value: string) =>
    setInputs({
      ...inputs,
      scenarios: {
        ...inputs.scenarios,
        [name]: { ...inputs.scenarios[name], [field]: value },
      },
    })

  const inputCls =
    'w-full rounded border border-slate-300 px-2 py-1 text-sm tabular-nums focus:border-sky-500 focus:outline-none'
  const labelCls = 'flex flex-col justify-between gap-0.5 text-xs text-slate-500'
  const moneda = defaults.moneda ?? null

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">DCF por escenarios</h2>
          <EstadoDato data={defaults} />
        </div>
        <p className="mb-3 text-xs text-slate-500">
          {defaults.note} Crecimiento histórico (<Ventana anos={defaults.historical_growth.years} />): ingresos{' '}
          {fmtPct(defaults.historical_growth.revenue_cagr)}, FCF{' '}
          {fmtPct(defaults.historical_growth.fcf_cagr)}.
        </p>

        {/* Cada caja, una columna con el campo abajo del todo: a 820 px «FCF base
            (año 2025)» y «Acciones en circulación» ocupan dos líneas y «Deuda
            neta» una, y los campos de la misma fila quedaban a alturas distintas
            (revisión 12, visual). La moneda va en el rótulo: el FCF y la deuda
            iban sin unidad. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className={labelCls}>
            FCF base ({moneda ? `${moneda}, ` : ''}año {defaults.fiscal_year ?? '—'})
            {/* Sin `inputMode="decimal"`, como la deuda neta: una empresa que quema
                caja tiene el FCF negativo y el teclado de iOS de ese modo no trae
                «-» (revisión 13). */}
            <input
              className={inputCls}
              value={inputs.base_fcf}
              onChange={(e) => setInputs({ ...inputs, base_fcf: e.target.value })}
            />
          </label>
          <label className={labelCls}>
            Deuda neta{moneda ? ` (${moneda})` : ''}
            {/* Sin `inputMode="decimal"`: el teclado de ese modo en iOS no trae
                «-», y una empresa con más caja que deuda tiene la deuda neta
                negativa; no había forma de escribirla (revisión 13). */}
            <input
              className={inputCls}
              value={inputs.net_debt}
              placeholder="desconocida: escríbela"
              onChange={(e) => setInputs({ ...inputs, net_debt: e.target.value })}
            />
          </label>
          <label className={labelCls}>
            Acciones en circulación
            <input
              className={inputCls}
              inputMode="decimal"
              value={inputs.shares_outstanding}
              onChange={(e) => setInputs({ ...inputs, shares_outstanding: e.target.value })}
            />
          </label>
          <label className={labelCls}>
            Años de proyección
            <input
              className={inputCls}
              inputMode="numeric"
              value={inputs.years}
              onChange={(e) => setInputs({ ...inputs, years: e.target.value })}
            />
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {ESCENARIOS.map((name) => (
            <div key={name} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 text-xs font-semibold text-slate-600">
                {etiqueta(name, { mayuscula: true })}
              </div>
              {/* Espacio duro antes del «(%)»: se quedaba solo en una línea. */}
              <label className="mb-1 block text-xs text-slate-500">
                Crecimiento FCF&nbsp;(%/año)
                {/* El crecimiento y la perpetuidad pueden ser negativos (un
                    bajista que encoge): sin `inputMode="decimal"`, cuyo teclado
                    de iOS no trae «-» (revisión 13). El WACC lo conserva: es
                    siempre positivo. */}
                <input
                  className={inputCls}
                  value={inputs.scenarios[name].growth}
                  placeholder={defaults.suggested_growth_capped === null ? 'sin histórico: escríbelo' : undefined}
                  onChange={(e) => setScenario(name, 'growth', e.target.value)}
                />
              </label>
              <label className="mb-1 block text-xs text-slate-500">
                WACC / tasa de descuento&nbsp;(%)
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={inputs.scenarios[name].wacc}
                  onChange={(e) => setScenario(name, 'wacc', e.target.value)}
                />
              </label>
              <label className="block text-xs text-slate-500">
                Crecimiento terminal&nbsp;(%)
                <input
                  className={inputCls}
                  value={inputs.scenarios[name].terminal}
                  onChange={(e) => setScenario(name, 'terminal', e.target.value)}
                />
              </label>
            </div>
          ))}
        </div>

        {leido.ilegibles.length > 0 && (
          <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            No se puede leer {leido.ilegibles.join(', ')}. Escribe las cifras como en el resto de la app,
            p.&nbsp;ej. 8,5 o 1.250.000, y los años en número entero: no se calcula con un número a medias.
          </p>
        )}
        {defaults.suggested_growth_capped === null && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            Sin crecimiento histórico con el que precargarlo: escribe el tuyo en cada escenario para calcular.
          </p>
        )}
        {defaults.net_debt === null && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            El filing no trae deuda a largo ni a corto plazo: la deuda neta es desconocida. Sin
            ella no hay valor por acción, y suponerla cero valoraría la empresa como si no debiera
            nada. Escríbela para calcular.
          </p>
        )}
        {defaults.nota_deuda && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            Deuda parcial. {defaults.nota_deuda}
          </p>
        )}

        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={run}
            disabled={busy || !listo}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? 'Calculando…' : 'Calcular rango de valor'}
          </button>
          {leido.vacios.length > 0 && (
            <span className="text-xs text-slate-500">Para calcular falta: {leido.vacios.join(', ')}.</span>
          )}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </section>

      {result && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Rango de valor intrínseco{' '}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal text-slate-500">
              calculado con tus supuestos — no es una predicción
            </span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {ESCENARIOS.map((name) => {
              const sc = result.scenarios[name]
              if (!sc) return null
              const vs =
                sc.value_per_share !== null && result.current_price
                  ? sc.value_per_share / result.current_price - 1
                  : null
              return (
                <div key={name} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">{etiqueta(name, { mayuscula: true })}</div>
                  <div className="text-2xl font-semibold tabular-nums text-slate-900">
                    {sc.value_per_share !== null
                      ? fmtPrecio(sc.value_per_share)
                      : fmtCompacto(sc.equity_value)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {vs !== null && (
                      <>
                        {fmtPct(vs)} vs. precio actual ({fmtPrecio(result.current_price)}) ·{' '}
                      </>
                    )}
                    terminal pesa {fmtPct(sc.terminal_weight)}
                  </div>
                </div>
              )
            })}
          </div>

          {result.sensitivity && (
            <div className="mt-4">
              <h3 className="mb-1 text-xs font-semibold text-slate-600">
                Sensibilidad (escenario base): valor/acción según WACC × crecimiento
              </h3>
              <MarcoTabla etiqueta="Sensibilidad del valor por acción">
                <table className="text-xs tabular-nums">
                  <thead>
                    <tr>
                      <th className="p-1 text-left font-normal text-slate-400">WACC \ g</th>
                      {result.sensitivity.growth_rates.map((g) => (
                        <th key={g} className="p-1 text-right font-normal text-slate-400">
                          {fmtPct(g, 0)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.sensitivity.rows.map((row) => (
                      <tr key={row.discount_rate}>
                        <td className="p-1 text-slate-400">{fmtPct(row.discount_rate, 0)}</td>
                        {row.values.map((v, i) => (
                          <td key={i} className="p-1 text-right text-slate-700">
                            {/* Sin decimales, cualquier acción por debajo de 0,50 salía
                                «0» en todas las celdas (revisión 4); con los de un precio,
                                «170,63», una precisión que el método no tiene y que no
                                cabía a 390 px (revisión 5). Tres cifras significativas. */}
                            {v !== null ? fmtCifras(v) : '·'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </MarcoTabla>
              <p className="mt-2 text-xs text-slate-400">
                Si la matriz se mueve mucho entre celdas vecinas, el valor central es poco
                robusto: la incertidumbre es información, no un defecto.
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
