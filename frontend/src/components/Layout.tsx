import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ApiUsageBar } from './ApiUsageBar'

// Agrupado por intención, no por orden de construcción: lo primero es la
// pregunta con la que se abre la app ("¿qué miro hoy?"), no el catálogo de
// herramientas.
const NAV_GROUPS: { title: string | null; items: { to: string; label: string }[] }[] = [
  {
    title: null,
    items: [
      { to: '/hoy', label: 'Hoy' },
      { to: '/dashboard', label: 'Mercado' },
      { to: '/ticker', label: 'Acciones' },
    ],
  },
  {
    title: 'Herramientas',
    items: [
      { to: '/screener', label: 'Screener' },
      { to: '/multifactor', label: 'Multifactor' },
      { to: '/resultados', label: 'Resultados' },
      { to: '/valoracion', label: 'Valoración' },
      { to: '/senales', label: 'Señales' },
      { to: '/etfs', label: 'ETFs' },
      { to: '/noticias', label: 'Noticias' },
    ],
  },
  {
    title: 'Mío',
    items: [
      { to: '/portafolio', label: 'Portafolio' },
      { to: '/cartera', label: 'Cartera' },
      { to: '/tesis', label: 'Tesis' },
      { to: '/vigilancia', label: 'Vigilancia' },
    ],
  },
]

/** El logo y el nombre. El mismo dibujo que el favicon, en línea y no como
 *  <img>: así hereda el color del tema y no cuesta una petición. */
function Marca({ lema = true }: { lema?: boolean }) {
  return (
    // Sin lema (cabecera de móvil), centrado: arriba, el nombre quedaba 7 px
    // por encima del centro del logo y del botón «Menú».
    <div className={`flex gap-2.5 ${lema ? 'items-start' : 'items-center'}`}>
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
        {/* Decía «investigación, no señales» y la portada dice COMPRAR: una
            de las dos mentía. La app sí da señales; lo que no hace es
            predecir. */}
        {lema && <div className="text-[11px] text-slate-400">reglas, no predicciones</div>}
      </div>
    </div>
  )
}

/**
 * Por debajo de 768 px (`md`) la barra lateral es un cajón que se abre con
 * «Menú» (ítem 2.12, V2). Fija, ocupaba la mitad de una pantalla de 390 px:
 * el contenido se partía palabra a palabra y tapaba los botones, hasta el
 * punto de que las capturas tenían que pulsar «a la fuerza» (auditoría del
 * 19 oct). Se cierra al navegar, con Escape y tocando fuera.
 *
 * Abierto, es modal de verdad: la cabecera y el contenido quedan `inert` (ni el
 * tabulador ni un lector de pantalla llegan a lo que tapa el velo) y el cajón es
 * un `dialog`. Antes Mayús+Tab salía a «Menú», debajo del velo, y tras los
 * enlaces el foco pasaba a los botones de la pantalla tapada (revisión de A7).
 */
export function Layout() {
  const [abierto, setAbierto] = useState(false)
  const { pathname } = useLocation()
  const [ruta, setRuta] = useState(pathname)
  const boton = useRef<HTMLButtonElement>(null)
  const cerrar = useRef<HTMLButtonElement>(null)
  // El foco vuelve a «Menú» DESPUÉS de cerrar: mientras el cajón está abierto la
  // cabecera es `inert` y no se puede enfocar nada dentro.
  const devolverFoco = useRef(false)
  const cerrarYVolver = () => {
    devolverFoco.current = true
    setAbierto(false)
  }
  // Al cambiar de pantalla, en el mismo render: un efecto dejaría un render
  // con el cajón abierto encima de la pantalla nueva.
  if (ruta !== pathname) {
    setRuta(pathname)
    setAbierto(false)
  }
  useEffect(() => {
    if (!abierto) {
      if (devolverFoco.current) boton.current?.focus()
      devolverFoco.current = false
      return
    }
    cerrar.current?.focus()
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      devolverFoco.current = true
      setAbierto(false)
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [abierto])

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <header
        inert={abierto || undefined}
        className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 md:hidden"
      >
        <Marca lema={false} />
        <button
          ref={boton}
          type="button"
          aria-expanded={abierto}
          aria-controls="navegacion"
          onClick={() => setAbierto(true)}
          className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Menú
        </button>
      </header>
      {abierto && (
        <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={cerrarYVolver} />
      )}
      <aside
        id="navegacion"
        aria-label="Navegación"
        role={abierto ? 'dialog' : undefined}
        aria-modal={abierto || undefined}
        className={`${
          abierto ? 'fixed inset-y-0 left-0 z-50 flex w-64 overflow-y-auto shadow-xl' : 'hidden'
        } shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-5 md:static md:z-auto md:flex md:w-56 md:overflow-visible md:shadow-none`}
      >
        <div className="mb-6 flex items-start justify-between gap-2 px-3">
          <Marca />
          <button
            ref={cerrar}
            type="button"
            onClick={cerrarYVolver}
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:text-slate-900 md:hidden"
          >
            Cerrar
          </button>
        </div>
        <nav className="flex flex-col gap-5">
          {NAV_GROUPS.map((group, i) => (
            <div key={group.title ?? i} className="flex flex-col gap-0.5">
              {group.title && (
                // `slate-400`: con `slate-300`, 1,9:1 de contraste a 10 px.
                <div className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                  {group.title}
                </div>
              )}
              {group.items.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setAbierto(false)}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-slate-100 font-medium text-slate-900'
                        : 'text-slate-500 hover:text-slate-900'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="mt-auto space-y-3 px-3 pt-6">
          <ApiUsageBar />
          <p className="text-[10px] leading-snug text-slate-400">
            Herramienta personal. Da señales de compra y venta a partir de
            reglas mecánicas escritas — no es asesoría financiera, no predice
            precios y no ejecuta órdenes. La decisión es tuya.
          </p>
        </div>
      </aside>
      <main inert={abierto || undefined} className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-7">
        <Outlet />
      </main>
    </div>
  )
}
