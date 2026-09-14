import { describe, it, expect } from 'vitest'
import { TOKENS_CLARO, TOKENS_OSCURO, cssDeTokens } from './tema'
import { T } from './theme'

describe('los tokens del tema', () => {
  it('las dos paletas declaran exactamente los mismos tokens', () => {
    expect(Object.keys(TOKENS_OSCURO).sort()).toEqual(Object.keys(TOKENS_CLARO).sort())
  })

  it('todo lo que T expone como color apunta a un token declarado', () => {
    for (const [clave, valor] of Object.entries(T)) {
      if (typeof valor !== 'string' || !valor.startsWith('var(')) continue
      const token = valor.slice(6, -1)   // var(--fondo) -> fondo
      expect(TOKENS_CLARO, `T.${clave} apunta a --${token}, que no existe`).toHaveProperty(token)
    }
  })

  it('el CSS declara la paleta clara en :root y la oscura bajo data-tema', () => {
    const css = cssDeTokens(TOKENS_CLARO, TOKENS_OSCURO)
    expect(css).toContain(':root{')
    expect(css).toContain('[data-tema="oscuro"]')
    expect(css).toContain('--fondo:')
  })

  // La regla que no se cruza: el color del DATO no puede entrar acá. Un verde
  // que significa "pavimento bueno" tiene que ser el mismo de día y de noche.
  //
  // Los dos lados se normalizan a triplete rgb antes de comparar. Comparar el
  // hex del token contra lo que css3() devuelve (`rgb(33,158,79)`) no casaría
  // NUNCA, y el test pasaría siempre sin comprobar nada.
  it('ningún token es un color de la rampa del PCI', async () => {
    const { PCI_RANGES } = await import('../data/constants')
    const rgbDe = (v: string): string | null => {
      const hex = /^#([0-9a-f]{6})$/i.exec(v.trim())
      if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).join(',')
      const rgb = /^rgba?\(([^)]+)\)$/i.exec(v.trim())
      if (rgb) return rgb[1].split(',').slice(0, 3).map(n => Math.round(+n)).join(',')
      return null   // sombras y demás: no son un color suelto
    }
    const delDato = new Set(PCI_RANGES.map(r => r.color.map(c => Math.round(c * 255)).join(',')))
    for (const [clave, valor] of Object.entries({ ...TOKENS_CLARO, ...TOKENS_OSCURO })) {
      const rgb = rgbDe(valor)
      if (rgb === null) continue
      expect(delDato.has(rgb), `--${clave} (${valor}) es un color de la rampa del PCI`).toBe(false)
    }
  })
})
