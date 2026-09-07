import { describe, it, expect } from 'vitest'
import { alturaMalla } from './drape'
import type { TerrainMeta } from '../data/types'

// Rejilla de juguete 3x3 sobre un bbox de un grado, con alturas distintas en
// cada vértice para que ningún triángulo salga plano por casualidad.
const meta: TerrainMeta = {
  width: 3, height: 3,
  bbox: { s: 0, w: 0, n: 1, e: 1 },
  min: 0, max: 100,
  origin: { lat: 0.5, lon: 0.5, h: 0 },
  dem: { z: 12, x0: 0, y0: 0, nx: 1, ny: 1 },   // no lo mira alturaMalla
}
//  fila 0 = norte
const grid = new Int16Array([
  0, 10, 20,
  30, 40, 50,
  60, 70, 100,
])
// (lat, lon) del vértice (x, y) de esa rejilla.
const vert = (x: number, y: number) => ({ lat: 1 - y / 2, lon: x / 2 })

describe('alturaMalla', () => {
  it('devuelve el valor exacto en cada vértice de la rejilla', () => {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const { lat, lon } = vert(x, y)
        expect(alturaMalla(grid, meta, lat, lon)).toBeCloseTo(grid[y * 3 + x], 6)
      }
    }
  })

  it('devuelve null fuera de la rejilla', () => {
    expect(alturaMalla(grid, meta, 1.5, 0.5)).toBeNull()
    expect(alturaMalla(grid, meta, 0.5, -0.1)).toBeNull()
    expect(alturaMalla(grid, meta, -0.01, 0.5)).toBeNull()
    expect(alturaMalla(grid, meta, 0.5, 1.01)).toBeNull()
  })

  it('la diagonal de la celda va de arriba-derecha a abajo-izquierda', () => {
    // El acoplamiento con Terrain.tsx vive en esta diagonal: sus dos
    // triángulos son (a,c,b) y (b,c,d), o sea la diagonal une b (arriba-dcha)
    // con c (abajo-izda). Sobre esa recta los dos triángulos coinciden; en el
    // centro de la OTRA diagonal, no. La celda de abajo-derecha del juguete
    // está torcida a propósito (40,50,70,100: 40+100 != 50+70), así que si
    // alguien cambia la diagonal, este número cambia.
    const centro = alturaMalla(grid, meta, 0.25, 0.75)!   // centro de esa celda
    expect(centro).toBeCloseTo((50 + 70) / 2, 6)          // media de b y c
    expect(centro).not.toBeCloseTo((40 + 100) / 2, 1)     // NO la media de a y d
  })

  it('interpola linealmente dentro de un triángulo', () => {
    // Punto medio entre dos vértices de la misma arista: media exacta.
    expect(alturaMalla(grid, meta, 1, 0.25)).toBeCloseTo(5, 6)    // entre 0 y 10
    expect(alturaMalla(grid, meta, 0.75, 0)).toBeCloseTo(15, 6)   // entre 0 y 30
  })
})
