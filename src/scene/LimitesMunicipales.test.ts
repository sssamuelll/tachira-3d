import { describe, it, expect } from 'vitest'
import { ANCHO_PX, OPACIDAD, COLOR_CLARO, COLOR_OSCURO } from './LimitesMunicipales'

describe('el estilo de la línea de límite', () => {
  // Google dibuja los límites administrativos finos y tenues, en un gris
  // frío -- nunca en negro ni en el color de acento. Estos valores son el
  // punto de partida y se calibran mirando el mapa; el test solo impide que
  // alguien los suba a un grosor que tape la calle que hay debajo.
  it('la línea es fina: ningún valor de calibración puede pasar de 3 px', () => {
    expect(ANCHO_PX).toBeGreaterThan(0.5)
    expect(ANCHO_PX).toBeLessThanOrEqual(3)
  })

  it('la línea es tenue, nunca opaca del todo', () => {
    expect(OPACIDAD.claro).toBeLessThan(1)
    expect(OPACIDAD.oscuro).toBeLessThan(1)
  })

  it('el color es un gris frío, no un negro ni un color saturado', () => {
    for (const hex of [COLOR_CLARO, COLOR_OSCURO]) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      expect(max - min, `${hex} está demasiado saturado`).toBeLessThan(40)
      expect(max, `${hex} es casi negro`).toBeGreaterThan(60)
    }
  })
})
