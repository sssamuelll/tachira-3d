import { describe, expect, it } from 'vitest'
import { auditarContactosPuente, tallarAccesos, redrapearCrucesTerreno } from '../lib/approach-terrain.mjs'
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

  it('lleva el terreno a la rasante declarada en un cruce y conserva el puente fuera de la loma', () => {
    const dem = fixture(), crossing = point(12.4, 20)
    const fill = { ...corridor(120), terrainCrossings: [
      { nodeId: 2, point: crossing, heightM: 120 },
    ] }
    const stats = tallarAccesos(dem, [fill], topology([point(12.4, 15), point(12.4, 25)]))

    expect(alturaTriangulo(dem, ...crossing)).toBeCloseTo(120, 4)
    expect(alturaTriangulo(dem, ...point(12.4, 15))).toBeLessThanOrEqual(100 + 1e-7)
    expect(alturaTriangulo(dem, ...point(12.4, 25))).toBeLessThanOrEqual(100 + 1e-7)
    expect(stats.terrainCrossings).toEqual([expect.objectContaining({
      nodeId: 2, targetHeightM: 120, terrainHeightM: 120,
    })])
  })

  it('respeta dos rasantes distintas dentro de la misma celda sin atravesar sus tableros', () => {
    const dem = fixture()
    const west = point(12.5, 20.7), east = point(12.8, 20.7)
    const center = point(13.2, 19.2)
    const centerBefore = alturaTriangulo(dem, ...center)
    const deckSamples = (x, h) => [
      { point: point(x, 19.7), heightM: h - .5 },
      { point: point(x, 20.7), heightM: h },
      { point: point(x, 21.7), heightM: h + .5 },
    ]
    const crossing = (nodeId, point, heightM, samples) =>
      ({ nodeId, point, heightM, deckSamples: samples })
    const westCrossing = crossing(2, west, 120, deckSamples(12.5, 120))
    const eastCrossing = crossing(3, east, 121, deckSamples(12.8, 121))
    const corridors = [
      { ...corridor(120), terrainCrossings: [westCrossing] },
      { ...corridor(121), terrainCrossings: [eastCrossing] },
    ]
    const bridges = { chains: [
      [{ line: { coords: [point(12.5, 18), point(12.5, 23)] } }],
      [{ line: { coords: [point(12.8, 18), point(12.8, 23)] } }],
    ] }

    const stats = tallarAccesos(dem, corridors, bridges, { fixedCenters: [
      { id: 'piece', lon: center[0], lat: center[1] },
    ] })

    expect(alturaTriangulo(dem, ...west)).toBeCloseTo(120, 5)
    expect(alturaTriangulo(dem, ...east)).toBeCloseTo(121, 5)
    expect(alturaTriangulo(dem, ...center)).toBeCloseTo(centerBefore, 5)
    expect(stats.centerGroundChanges[0].id).toBe('piece')
    expect(Math.abs(stats.centerGroundChanges[0].changeM)).toBeLessThan(1e-5)
    for (const [x, h] of [[12.5, 120], [12.8, 121]]) {
      for (let y = 20; y <= 21; y += .05) {
        const deck = h + .5 * (y - 20.7)
        expect(alturaTriangulo(dem, ...point(x, y))).toBeLessThanOrEqual(deck + 1e-5)
      }
    }
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

it('redrapea solo las calles del cruce sobre el DEM ya corregido', () => {
  const m = 1 / 111319.490793
  const lines = [
    { osmId: 1, coords: [[0, 0], [10 * m, 0], [20 * m, 0]] },
    { osmId: 2, coords: [[0, m], [10 * m, m]] },
  ]
  const approaches = { byWay: new Map([
    [1, { heights: [90, 90, 90], ownSegments: [true, true] }],
    [2, { heights: [80, 80], ownSegments: [true] }],
  ]), report: { terrainCrossings: [{ roadWayIds: [1] }], ownRanges: [
    { osmId: 1, ranges: [[0, 2]] },
  ] } }

  const ground = lon => {
    const x = lon / m
    return 100 + x / 10 + Math.sin(Math.PI * x / 10)
  }
  const stats = redrapearCrucesTerreno(lines, approaches, ground)

  const profile = approaches.byWay.get(1)
  expect(lines[0].coords.length).toBeGreaterThan(3)
  expect(profile.heights).toHaveLength(lines[0].coords.length)
  expect(profile.ownSegments).toHaveLength(lines[0].coords.length - 1)
  expect(profile.ownSegments.every(Boolean)).toBe(true)
  expect(profile.heights).toEqual(lines[0].coords.map(([lon, lat]) => ground(lon, lat)))
  let maxDeviationM = 0
  for (let i = 1; i < lines[0].coords.length; i++) for (let k = 0; k <= 20; k++) {
    const t = k / 20, a = lines[0].coords[i - 1], b = lines[0].coords[i]
    const lon = a[0] + (b[0] - a[0]) * t
    const road = profile.heights[i - 1] + (profile.heights[i] - profile.heights[i - 1]) * t
    maxDeviationM = Math.max(maxDeviationM, Math.abs(road - ground(lon, 0)))
  }
  expect(maxDeviationM).toBeLessThan(.025)
  expect(approaches.byWay.get(2).heights).toEqual([80, 80])
  expect(stats.ways).toBe(1)
  expect(stats.vertices).toBe(lines[0].coords.length)
  expect(stats.insertedVertices).toBe(lines[0].coords.length - 3)
  expect(stats.maxHeightChangeM).toBeGreaterThanOrEqual(11)
  expect(approaches.report.ownRanges[0].ranges).toEqual([[0, lines[0].coords.length - 1]])
})

it('limita el contacto del terreno a la celda exacta del cruce', () => {
  const dem = fixture(), crossing = point(12.4, 20.4)
  const line = { osmId: 7, coords: [point(12.4, 18.2), point(12.4, 22.2)] }
  const topology = { chains: [[{ line }]] }
  const structures = { byWay: new Map([[7, { heights: [100, 100] }]]) }
  const crossings = [{ point: crossing, bridgeWayIds: [7] }]
  const cellOf = ([lon, lat]) => {
    const u = (tileXf(lon, 12) - 1223) * 256
    const v = (tileYf(lat, 12) - 1948) * 256
    return `${Math.floor(u)}/${Math.floor(v)}`
  }
  const audit = auditarContactosPuente(dem, topology, structures, crossings, {
    stepM: 1,
    ground: (lon, lat) => cellOf([lon, lat]) === '12/20' ? 100.001 : 101,
  })

  expect(audit.ways[0].minLocalClearanceM).toBeCloseTo(-.001, 8)
  expect(audit.violations).toEqual([expect.objectContaining({
    osmId: 7, reason: 'outside-crossing-penetration', clearanceM: -1,
  })])
})
