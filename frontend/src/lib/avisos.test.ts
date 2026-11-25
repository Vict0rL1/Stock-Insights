/**
 * El aviso de acción presenta lo que decide el motor, sin decidir nada (petición
 * del 24 nov: «que las alertas de compra y venta sean más claras»). Cada tipo,
 * con decisiones con la forma de las que sirve `decision.py`, y las guardas:
 * sin precio nunca hay «mantener», un peso 0 por los topes es «Sin sitio», sin
 * `cambiaria` hacia comprar «Esperar» no inventa un precio, y las cifras se
 * escriben en español.
 */
import { describe, expect, it } from 'vitest'
import type { AlternativaDecision, DailySignal, Decision, DecisionLevels, ReglaTraza, Shortlist, StopDePosicion, StopsDeCartera } from '../api/types'
import {
  avisoDe,
  avisoDeLaFila,
  avisosDeCartera,
  contextoDeLaFila,
  resumenDelRecorte,
  tamanoDeLaLista,
  type Aviso,
  type DatosDelAviso,
  type TipoAviso,
} from './avisos'

const D = ' ' // espacio duro

const NIVELES: DecisionLevels = {
  entrada_desde: 138.18,
  entrada_hasta: 143.82,
  stop: 117.73,
  stop_pct: 16.5,
  objetivo: 197.96,
  objetivo_pct: 40.4,
  ratio: 2,
  peso_bruto_pct: 6.1,
}

function decision(d: Partial<Decision> & Pick<Decision, 'action'>): Decision {
  return {
    label: d.action,
    reasons: [],
    levels: null,
    escenarios: null,
    triggers: [],
    confidence: 'sin_calibrar',
    owned: false,
    ...d,
  }
}

const regla = (id: string, valor: number, umbral: number, papel = 'decide'): ReglaTraza => ({
  id,
  regla: id,
  resultado: 'cumple',
  efecto: null,
  papel,
  datos: { valor, umbral },
})

const posicion = (p: Partial<StopDePosicion> & { symbol?: string }): StopDePosicion => ({
  symbol: 'STOP',
  en_lista: false,
  precio: 100,
  precio_estado: 'valido',
  moneda: 'USD',
  stop: 90,
  stop_fijado_al_abrir: true,
  stop_por_clase: false,
  estado: 'por_encima',
  motivo: null,
  ...p,
})

const RECORTES_DXCM = [
  `DXCM: 10,9${D}% → 10,0${D}% (tope por posición). Un stop ceñido puede justificar aritméticamente mucho más, pero el modelo puede estar equivocado sobre esa empresa y entonces el tamaño no te salva el stop.`,
  `Ideas nuevas al 0${D}%: la cartera que YA tienes estima un 22,2${D}% de volatilidad, por encima del objetivo (12${D}%). No es que las ideas sean malas — es que no cabe más riesgo.`,
]

const comprar = (extra: Partial<Decision> = {}) => decision({ action: 'comprar', levels: NIVELES, ...extra })

const haciaComprar = (condiciones: AlternativaDecision['condiciones']): AlternativaDecision[] => [
  { hacia: 'comprar', requiere: 'todas', condiciones },
  { hacia: 'ninguna', requiere: 'todas', condiciones: [{ regla: 'puntuacion_favorable', condicion: 'puntuación < +0,35', actual: 0.5, umbral: 0.35, distancia: -0.15, unidad: 'puntos' }] },
]

const TENDENCIA = {
  regla: 'tendencia_a_favor',
  condicion: 'precio ≥ 96,68 (media 200 + 2 %)',
  actual: 92,
  umbral: 96.68,
  distancia: 5.09,
  unidad: '%',
}

const texto = (a: Aviso) => [a.verbo, a.frase, ...a.pasos, ...a.cifras.flatMap((c) => [c.rotulo, c.valor, c.nota ?? ''])].join(' | ')

describe('comprar', () => {
  it('con peso final: zona, límite de pérdida y tamaño, en frases', () => {
    const a = avisoDe({ decision: comprar(), tamano: { pesoFinalPct: 4, recortes: [] } })
    expect(a.tipo).toBe('comprar')
    expect(a.verbo).toBe('Comprar')
    expect(a.tono).toBe('verde')
    expect(a.frase).toBe('Compra entre 138,18 y 143,82. Si cae a 117,73, vende: es tu límite de pérdida (stop).')
    expect(a.pasos).toEqual([`Tamaño sugerido: 4,0${D}% de tu cartera.`])
    expect(a.cifras).toEqual([
      { rotulo: 'Comprar entre', valor: '138,18–143,82' },
      { rotulo: 'Vender si baja a', valor: '117,73', tono: 'rojo' },
      { rotulo: 'Cuánto de tu cartera', valor: `4,0${D}%`, nota: `recortado desde 6,1${D}%` },
    ])
  })

  it('con moneda, cada precio lleva su código', () => {
    const a = avisoDe({ decision: comprar(), tamano: { pesoFinalPct: 6.1, recortes: [] }, moneda: 'CAD' })
    expect(a.frase).toBe(`Compra entre 138,18${D}CAD y 143,82${D}CAD. Si cae a 117,73${D}CAD, vende: es tu límite de pérdida (stop).`)
    // Sin recortar no hay «recortado desde».
    expect(a.cifras[2]).toEqual({ rotulo: 'Cuánto de tu cartera', valor: `6,1${D}%`, nota: undefined })
  })

  it('un peso pequeño no se escribe «0,0 %» ni pasa por «no cabe»', () => {
    const a = avisoDe({ decision: comprar(), tamano: { pesoFinalPct: 0.04, recortes: [] } })
    expect(a.tipo).toBe('comprar')
    expect(a.pasos).toEqual([`Tamaño sugerido: 0,04${D}% de tu cartera.`])
  })

  it('una acción de céntimos conserva sus cifras', () => {
    const levels = { ...NIVELES, entrada_desde: 0.00294, entrada_hasta: 0.00306, stop: 0.002616 }
    const a = avisoDe({ decision: comprar({ levels }), tamano: { pesoFinalPct: 2, recortes: [] } })
    expect(a.frase).toBe('Compra entre 0,00294 y 0,00306. Si cae a 0,002616, vende: es tu límite de pérdida (stop).')
    expect(a.cifras[0].valor).toBe('0,00294–0,00306')
  })

  it('con reglas refutadas contra el histórico, lo dice antes que el tamaño', () => {
    const a = avisoDe({ decision: comprar({ confidence: 'refutada' }), tamano: { pesoFinalPct: 4, recortes: [] } })
    expect(a.pasos[0]).toMatch(/^Ojo: estas reglas se probaron contra el histórico y no funcionaron/)
  })
})

describe('comprar sin sitio: peso 0 por los topes de la cartera', () => {
  it('«Buena idea, pero hoy no cabe», con el recorte que la deja en 0 y qué haría falta', () => {
    const a = avisoDe({ decision: comprar({ levels: { ...NIVELES, peso_bruto_pct: 10.9 } }), tamano: { pesoFinalPct: 0, recortes: RECORTES_DXCM } })
    expect(a.tipo).toBe('comprar_sin_sitio')
    expect(a.verbo).toBe('Sin sitio')
    expect(a.tono).toBe('ambar')
    expect(a.frase).toBe('Buena idea, pero hoy no cabe en tu cartera.')
    // El último paso del dimensionador, no el primero: «10,9 % → 10,0 % (tope
    // por posición)» no explica ningún cero.
    expect(a.pasos).toEqual([
      `Ideas nuevas al 0${D}%: la cartera que YA tienes estima un 22,2${D}% de volatilidad, por encima del objetivo (12${D}%).`,
      'Para hacerle sitio tendrías que vender algo antes.',
    ])
    expect(a.cifras[2]).toEqual({ rotulo: 'Cuánto de tu cartera', valor: `0,0${D}%`, nota: `recortado desde 10,9${D}%` })
  })

  it('sin recortes que la nombren, no se calla el porqué', () => {
    const a = avisoDe({ decision: comprar(), tamano: { pesoFinalPct: 0, recortes: [] } })
    expect(a.tipo).toBe('comprar_sin_sitio')
    expect(a.pasos).toEqual([`Los topes de tu cartera la dejan en 0${D}%.`, 'Para hacerle sitio tendrías que vender algo antes.'])
  })
})

describe('comprar sin tamaño', () => {
  it('sin peso final: el bruto no se presenta como tamaño', () => {
    const a = avisoDe({ decision: comprar(), tamano: { pesoFinalPct: null, recortes: [] } })
    expect(a.tipo).toBe('comprar_sin_tamano')
    expect(a.verbo).toBe('Comprar')
    expect(a.frase).toBe('Compra entre 138,18 y 143,82. Si cae a 117,73, vende: es tu límite de pérdida (stop).')
    expect(a.pasos).toEqual([`Tamaño sin calcular para tu cartera: su stop permitiría hasta un 6,1${D}%, antes de los topes de la cartera.`])
    expect(a.cifras[2]).toEqual({ rotulo: 'Cuánto de tu cartera', valor: '—', nota: `sin calcular; antes de los topes, 6,1${D}%` })
  })

  it('fuera de la lista corta (sin dimensionar) es lo mismo, y sin bruto no lo inventa', () => {
    const a = avisoDe({ decision: comprar({ levels: { ...NIVELES, peso_bruto_pct: null } }) })
    expect(a.tipo).toBe('comprar_sin_tamano')
    expect(a.pasos).toEqual(['Tamaño sin calcular para tu cartera.'])
    expect(a.cifras[2]).toEqual({ rotulo: 'Cuánto de tu cartera', valor: '—', nota: 'sin calcular' })
  })

  it('sin dimensionar pero sin hueco para ninguna idea nueva: «Sin sitio», con el motivo, y sin escribir un cero', () => {
    // Revisión 14, H12: con «Ideas nuevas al 0 %», la cabecera decía «ninguna cabe
    // hoy» y las que califican fuera de la lista corta, «Comprar» en verde.
    const a = avisoDe({ decision: comprar(), tamano: { pesoFinalPct: null, recortes: [RECORTES_DXCM[1]], sinHueco: true } })
    expect(a.tipo).toBe('comprar_sin_sitio')
    expect(a.verbo).toBe('Sin sitio')
    expect(a.tono).toBe('ambar')
    expect(a.frase).toBe('Buena idea, pero hoy no cabe en tu cartera.')
    expect(a.pasos).toEqual([
      `Ideas nuevas al 0${D}%: la cartera que YA tienes estima un 22,2${D}% de volatilidad, por encima del objetivo (12${D}%).`,
      'Para hacerle sitio tendrías que vender algo antes.',
    ])
    expect(a.cifras[2]).toEqual({ rotulo: 'Cuánto de tu cartera', valor: '—', nota: 'sin calcular: hoy no cabe ninguna idea nueva' })
  })
})

describe('esperar (vigilar)', () => {
  it('con «qué la cambiaría» hacia comprar: el precio y lo que le falta', () => {
    const a = avisoDe({ decision: decision({ action: 'vigilar', levels: NIVELES, cambiaria: haciaComprar([TENDENCIA]) }) })
    expect(a.tipo).toBe('esperar')
    expect(a.verbo).toBe('Esperar')
    expect(a.tono).toBe('ambar')
    expect(a.frase).toBe(`Compra cuando cierre a 96,68 o más (le falta un 5,09${D}%).`)
    expect(a.cifras).toEqual([
      { rotulo: 'Comprar si cierra a', valor: '96,68 o más', tono: 'verde' },
      { rotulo: 'Le falta', valor: `5,09${D}%` },
    ])
  })

  it('aplazada por resultados: la fecha, en español, junto a lo que falte', () => {
    const resultados = { regla: 'resultados_proximos', condicion: 'que pasen los resultados del 6 oct 2026', actual: '2026-10-06', umbral: null, distancia: null, unidad: null }
    const solo = avisoDe({ decision: decision({ action: 'vigilar', levels: NIVELES, cambiaria: haciaComprar([resultados]) }) })
    expect(solo.frase).toBe('Compra cuando pasen sus resultados del 6 oct 2026.')
    const ambas = avisoDe({ decision: decision({ action: 'vigilar', levels: NIVELES, cambiaria: haciaComprar([TENDENCIA, resultados]) }) })
    expect(ambas.frase).toBe(`Compra cuando cierre a 96,68 o más (le falta un 5,09${D}%) y pasen sus resultados del 6 oct 2026.`)
  })

  it('con un precio viejo, espera a tener uno actual', () => {
    const viejo = { regla: 'precio_viejo', condicion: 'volver a tener precio actual', actual: 'viejo', umbral: null, distancia: null, unidad: null }
    const a = avisoDe({ decision: decision({ action: 'vigilar', levels: NIVELES, cambiaria: haciaComprar([viejo]) }) })
    expect(a.frase).toBe('Compra cuando vuelva a haber un precio actual.')
  })

  it('sin «qué la cambiaría» hacia comprar no inventa un precio con los niveles', () => {
    // Una «vigilar» trae zona de compra y stop (`levels`): ninguno es el precio que
    // la haría comprar, y antes de esto nada impedía usarlos.
    const sinNada = avisoDe({ decision: decision({ action: 'vigilar', levels: NIVELES, cambiaria: [] }) })
    expect(sinNada.tipo).toBe('esperar')
    expect(sinNada.frase).toBe('Todavía no: la regla espera antes de comprar.')
    expect(texto(sinNada)).not.toMatch(/\d/)
    // Solo la otra alternativa (hacia «ninguna»): tampoco.
    const otra = avisoDe({ decision: decision({ action: 'vigilar', levels: NIVELES, cambiaria: haciaComprar([]).slice(1) }) })
    expect(texto(otra)).not.toMatch(/138|143|117/)
    // Con disparadores del motor, los suyos, tal cual.
    const disparador = 'Comprar cuando cierre en o por encima de 96,68 (media 200 + 2 %)'
    const conDisparador = avisoDe({ decision: decision({ action: 'vigilar', levels: NIVELES, triggers: [disparador] }) })
    expect(conDisparador.pasos).toEqual([disparador])
    expect(texto(conDisparador)).not.toMatch(/138|143|117/)
  })

  it('sin media de 200 sesiones tampoco hay precio que pedir', () => {
    const desconocida = { regla: 'tendencia_a_favor', condicion: 'precio ≥ media 200 + 2 %', actual: 92, umbral: null, distancia: null, unidad: '%', nota: 'desconocido' }
    const a = avisoDe({ decision: decision({ action: 'vigilar', levels: NIVELES, cambiaria: haciaComprar([desconocida]) }) })
    expect(a.frase).toBe('Compra cuando haya una media de 200 sesiones con que medir la tendencia.')
    expect(a.cifras).toEqual([])
  })
})

describe('evitar, sin acción y sin datos', () => {
  it('evitar: no comprar, en gris y sin cifras', () => {
    const a = avisoDe({ decision: decision({ action: 'evitar' }) })
    expect(a).toEqual({
      tipo: 'evitar',
      verbo: 'Evitar',
      frase: 'No la compres: puntúa por detrás de sus comparables de sector.',
      pasos: [],
      tono: 'gris',
      cifras: [],
    })
  })

  it('sin acción: qué la haría comprar, con su puntuación junto al umbral', () => {
    const puntuacion = { regla: 'puntuacion_favorable', condicion: 'puntuación ≥ +0,35', actual: 0.3496, umbral: 0.35, distancia: 0.0004, unidad: 'puntos' }
    const a = avisoDe({ decision: decision({ action: 'ninguna', cambiaria: haciaComprar([puntuacion]) }) })
    expect(a.tipo).toBe('sin_accion')
    expect(a.verbo).toBe('Sin acción')
    // 0,3496 frente a 0,35: no «ahora +0,35».
    expect(a.pasos).toEqual(['Pasaría a «Comprar» cuando su puntuación llegue a +0,35 o más (ahora +0,3496).'])
    // La cola de la lista no trae la traza: sin pasos, no sin aviso.
    expect(avisoDe({ decision: decision({ action: 'ninguna', traza_en_ficha: true }) }).pasos).toEqual([])
  })

  it('sin datos: lo dice el motor', () => {
    const a = avisoDe({ decision: decision({ action: 'sin_datos', reasons: ['Falta el precio sobre esta empresa.'] }) })
    expect(a.tipo).toBe('sin_datos')
    expect(a.pasos).toEqual(['Falta el precio sobre esta empresa.'])
    expect(avisoDe({}).tipo).toBe('sin_datos')
  })
})

describe('vender', () => {
  it('stop perforado en el repaso: precio, límite y moneda', () => {
    const a = avisoDe({ stop: posicion({ precio: 104, stop: 110, estado: 'perforado' }) })
    expect(a.tipo).toBe('vender')
    expect(a.verbo).toBe('Vender')
    expect(a.tono).toBe('rojo')
    expect(a.frase).toBe(`Cotiza a 104,00${D}USD, por debajo de tu límite de pérdida (stop) de 110,00${D}USD. Tu regla dice vender.`)
    expect(a.cifras).toEqual([
      { rotulo: 'Precio', valor: `104,00${D}USD` },
      { rotulo: 'Límite de pérdida (stop)', valor: `110,00${D}USD`, tono: 'rojo' },
    ])
  })

  it('un stop perforado manda aunque la lista, de hace horas, diga mantener', () => {
    const lista = decision({ action: 'mantener', owned: true, levels: { ...NIVELES, stop: 110 } })
    expect(avisoDe({ decision: lista, stop: posicion({ precio: 104, stop: 110, estado: 'perforado' }) }).tipo).toBe('vender')
  })

  it('en el propio stop dice «justo en»; y un precio a un pelo no se escribe como el stop', () => {
    expect(avisoDe({ stop: posicion({ precio: 110, stop: 110, estado: 'perforado' }) }).frase).toBe(
      `Cotiza a 110,00${D}USD, justo en tu límite de pérdida (stop). Tu regla dice vender.`,
    )
    expect(avisoDe({ stop: posicion({ precio: 109.999, stop: 110, estado: 'perforado' }) }).frase).toBe(
      `Cotiza a 109,999${D}USD, por debajo de tu límite de pérdida (stop) de 110,00${D}USD. Tu regla dice vender.`,
    )
  })

  it('perforado con un precio viejo o solo por el cierre de la lista: se dice, con las dos cifras', () => {
    const a = avisoDe({
      stop: posicion({
        precio: 115, stop: 116, estado: 'perforado', precio_estado: 'viejo', precio_fuente: 'cierre_de_la_lista',
        precios: [
          { precio: 117, fuente: 'cotizacion', estado: 'valido', proveedor: 'finnhub', fecha: null },
          { precio: 115, fuente: 'cierre_de_la_lista', estado: 'viejo', proveedor: 'yfinance', fecha: null },
        ],
        lotes: 2, stop_por_clase: true,
      }),
    })
    expect(a.tipo).toBe('vender')
    expect(a.pasos).toEqual([
      'Es un precio viejo: compruébalo en tu broker antes de actuar.',
      `La cotización de ahora (117,00${D}USD) está por encima: compruébalo en tu broker.`,
      'Es el más alto de los de sus 2 lotes, y es el punto medio de su clase, no uno medido.',
    ])
  })

  it('la lista manda vender por su stop (sin repaso): con las cifras de su traza', () => {
    const a = avisoDe({
      decision: decision({ action: 'vender', owned: true, levels: { ...NIVELES, stop: 110 }, reglas: [regla('stop_perforado', 104, 110)] }),
    })
    expect(a.tipo).toBe('vender')
    expect(a.frase).toBe('Cotiza a 104,00, por debajo de tu límite de pérdida (stop) de 110,00. Tu regla dice vender.')
  })

  it('la lista manda vender por puntuación: la cifra frente a su umbral', () => {
    const a = avisoDe({
      decision: decision({ action: 'vender', owned: true, reglas: [regla('puntuacion_desfavorable', -0.52, -0.35)] }),
      stop: posicion({ precio: 60, stop: 50 }),
    })
    expect(a.tipo).toBe('vender')
    expect(a.frase).toBe(
      'Su puntuación frente a sus comparables cayó a -0,52, en o por debajo de -0,35: la razón para tenerla ya no se sostiene. Tu regla dice vender.',
    )
  })

  it('la lista dice vender por un stop que con el precio de ahora no está perforado: vende igual, y lo dice', () => {
    const a = avisoDe({
      decision: decision({ action: 'vender', owned: true, reglas: [regla('stop_perforado', 104, 110)] }),
      stop: posicion({ precio: 112, stop: 110 }),
    })
    expect(a.tipo).toBe('vender')
    expect(a.pasos).toContain(`Con el precio de ahora (112,00${D}USD) tu límite no está perforado: la lista es de antes; compruébalo en tu broker.`)
  })

  it('sin traza (cola de la lista), con la razón del motor', () => {
    const a = avisoDe({ decision: decision({ action: 'vender', owned: true, reasons: ['La puntuación cayó a -0,52.'] }) })
    expect(a.frase).toBe('La puntuación cayó a -0,52. Tu regla dice vender.')
  })
})

describe('sin comprobar: lo que no se pudo mirar no está en orden', () => {
  it('sin precio nunca da «mantener», diga lo que diga la lista', () => {
    const p = posicion({ precio: null, precio_estado: 'desconocido', estado: 'sin_comprobar', motivo: 'sin precio (ninguna fuente dio su cotización)' })
    for (const lista of [undefined, decision({ action: 'mantener', owned: true, levels: NIVELES })]) {
      const a = avisoDe({ decision: lista, stop: p })
      expect(a.tipo).toBe('sin_comprobar')
      expect(a.verbo).toBe('Revisar')
      expect(a.tono).toBe('ambar')
      expect(a.frase).toBe('No hay precio de hoy: el límite de pérdida (stop) no se ha podido comprobar.')
      expect(a.pasos[0]).toBe('Míralo en tu broker.')
      expect(a.cifras[0]).toEqual({ rotulo: 'Precio', valor: '—' })
    }
  })

  it('un «por encima» sin precio válido o sin stop tampoco pasa por bueno', () => {
    expect(avisoDe({ stop: posicion({ precio: null, estado: 'por_encima' }) }).tipo).toBe('sin_comprobar')
    expect(avisoDe({ stop: posicion({ precio_estado: 'viejo', estado: 'por_encima' }) }).tipo).toBe('sin_comprobar')
    expect(avisoDe({ stop: posicion({ stop: null, estado: 'por_encima' }) }).tipo).toBe('sin_comprobar')
  })

  it('con su motivo, y lo que diga la lista además', () => {
    const p = posicion({ estado: 'sin_comprobar', motivo: 'sin stop (ni fijado al abrir ni coste con que calcularlo)', stop: null })
    const a = avisoDe({ stop: p, decision: decision({ action: 'reducir', owned: true }) })
    expect(a.frase).toBe('El límite de pérdida (stop) no se ha podido comprobar: sin stop (ni fijado al abrir ni coste con que calcularlo).')
    expect(a.pasos).toEqual(['Míralo en tu broker.', 'La lista dice además «Reducir»: la tendencia se giró en contra.'])
  })

  it('sin repaso, un precio viejo no es «Mantener»: lo mismo que con el repaso', () => {
    // Revisión 14, H13: con el repaso era «Revisar»; sin él (falló, o la ficha,
    // que no lo tiene), «Mantener» con una nota.
    const lista = decision({
      action: 'mantener',
      owned: true,
      levels: { ...NIVELES, stop: 90 },
      reglas: [
        { ...regla('stop_perforado', 100, 90, 'evaluada'), resultado: 'no_cumple' },
        { ...regla('precio_viejo', 300, 0, 'informa'), datos: { minutos: 300 } },
      ],
    })
    const conRepaso = avisoDe({ decision: lista, stop: posicion({ precio: 100, precio_estado: 'viejo', motivo: 'solo un precio viejo' }) })
    const sinRepaso = avisoDe({ decision: lista, precio: 100, moneda: 'USD' })
    expect([conRepaso.tipo, sinRepaso.tipo]).toEqual(['sin_comprobar', 'sin_comprobar'])
    // La ficha («Qué dice la app») pasa solo la decisión: tampoco «Mantener».
    expect(avisoDe({ decision: lista }).verbo).toBe('Revisar')
    expect(sinRepaso.verbo).toBe('Revisar')
    expect(sinRepaso.frase).toBe('El límite de pérdida (stop) no se ha podido comprobar: solo hay un precio viejo (todas las fuentes fallaron).')
    expect(sinRepaso.pasos).toEqual(['Míralo en tu broker.', 'Con lo que sí pudo mirar, tu regla dice mantener.'])
    expect(sinRepaso.cifras).toEqual([
      { rotulo: 'Precio', valor: `100,00${D}USD` },
      { rotulo: 'Límite de pérdida (stop)', valor: `90,00${D}USD`, tono: 'gris' },
    ])
  })

  it('sin repaso, un stop que el motor no pudo evaluar (sin stop ni coste) no es «Mantener»', () => {
    const lista = decision({
      action: 'mantener',
      owned: true,
      reglas: [
        { ...regla('puntuacion_desfavorable', 0.5, -0.35, 'evaluada'), resultado: 'no_cumple' },
        { ...regla('stop_perforado', 100, 0, 'evaluada'), resultado: 'desconocido', datos: { valor: 100, umbral: null } },
      ],
    })
    const a = avisoDe({ decision: lista, precio: 100 })
    expect(a.tipo).toBe('sin_comprobar')
    expect(a.frase).toBe('El límite de pérdida (stop) no se ha podido comprobar: la posición no tiene stop ni coste con que calcularlo.')
    // Con la regla evaluada, sí es «Mantener», aunque no se sepa el precio (la ficha no lo pasa).
    const evaluada = decision({ ...lista, levels: { ...NIVELES, stop: 90 }, reglas: [{ ...regla('stop_perforado', 100, 90, 'evaluada'), resultado: 'no_cumple' }] })
    expect(avisoDe({ decision: evaluada }).tipo).toBe('mantener')
    expect(avisoDe({ decision: evaluada }).frase).toBe('Tu regla dice mantener. Si cae a 90,00, vende: es tu límite de pérdida (stop).')
  })

  it('sin traza (respuesta antigua), «Mantener» solo con el precio por encima del stop', () => {
    const lista = decision({ action: 'mantener', owned: true, levels: { ...NIVELES, stop: 90 } })
    expect(avisoDe({ decision: lista, precio: 100 }).tipo).toBe('mantener')
    expect(avisoDe({ decision: lista }).frase).toBe('No hay precio de hoy: el límite de pérdida (stop) no se ha podido comprobar.')
    expect(avisoDe({ decision: decision({ action: 'mantener', owned: true }), precio: 100 }).frase).toBe(
      'El límite de pérdida (stop) no se ha podido comprobar: la lista no trae el stop de la posición.',
    )
  })

  it('una posición sin datos en la lista y sin repaso: sin comprobar, no «sin datos»', () => {
    const a = avisoDe({ decision: decision({ action: 'sin_datos', owned: true, reasons: ['Falta el precio.'] }) })
    expect(a.tipo).toBe('sin_comprobar')
    expect(a.pasos).toEqual(['Falta el precio.', 'Míralo en tu broker.'])
  })
})

describe('mantener y reducir', () => {
  const CAMBIARIA_MANTENER: AlternativaDecision[] = [
    { hacia: 'vender', requiere: 'alguna', condiciones: [] },
    { hacia: 'reducir', requiere: 'alguna', condiciones: [{ regla: 'tendencia_perdida', condicion: 'precio ≤ 92,66 (media 200 − 1 %)', actual: 104, umbral: 92.66, distancia: -10.9, unidad: '%' }] },
  ]

  it('la lista dice mantener y el stop de ahora está por encima', () => {
    const a = avisoDe({
      decision: decision({ action: 'mantener', owned: true, levels: { ...NIVELES, stop: 50 }, cambiaria: CAMBIARIA_MANTENER }),
      stop: posicion({ symbol: 'KO', precio: 60, stop: 50 }),
    })
    expect(a.tipo).toBe('mantener')
    expect(a.tono).toBe('gris')
    expect(a.frase).toBe(`Cotiza a 60,00${D}USD, por encima de tu límite de pérdida (stop) de 50,00${D}USD. Tu regla dice mantener.`)
    expect(a.pasos).toEqual([`Si cierra a 92,66${D}USD o menos, tu regla dice reducir.`])
  })

  it('solo con su stop (la lista no la decide): mantener sin atribuírselo al motor', () => {
    const a = avisoDe({ stop: posicion({ precio: 60, stop: 50 }) })
    expect(a.tipo).toBe('mantener')
    expect(a.frase).toBe(`Cotiza a 60,00${D}USD, por encima de tu límite de pérdida (stop) de 50,00${D}USD. De momento, nada que vender.`)
    // Una «comprar» de una lista calculada antes de abrirla no es sobre tu posición.
    expect(avisoDe({ decision: comprar(), stop: posicion({ precio: 60, stop: 50 }) }).tipo).toBe('mantener')
  })

  it('sin repaso, la decisión de la lista sobre la posición', () => {
    const a = avisoDe({ decision: decision({ action: 'mantener', owned: true, levels: { ...NIVELES, stop: 50 } }), precio: 60 })
    expect(a.frase).toBe('Cotiza a 60,00, por encima de tu límite de pérdida (stop) de 50,00. Tu regla dice mantener.')
  })

  it('reducir: la tendencia, con el umbral de su traza, y el stop', () => {
    const lista = decision({ action: 'reducir', owned: true, levels: { ...NIVELES, stop: 80 }, reglas: [regla('tendencia_perdida', 90, 92.66)] })
    const a = avisoDe({ decision: lista, stop: posicion({ precio: 90, stop: 80 }) })
    expect(a.tipo).toBe('reducir')
    expect(a.verbo).toBe('Reducir')
    expect(a.tono).toBe('naranja')
    expect(a.frase).toBe(`La tendencia se giró en contra: cotiza a 90,00${D}USD, en o por debajo de 92,66${D}USD. Tu regla dice reducir.`)
    expect(a.pasos[0]).toBe(`Si cae a 80,00${D}USD, vende: es tu límite de pérdida (stop).`)
  })
})

describe('la cartera entera: el recuento «Para vender» sale de los mismos avisos', () => {
  const senal = (symbol: string, d: Decision) => ({ symbol, decision: d, price: { last: 60 } }) as unknown as DailySignal

  it('con repaso: cada abierta, con su decisión si la lista la trata como posición', () => {
    const signals = [
      senal('KO', decision({ action: 'vender', owned: true, reglas: [regla('puntuacion_desfavorable', -0.6, -0.35)] })),
      senal('CERRADA', decision({ action: 'vender', owned: true })),
      senal('IDEA', comprar()),
    ]
    const repaso: StopsDeCartera = {
      abiertas: 3,
      en_lista: 1,
      posiciones: [
        posicion({ symbol: 'KO', en_lista: true, precio: 60, stop: 50 }),
        posicion({ symbol: 'STOP', precio: 104, stop: 110, estado: 'perforado' }),
        posicion({ symbol: 'SHOP.TO', precio: null, estado: 'sin_comprobar', motivo: 'sin precio' }),
      ],
    }
    const avisos = avisosDeCartera(signals, repaso)
    expect(avisos.map((a) => [a.symbol, a.aviso.tipo])).toEqual([
      ['KO', 'vender'],
      ['STOP', 'vender'],
      ['SHOP.TO', 'sin_comprobar'],
    ])
    expect(avisos[0].senal?.symbol).toBe('KO')
  })

  it('sin repaso, o con el repaso fallido: las filas de la lista que son tuyas', () => {
    const signals = [senal('VIEJA', decision({ action: 'vender', owned: true })), senal('IDEA', comprar())]
    expect(avisosDeCartera(signals, undefined).map((a) => a.symbol)).toEqual(['VIEJA'])
    expect(avisosDeCartera(signals, { abiertas: null, en_lista: null, posiciones: [], error: 'falló' }).map((a) => a.symbol)).toEqual(['VIEJA'])
    expect(avisosDeCartera(signals, { abiertas: 0, en_lista: 0, posiciones: [] })).toEqual([])
  })
})

describe('el contexto de una fila de la lista', () => {
  const shortlist = {
    ideas: [{ symbol: 'DXCM', peso_final_pct: 0 }, { symbol: 'HSY', peso_final_pct: 4 }],
    sizing: { recortes: RECORTES_DXCM },
  } as unknown as Shortlist

  it('su tamaño, si está en la lista corta, con los recortes que la tocan', () => {
    expect(tamanoDeLaLista('DXCM', shortlist)).toEqual({ pesoFinalPct: 0, recortes: RECORTES_DXCM })
    expect(tamanoDeLaLista('HSY', shortlist)).toEqual({ pesoFinalPct: 4, recortes: [RECORTES_DXCM[1]] })
    expect(tamanoDeLaLista('OTRA', shortlist)).toBeUndefined()
    expect(tamanoDeLaLista('DXCM', undefined)).toBeUndefined()
  })

  it('fuera de la lista corta, sin tamaño; salvo que no quepa ninguna idea nueva', () => {
    const sinHueco = { ...shortlist, sin_hueco_de_riesgo: true } as Shortlist
    expect(tamanoDeLaLista('OTRA', sinHueco)).toEqual({ pesoFinalPct: null, recortes: [RECORTES_DXCM[1]], sinHueco: true })
    expect(tamanoDeLaLista('DXCM', sinHueco)).toEqual({ pesoFinalPct: 0, recortes: RECORTES_DXCM, sinHueco: true })
    expect(tamanoDeLaLista('OTRA', { ...shortlist, sin_hueco_de_riesgo: false } as Shortlist)).toBeUndefined()
  })

  it('el aviso de la fila es el de su tarjeta: una idea que ya tienes habla de su stop', () => {
    // Revisión 14, H1: la tarjeta pasaba solo el tamaño y decía «Comprar … Tamaño
    // sugerido» de una idea comprada después de calcular la lista.
    const hsy = { symbol: 'HSY', decision: comprar(), price: { last: 144 } } as unknown as DailySignal
    expect(avisoDeLaFila(hsy, { cartera: undefined, shortlist }).tipo).toBe('comprar')
    const repaso = { abiertas: 1, en_lista: 1, posiciones: [posicion({ symbol: 'HSY', precio: 144, stop: 125 })] }
    expect(avisoDeLaFila(hsy, { cartera: repaso, shortlist }).tipo).toBe('mantener')
    expect(avisoDeLaFila(hsy, null).tipo).toBe('comprar_sin_tamano')
  })

  it('su stop, solo con un repaso que se pudo hacer', () => {
    const p = posicion({ symbol: 'KO' })
    expect(contextoDeLaFila('KO', { cartera: { abiertas: 1, en_lista: 1, posiciones: [p] }, shortlist })).toEqual({ stop: p, tamano: undefined })
    expect(contextoDeLaFila('KO', { cartera: { abiertas: null, en_lista: null, posiciones: [p], error: 'x' }, shortlist }).stop).toBeNull()
    expect(contextoDeLaFila('KO', null)).toEqual({ stop: null, tamano: undefined })
  })
})

describe('el resumen de un recorte', () => {
  it('la primera frase, sin cortar en «EE. UU.»', () => {
    expect(resumenDelRecorte(RECORTES_DXCM[0])).toBe(`DXCM: 10,9${D}% → 10,0${D}% (tope por posición).`)
    expect(resumenDelRecorte('Sin margen en EE. UU. por el tope. Lo demás.')).toBe('Sin margen en EE. UU. por el tope.')
    expect(resumenDelRecorte('Una sola frase sin punto')).toBe('Una sola frase sin punto')
  })
})

describe('todos los tipos', () => {
  // Uno de cada, para las guardas de conjunto.
  const CASOS: [TipoAviso, DatosDelAviso][] = [
    ['comprar', { decision: comprar(), tamano: { pesoFinalPct: 4, recortes: [] } }],
    ['comprar_sin_sitio', { decision: comprar(), tamano: { pesoFinalPct: 0, recortes: RECORTES_DXCM } }],
    ['comprar_sin_tamano', { decision: comprar(), tamano: { pesoFinalPct: null, recortes: [] } }],
    ['esperar', { decision: decision({ action: 'vigilar', levels: NIVELES, cambiaria: haciaComprar([TENDENCIA]) }) }],
    ['evitar', { decision: decision({ action: 'evitar' }) }],
    ['vender', { stop: posicion({ precio: 104, stop: 110, estado: 'perforado' }) }],
    ['reducir', { decision: decision({ action: 'reducir', owned: true, reglas: [regla('tendencia_perdida', 90, 92.66)] }), precio: 90 }],
    ['mantener', { stop: posicion({ precio: 60, stop: 50 }) }],
    ['sin_comprobar', { stop: posicion({ precio: null, estado: 'sin_comprobar' }) }],
    ['sin_datos', { decision: decision({ action: 'sin_datos' }) }],
    ['sin_accion', { decision: decision({ action: 'ninguna' }) }],
  ]

  it('cada caso da su tipo, y hay un caso por tipo', () => {
    expect(CASOS.map(([tipo, datos]) => [tipo, avisoDe(datos).tipo])).toEqual(CASOS.map(([tipo]) => [tipo, tipo]))
    expect(new Set(CASOS.map(([t]) => t)).size).toBe(11)
  })

  it('cifras en español: coma decimal, espacio duro antes de «%» y de la moneda, nada ausente escrito', () => {
    for (const [, datos] of CASOS) {
      const t = texto(avisoDe(datos))
      expect(t).not.toMatch(/\d\.\d/) // ni «104.00» ni «4.0 %»
      expect(t).not.toMatch(/\d %|\d USD/) // espacio normal: se parte en dos líneas
      expect(t).not.toMatch(/undefined|NaN|null/)
      expect(t).not.toMatch(/\b[a-z]+_[a-z_]+\b/) // ni un código en crudo
    }
  })

  it('el término «stop» se explica en cada aviso que lo nombra', () => {
    for (const [, datos] of CASOS) {
      const a = avisoDe(datos)
      const frases = [a.frase, ...a.pasos].join(' ')
      if (/\bstop\b/.test(frases)) expect(frases).toContain('límite de pérdida (stop)')
    }
  })
})
