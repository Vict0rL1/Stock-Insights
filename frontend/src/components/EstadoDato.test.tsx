import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDato } from '../lib/useDato'
import { BloqueDatos, EstadoDato } from './EstadoDato'

// Principio de la app: toda cifra lleva su fuente y su frescura. La insignia
// es lo que lo enseña, así que es el primer componente con test.
describe('EstadoDato', () => {
  it('enseña la fuente y su frescura', () => {
    render(<EstadoDato data={{ source: 'finnhub', as_of: '2026-10-08T14:00:00Z', cached: false, fetched_at: null }} freshness="delayed" />)
    expect(screen.getByText('finnhub · retrasado ~15 min')).toBeInTheDocument()
  })

  it('un dato viejo se distingue y dice su antigüedad', () => {
    render(
      <EstadoDato
        data={{ source: 'yfinance', as_of: '2026-10-08T14:00:00Z', cached: true, fetched_at: '2026-10-08T14:00:00Z', estado: 'viejo', antiguedad_segundos: 1200 }}
        freshness="live"
      />,
    )
    // Nunca «en vivo» para una copia rescatada.
    expect(screen.getByText(/DATO VIEJO · yfinance · hace 20 min/)).toBeInTheDocument()
    expect(screen.queryByText(/en vivo/)).not.toBeInTheDocument()
  })

  it('la hora del dato va en la del mercado, rotulada (revisión de la Fase 1)', () => {
    const { container } = render(
      <EstadoDato data={{ source: 'finnhub', as_of: '2026-10-08T14:00:00Z', cached: false, fetched_at: null }} freshness="delayed" />,
    )
    expect(container.querySelector('[title]')?.getAttribute('title')).toBe('Fuente: finnhub · dato del 8 oct 2026, 10:00\u00a0ET')
  })

  it('un dato viejo sin antigüedad no dice «hace 0 min» (revisión de la Fase 1)', () => {
    render(
      <EstadoDato
        data={{ source: 'yfinance', as_of: '2026-10-08T14:00:00Z', cached: true, fetched_at: null, estado: 'viejo', antiguedad_segundos: null }}
        freshness="live"
      />,
    )
    expect(screen.getByText(/DATO VIEJO · yfinance · antigüedad desconocida/)).toBeInTheDocument()
  })

  it('desconocido y error se ven distintos de un dato válido (ítem 2.1)', () => {
    const base = { source: 'edgar', as_of: '2026-10-08T14:00:00Z', cached: false, fetched_at: null }
    const { rerender } = render(<EstadoDato data={{ ...base, estado: 'desconocido', aviso: 'sin respuesta' }} />)
    expect(screen.getByText('DATO DESCONOCIDO · edgar')).toBeInTheDocument()
    rerender(<EstadoDato data={{ ...base, estado: 'error' }} />)
    expect(screen.getByText('ERROR EN EL DATO · edgar')).toBeInTheDocument()
  })
})

describe('BloqueDatos', () => {
  const carga = <T,>(c: object) => ({ reintentar: () => undefined, datos: null, error: null, ...c }) as never as T

  it('un fallo se dice con su motivo y se puede reintentar; nunca como «no hay datos»', () => {
    let reintentos = 0
    render(
      <BloqueDatos
        carga={{ estado: 'error', datos: null, error: 'Timeout tras 15 s', reintentar: () => (reintentos += 1) }}
        que="los índices"
        vacio={(d: string[]) => d.length === 0}
        mensajeVacio="No hay índices."
      >
        {(d) => d.join(',')}
      </BloqueDatos>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar los índices: Timeout tras 15 s')
    expect(screen.queryByText('No hay índices.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(reintentos).toBe(1)
  })

  it('cargando, vacío y con datos son tres cosas distintas', () => {
    const hijos = (d: string[]) => <span>{d.join(',')}</span>
    const { rerender } = render(
      <BloqueDatos carga={carga({ estado: 'cargando' })} que="los sectores" vacio={(d: string[]) => !d.length} mensajeVacio="Ningún sector.">
        {hijos}
      </BloqueDatos>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Cargando los sectores…')
    rerender(
      <BloqueDatos carga={carga({ estado: 'listo', datos: [] })} que="los sectores" vacio={(d: string[]) => !d.length} mensajeVacio="Ningún sector.">
        {hijos}
      </BloqueDatos>,
    )
    expect(screen.getByText('Ningún sector.')).toBeInTheDocument()
    rerender(
      <BloqueDatos carga={carga({ estado: 'listo', datos: ['XLK'] })} que="los sectores" vacio={(d: string[]) => !d.length} mensajeVacio="Ningún sector.">
        {hijos}
      </BloqueDatos>,
    )
    expect(screen.getByText('XLK')).toBeInTheDocument()
  })
})

describe('useDato', () => {
  it('un fallo es un estado propio, y reintentar vuelve a pedir', async () => {
    let llamadas = 0
    const { result } = renderHook(() =>
      useDato(() => {
        llamadas += 1
        return llamadas === 1 ? Promise.reject(new Error('caído')) : Promise.resolve(['ok'])
      }, 'clave'),
    )
    await waitFor(() => expect(result.current.estado).toBe('error'))
    expect(result.current.error).toBe('caído')
    act(() => result.current.reintentar())
    await waitFor(() => expect(result.current.estado).toBe('listo'))
    expect(result.current.datos).toEqual(['ok'])
  })

  it('al cambiar de clave vuelve a «cargando» y descarta la respuesta vieja', async () => {
    const pendientes: Record<string, (v: string) => void> = {}
    const { result, rerender } = renderHook(({ clave }) => useDato(() => new Promise<string>((r) => (pendientes[clave] = r)), clave), {
      initialProps: { clave: 'AAPL' },
    })
    rerender({ clave: 'MSFT' })
    expect(result.current.estado).toBe('cargando')
    act(() => pendientes.AAPL('datos de AAPL'))
    expect(result.current.estado).toBe('cargando')
    act(() => pendientes.MSFT('datos de MSFT'))
    await waitFor(() => expect(result.current.datos).toBe('datos de MSFT'))
  })
})

