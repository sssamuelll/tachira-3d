import { describe, it, expect } from 'vitest'
import { temaDe, leer, guardar } from './usarTema'

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

// El repo no tiene jsdom, así que no hay navegador de mentira donde probar
// esto por fuera: se reemplaza el localStorage global por uno falso que
// lanza, directo, y se restaura al terminar.
describe('leer/guardar contra un localStorage que lanza', () => {
  it('leer() da null y guardar() no lanza (ventana privada, cookies bloqueadas)', () => {
    const habiaOriginal = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage')
    const original = (globalThis as any).localStorage
    ;(globalThis as any).localStorage = {
      getItem () { throw new Error('bloqueado: ventana privada') },
      setItem () { throw new Error('bloqueado: ventana privada') },
    }
    try {
      expect(leer()).toBeNull()
      expect(() => guardar('oscuro')).not.toThrow()
    } finally {
      if (habiaOriginal) (globalThis as any).localStorage = original
      else delete (globalThis as any).localStorage
    }
  })
})
