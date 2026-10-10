/**
 * Ítem 2.1: un fallo de los filings salía «Sin filings: …», que se lee como «no
 * hay», y no se podía reintentar sin recargar la página.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FilingsResponse } from '../../api/types'
import { FilingsSection } from './FilingsSection'

afterEach(() => vi.unstubAllGlobals())

const FILINGS: FilingsResponse = {
  source: 'edgar',
  as_of: '2026-09-12T14:35:00+00:00',
  cached: false,
  fetched_at: null,
  estado: 'valido',
  symbol: 'ACME',
  filings: [{ type: '10-K', filed_at: '2026-02-20', accession_no: '0000000000-26-000001', url: 'https://www.sec.gov/' }],
  insider_filings: [],
}

describe('filings de la ficha', () => {
  it('un fallo se dice como fallo, con su motivo, y «Reintentar» lo vuelve a pedir', async () => {
    let respuesta: { status: number; json: unknown } = { status: 502, json: { detail: 'EDGAR no respondió' } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(respuesta.json), { status: respuesta.status })))
    render(<FilingsSection symbol="ACME" />)
    expect(await screen.findByText('No se pudieron cargar los filings de EDGAR: EDGAR no respondió')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Sin filings/)

    respuesta = { status: 200, json: FILINGS }
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('10-K')).toBeInTheDocument()
    expect(screen.getByText('Sin filings recientes.')).toBeInTheDocument()
  })
})
