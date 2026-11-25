/**
 * Qué significa cada término que la ficha enseña a alguien sin experiencia
 * («PER», «margen operativo», «stop», «media de 200 sesiones»…), en UN solo
 * sitio. `components/Termino.tsx` los explica al pasar, enfocar o tocar.
 *
 * Las palabras las fija `docs/GLOSARIO.md`: cada entrada nombra su fila
 * («concepto») y `glosario.test.ts` comprueba que el término es el de allí y
 * que ninguna definición usa lo que su columna «Nunca» prohíbe. Una definición
 * dice qué es y para qué sirve; no repite umbrales del motor (+0,35, 2 %…),
 * que cambian en `decision.py` sin que esto se entere: las cifras de cada
 * regla salen de su traza.
 */
import type { DecisionAction } from '../api/types'

export interface EntradaGlosario {
  /** Como se escribe en pantalla (y en `docs/GLOSARIO.md`). */
  termino: string
  /** La fila de `docs/GLOSARIO.md` («Concepto») que fija la palabra. */
  concepto: string
  definicion: string
}

export const GLOSARIO = {
  per: {
    termino: 'PER',
    concepto: 'Precio entre beneficio por acción',
    definicion:
      'El precio de una acción dividido entre lo que la empresa ganó por acción (BPA) en su último ejercicio: ' +
      'cuántos años de beneficios pagas al precio de hoy. Cuanto más alto, más crecimiento da por hecho el mercado.',
  },
  bpa: {
    termino: 'BPA',
    concepto: 'Beneficio por acción',
    definicion: 'Beneficio por acción: lo que la empresa ganó en el año dividido entre el número de sus acciones.',
  },
  margen_operativo: {
    termino: 'margen operativo',
    concepto: 'Beneficio de la operación sobre las ventas',
    definicion:
      'Lo que le queda a la empresa de cada 100 que vende después de pagar lo que cuesta su negocio ' +
      '(fabricar, vender, investigar, administrar), antes de intereses e impuestos.',
  },
  stop: {
    termino: 'stop',
    concepto: 'Nivel de salida por pérdida',
    definicion:
      'El precio al que la app sugiere vender para que una idea que sale mal cueste poco. Se fija al abrir la ' +
      'posición y desde la cartera solo se puede subir, nunca bajar.',
  },
  media_200: {
    termino: 'media de 200 sesiones',
    concepto: 'Precio medio de cierre de las últimas 200 sesiones',
    definicion:
      'El precio medio de cierre de las últimas 200 sesiones de bolsa (unos diez meses). Un precio claramente ' +
      'por encima dice que la tendencia va al alza; por debajo, a la baja. En el gráfico es la línea «SMA 200».',
  },
  puntuacion: {
    termino: 'puntuación',
    concepto: 'Valor relativo frente a comparables',
    definicion:
      'Cómo sale la empresa frente a las de su mismo sector en valor, calidad y momentum, en una escala ' +
      'centrada en cero: por encima, mejor que la media de su sector; por debajo, peor.',
  },
  crecimiento_implicito: {
    termino: 'crecimiento que da por hecho el precio',
    concepto: 'Crecimiento del FCF que justifica el precio',
    definicion:
      'El crecimiento anual del flujo de caja libre que haría falta para que la empresa valga lo que cuesta hoy, ' +
      'con unos supuestos fijos de descuento y de años. No es una previsión: es lo que el precio ya da por hecho.',
  },
  fcf: {
    termino: 'flujo de caja libre (FCF)',
    concepto: 'Flujo de caja libre',
    definicion:
      'El dinero que genera el negocio después de pagar sus inversiones: el flujo de caja de las operaciones ' +
      'menos lo que invierte en fábricas, equipos y demás activos.',
  },
  capitalizacion: {
    termino: 'capitalización',
    concepto: 'Valor en bolsa de la empresa',
    definicion: 'Lo que vale en bolsa la empresa entera: el precio de una acción por el número de acciones.',
  },
  confianza: {
    termino: 'confianza',
    concepto: 'Calidad de la evidencia de una decisión',
    definicion:
      'Lo sólidos que son los datos en que se apoya la decisión: si están completos y al día, si las reglas ' +
      'se han probado con el histórico, si un movimiento pequeño la cambiaría. No es la probabilidad de acertar.',
  },
  tesis: {
    termino: 'tesis',
    concepto: 'Postura escrita sobre una empresa',
    definicion:
      'Lo que escribiste sobre por qué tienes o quieres una empresa, con los puntos medibles que, si se ' +
      'cruzan, dicen que estabas equivocado.',
  },
} as const satisfies Record<string, EntradaGlosario>

export type ClaveGlosario = keyof typeof GLOSARIO

/** Qué significa cada acción del motor, para quien la lee por primera vez. El
 *  nombre de la acción es el que sirve el motor (`decision.label`). */
export const QUE_SIGNIFICA_LA_ACCION: Record<DecisionAction, string> = {
  comprar: 'Se cumplen las reglas para entrar. Llega con su zona de compra y con su stop.',
  vigilar: 'La empresa interesa, pero falta algo para comprarla: todavía no se compra.',
  mantener: 'Ya la tienes y ninguna regla pide tocarla.',
  reducir: 'Ya la tienes y su precio ha perdido la tendencia: la app sugiere vender una parte.',
  vender: 'Ya la tienes y una regla pide salir: el precio llegó a tu stop o la empresa ya no destaca frente a su sector.',
  evitar: 'Queda claramente por detrás de las empresas de su sector: la app sugiere no comprarla.',
  ninguna: 'Ni destaca ni preocupa frente a las de su sector: no hay nada que hacer.',
  sin_datos: 'Faltan datos imprescindibles (el precio o la puntuación) y sin ellos la app no decide.',
}

/** Las palabras de cada término que `ConTerminos` reconoce dentro de un texto. */
export const FORMAS: Record<ClaveGlosario, string[]> = {
  per: ['PER'],
  bpa: ['BPA'],
  margen_operativo: ['margen operativo'],
  stop: ['stop'],
  media_200: ['media de 200 sesiones'],
  puntuacion: ['puntuación'],
  crecimiento_implicito: ['crecimiento que da por hecho el precio'],
  fcf: ['flujo de caja libre'],
  capitalizacion: ['capitalización'],
  confianza: ['confianza'],
  tesis: ['tesis'],
}
