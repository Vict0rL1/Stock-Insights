// Matchers de DOM para `expect` (toBeInTheDocument, toHaveTextContent…) y
// limpieza del DOM entre tests.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { olvidarListasDiarias } from '../hooks/useListaDiaria'

afterEach(() => cleanup())
// La lista del día se comparte a nivel de módulo (`useListaDiaria`): sin esto, un
// test heredaría la lista, el fallo o la petición en vuelo del anterior.
afterEach(() => olvidarListasDiarias())
