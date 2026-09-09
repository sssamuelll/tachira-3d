import { describe, expect, it } from 'vitest'
import { encadenarPuentes, elevarPuentes, normalesTablero, regresionesGalibo } from '../lib/structures.mjs'
import { geodeticToEnu, makeEnuFrame } from '../lib/enu.mjs'
import { subdividir } from '../lib/subdividir.mjs'
import { orientar } from '../lib/road-meta.mjs'
import { lineLengthMeters } from '../lib/geo.mjs'

const line = (osmId, xs, nodes, tags = {}) => ({
  osmId, nodes, coords: xs.map(x => [x / 10000, 0]),
  tags: { highway: 'primary', bridge: 'yes', ...tags },
})
const resolve = (lines, height) => elevarPuentes(encadenarPuentes(lines), height)

describe('rasante de puentes completos', () => {
  it('no baja al fondo del valle en la junta entre ways invertidos', () => {
    const a = line(1, [0, 1, 2], [10, 11, 12])
    const b = line(2, [4, 3, 2], [14, 13, 12])
    const result = resolve([b, a], lon => lon === 0 || lon === 0.0004 ? 100 : 20)
    expect(result.byWay.get(1).heights).toEqual([100, 100, 100])
    expect(result.byWay.get(2).heights).toEqual([100, 100, 100])
    expect(result.report.chains).toHaveLength(1)
    expect(result.report.interpolatedWays).toBe(2)
  })

  it('interpola por distancia recorrida, no por cantidad de nodos ni cuerda', () => {
    const a = line(1, [0, 1, 4], [10, 11, 12])
    const heights = resolve([a], lon => 100 + lon * 100000).byWay.get(1).heights
    expect(heights[1]).toBeCloseTo(110, 6)
    a.coords = [[0, 0], [0.0001, 0.0001], [0.0004, 0]]
    const h = resolve([a], lon => 100 + lon * 100000).byWay.get(1).heights
    const t = lineLengthMeters(a.coords.slice(0, 2)) / lineLengthMeters(a.coords)
    expect(h[1]).toBeCloseTo(100 + 40 * t, 8)
  })

  it('alinea las alturas después de subdividir e invertir oneway=-1', () => {
    const a = line(1, [0, 10], [10, 11], { oneway: '-1' })
    const topology = encadenarPuentes([a])
    a.coords = subdividir(orientar(a.coords, a.tags.oneway))
    const heights = elevarPuentes(topology, lon => 100 + lon * 10000).byWay.get(1).heights
    expect(heights).toHaveLength(a.coords.length)
    expect(heights[0]).toBe(110)
    expect(heights.at(-1)).toBe(100)
    for (let i = 0; i < heights.length; i++) expect(heights[i]).toBeCloseTo(100 + a.coords[i][0] * 10000, 7)
  })

  it('mantiene independientes dos calzadas paralelas con sus propios estribos', () => {
    const a = line(1, [0, 1, 2], [10, 11, 12])
    const b = line(2, [0, 1, 2], [20, 21, 22])
    b.coords = b.coords.map(([x]) => [x, 0.00003])
    const { byWay, report } = resolve([a, b], (lon, lat) => 100 + lat * 100000)
    expect(report.chains).toHaveLength(2)
    expect(byWay.get(1).heights).toEqual([100, 100, 100])
    expect(byWay.get(2).heights).toEqual([103, 103, 103])
  })

  it('usa layer para separar cadenas, sin convertir capas en metros', () => {
    const a = line(1, [0, 1], [10, 11], { layer: '1' })
    const b = line(2, [1, 2], [11, 12], { layer: '2' })
    const { byWay, report } = resolve([a, b], () => 100)
    expect(report.chains).toHaveLength(2)
    expect(byWay.get(2).heights).toEqual([100, 100])
  })

  it('no toma un tramo sin bridge como parte del puente por compartir nombre', () => {
    const a = line(1, [0, 1], [10, 11], { name: 'Viaducto' })
    const b = line(2, [1, 2], [11, 12], { bridge: 'no', name: 'Viaducto' })
    const c = line(3, [2, 3], [12, 13], { name: 'Viaducto' })
    const { byWay, report } = resolve([a, b, c], () => 100)
    expect(byWay.has(2)).toBe(false)
    expect(report.chains).toHaveLength(2)
  })

  it('reporta ramificaciones completas en vez de elegir una continuación arbitraria', () => {
    const roads = [line(1, [0, 1], [10, 11]), line(2, [1, 2], [11, 12]), line(3, [1, 3], [11, 13])]
    const { byWay, report } = resolve(roads, () => 100)
    expect(byWay.size).toBe(0)
    expect(report.excludedWays.map(w => w.reason)).toEqual(['branched', 'branched', 'branched'])
  })

  it('detecta una conexión al interior de otro way y no ancla sobre esa junta', () => {
    const { byWay, report } = resolve([line(1, [0, 1, 2], [10, 11, 12]), line(2, [1, 3], [11, 13])], () => 100)
    expect(byWay.size).toBe(0)
    expect(report.excludedWays.every(w => w.reason === 'interior-junction')).toBe(true)
  })

  it('reporta anillos sin inventar estribos', () => {
    const { byWay, report } = resolve([line(1, [0, 1, 0], [10, 11, 10])], () => 100)
    expect(byWay.size).toBe(0)
    expect(report.excludedWays[0].reason).toBe('closed')
  })

  it('no eleva un vado ni una vía marcada bridge=no', () => {
    const { byWay, report } = resolve([line(1, [0, 1], [10, 11], { bridge: 'low_water_crossing' }), line(2, [0, 1], [20, 21], { bridge: 'no' })], () => 100)
    expect(byWay.size).toBe(0)
    expect(report.bridgeWays).toBe(1)
    expect(report.excludedWays).toEqual([{ osmId: 1, reason: 'low-water-crossing' }])
  })

  it('detecta relieve que atraviesa la cuerda ENTRE nodos sin forzar la cota', () => {
    const a = line(1, [0, 10], [10, 11])
    const { byWay, report } = resolve([a], lon => lon > 0.0004 && lon < 0.0006 ? 120 : 100)
    expect(byWay.get(1).heights).toEqual([100, 100])
    expect(report.chains[0].ways[0].minClearanceM).toBe(-20)
    expect(report.penetratingWays).toBe(1)
  })

  it('no emite NaN cuando faltan cotas o el recorrido tiene longitud cero', () => {
    const missing = resolve([line(1, [0, 1], [10, 11])], () => NaN)
    expect(missing.byWay.size).toBe(0)
    expect(missing.report.excludedWays[0].reason).toBe('invalid-height')
    const zero = resolve([line(2, [0, 0], [20, 21])], () => 100)
    expect(zero.byWay.size).toBe(0)
    expect(zero.report.excludedWays[0].reason).toBe('zero-length')
  })
})

it('cada tramo conserva el ancho horizontal incluso en una curva con pendiente', () => {
  const coords = [[-72.23, 7.76], [-72.2295, 7.76], [-72.2295, 7.7605]]
  const frame = makeEnuFrame(8.021973, -71.901563, 0)
  const enu = coords.map(([lon, lat], i) => geodeticToEnu(frame, lat, lon, 800 + i * 2))
  const normals = normalesTablero(enu, coords, frame)
  expect(normals).toHaveLength(coords.length - 1)
  for (let i = 0; i < coords.length - 1; i++) for (let end = 0; end < 2; end++) {
    const a = enu[i], b = enu[i + 1]
    const tangent = [b[0] - a[0], b[2] - a[2], -(b[1] - a[1])]
    const n = normals[i][end]
    expect(Math.hypot(...n)).toBeCloseTo(1, 8)
    expect(n[1]).toBeGreaterThan(0.99)
    expect(n.reduce((sum, x, j) => sum + x * tangent[j], 0)).toBeCloseTo(0, 7)
    const side = [tangent[1] * n[2] - tangent[2] * n[1], tangent[2] * n[0] - tangent[0] * n[2], tangent[0] * n[1] - tangent[1] * n[0]]
    const [lon, lat] = coords[i + end]
    const u0 = geodeticToEnu(frame, lat, lon, 0), u1 = geodeticToEnu(frame, lat, lon, 1)
    const up = [u1[0] - u0[0], u1[2] - u0[2], -(u1[1] - u0[1])]
    expect(side.reduce((sum, x, j) => sum + x * up[j], 0)).toBeCloseTo(0, 6)
  }
})

it('acepta contacto a nivel sin ocultar una penetración ni otra regresión de gálibo', () => {
  const report = values => ({ chains: [{ ways: values.map(([osmId, minClearanceM]) => ({ osmId, minClearanceM })) }] })
  const before = report([[1, 5], [2, 5], [3, 5]])
  const after = report([[1, -.00002], [2, -.01], [3, 4]])

  expect(regresionesGalibo(before, after, new Set([1, 2]))).toEqual([
    { osmId: 2, beforeM: 5, afterM: -.01, reason: 'terrain-penetration' },
    { osmId: 3, beforeM: 5, afterM: 4, reason: 'clearance-regression' },
  ])
})
