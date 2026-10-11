/**
 * Revisión del 2.1, dos fallos del propio `useDato`:
 *
 * - Al cambiar de clave quedaba un render con los datos de la clave anterior
 *   (el reset a «cargando» iba en el efecto): la cabecera del símbolo nuevo
 *   con el nombre del viejo, y una pestaña hija que ya pedía lo suyo.
 * - Recargar tras una acción pasaba por «cargando»: la tabla de la cartera, la
 *   lectura de un evento o el análisis de la cartera desaparecían mientras
 *   llegaba lo nuevo, y la página saltaba.
 */
import { act, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { useDato, type CargaConReintento } from './useDato'

type Pendiente = { resolver: (v: string) => void }

function crearPeticiones() {
  const pendientes: Record<string, Pendiente[]> = {}
  const pedir = (clave: string) =>
    new Promise<string>((resolver) => {
      ;(pendientes[clave] ??= []).push({ resolver })
    })
  return { pendientes, pedir }
}

describe('useDato', () => {
  it('al cambiar de clave no hay ni un render con los datos de la anterior', async () => {
    const { pendientes, pedir } = crearPeticiones()
    const vistos: string[] = []
    function Sonda({ clave }: { clave: string }) {
      const c = useDato(() => pedir(clave), clave)
      vistos.push(`${clave}:${c.estado}:${c.datos ?? ''}`)
      return null
    }
    const { rerender } = render(<Sonda clave="ACME" />)
    await act(async () => pendientes.ACME[0].resolver('datos de ACME'))
    expect(vistos.at(-1)).toBe('ACME:listo:datos de ACME')

    vistos.length = 0
    rerender(<Sonda clave="OTRA" />)
    expect(vistos.length).toBeGreaterThan(0)
    expect(vistos.filter((v) => v.startsWith('OTRA:') && v.includes('ACME'))).toEqual([])
    expect(vistos[0]).toBe('OTRA:cargando:')
  })

  it('refrescar conserva lo que se ve hasta que llega lo nuevo', async () => {
    const { pendientes, pedir } = crearPeticiones()
    let carga: CargaConReintento<string> | undefined
    function Sonda() {
      carga = useDato(() => pedir('x'), 'x')
      return <p>{carga.estado === 'listo' ? carga.datos : carga.estado}</p>
    }
    render(<Sonda />)
    await act(async () => pendientes.x[0].resolver('primera'))
    expect(screen.getByText('primera')).toBeInTheDocument()

    act(() => carga!.refrescar())
    expect(screen.getByText('primera')).toBeInTheDocument()
    expect(carga!.refrescando).toBe(true)

    await act(async () => pendientes.x[1].resolver('segunda'))
    expect(screen.getByText('segunda')).toBeInTheDocument()
    expect(carga!.refrescando).toBe(false)
  })

  // Guarda de no regresión (pasa también con el código anterior): el botón
  // «Reintentar» sí pasa por «cargando»; solo `refrescar` conserva lo visible.
  it('reintentar, en cambio, sí vuelve a «cargando»', async () => {
    const { pendientes, pedir } = crearPeticiones()
    let carga: CargaConReintento<string> | undefined
    function Sonda() {
      carga = useDato(() => pedir('x'), 'x')
      return <p>{carga.estado === 'listo' ? carga.datos : carga.estado}</p>
    }
    render(<Sonda />)
    await act(async () => pendientes.x[0].resolver('primera'))
    act(() => carga!.reintentar())
    expect(screen.getByText('cargando')).toBeInTheDocument()
  })

  it('refrescar desde un error vuelve a «cargando»: el fallo viejo no se queda con su «Reintentar»', async () => {
    // Segunda revisión del 2.1: en Cartera, con el análisis en error, «Descargar
    // histórico completo» dejaba el error y su «Reintentar» a la vista mientras
    // ya se descargaba, y pulsarlo lanzaba una segunda descarga.
    let llamadas = 0
    let carga: CargaConReintento<string> | undefined
    function Sonda() {
      carga = useDato(() => {
        llamadas += 1
        return llamadas === 1 ? Promise.reject(new Error('tiempo agotado')) : new Promise<string>(() => {})
      }, 'x')
      return <p>{carga.estado}</p>
    }
    render(<Sonda />)
    expect(await screen.findByText('error')).toBeInTheDocument()
    act(() => carga!.refrescar())
    expect(screen.getByText('cargando')).toBeInTheDocument()
    expect(carga!.refrescando).toBe(false)
  })

  it('en StrictMode (`npm run dev`) se pide una sola vez al montar', async () => {
    // El doble efecto de StrictMode mandaba cada carga dos veces al backend
    // (segunda revisión del 2.1).
    let llamadas = 0
    function Sonda() {
      const c = useDato(() => {
        llamadas += 1
        return Promise.resolve('hecho')
      }, 'x')
      return <p>{c.estado === 'listo' ? c.datos : c.estado}</p>
    }
    render(<StrictMode><Sonda /></StrictMode>)
    expect(await screen.findByText('hecho')).toBeInTheDocument()
    expect(llamadas).toBe(1)
  })

  it('volver a una clave después de una clave null pide otra vez: solo se reutiliza lo que está en vuelo', async () => {
    // Tercera pasada: /ticker/AAPL → /ticker (clave null) → /ticker/AAPL
    // reutilizaba la promesa ya resuelta y enseñaba el precio de la primera
    // visita como si fuera de ahora.
    let llamadas = 0
    function Sonda({ clave }: { clave: string | null }) {
      const c = useDato(() => {
        llamadas += 1
        return Promise.resolve(`dato ${llamadas}`)
      }, clave)
      return <p>{c.estado === 'listo' ? c.datos : c.estado}</p>
    }
    const { rerender } = render(<Sonda clave="AAPL" />)
    expect(await screen.findByText('dato 1')).toBeInTheDocument()
    rerender(<Sonda clave={null} />)
    rerender(<Sonda clave="AAPL" />)
    expect(await screen.findByText('dato 2')).toBeInTheDocument()
    expect(llamadas).toBe(2)
  })
})
