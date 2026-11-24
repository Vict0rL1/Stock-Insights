import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { destinoConConsulta, REDIRECCIONES, RUTAS, rutaEmpresa } from './lib/rutas'
import { AvanzadoPage } from './pages/AvanzadoPage'
import { DashboardPage } from './pages/DashboardPage'
import { EarningsPage } from './pages/EarningsPage'
import { ExplorarPage } from './pages/ExplorarPage'
import { InicioPage } from './pages/InicioPage'
import { MiCarteraPage } from './pages/MiCarteraPage'
import { NewsPage } from './pages/NewsPage'
import { SignalsPage } from './pages/SignalsPage'
import { TickerPage } from './pages/TickerPage'
import { ValuationPage } from './pages/ValuationPage'

/** Una ruta vieja lleva a la nueva conservando su consulta y su ancla: los
 *  marcadores y los enlaces que queden por ahí siguen funcionando. */
function Redirigir({ a }: { a: string }) {
  const { search, hash } = useLocation()
  return <Navigate to={destinoConConsulta(a, search) + hash} replace />
}

function RedirigirFicha() {
  const { symbol } = useParams()
  const { search, hash } = useLocation()
  return <Navigate to={destinoConConsulta(symbol ? rutaEmpresa(symbol) : RUTAS.explorar, search) + hash} replace />
}

/** Las rutas de la app, ya sin las 15 entradas de antes (`docs/PLAN_NAVEGACION.md`). */
export function Rutas() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path={RUTAS.inicio} element={<InicioPage />} />
        <Route path={RUTAS.explorar} element={<ExplorarPage />} />
        <Route path={RUTAS.empresa} element={<TickerPage />} />
        <Route path={`${RUTAS.empresa}/:symbol`} element={<TickerPage />} />
        <Route path={RUTAS.cartera} element={<MiCarteraPage />} />
        <Route path={RUTAS.avanzado} element={<AvanzadoPage />} />
        <Route path={RUTAS.mercado} element={<DashboardPage />} />
        <Route path={RUTAS.senales} element={<SignalsPage />} />
        <Route path={RUTAS.valoracion} element={<ValuationPage />} />
        <Route path={RUTAS.resultados} element={<EarningsPage />} />
        <Route path={RUTAS.noticias} element={<NewsPage />} />
        <Route path="/ticker/:symbol" element={<RedirigirFicha />} />
        {Object.entries(REDIRECCIONES).map(([vieja, nueva]) => (
          <Route key={vieja} path={vieja} element={<Redirigir a={nueva} />} />
        ))}
        <Route path="*" element={<Navigate to={RUTAS.inicio} replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Rutas />
      </ErrorBoundary>
    </BrowserRouter>
  )
}
