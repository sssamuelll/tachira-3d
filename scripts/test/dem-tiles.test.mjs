import { describe, expect, it } from 'vitest'
import { alturaVertice, dentroVertice, teselaRgba, errorNodo, encodeTerrarium, LADO } from '../lib/dem-tiles.mjs'
import { decodeTerrarium } from '../lib/terrarium.mjs'

// DEM de juguete: 3x3 teselas z12 (768x768 posts) desde la tesela (100, 200),
// altura = c + f (un plano inclinado en las dos direcciones).
const W = 768, H = 768
const data = new Float32Array(W * H)
for (let f = 0; f < H; f++) for (let c = 0; c < W; c++) data[f * W + c] = c + f
const dem = { width: W, height: H, data, tile: { z: 12, x0: 100, y0: 200, nx: 3, ny: 3 } }
const dentro = new Uint8Array(W * H).fill(255)

describe('encodeTerrarium', () => {
  it('ida y vuelta a 1/256 m', () => {
    for (const h of [-32768, -12.5, 0, 0.75, 1234.3, 8848]) {
      const [r, g, b] = encodeTerrarium(h)
      expect(decodeTerrarium(r, g, b)).toBeCloseTo(h, 2)
    }
  })
})

describe('alturaVertice', () => {
  it('en z12 es el post, y el píxel 256 es el primero de la vecina', () => {
    expect(alturaVertice(dem, 12, 100, 200, 5, 7)).toBe(5 + 7)
    expect(alturaVertice(dem, 12, 100, 200, 256, 0)).toBe(256)
    expect(alturaVertice(dem, 12, 101, 200, 0, 0)).toBe(256)
  })

  it('en z11 decima: el píxel (1,1) es el post (2,2)', () => {
    expect(alturaVertice(dem, 11, 50, 100, 1, 1)).toBe(4)
  })

  it('fuera de la rejilla extiende el borde, y no está dentro', () => {
    expect(alturaVertice(dem, 12, 103, 200, 3, 3)).toBe(767 + 3)
    expect(dentroVertice(dem, dentro, 12, 103, 200, 3, 3)).toBe(false)
    expect(dentroVertice(dem, dentro, 12, 100, 200, 3, 3)).toBe(true)
  })

  it('dentro en un nivel grueso es "algún post del bloque"', () => {
    const d = new Uint8Array(W * H)
    d[3 * W + 3] = 255                                   // un solo post dentro
    expect(dentroVertice(dem, d, 11, 50, 100, 1, 1)).toBe(true)   // bloque [2,3]x[2,3]
    expect(dentroVertice(dem, d, 11, 50, 100, 2, 2)).toBe(false)
  })
})

describe('teselaRgba', () => {
  it('257x257 RGBA con Terrarium y alpha 255 dentro, 254 fuera', () => {
    const t0 = teselaRgba(dem, new Uint8Array(W * H), 12, 100, 200)
    expect(t0.length).toBe(LADO * LADO * 4)
    expect(t0[3]).toBe(254)
    const t1 = teselaRgba(dem, dentro, 12, 100, 200)
    expect(t1[3]).toBe(255)
    const i = (7 * LADO + 5) * 4
    expect(decodeTerrarium(t1[i], t1[i + 1], t1[i + 2])).toBeCloseTo(12, 2)
  })
})

describe('errorNodo', () => {
  it('un plano inclinado se representa sin error a cualquier nivel', () => {
    for (const [z, x, y] of [[12, 101, 201], [11, 50, 100], [13, 202, 402], [14, 404, 804], [15, 808, 1608]]) {
      expect(errorNodo(dem, dentro, z, x, y)).toBeCloseTo(0, 6)
    }
  })

  it('un pico entre vértices da error, y desaparece en el nivel donde es vértice', () => {
    const d = new Float32Array(W * H)
    d[101 * W + 101] = 80                               // un post aislado
    const dem2 = { ...dem, data: d }
    expect(errorNodo(dem2, dentro, 12, 100, 200)).toBeCloseTo(80, 3)    // vértices cada 8: 101 no lo es
    expect(errorNodo(dem2, dentro, 14, 401, 801)).toBeCloseTo(80, 3)    // paso 2: tampoco
    expect(errorNodo(dem2, dentro, 15, 803, 1603)).toBeCloseTo(0, 3)    // paso 1: superficie exacta
  })

  it('un nodo sin ningún post dentro devuelve null', () => {
    expect(errorNodo(dem, new Uint8Array(W * H), 12, 100, 200)).toBeNull()
  })
})
