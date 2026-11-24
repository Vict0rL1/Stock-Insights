import { Link } from 'react-router-dom'
import { ApiUsageBar } from '../components/ApiUsageBar'
import { RUTAS, rutaExplorar } from '../lib/rutas'

/**
 * Las herramientas que no hacen falta para el día a día (`docs/PLAN_NAVEGACION.md`).
 * Antes eran siete entradas del menú al mismo nivel que «Hoy», y un usuario sin
 * experiencia no sabía cuál de las cuatro listas de empresas (Hoy, Screener,
 * Multifactor, Señales) era la que decidía. Aquí cada una dice para qué sirve y
 * que la decisión de compra sale de Explorar (ítem 3.4 del plan de arreglos).
 */
const HERRAMIENTAS: { to: string; titulo: string; para: string }[] = [
  {
    to: RUTAS.mercado,
    titulo: 'Mercado completo',
    para: 'Índices, sectores, curva de tipos, macroeconomía y el calendario de resultados de la semana.',
  },
  {
    to: RUTAS.senales,
    titulo: 'Señales y backtest',
    para: 'La puntuación por factores de cualquier lista de empresas y cómo les habría ido a las reglas en el pasado.',
  },
  {
    to: RUTAS.valoracion,
    titulo: 'Valoración DCF completa',
    para: 'El rango de valor de una empresa con tus propios supuestos de crecimiento y tasa de descuento.',
  },
  {
    to: RUTAS.resultados,
    titulo: 'Calendario de resultados',
    para: 'Quién presenta cuentas y cómo le fue frente a lo esperado.',
  },
  {
    to: RUTAS.noticias,
    titulo: 'Noticias',
    para: 'Los titulares del mercado y de tus empresas, con un resumen por IA si lo pides.',
  },
  {
    to: rutaExplorar({ filtros: 'simples' }),
    titulo: 'Filtros propios (screener y multifactor)',
    para: 'Buscar empresas con tus criterios: PER, dividendo, deuda o el peso de cada factor.',
  },
]

export function AvanzadoPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Herramientas avanzadas</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
          Para profundizar. Exploran y explican, pero no deciden: la decisión de compra sale de{' '}
          <Link to={RUTAS.explorar} className="font-medium text-sky-700 hover:underline">
            Explorar › Ideas de compra
          </Link>
          .
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {HERRAMIENTAS.map((h) => (
          <li key={h.to}>
            <Link
              to={h.to}
              className="flex h-full flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
            >
              <span className="text-sm font-semibold text-slate-900">{h.titulo}</span>
              <span className="text-sm leading-snug text-slate-500">{h.para}</span>
            </Link>
          </li>
        ))}
      </ul>
      {/* En el móvil no hay barra lateral: el estado de las fuentes se ve aquí. */}
      <section aria-labelledby="fuentes-t" className="rounded-xl border border-slate-200 bg-white p-4 md:hidden">
        <h2 id="fuentes-t" className="mb-2 text-sm font-semibold text-slate-900">
          Fuentes de datos
        </h2>
        <ApiUsageBar />
      </section>
    </div>
  )
}
