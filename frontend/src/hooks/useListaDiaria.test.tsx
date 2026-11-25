/**
 * La primera carga de la lista del día, sin bloquear (docs/PLAN_NAVEGACION.md):
 * la guardada al momento y la de ahora detrás, la primera pasada corta cuando no
 * hay ninguna, las pasadas automáticas, los fallos con «Reintentar» y, sobre
 * todo, que dos pantallas (Inicio y Explorar) o StrictMode no pidan dos veces lo
 * mismo. Se simula `fetch`, y cada respuesta se suelta a mano para fijar el orden.
 * Y que la lista en memoria envejece: se guarda cuándo se calculó, no su edad.
 */
import { act, render, renderHook, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProgresoAnalisis, textoDeAntiguedad } from '../components/ProgresoAnalisis'
import { MAX_PASADAS_AUTO, PRIMERA_PASADA, REVALIDAR_TRAS_MS, VIGENCIA_LISTA_HORAS, useListaDiaria } from './useListaDiaria'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const G = '/api/signals/today?market=us_sp500&vencida=aceptar'
const N = '/api/signals/today?market=us_sp500'
const P = `/api/signals/today?market=us_sp500&budget=${PRIMERA_PASADA}`
const R = '/api/signals/today?market=us_sp500&refresh=true'

type Respuesta = { status: number; json: unknown }

/** Una lista con lo que el hook lee; `complete` sale de las cuentas. Calculada
 *  AHORA (el reloj del test): una con fecha fija envejecería con el calendario. */
function lista(scored: number, extra: Record<string, unknown> = {}): Respuesta {
  const ahora = new Date(Date.now()).toISOString()
  return {
    status: 200,
    json: { scored, requested: 502, pending: 502 - scored, complete: scored === 502, cached: true,
      as_of: ahora, fetched_at: ahora, signals: [], ...extra },
  }
}
const vieja = (scored: number) => lista(scored, { estado: 'viejo', antiguedad_segundos: 9 * 3600 })
const falla = (status: number, detail: string): Respuesta => ({ status, json: { detail } })

/** `fetch` que deja cada petición esperando hasta `soltar(url, respuesta)`. */
function servidor() {
  const pedidas: string[] = []
  const pendientes = new Map<string, ((r: Respuesta) => void)[]>()
  vi.stubGlobal('fetch', vi.fn((e: RequestInfo | URL) => {
    const url = typeof e === 'string' ? e : e instanceof URL ? e.pathname + e.search : e.url
    pedidas.push(url)
    return new Promise<Response>((ok) => {
      pendientes.set(url, [...(pendientes.get(url) ?? []), (r) => ok(new Response(JSON.stringify(r.json), { status: r.status }))])
    })
  }))
  return {
    pedidas,
    veces: (url: string) => pedidas.filter((u) => u === url).length,
    soltar: async (url: string, r: Respuesta) => {
      const cola = pendientes.get(url)
      if (!cola?.length) throw new Error(`nadie esperaba ${url}; pedidas: ${pedidas.join(', ')}`)
      await act(async () => cola.shift()!(r))
    },
  }
}

const montar = (market = 'us_sp500') => renderHook(() => useListaDiaria(market), { wrapper: StrictMode })

describe('useListaDiaria: lo guardado primero', () => {
  it('enseña la guardada caducada con su antigüedad y la sustituye al llegar la de ahora', async () => {
    const s = servidor()
    const { result } = montar()
    expect(result.current.estado).toBe('cargando')
    expect(s.pedidas).toEqual([G])

    await s.soltar(G, vieja(502))
    expect(result.current.estado).toBe('vieja')
    expect(result.current.vieja).toBe(true)
    expect(textoDeAntiguedad(result.current.calculadaEn)).toBe('Lista de hace 9 h')
    expect(result.current.data?.scored).toBe(502)
    expect(result.current.ocupado).toBe(true)
    expect(s.pedidas).toEqual([G, N])

    await s.soltar(N, lista(502, { cached: false }))
    expect(result.current.estado).toBe('lista')
    expect(result.current.vieja).toBe(false)
    expect(result.current.data?.estado).toBeUndefined()
    expect(result.current.ocupado).toBe(false)
    expect(s.pedidas).toEqual([G, N])
  })

  it('con la guardada vigente no pide la normal: es la misma', async () => {
    const s = servidor()
    const { result } = montar()
    await s.soltar(G, lista(502))
    expect(result.current.estado).toBe('lista')
    expect(result.current.vieja).toBe(false)
    expect(s.pedidas).toEqual([G])
  })

  it('sin ninguna guardada espera a la normal, con la primera pasada corta', async () => {
    const s = servidor()
    const { result } = montar()
    await s.soltar(G, falla(404, 'No hay ninguna lista de EE. UU. — S&P 500 guardada'))
    expect(result.current.estado).toBe('cargando')
    expect(result.current.primeraVez).toBe(true)
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBeNull()
    expect(s.pedidas).toEqual([G, P])

    await s.soltar(P, lista(PRIMERA_PASADA, { cached: false }))
    expect(result.current.data?.scored).toBe(PRIMERA_PASADA)
    expect(result.current.primeraVez).toBe(false)
    expect(result.current.estado).toBe('actualizando')
    expect(result.current.progreso).toEqual({ puntuadas: PRIMERA_PASADA, total: 502, pendientes: 502 - PRIMERA_PASADA, completa: false })
    // Y las pasadas automáticas siguen completando, con el presupuesto normal.
    expect(result.current.pasada).toBe(1)
    expect(s.pedidas).toEqual([G, P, R])
  })

  it('si la guardada falla por otra cosa, no se sabe si la hay: la normal, sin recortar', async () => {
    const s = servidor()
    const { result } = montar()
    await s.soltar(G, falla(500, 'Fallo inesperado'))
    expect(s.pedidas).toEqual([G, N])
    expect(result.current.error).toBeNull()
    expect(result.current.primeraVez).toBe(false)
  })
})

describe('useListaDiaria: pasadas y fallos', () => {
  it('encadena pasadas solas hasta el tope y se para; «Seguir completando» sigue', async () => {
    const s = servidor()
    const { result } = montar()
    await s.soltar(G, lista(120))
    for (let pasada = 1; pasada <= MAX_PASADAS_AUTO; pasada++) {
      expect(result.current.pasada).toBe(pasada)
      expect(result.current.estado).toBe('actualizando')
      await s.soltar(R, lista(120 + pasada * 50))
    }
    expect(s.veces(R)).toBe(MAX_PASADAS_AUTO)
    expect(result.current.ocupado).toBe(false)
    expect(result.current.estado).toBe('lista')
    expect(result.current.progreso?.completa).toBe(false)
    expect(result.current.progreso?.puntuadas).toBe(120 + MAX_PASADAS_AUTO * 50)

    act(() => result.current.seguirCompletando())
    expect(s.veces(R)).toBe(MAX_PASADAS_AUTO + 1)
    expect(result.current.pasada).toBe(0)
    await s.soltar(R, lista(502))
    expect(result.current.estado).toBe('lista')
    expect(s.veces(R)).toBe(MAX_PASADAS_AUTO + 1)
  })

  it('un fallo se dice sin quitar lo que se ve, y «Reintentar» repite la misma pasada', async () => {
    const s = servidor()
    const { result } = montar()
    await s.soltar(G, lista(120))
    await s.soltar(R, falla(502, 'el proveedor de precios no respondió'))
    expect(result.current.estado).toBe('error')
    expect(result.current.error?.mensaje).toBe('el proveedor de precios no respondió')
    expect(result.current.data?.scored).toBe(120)
    expect(result.current.ocupado).toBe(false)

    act(() => result.current.error!.reintentar())
    expect(result.current.error).toBeNull()
    expect(result.current.pasada).toBe(1)
    expect(s.veces(R)).toBe(2)
    await s.soltar(R, lista(502))
    expect(result.current.estado).toBe('lista')
  })

  it('si la de ahora falla, la guardada sigue a la vista con su antigüedad', async () => {
    const s = servidor()
    const { result } = montar()
    await s.soltar(G, vieja(502))
    await s.soltar(N, falla(502, 'EDGAR no respondió'))
    expect(result.current.estado).toBe('error')
    expect(result.current.vieja).toBe(true)
    expect(textoDeAntiguedad(result.current.calculadaEn)).toBe('Lista de hace 9 h')
    act(() => result.current.error!.reintentar())
    expect(s.veces(N)).toBe(2)
  })
})

describe('useListaDiaria: compartida entre pantallas', () => {
  it('dos pantallas y StrictMode hacen una sola petición por mercado y tipo de pasada', async () => {
    const s = servidor()
    const inicio = montar()
    const explorar = montar()
    expect(s.pedidas).toEqual([G])

    await s.soltar(G, vieja(502))
    expect(inicio.result.current.estado).toBe('vieja')
    expect(explorar.result.current.estado).toBe('vieja')
    expect(s.pedidas).toEqual([G, N])

    await s.soltar(N, lista(120, { cached: false }))
    expect(s.pedidas).toEqual([G, N, R])
    for (let i = 1; i < MAX_PASADAS_AUTO; i++) await s.soltar(R, lista(120 + i * 100))
    await s.soltar(R, lista(502))
    expect(s.veces(R)).toBe(MAX_PASADAS_AUTO)
    expect(inicio.result.current.data?.scored).toBe(502)
    expect(explorar.result.current.data).toBe(inicio.result.current.data)

    // Una tercera que monta después la enseña sin pedir nada.
    const otra = montar()
    expect(otra.result.current.estado).toBe('lista')
    expect(otra.result.current.data?.scored).toBe(502)
    expect(s.pedidas).toHaveLength(2 + MAX_PASADAS_AUTO)

    // Otro mercado es otra lista.
    montar('canada')
    expect(s.pedidas.at(-1)).toBe('/api/signals/today?market=canada&vencida=aceptar')
  })

  it('una pantalla que monta a media cadena se engancha a ella, no empieza otra', async () => {
    const s = servidor()
    const inicio = montar()
    await s.soltar(G, lista(120))
    expect(s.veces(R)).toBe(1)
    const explorar = montar()
    expect(explorar.result.current.estado).toBe('actualizando')
    expect(explorar.result.current.pasada).toBe(1)
    expect(s.pedidas).toEqual([G, R])
    await s.soltar(R, lista(502))
    expect(explorar.result.current.estado).toBe('lista')
    expect(inicio.result.current.estado).toBe('lista')
    expect(s.pedidas).toEqual([G, R])
  })

  it('sin nadie mirando no pide la siguiente pasada; al volver alguien, sigue por donde iba', async () => {
    const s = servidor()
    const hoy = montar()
    await s.soltar(G, lista(120))
    hoy.unmount()
    await s.soltar(R, lista(240))
    expect(s.veces(R)).toBe(1)

    const otra = montar()
    expect(s.veces(R)).toBe(2)
    expect(otra.result.current.pasada).toBe(2)
    expect(otra.result.current.data?.scored).toBe(240)
  })

  it('una lista de hace más de un minuto se pide otra vez, una sola, sin otra cadena', async () => {
    const s = servidor()
    const ahora = Date.now()
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(ahora)
    const hoy = montar()
    await s.soltar(G, lista(120))
    for (let i = 1; i <= MAX_PASADAS_AUTO; i++) await s.soltar(R, lista(120 + i * 50))
    hoy.unmount()

    reloj.mockReturnValue(ahora + REVALIDAR_TRAS_MS - 1)
    montar().unmount()
    expect(s.veces(N)).toBe(0)

    reloj.mockReturnValue(ahora + REVALIDAR_TRAS_MS + 1)
    const despues = montar()
    expect(s.veces(N)).toBe(1)
    expect(despues.result.current.estado).toBe('actualizando')
    // La misma lista guardada a medias: ya tuvo su cadena y no se repite sola.
    await s.soltar(N, lista(320))
    expect(s.veces(R)).toBe(MAX_PASADAS_AUTO)
    expect(despues.result.current.estado).toBe('lista')
  })
})

describe('useListaDiaria: la lista en memoria envejece (revisión 15)', () => {
  const DIEZ = '2026-11-24T10:00:00+00:00'
  const calculadaALasDiez = (extra: Record<string, unknown> = {}) => lista(502, { as_of: DIEZ, fetched_at: DIEZ, ...extra })

  function Progreso() {
    const l = useListaDiaria('us_sp500')
    return <ProgresoAnalisis lista={l} />
  }

  it('una lista de hace 7 h, al volver a la pantalla, no se presenta como de ahora', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-24T10:00:30Z'))
    const s = servidor()
    const primera = montar()
    await s.soltar(G, calculadaALasDiez())
    expect(primera.result.current.estado).toBe('lista')
    primera.unmount()

    // Siete horas después (otra pantalla de la app, o la pestaña en segundo plano).
    vi.setSystemTime(new Date('2026-11-24T17:00:30Z'))
    const despues = montar()
    expect(s.pedidas.at(-1)).toBe(N)
    // Pasada su vigencia de 6 h: vieja, con su edad, mientras llega la de ahora.
    expect(despues.result.current).toMatchObject({ estado: 'vieja', vieja: true, ocupado: true })
    expect(textoDeAntiguedad(despues.result.current.calculadaEn)).toBe('Lista de hace 7 h')
  })

  it('y si la de ahora falla, sigue diciendo de cuándo es y que el repaso tampoco es de ahora', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-24T10:00:30Z'))
    const s = servidor()
    const primera = render(<StrictMode><Progreso /></StrictMode>)
    await s.soltar(G, calculadaALasDiez())
    primera.unmount()

    vi.setSystemTime(new Date('2026-11-24T17:00:30Z'))
    render(<StrictMode><Progreso /></StrictMode>)
    await s.soltar(N, falla(502, 'No se pudo puntuar ningún sector'))
    const estado = screen.getByRole('status')
    expect(estado).toHaveTextContent('Lista de hace 7 h, sin actualizar.')
    expect(estado).toHaveTextContent('El repaso del stop de tus posiciones es de cuando llegó, hace 7 h.')
    expect(estado).not.toHaveTextContent('sí es de ahora')
  })

  it('la edad de la copia caducada avanza mientras se enseña', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-24T19:00:00Z'))
    const s = servidor()
    const { result } = montar()
    await s.soltar(G, calculadaALasDiez({ estado: 'viejo', antiguedad_segundos: 9 * 3600 }))
    await s.soltar(N, falla(502, 'fuentes caídas'))
    expect(textoDeAntiguedad(result.current.calculadaEn)).toBe('Lista de hace 9 h')
    // Tres horas con la pantalla abierta: la copia tiene 12 h.
    vi.setSystemTime(new Date('2026-11-24T22:00:00Z'))
    expect(textoDeAntiguedad(result.current.calculadaEn)).toBe('Lista de hace 12 h')
  })

  it('la que está a la vista se vuelve vieja sola al pasar su vigencia, sin pedir nada', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-11-24T10:00:00Z'))
    const s = servidor()
    const { result } = montar()
    await s.soltar(G, lista(502, { cached: false }))
    expect(result.current.estado).toBe('lista')
    act(() => {
      vi.advanceTimersByTime(VIGENCIA_LISTA_HORAS * 3_600_000 - 60_000)
    })
    expect(result.current.estado).toBe('lista')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(result.current).toMatchObject({ estado: 'vieja', vieja: true, ocupado: false })
    expect(textoDeAntiguedad(result.current.calculadaEn)).toBe(`Lista de hace ${VIGENCIA_LISTA_HORAS} h`)
    expect(s.pedidas).toEqual([G])
  })
})
