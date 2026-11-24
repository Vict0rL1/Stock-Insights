import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { RUTAS, rutaEmpresa } from '../lib/rutas'
import { ApiUsageBar } from './ApiUsageBar'

/**
 * El menú de la app: tres sitios y un cajón de herramientas avanzadas
 * (`docs/PLAN_NAVEGACION.md`). Antes eran 15 entradas en tres grupos y nada
 * decía por dónde empezar; un usuario sin experiencia no sabía si mirar «Hoy»,
 * «Señales», «Screener» o «Multifactor», que eran cuatro listas de empresas.
 *
 * En escritorio, barra lateral. En el móvil, barra inferior con cuatro botones
 * (Inicio, Explorar, Cartera, Más): con tres destinos sobra el cajón de antes,
 * que había que abrir para cada cambio de pantalla.
 */

type Destino = {
  to: string
  label: string
  corto: string
  icono: ReactNode
  /** Qué rutas cuentan como «estar aquí»: la ficha de una empresa es parte de Explorar. */
  activo: (ruta: string) => boolean
}

const trazo = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const DESTINOS: Destino[] = [
  {
    to: RUTAS.inicio,
    label: 'Inicio',
    corto: 'Inicio',
    icono: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0" {...trazo}>
        <path d="M3 11l9-8 9 8" />
        <path d="M5 10v10h14V10" />
      </svg>
    ),
    activo: (r) => r === RUTAS.inicio,
  },
  {
    to: RUTAS.explorar,
    label: 'Explorar acciones y ETFs',
    corto: 'Explorar',
    icono: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0" {...trazo}>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
    ),
    activo: (r) => r.startsWith(RUTAS.explorar) || r.startsWith(RUTAS.empresa),
  },
  {
    to: RUTAS.cartera,
    label: 'Mi cartera',
    corto: 'Cartera',
    icono: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0" {...trazo}>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
      </svg>
    ),
    activo: (r) => r.startsWith(RUTAS.cartera),
  },
]

const AVANZADO: Destino = {
  to: RUTAS.avanzado,
  label: 'Herramientas avanzadas',
  corto: 'Más',
  icono: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0" {...trazo}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  ),
  activo: (r) => r.startsWith(RUTAS.avanzado),
}

/** El logo y el nombre. El mismo dibujo que el favicon, en línea y no como
 *  <img>: así hereda el color del tema y no cuesta una petición. */
function Marca({ lema = true }: { lema?: boolean }) {
  return (
    <Link to={RUTAS.inicio} className={`flex gap-2.5 ${lema ? 'items-start' : 'items-center'}`}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className={`h-7 w-7 shrink-0 rounded-md bg-slate-900 ${lema ? 'mt-0.5' : ''}`}>
        <polyline
          points="5,22 10,17 14,19 19,11 23,14 27,7"
          fill="none"
          style={{ stroke: 'var(--info)' }}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="27" cy="7" r="2.6" style={{ fill: 'var(--info)' }} />
      </svg>
      <div>
        <div className="text-sm font-semibold tracking-tight text-slate-900">Análisis Bursátil</div>
        {lema && <div className="text-[11px] text-slate-400">acciones y ETFs, sin predicciones</div>}
      </div>
    </Link>
  )
}

/** Un símbolo se puede escribir con minúsculas y espacios; solo se rechaza lo
 *  que no puede ser un símbolo (vacío o con caracteres raros), y se dice. */
export function simboloEscrito(texto: string): string | null {
  const s = texto.trim().toUpperCase()
  return /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/.test(s) ? s : null
}

/** La búsqueda de arriba, en todas las pantallas: lleva a la ficha. */
function Buscador() {
  const navigate = useNavigate()
  const [texto, setTexto] = useState('')
  const [error, setError] = useState<string | null>(null)
  const enviar = (e: FormEvent) => {
    e.preventDefault()
    const s = simboloEscrito(texto)
    if (!s) {
      setError('Escribe el símbolo con letras y números, por ejemplo AAPL o SPY.')
      return
    }
    setError(null)
    setTexto('')
    void navigate(rutaEmpresa(s))
  }
  return (
    <form role="search" onSubmit={enviar} className="mx-auto mb-5 max-w-5xl">
      <div className="flex gap-2">
        <label htmlFor="buscador-global" className="sr-only">
          Buscar una empresa o un ETF por su símbolo
        </label>
        <input
          id="buscador-global"
          type="search"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Busca por símbolo: AAPL, SPY…"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'buscador-error' : undefined}
          autoCapitalize="characters"
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400"
        />
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Buscar
        </button>
      </div>
      {error && (
        <p id="buscador-error" role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </form>
  )
}

export function Layout() {
  const { pathname, hash } = useLocation()
  const tipoNavegacion = useNavigationType()
  const rutaDesplazada = useRef(pathname)
  // Una pantalla nueva se abre por arriba (revisión 12, visual): la página no
  // se recarga y el navegador conservaba el desplazamiento de la anterior, así
  // que «Ver el análisis completo» desde la lista de Hoy abría la ficha unos
  // 100 px más abajo, con la cabecera cortada. Solo al cambiar de ruta (no al
  // cambiar de pestaña dentro de la ficha), y no en «Atrás»/«Adelante» (POP),
  // donde volver a donde estabas es lo esperado. Con un ancla (#) que ya está
  // en la página, a ella.
  useEffect(() => {
    if (rutaDesplazada.current === pathname) return
    rutaDesplazada.current = pathname
    if (tipoNavegacion === 'POP') return
    const ancla = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
    if (ancla) ancla.scrollIntoView()
    else window.scrollTo(0, 0)
  }, [pathname, hash, tipoNavegacion])

  const enlaceLateral = (d: Destino) => {
    const activo = d.activo(pathname)
    return (
      <Link
        key={d.to}
        to={d.to}
        aria-current={activo ? 'page' : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
          activo ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        {d.icono}
        {d.label}
      </Link>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <header className="sticky top-0 z-30 flex items-center border-b border-slate-200 bg-white px-4 py-2.5 md:hidden">
        <Marca lema={false} />
      </header>

      <aside
        aria-label="Navegación"
        className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 md:flex"
      >
        <div className="mb-6 px-3">
          <Marca />
        </div>
        <nav aria-label="Principal" className="flex flex-col gap-1">
          {DESTINOS.map(enlaceLateral)}
        </nav>
        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Para usuarios avanzados
          </div>
          {enlaceLateral(AVANZADO)}
          <p className="px-3 pt-1 text-[11px] leading-snug text-slate-400">
            Mercado completo, señales y backtest, valoración DCF, calendario de resultados y noticias.
          </p>
        </div>

        <div className="mt-auto space-y-3 px-3 pt-6">
          <ApiUsageBar />
          <p className="text-[10px] leading-snug text-slate-400">
            Herramienta personal. Da señales de compra y venta a partir de
            reglas mecánicas escritas — no es asesoría financiera, no predice
            precios y no ejecuta órdenes. La decisión es tuya.
          </p>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-28 pt-5 md:px-6 md:pb-10 md:pt-7">
        <Buscador />
        <Outlet />
      </main>

      {/* La barra de abajo del móvil: los mismos destinos, con su nombre corto.
          `pb-28` en el contenido para que no tape lo último de la página. */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-slate-200 bg-white px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1 md:hidden"
      >
        {[...DESTINOS, AVANZADO].map((d) => {
          const activo = d.activo(pathname)
          return (
            <Link
              key={d.to}
              to={d.to}
              aria-current={activo ? 'page' : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[12px] ${
                activo ? 'font-semibold text-sky-700' : 'text-slate-500'
              }`}
            >
              {d.icono}
              {d.corto}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
