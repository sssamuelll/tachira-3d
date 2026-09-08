import { describe, expect, it } from 'vitest'
import { tallarAccesos } from '../lib/approach-terrain.mjs'
import { alturaTriangulo } from '../lib/drape.mjs'
import { tileXToLon, tileYToLat, tileXf, tileYf } from '../lib/terrarium.mjs'

const W = 48
const point = (u, v) => [tileXToLon(1223 + u / 256, 12), tileYToLat(1948 + v / 256, 12)]
const fixture = () => ({ width: W, height: W, tile: { z: 12, x0: 1223, y0: 1948 },
  data: new Float32Array(W * W).fill(100) })
const corridor = (height, weights = [1, 1]) => ({ tags: { highway: 'primary' },
  coords: [point(10, 20), point(15, 20)], carvingHeights: [height, height], carvingWeights: weights })
const topology = coords => ({ chains: [[{ line: { coords } }]] })

describe('tallarAccesos', () => {
  it('reutiliza el corredor del carving y conserva el terreno distante', () => {
    const dem = fixture(), before = dem.data.slice()
    const stats = tallarAccesos(dem, [corridor(110)], { chains: [] })
    expect(dem.data[20 * W + 12]).toBeCloseTo(110, 4)
    expect(dem.data[21 * W + 12]).toBeGreaterThan(100)
    expect(dem.data[21 * W + 12]).toBeLessThan(110)
    expect(dem.data[22 * W + 12]).toBe(100)
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (x < 8 || x > 17 || y < 18 || y > 22) expect(dem.data[y * W + x]).toBe(before[y * W + x])
    }
    expect(stats.posts).toBeGreaterThan(0)
  })

  it('no levanta ningún post de soporte del puente aunque lo cruce un relleno', () => {
    const dem = fixture(), coords = [point(12.4, 17), point(12.4, 23)]
    const stats = tallarAccesos(dem, [corridor(120)], topology(coords))
    for (let y = 17; y <= 24; y++) for (const x of [12, 13]) expect(dem.data[y * W + x]).toBeLessThanOrEqual(100)
    for (let y = 17; y <= 23; y += 0.05) expect(alturaTriangulo(dem, ...point(12.4, y))).toBeLessThanOrEqual(100 + 1e-7)
    expect(dem.data[20 * W + 10]).toBeCloseTo(120, 4)
    expect(stats.protectedBridgePosts).toBeGreaterThan(0)
  })

  it('apaga el tallado longitudinalmente y no toca un corredor de peso cero', () => {
    const dem = fixture()
    tallarAccesos(dem, [corridor(120, [1, 0])], { chains: [] })
    expect(dem.data[20 * W + 10]).toBeCloseTo(120, 4)
    expect(dem.data[20 * W + 12]).toBeCloseTo(112, 4)
    expect(dem.data[20 * W + 15]).toBeCloseTo(100, 4)
    expect(dem.data[20 * W + 16]).toBe(100)
    const untouched = fixture()
    const stats = tallarAccesos(untouched, [corridor(50, [0, 0])], { chains: [] })
    expect(untouched.data).toEqual(fixture().data)
    expect(stats.posts).toBe(0)
  })

  it('conserva la altura del terreno usada para colocar la pieza del Viaducto Viejo', () => {
    const lon = -72.23427815, lat = 7.76271285, z = 12
    const x0 = Math.floor(tileXf(lon, z)), y0 = Math.floor(tileYf(lat, z))
    const dem = { width: 257, height: 257, tile: { z, x0, y0 }, data: new Float32Array(257 * 257).fill(100) }
    const line = { tags: { highway: 'primary' }, coords: [[lon - .0004, lat], [lon + .0004, lat]],
      carvingHeights: [130, 130], carvingWeights: [1, 1] }
    const before = alturaTriangulo(dem, lon, lat)
    const stats = tallarAccesos(dem, [line], { chains: [] })
    expect(alturaTriangulo(dem, lon, lat)).toBe(before)
    expect(stats.centerGroundChanges.find(c => c.id === 'viaducto-viejo').changeM).toBe(0)
  })
})
