import { describe, it, expect } from 'vitest'
import { temaDe } from './usarTema'

describe('temaDe', () => {
  it('sin elección previa, manda el sistema', () => {
    expect(temaDe(null, true)).toBe('oscuro')
    expect(temaDe(null, false)).toBe('claro')
  })

  it('la elección explícita gana sobre el sistema', () => {
    expect(temaDe('claro', true)).toBe('claro')
    expect(temaDe('oscuro', false)).toBe('oscuro')
  })

  // Lo guardado puede ser basura: otra versión de la app, alguien tocando
  // localStorage a mano. Si no se reconoce, manda el sistema.
  it('un valor guardado que no reconoce cae al sistema', () => {
    expect(temaDe('azul', true)).toBe('oscuro')
    expect(temaDe('', false)).toBe('claro')
  })
})
