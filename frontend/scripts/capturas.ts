/**
 * Capturas repetibles de todas las pantallas (ítem 0.6 del plan de correcciones).
 *
 *     npm run capturas -- <carpeta-de-salida> [--escenarios normal,con_ia] [--solo 01_hoy,13_cartera]
 *
 * Una orden lo regenera todo: compila el frontend, levanta por escenario el
 * backend de demostración (`backend/tests/fixtures/servidor_demo.py`, datos
 * ficticios del paquete de casos extremos y una base temporal: nunca tu
 * app.db), sirve el build con `vite preview` y fotografía cada pantalla a
 * 1440 px y a 390 px. Usa su propio puerto (8077) y no pisa la app si la
 * tienes abierta.
 *
 * Salida: <carpeta>/<escenario>/<pantalla>_<ancho>.png. El conjunto «antes» del
 * plan está en docs/revision/.
 *
 * Si una pantalla no se puede fotografiar —no carga, sigue «Cargando…» o no
 * existe el botón que había que pulsar— se sigue con las demás y al final se
 * sale con código 1 y la lista de fallos. Antes se escribía «✗» y se salía con
 * 0, y una captura de IA podía salir sin IA sin que nada fallara.
 *
 * Requisitos: el entorno de Python del backend y el Chromium de Playwright
 * (`npx playwright install chromium` la primera vez).
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND = resolve(RAIZ, '..', 'backend')
const PUERTO_API = 8077
const PUERTO_WEB = 4177
const WEB = `http://127.0.0.1:${PUERTO_WEB}`
const ALTO_MAXIMO = 4000
// El backend de demostración congela su reloj en este instante (el `AHORA` del
// paquete de casos extremos); el navegador también, o «hace X días» cambiaría
// cada día y dos capturas del mismo estado no coincidirían.
const AHORA = new Date('2026-09-12T14:40:00Z')
const CARGANDO = /Cargando|Analizando|Calculando…|Calculando\.\.\.|Redactando|Interpretando|Resumiendo/

// `comprobar`: aplicar las guardas del 2.12 (desbordes, recortes y texto partido).
// 820 px es una tableta en vertical: entre 768 y ~1140 px la barra lateral
// vuelve a estar fija y la lista de Hoy perdía la puntuación y la acción, sin
// que ninguna captura lo viera (revisión de A7).
const ANCHOS = [
  { sufijo: '1440', viewport: { width: 1440, height: 900 }, movil: false, comprobar: false },
  { sufijo: '820', viewport: { width: 820, height: 1180 }, movil: false, comprobar: true },
  { sufijo: '390', viewport: { width: 390, height: 844 }, movil: true, comprobar: true },
]

type Pantalla = { nombre: string; ruta: string; pestana?: string; accion?: (p: Page) => Promise<void>; soloMovil?: boolean }

const PESTANAS_FICHA: [string, string][] = [
  ['03_ficha_resumen', 'Resumen'],
  ['04_ficha_informe', 'Informe completo'],
  ['05_ficha_fundamentales', 'Fundamentales'],
  ['06_ficha_valoracion', 'Valoración'],
  ['07_ficha_salud', 'Salud y riesgo'],
  ['08_ficha_que_cambio', 'Qué cambió'],
  ['09_ficha_expectativas', 'Resultados vs expectativas'],
  ['10_ficha_calidad', 'Calidad de beneficios'],
  ['11_ficha_historial', 'Decisiones y replay'],
  ['12_ficha_opciones', 'Opciones'],
  ['12b_ficha_filings', 'Filings'],
]

const ficha = (symbol: string, cuales?: string[]): Pantalla[] =>
  PESTANAS_FICHA.filter(([n]) => !cuales || cuales.includes(n)).map(([nombre, pestana]) => ({
    nombre,
    ruta: `/ticker/${symbol}`,
    pestana,
  }))

const pulsar = (texto: RegExp) => async (p: Page) => {
  const boton = p.getByRole('button', { name: texto }).first()
  if (!(await boton.count())) throw new Error(`no aparece el botón ${texto}`)
  // Sin `force`: antes del 2.12 la barra lateral tapaba el contenido a 390 px
  // y el clic normal esperaba para siempre a que el botón quedara libre. Si
  // algo lo tapa, es un fallo de la pantalla, no del script.
  await boton.click({ timeout: 10000 })
  await esperar(p)
}

// El menú de móvil (ítem 2.12), con clics de verdad: se abre, y desde él se
// llega a otra pantalla y se cierra.
const abrirMenu = async (p: Page) => {
  await p.getByRole('button', { name: 'Menú' }).click({ timeout: 10000 })
  await p.getByRole('link', { name: 'Cartera' }).waitFor({ state: 'visible', timeout: 5000 })
}

const TODAS: Pantalla[] = [
  { nombre: '00_menu_abierto', ruta: '/hoy', soloMovil: true, accion: abrirMenu },
  {
    nombre: '00_menu_navega',
    ruta: '/hoy',
    soloMovil: true,
    accion: async (p) => {
      await abrirMenu(p)
      await p.getByRole('link', { name: 'Cartera' }).click({ timeout: 10000 })
      await p.waitForURL('**/cartera', { timeout: 10000 })
      await esperar(p)
      if ((await p.getByRole('button', { name: 'Menú' }).getAttribute('aria-expanded')) !== 'false')
        throw new Error('el menú sigue abierto tras navegar')
    },
  },
  { nombre: '01_hoy', ruta: '/hoy' },
  // La lista entera, con sus columnas: «Mejores ideas» son tarjetas y la lista de
  // señales no se medía nunca (revisión de A7).
  { nombre: '01b_hoy_todas', ruta: '/hoy', accion: pulsar(/^Todas \(/) },
  { nombre: '02_mercado', ruta: '/dashboard' },
  ...ficha('ACME'),
  { nombre: '13_cartera', ruta: '/cartera' },
  { nombre: '14_portafolio', ruta: '/portafolio' },
  { nombre: '15_tesis', ruta: '/tesis' },
  { nombre: '16_vigilancia', ruta: '/vigilancia' },
  { nombre: '17_valoracion_modulo', ruta: '/valoracion' },
  { nombre: '18_screener', ruta: '/screener' },
  { nombre: '19_multifactor', ruta: '/multifactor' },
  { nombre: '20_resultados', ruta: '/resultados' },
  { nombre: '21_senales', ruta: '/senales' },
  { nombre: '22_etfs', ruta: '/etfs' },
  // La recomendación de ETFs: hasta la revisión de la Fase 0, «/api/etfs/{symbol}»
  // tapaba su ruta y este botón nunca había funcionado.
  {
    nombre: '22b_etfs_recomendar',
    ruta: '/etfs',
    accion: async (p) => {
      await p.getByPlaceholder(/Hasta 4 ETFs/).fill('INDX, TECX, TOTX')
      await pulsar(/Analizar y recomendar/)(p)
    },
  },
  { nombre: '23_noticias', ruta: '/noticias' },
]

const ESCENARIOS: Record<string, Pantalla[]> = {
  normal: TODAS,
  cartera_vacia: TODAS.filter((p) => ['01_hoy', '13_cartera', '14_portafolio'].includes(p.nombre)),
  sin_candidatas: TODAS.filter((p) => p.nombre === '01_hoy'),
  // Sin cotización: desde el ítem 2.1 la ficha enseña la cabecera (nombre del
  // perfil o símbolo), «Precio no disponible…» y todas sus pestañas; antes se
  // sustituía entera por «No se encontró el símbolo» aunque EDGAR tuviera datos.
  // La demo ya no inventa una cotización para VACIA.
  empresa_sin_datos: [{ nombre: '03_ficha_sin_cotizacion', ruta: '/ticker/VACIA' }],
  con_ia: [
    { nombre: '04_ficha_informe_ia', ruta: '/ticker/ACME', pestana: 'Informe completo', accion: pulsar(/Redactar informe \(IA\)/) },
    { nombre: '08_ficha_que_cambio_ia', ruta: '/ticker/ACME', pestana: 'Qué cambió', accion: pulsar(/Resumir este diff con IA/) },
    { nombre: '23_noticias_ia', ruta: '/noticias', accion: pulsar(/Por qué importa\? \(IA\)/) },
  ],
}

async function esperar(p: Page) {
  await p.waitForLoadState('networkidle').catch(() => {})
  // Una pantalla que sigue cargando a los 15 s no es una captura: es un fallo.
  await p
    .waitForFunction((re) => !new RegExp(re).test(document.body.innerText), CARGANDO.source, { timeout: 15000 })
    .catch(() => {
      throw new Error('la pantalla sigue cargando a los 15 s')
    })
  await p.waitForTimeout(400)
}

async function fotografiar(navegador: Browser, pantallas: Pantalla[], carpeta: string, solo?: string[]): Promise<string[]> {
  const fallos: string[] = []
  for (const ancho of ANCHOS) {
    const contexto = await navegador.newContext({
      viewport: ancho.viewport,
      isMobile: ancho.movil,
      deviceScaleFactor: ancho.movil ? 2 : 1,
      locale: 'es-ES',
      timezoneId: 'Europe/Madrid',
    })
    await contexto.clock.setFixedTime(AHORA)
    const p = await contexto.newPage()
    for (const pantalla of pantallas) {
      if (solo && !solo.some((s) => pantalla.nombre.startsWith(s))) continue
      if (pantalla.soloMovil && !ancho.movil) continue
      const archivo = join(carpeta, `${pantalla.nombre}_${ancho.sufijo}.png`)
      try {
        await p.goto(WEB + pantalla.ruta, { waitUntil: 'networkidle', timeout: 30000 })
        await esperar(p)
        if (pantalla.pestana) {
          await p.getByRole('button', { name: pantalla.pestana, exact: true }).click()
          await esperar(p)
        }
        if (pantalla.accion) await pantalla.accion(p)
        // Ítem 2.12: a 390 px ninguna pantalla desborda en horizontal. Se dice
        // qué lo empuja (las tablas van dentro de su propio contenedor con
        // scroll, que no cuenta). Se fotografía igual, para verlo.
        const desborde = ancho.comprobar ? await p.evaluate(desbordeHorizontal) : null
        const recortado = ancho.comprobar ? await p.evaluate(recortes) : []
        const partidos = ancho.comprobar ? await p.evaluate(palabraAPalabra) : []
        // Arriba antes de fotografiar: tras pulsar un botón la página queda
        // desplazada y la cabecera fija de móvil salía pintada a media página,
        // tapando una fila. Y `fullPage` siempre: con `clip` solo, una página de
        // más de ALTO_MAXIMO salía recortada a la primera pantalla (844 px a 390),
        // y la lista de Hoy en móvil no llegaba a verse (revisión del 2.12).
        await p.evaluate(() => window.scrollTo(0, 0))
        const alto = await p.evaluate(() => document.documentElement.scrollHeight)
        await p.screenshot({
          path: archivo,
          fullPage: true,
          clip: alto > ALTO_MAXIMO ? { x: 0, y: 0, width: ancho.viewport.width, height: ALTO_MAXIMO } : undefined,
        })
        if (desborde) throw new Error(`desborda en horizontal: ${desborde}`)
        if (recortado.length) throw new Error(`contenido recortado en su marco: ${recortado.join('; ')}`)
        if (partidos.length) throw new Error(`texto partido palabra a palabra: ${partidos.join('; ')}`)
        console.log(`  ✓ ${archivo}`)
      } catch (e) {
        const motivo = String(e).split('\n')[0]
        console.log(`  ✗ ${archivo}: ${motivo}`)
        fallos.push(`${archivo}: ${motivo}`)
      }
    }
    await contexto.close()
  }
  return fallos
}

/** En el navegador: null si la página no desborda en horizontal; si no, cuánto
 *  y los elementos más externos que salen del ancho (sin contar lo que está
 *  dentro de un contenedor con scroll propio). */
function desbordeHorizontal(): string | null {
  const ancho = document.documentElement.clientWidth
  const sobra = document.documentElement.scrollWidth - ancho
  if (sobra <= 0) return null
  const conScroll = (el: Element | null): boolean => {
    for (let e = el?.parentElement; e; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true
    }
    return false
  }
  const culpables: string[] = []
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const r = el.getBoundingClientRect()
    if (r.right <= ancho + 1 || r.width === 0 || conScroll(el)) continue
    const padre = el.parentElement?.getBoundingClientRect()
    if (padre && padre.right > ancho + 1 && !conScroll(el.parentElement)) continue
    const clase = typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : ''
    culpables.push(`${el.tagName.toLowerCase()}${clase ? '.' + clase : ''} «${(el.textContent ?? '').trim().slice(0, 30)}»`)
    if (culpables.length >= 4) break
  }
  return `${sobra} px (${culpables.join('; ')})`
}

/** En el navegador: lo que un marco `overflow-hidden` (o `clip`) recorta en
 *  horizontal. La página no se ensancha, así que `desbordeHorizontal` no lo ve,
 *  y en Hoy la columna «Acción» quedaba entera fuera de la lista (revisión de
 *  A7). Lo que se recorta a propósito con puntos suspensivos (`truncate`) o
 *  por líneas (`line-clamp`) no cuenta, ni lo que solo se oculta a la vista. */
function recortes(): string[] {
  const salida: string[] = []
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const s = getComputedStyle(el)
    if (s.overflowX !== 'hidden' && s.overflowX !== 'clip') continue
    if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' || el.classList.contains('sr-only')) continue
    const h = el as HTMLElement
    if (h.clientWidth === 0 || h.scrollWidth <= h.clientWidth + 1) continue
    const clase = typeof el.className === 'string' ? el.className.split(' ').slice(0, 3).join('.') : ''
    salida.push(`${el.tagName.toLowerCase()}${clase ? '.' + clase : ''} (${h.scrollWidth} px en ${h.clientWidth})`)
    if (salida.length >= 4) break
  }
  return salida
}

/** En el navegador: los textos de tres o más palabras partidos casi palabra a
 *  palabra, que es lo que pasaba a 390 px con la barra lateral fija (ítem 2.12).
 *
 *  Por elemento y no por nodo de texto (React parte `{a} {b}` en varios
 *  nodos), y por proporción y no por igualdad: en español «de la» o «y el»
 *  comparten línea, y «Margen / de la / empresa» pasaba (revisión de A7). */
function palabraAPalabra(): string[] {
  const salida: string[] = []
  const enBloque = (e: Element) => !getComputedStyle(e).display.startsWith('inline')
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const conTexto = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim())
    if (!conTexto || Array.from(el.children).some(enBloque)) continue
    const texto = (el.textContent ?? '').trim()
    // Sin partir por el espacio duro: «10,0 %» es una cifra, no dos palabras.
    const palabras = texto.split(/[^\S\u00a0]+/).filter(Boolean)
    if (palabras.length < 3) continue
    // Solo las cajas del TEXTO (un `<input>` dentro de la `label` contaba como
    // otra línea), agrupadas por solapamiento vertical y no por `top`: el texto
    // de una insignia con otro tamaño, en la misma línea, tiene otro `top`.
    const cajas: DOMRect[] = []
    const textos = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = textos.nextNode(); n; n = textos.nextNode()) {
      const rango = document.createRange()
      rango.selectNodeContents(n)
      cajas.push(...Array.from(rango.getClientRects()).filter((r) => r.width > 0))
    }
    const lineas: { arriba: number; abajo: number }[] = []
    for (const r of cajas.sort((a, b) => a.top - b.top)) {
      const misma = lineas.find((l) => r.top < l.abajo - 2 && r.bottom > l.arriba + 2)
      if (misma) {
        misma.arriba = Math.min(misma.arriba, r.top)
        misma.abajo = Math.max(misma.abajo, r.bottom)
      } else lineas.push({ arriba: r.top, abajo: r.bottom })
    }
    if (lineas.length >= Math.max(3, Math.ceil(palabras.length * 0.6))) salida.push(`«${texto.slice(0, 40)}»`)
    if (salida.length >= 4) break
  }
  return salida
}

async function hastaQueResponda(url: string, segundos = 90) {
  for (let i = 0; i < segundos * 2; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* todavía no */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} no respondió en ${segundos} s`)
}

function arrancar(orden: string, args: string[], cwd: string, env: Record<string, string> = {}): ChildProcess {
  return spawn(orden, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'inherit'], detached: true })
}

function parar(hijo: ChildProcess | null) {
  // Por grupo de procesos: el backend y el servidor web tienen hijos propios.
  if (hijo?.pid) {
    try {
      process.kill(-hijo.pid, 'SIGTERM')
    } catch {
      /* ya terminó */
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const salida = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'))
  if (!salida) {
    console.error('Uso: npm run capturas -- <carpeta-de-salida> [--escenarios normal,con_ia] [--solo 01_hoy]')
    process.exit(2)
  }
  const valor = (bandera: string) => (args.includes(bandera) ? args[args.indexOf(bandera) + 1]?.split(',') : undefined)
  const escenarios = valor('--escenarios') ?? Object.keys(ESCENARIOS)
  const solo = valor('--solo')
  const python =
    process.env.PYTHON ?? (existsSync(join(BACKEND, '.venv', 'bin', 'python')) ? join(BACKEND, '.venv', 'bin', 'python') : 'python3')

  console.log('Compilando el frontend…')
  execSync('npx vite build', { cwd: RAIZ, stdio: 'ignore' })
  const web = arrancar('npx', ['vite', 'preview', '--port', String(PUERTO_WEB), '--strictPort', '--host', '127.0.0.1'], RAIZ, {
    API_URL: `http://127.0.0.1:${PUERTO_API}`,
  })
  let api: ChildProcess | null = null
  const fallos: string[] = []
  const navegador = await chromium.launch()
  try {
    await hastaQueResponda(WEB)
    for (const escenario of escenarios) {
      if (!ESCENARIOS[escenario]) throw new Error(`Escenario desconocido: ${escenario}`)
      console.log(`Escenario «${escenario}»`)
      api = arrancar(python, ['-m', 'tests.fixtures.servidor_demo', '--escenario', escenario, '--puerto', String(PUERTO_API)], BACKEND)
      await hastaQueResponda(`http://127.0.0.1:${PUERTO_API}/api/meta/llm`)
      const carpeta = resolve(salida, escenario)
      mkdirSync(carpeta, { recursive: true })
      fallos.push(...(await fotografiar(navegador, ESCENARIOS[escenario], carpeta, solo)))
      parar(api)
      api = null
      await new Promise((r) => setTimeout(r, 800))
    }
  } finally {
    await navegador.close()
    parar(api)
    parar(web)
  }
  if (fallos.length) {
    console.error(`\n${fallos.length} ${fallos.length === 1 ? 'captura fallida' : 'capturas fallidas'}:\n  ${fallos.join('\n  ')}`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
