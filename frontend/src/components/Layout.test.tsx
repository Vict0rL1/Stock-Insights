/**
 * El menú del rediseño (`docs/PLAN_NAVEGACION.md`): tres sitios — Inicio,
 * Explorar y Mi cartera — y las herramientas avanzadas aparte. En escritorio,
 * barra lateral; en el móvil, barra inferior (jsdom no aplica los puntos de
 * corte de CSS: las dos están en el árbol y se prueban las dos; lo visual lo
 * prueban las capturas a 390 y 1440). Arriba, en todas las pantallas, la
 * búsqueda por símbolo que lleva a la ficha.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Layout, simboloEscrito } from './Layout'

// jsdom no desplaza: sin esto, cada navegación avisa de que `scrollTo` no existe.
const arriba = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ providers: [], llm: null }), { status: 200 })))
  arriba.mockClear()
  vi.stubGlobal('scrollTo', arriba)
})
afterEach(() => vi.unstubAllGlobals())

function Ficha() {
  const { symbol } = useParams()
  return <h1>Ficha {symbol}</h1>
}

function pintar(ruta = '/') {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<h1>Pantalla Inicio</h1>} />
          <Route path="/explorar" element={<h1>Pantalla Explorar</h1>} />
          <Route path="/empresa/:symbol" element={<Ficha />} />
          <Route path="/cartera" element={<h1>Pantalla Cartera</h1>} />
          <Route path="/avanzado" element={<h1>Pantalla Avanzado</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const menus = () => screen.getAllByRole('navigation', { name: 'Principal' })
const nombres = (nav: HTMLElement) => within(nav).getAllByRole('link').map((a) => a.textContent)

describe('Layout: el menú', () => {
  it('tiene tres sitios y las herramientas avanzadas, en la barra lateral y en la de abajo', () => {
    pintar()
    const [lateral, abajo] = menus()
    expect(nombres(lateral)).toEqual(['Inicio', 'Explorar acciones y ETFs', 'Mi cartera'])
    expect(screen.getByRole('link', { name: 'Herramientas avanzadas' })).toBeInTheDocument()
    expect(nombres(abajo)).toEqual(['Inicio', 'Explorar', 'Cartera', 'Más'])
  })

  it('marca dónde estás, y la ficha de una empresa cuenta como Explorar', () => {
    pintar('/empresa/ACME')
    for (const nav of menus()) {
      const actual = within(nav).getAllByRole('link').filter((a) => a.getAttribute('aria-current') === 'page')
      expect(actual.map((a) => a.textContent)).toEqual([nav === menus()[0] ? 'Explorar acciones y ETFs' : 'Explorar'])
    }
  })

  it('Inicio solo está activo en la portada', () => {
    pintar('/cartera')
    expect(within(menus()[0]).getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current')
    expect(within(menus()[0]).getByRole('link', { name: 'Mi cartera' })).toHaveAttribute('aria-current', 'page')
  })

  it('navegar desde la barra de abajo enseña la pantalla elegida', () => {
    pintar()
    fireEvent.click(within(menus()[1]).getByRole('link', { name: 'Más' }))
    expect(screen.getByRole('heading', { name: 'Pantalla Avanzado' })).toBeInTheDocument()
  })
})

describe('Layout: la búsqueda de arriba', () => {
  const buscar = (texto: string) => {
    fireEvent.change(screen.getByLabelText('Buscar una empresa o un ETF por su símbolo'), { target: { value: texto } })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    })
  }

  it('lleva a la ficha del símbolo, en mayúsculas y sin espacios', () => {
    pintar()
    buscar('  brk.b ')
    expect(screen.getByRole('heading', { name: 'Ficha BRK.B' })).toBeInTheDocument()
  })

  it('con algo que no puede ser un símbolo no navega y lo dice', () => {
    pintar()
    buscar('hola mundo!')
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe el símbolo con letras y números')
    expect(screen.getByRole('heading', { name: 'Pantalla Inicio' })).toBeInTheDocument()
  })

  it('simboloEscrito acepta puntos y guiones y rechaza lo vacío y los espacios', () => {
    expect(simboloEscrito('shop.to')).toBe('SHOP.TO')
    expect(simboloEscrito('BTC-USD')).toBe('BTC-USD')
    expect(simboloEscrito('   ')).toBeNull()
    expect(simboloEscrito('a b')).toBeNull()
  })
})

/** Una pantalla con enlaces a otra, como la lista de Hoy con «Ver el análisis completo». */
function Pantalla({ titulo }: { titulo: string }) {
  const navigate = useNavigate()
  return (
    <>
      <h1>{titulo}</h1>
      <button type="button" onClick={() => void navigate('/ticker/ACME')}>Ver el análisis completo</button>
      <button type="button" onClick={() => void navigate('/ticker/ACME?pestana=historial')}>Misma ficha, otra consulta</button>
      <button type="button" onClick={() => void navigate('/cartera#riesgo')}>Al riesgo de la cartera</button>
      <button type="button" onClick={() => void navigate(-1)}>Atrás</button>
    </>
  )
}

function pintarConFicha() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Pantalla titulo="Pantalla Hoy" />} />
          <Route path="/ticker/:symbol" element={<Pantalla titulo="Ficha" />} />
          <Route
            path="/cartera"
            element={
              <>
                <Pantalla titulo="Pantalla Cartera" />
                <section id="riesgo">Riesgo</section>
              </>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('Layout: una pantalla nueva se abre por arriba', () => {
  // Revisión 12 (visual): la página no se recarga y el navegador conservaba el
  // desplazamiento de la anterior; «Ver el análisis completo» abría la ficha
  // unos 100 px más abajo, con la cabecera cortada.
  const alAncla = vi.fn()
  const original = Element.prototype.scrollIntoView
  beforeEach(() => {
    alAncla.mockClear()
    Element.prototype.scrollIntoView = alAncla
  })
  afterEach(() => {
    Element.prototype.scrollIntoView = original
  })

  it('al cambiar de ruta vuelve arriba', () => {
    pintarConFicha()
    expect(arriba).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ver el análisis completo' }))
    expect(screen.getByText('Ficha')).toBeInTheDocument()
    expect(arriba).toHaveBeenCalledWith(0, 0)
  })

  it('no al cambiar solo la consulta (las pestañas de la misma pantalla)', () => {
    pintarConFicha()
    fireEvent.click(screen.getByRole('button', { name: 'Ver el análisis completo' }))
    arriba.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Misma ficha, otra consulta' }))
    expect(arriba).not.toHaveBeenCalled()
  })

  it('con «Atrás» no: volver a donde estabas es cosa del navegador', () => {
    pintarConFicha()
    fireEvent.click(screen.getByRole('button', { name: 'Ver el análisis completo' }))
    arriba.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Atrás' }))
    expect(screen.getByText('Pantalla Hoy')).toBeInTheDocument()
    expect(arriba).not.toHaveBeenCalled()
  })

  it('con un ancla, a ella y no arriba', () => {
    pintarConFicha()
    fireEvent.click(screen.getByRole('button', { name: 'Al riesgo de la cartera' }))
    expect(alAncla).toHaveBeenCalledTimes(1)
    expect(alAncla.mock.contexts[0]).toBe(document.getElementById('riesgo'))
    expect(arriba).not.toHaveBeenCalled()
  })
})

