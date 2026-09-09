import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { tallar } from '../lib/carving.mjs'
import { alturaTriangulo } from '../lib/drape.mjs'
import { orientar } from '../lib/road-meta.mjs'
import { subdividir } from '../lib/subdividir.mjs'
import { tileXToLon, tileYToLat } from '../lib/terrarium.mjs'
import { createSparseCarvedDem, createCachedRawDem } from '../lib/sparse-carved-dem.mjs'

const coord = (c, f) => [tileXToLon(1223 + c / 256, 12), tileYToLat(1948 + f / 256, 12)]
const way = (osmId, highway, points, extra = {}) => ({ osmId, tags: { highway, ...extra }, coords: points.map(p => coord(...p)) })
const fixture = () => ({ width: 43, height: 35, tile: { z: 12, x0: 1223, y0: 1948, nx: 1, ny: 1 },
  data: Float32Array.from({ length: 43 * 35 }, (_, j) => 123.456 + 10 * Math.sin(j % 43 / 2) + 3 * Math.floor(j / 43)) })
const roads = () => [
  way(1, 'primary', [[1, 11], [16, 11.3], [40, 12]], { oneway: '-1' }),
  way(2, 'residential', [[19, 1], [18.7, 19], [20, 32]]),
  way(3, 'secondary', [[-1, 7], [20, 23], [44, 23]]),
  way(4, 'primary', [[1, 11], [40, 20]], { bridge: 'yes' }),
  way(5, 'footway', [[1, 11], [40, 20]]),
  way(6, 'primary', [[1, 11], [40, 20]], { tunnel: 'yes' }),
]
const dense = (rawDem, lines, opts) => {
  const dem = { ...rawDem, data: rawDem.data.slice() }
  tallar(dem, lines.map(l => ({ ...l, coords: subdividir(orientar(l.coords, l.tags.oneway)) })), opts)
  return dem
}

describe('DEM tallado disperso (sin regenerar public/data)', () => {
  it('lee las esquinas de teselas Terrarium y acota su caché sin perder precisión', () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'vialidad-sparse-dem-'))
    try {
      for (let t = 0; t < 2; t++) {
        const png = new PNG({ width: 256, height: 256 })
        for (let i = 0; i < 256 * 256; i++) {
          png.data[i * 4] = 128
          png.data[i * 4 + 1] = t * 100 + Math.floor(i / 256) % 100
          png.data[i * 4 + 2] = i % 256
          png.data[i * 4 + 3] = 255
        }
        writeFileSync(join(cacheDir, `12_${1223 + t}_1948.png`), PNG.sync.write(png))
      }
      const dem = createCachedRawDem({ tile: { z: 12, x0: 1223, y0: 1948, nx: 2, ny: 1 }, cacheDir, maxRawTiles: 1 })
      expect(dem.data[255 * 512 + 255]).toBe(Math.fround(55 + 255 / 256))
      expect(dem.data[255 * 512 + 256]).toBe(155)
      expect(dem.data[255 * 512 + 255]).toBe(Math.fround(55 + 255 / 256))
      expect(dem.stats.tilesRead).toBe(3)
      expect(dem.stats.peakResidentTiles).toBe(1)
      expect(() => { dem.data[0] = 100 }).toThrow('solo lectura')
    } finally { rmSync(cacheDir, { recursive: true, force: true }) }
  })

  it('reproduce cada Float32 del DEM completo, incluidos solapes, borde y vías invertidas', () => {
    const rawDem = fixture(), lines = roads(), expected = dense(rawDem, lines)
    const sparse = createSparseCarvedDem({ rawDem, lines, blockSize: 8, maxBlocks: 4 })
    const actual = Float32Array.from({ length: rawDem.data.length }, (_, j) => sparse.dem.data[j])
    expect(actual).toEqual(expected.data)
    expect(sparse.stats.peakResidentBlocks).toBeLessThanOrEqual(4)
    expect(sparse.stats.indexedWays).toBe(3)
  })

  it('conserva el perfil de toda la vía y la interpolación triangular de las consultas', () => {
    const rawDem = fixture(), lines = roads(), expected = dense(rawDem, lines)
    const sparse = createSparseCarvedDem({ rawDem, lines, blockSize: 4, maxBlocks: 2 })
    // Reemplazar las coords del llamador no cambia la captura original.
    lines[0].coords = [coord(0, 0), coord(1, 0)]
    for (const p of [[18.4, 11.8], [19.4, 20.6], [40.9, 33.1], [18.4, 11.8]]) {
      expect(sparse.alturaDe(...coord(...p))).toBe(alturaTriangulo(expected, ...coord(...p)))
    }
    expect(sparse.stats.peakResidentBlocks).toBeLessThanOrEqual(2)
  })

  it('indexa toda la banda configurada aunque exceda el bloque y no modifica el DEM original', () => {
    const rawDem = fixture(), original = rawDem.data.slice(), lines = roads()
    const carveOptions = { hombrillo: 180, transicion: Array(7).fill(250) }
    const expected = dense(rawDem, lines, carveOptions)
    const sparse = createSparseCarvedDem({ rawDem, lines, blockSize: 7, maxBlocks: 3, carveOptions })
    for (let j = 0; j < original.length; j += 7) expect(sparse.dem.data[j]).toBe(expected.data[j])
    expect(rawDem.data).toEqual(original)
  })

  it('las escrituras locales sobreviven a la expulsión de bloques y redondean como Float32', () => {
    const rawDem = fixture()
    const sparse = createSparseCarvedDem({ rawDem, lines: roads(), blockSize: 4, maxBlocks: 1 })
    sparse.dem.data[12] = 432.123456789
    void sparse.dem.data[rawDem.data.length - 1]
    expect(sparse.dem.data[12]).toBe(Math.fround(432.123456789))
    expect(sparse.stats.writtenPosts).toBe(1)
    sparse.clear()
    expect(sparse.stats.writtenPosts).toBe(0)
    expect(sparse.dem.data[12]).toBe(dense(rawDem, roads()).data[12])
  })
})
