import { describe, it, expect } from 'vitest'
import { corridorInfluencePosts, packedGeodeticPoints, structuralNetworkGrade } from '../lib/bridge-audit-input.mjs'
import { tallar } from '../lib/carving.mjs'
import { makeEnuFrame, geodeticToEnu } from '../lib/enu.mjs'
import { bakedWayPoints } from '../lib/bridge-join-audit.mjs'
import { tileXToLon, tileYToLat } from '../lib/terrarium.mjs'
import { packRoads } from '../lib/pack.mjs'

// Fixtures sintéticas: ninguna prueba requiere regenerar public/data.
describe('entrada de la simulación de empalmes', () => {
  it('selecciona todos los posts del corredor y su banda, también en bordes', () => {
    const dem = { tile: { z: 12, x0: 1223, y0: 1948 }, width: 32, height: 24,
      data: Float32Array.from({ length: 32 * 24 }, (_, i) => 100 + (i % 11)) }
    const point = (x, y) => [tileXToLon(dem.tile.x0 + x / 256, 12), tileYToLat(dem.tile.y0 + y / 256, 12)]
    const corridors = [
      { tags: { highway: 'trunk', lanes: '4' }, coords: [point(.2, 1), point(9, 5), point(25, 22.8)],
        carvingHeights: [90, 91, 92], carvingWeights: [1, 1, 0] },
      { tags: { highway: 'residential' }, coords: [point(31, 4), point(15, 20)], carvingHeights: [95, 96] },
    ]
    const full = { ...dem, data: dem.data.slice() }, selected = { ...dem, data: dem.data.slice() }
    const posts = corridorInfluencePosts(dem, corridors)
    tallar(full, corridors)
    tallar(selected, corridors, { posts })
    expect(selected.data).toEqual(full.data)
    expect(posts.size).toBeLessThan(dem.data.length)
    expect(full.data.some((h, i) => h !== dem.data[i])).toBe(true)
  })

  it('mide exactamente los Float32 del empaquetado real, sin redondear alturas antes', () => {
    const frame = makeEnuFrame(8.021973, -71.901563, 0)
    const coords = [[-72.234359, 7.7616799], [-72.234255, 7.7626986], [-72.2340983, 7.7637268]]
    const heights = [791.123456789, 795.432198765, 800.012345678]
    const packed = packRoads([{ enu: coords.map(([lon, lat], i) => geodeticToEnu(frame, lat, lon, heights[i])) }])
    const actual = bakedWayPoints({ ...packed, frame }, 0)
    expect(packedGeodeticPoints(coords, heights, frame)).toEqual(actual)
  })

  it('la pendiente de red usa el mismo filtro de 5 m y clases que verify', () => {
    const frame = makeEnuFrame(8, -72, 0)
    const data = { frame, meta: { ways: [
      { osmId: 1, highway: 'trunk' }, { osmId: 2, highway: 'primary' }, { osmId: 3, highway: 'residential' },
    ] }, index: new Uint32Array([0, 2, 3, 4]), positions: new Float32Array([
      0, 0, 0, 4, 90, 0, // Excluido por corto.
      4, 90, 0, 9, 91, 0, // Incluido exactamente en el límite: 20 %.
      0, 0, 0, 10, 1, 0, // 10 %.
      0, 0, 0, 10, 90, 0, // Excluido por clase.
    ]) }
    expect(structuralNetworkGrade(data)).toEqual({ count: 2, maxPct: 20, p99Pct: 20, thresholdPct: 30, passes: false })
    const override = packedGeodeticPoints([[-72, 8], [-71.9999, 8]], [0, 0], frame)
    const replaced = structuralNetworkGrade(data, new Map([[1, override]]))
    expect(replaced.count).toBe(2)
    expect(replaced.maxPct).toBe(10)
  })
})
