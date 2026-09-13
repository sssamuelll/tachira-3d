import { describe, it, expect } from 'vitest'
import { alturaGruesa } from './terreno'
import type { TerrainMeta } from './types'

// Una rejilla 3x3 sobre un grado cuadrado, fila 0 = norte, como el DEM real.
const grid = new Int16Array([
  10, 20, 30,
  40, 50, 60,
  70, 80, 90,
])
const meta = {
  width: 3, height: 3, bbox: { s: 0, w: 0, n: 1, e: 1 },
  min: 10, max: 90, origin: { lat: 0, lon: 0, h: 0 },
  dem: { z: 12, x0: 0, y0: 0, nx: 1, ny: 1 },
} as TerrainMeta

describe('alturaGruesa', () => {
  it('la esquina noroeste es el primer valor de la rejilla', () => {
    expect(alturaGruesa(grid, meta, 1, 0)).toBe(10)
  })

  it('la esquina sureste es el último', () => {
    expect(alturaGruesa(grid, meta, 0, 1)).toBe(90)
  })

  it('el centro es el vértice del medio', () => {
    expect(alturaGruesa(grid, meta, 0.5, 0.5)).toBe(50)
  })

  // Redondeo al vértice más cercano, no interpolación: es la misma regla que
  // usaba disco.ts, y cambiarla movería el minimapa.
  it('redondea al vértice más cercano', () => {
    expect(alturaGruesa(grid, meta, 0.9, 0.1)).toBe(10)
    expect(alturaGruesa(grid, meta, 0.6, 0.4)).toBe(50)
  })

  // Un hospital justo en el borde del bbox, o un redondeo que se pase por un
  // vértice, no puede leer fuera del array y devolver undefined.
  it('acota fuera del bbox en vez de salirse de la rejilla', () => {
    expect(alturaGruesa(grid, meta, 5, -5)).toBe(10)
    expect(alturaGruesa(grid, meta, -5, 5)).toBe(90)
  })
})
