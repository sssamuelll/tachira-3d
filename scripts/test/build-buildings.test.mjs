import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { crearMuestreadorDem, nodosDem, indexarRegistros } from '../build-buildings.mjs'
import { encodeTerrarium } from '../lib/dem-tiles.mjs'
import { tileXToLon, tileYToLat } from '../lib/terrarium.mjs'

describe('horneado de edificios sobre DEM tallado', () => {
  it('un faceIndex del chunk identifica el edificio mediante rango de índices', () => {
    const records = indexarRegistros([
      { record: { id: 'way/10' }, positions: new Array(12), indices: [0, 1, 2, 0, 2, 3] },
      { record: { id: 'way/11' }, positions: new Array(9), indices: [0, 1, 2] },
    ])
    const hit = faceIndex => records.find(b => faceIndex * 3 >= b.geometry.indexStart && faceIndex * 3 < b.geometry.indexStart + b.geometry.indexCount)?.id
    expect(hit(1)).toBe('way/10')
    expect(hit(2)).toBe('way/11')
    expect(hit(3)).toBeUndefined()
    expect(records[1].geometry).toEqual({ vertexStart: 4, vertexCount: 3, indexStart: 6, indexCount: 3 })
  })

  it('lee PNG final y respeta su diagonal triangular, no interpolación bilineal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'building-dem-'))
    try {
      mkdirSync(join(dir, '12', '1228'), { recursive: true })
      const png = new PNG({ width: 257, height: 257 })
      for (let i = 0; i < 257 * 257; i++) { const [r, g, b] = encodeTerrarium(i === 258 ? 80 : 0); png.data.set([r, g, b, 255], i * 4) }
      writeFileSync(join(dir, '12', '1228', '1956.png'), PNG.sync.write(png))
      const sample = crearMuestreadorDem(dir)
      expect(sample(tileYToLat(1956 + 0.2 / 256, 12), tileXToLon(1228 + 0.2 / 256, 12))).toBeCloseTo(0, 5)
      expect(sample(tileYToLat(1956 + 0.8 / 256, 12), tileXToLon(1228 + 0.8 / 256, 12))).toBeCloseTo(48, 4)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('declara ambos nodos cuando la huella cruza el borde z15', () => {
    const p = (x, y) => [tileXToLon(x, 15), tileYToLat(y, 15)]
    const b = { polygons: [{ outer: [p(9824.99, 15648.2), p(9825.01, 15648.2), p(9825.01, 15648.3), p(9824.99, 15648.3)], holes: [] }] }
    expect(nodosDem(b)).toEqual(['15/9824/15648', '15/9825/15648'])
  })
})
