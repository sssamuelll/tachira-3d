import { expect, test } from 'vitest'
import { verifyRoadStructures } from '../lib/verify-structures.mjs'
import { makeEnuFrame, geodeticToEnu } from '../lib/enu.mjs'
import { lineLengthMeters } from '../lib/geo.mjs'
import { packRoads } from '../lib/pack.mjs'

function fixture () {
  const frame = makeEnuFrame(8.021973, -71.901563, 0)
  const coords = [0, 1, 2, 3].map(i => [-72.23 + i * 0.001, 7.76])
  const point = (i, h = 100 + i * 4) => geodeticToEnu(frame, coords[i][1], coords[i][0], h)
  const lines = [
    { enu: [point(0), point(1), point(2)] },
    { enu: [point(3), point(2)] }, // Segunda way orientada contra la cadena.
    { hidden: true, enu: [point(0, 50), point(1, 50)] },
  ]
  const meta = { count: 3, ways: [
    { osmId: 10, bridge: 'yes' }, { osmId: 20, bridge: 'yes' }, { osmId: 30, tunnel: 'yes' },
  ] }
  const report = {
    version: 1, bridgeWays: 2, interpolatedWays: 2, clearWays: 1, penetratingWays: 1,
    clearanceToleranceM: 0.2, excludedWays: [], tunnels: [{ osmId: 30 }],
    wayCount: 3, segmentCount: 3,
    chains: [{
      id: 10, wayIds: [10, 20], lengthM: lineLengthMeters(coords),
      endpoints: [[...coords[0], 100], [...coords[3], 112]],
      ways: [
        { osmId: 10, startHeightM: 100, endHeightM: 108, minClearanceM: -2, maxClearanceM: 5, vertices: 3 },
        { osmId: 20, startHeightM: 112, endHeightM: 108, minClearanceM: 0, maxClearanceM: 5, vertices: 2 },
      ],
    }],
  }
  const run = (changes = {}) => {
    const { positions, segIds, index, nrm } = packRoads(lines)
    return verifyRoadStructures({ meta, report, frame, positions, segIds, index, normals: nrm, ...changes })
  }
  return { lines, meta, report, frame, point, run }
}

const failures = result => result.checks.filter(c => !c.ok).map(c => c.code)

test('acepta cadena invertida en Float32 y declara penetraciones sin fallar', () => {
  const result = fixture().run()
  expect(failures(result)).toEqual([])
  expect(result.stats.penetratingWays).toBe(1)
  expect(result.stats.checkedVertices).toBe(5)
  expect(result.stats.worstHeightErrorM).toBeLessThan(0.05)
})

test('rechaza un túnel que vuelve a aportar geometría', () => {
  const f = fixture()
  f.lines[2].hidden = false
  f.report.segmentCount = 4
  expect(failures(f.run())).toContain('tunnels-hidden')
})

test('detecta puente redrapeado aunque conserva ambos estribos', () => {
  const f = fixture()
  f.lines[0].enu[1] = f.point(1, 70)
  expect(failures(f.run())).toContain('bridge-profile')
})

test('detecta rampas por way aun si el informe repite sus cotas quebradas', () => {
  const f = fixture()
  f.lines[0].enu[2] = f.point(2, 80)
  f.lines[1].enu[1] = f.point(2, 80)
  f.report.chains[0].ways[0].endHeightM = 80
  f.report.chains[0].ways[1].endHeightM = 80
  expect(failures(f.run())).toContain('bridge-profile')
})

test.each([
  ['inicio distinto de cero', [1, 2, 3, 3]],
  ['índice decreciente', [0, 3, 2, 3]],
  ['final fuera del buffer', [0, 2, 3, 4]],
  ['longitud incorrecta', [0, 2, 3]],
])('rechaza CSR con %s', (_, values) => {
  expect(failures(fixture().run({ index: new Uint32Array(values) }))).toContain('binary-layout')
})

test('rechaza IDs de segmento asignados a otra vía', () => {
  expect(failures(fixture().run({ segIds: new Float32Array([0, 1, 1]) }))).toContain('segment-ids')
})

test('rechaza NaN en posiciones', () => {
  const f = fixture()
  f.lines[0].enu[1][2] = NaN
  expect(failures(f.run())).toContain('finite-positions')
})

test('rechaza normales cuyo tamaño no corresponde a los segmentos', () => {
  expect(failures(fixture().run({ normals: new Int8Array(0) }))).toContain('binary-layout')
})

test('rechaza un puente omitido del informe', () => {
  const f = fixture()
  f.report.chains[0].ways.pop()
  f.report.chains[0].wayIds.pop()
  expect(failures(f.run())).toContain('bridge-coverage')
})

test('rechaza cotas no finitas del informe antes de comprobar la rasante', () => {
  const f = fixture()
  f.report.chains[0].endpoints[1][2] = NaN
  expect(failures(f.run())).toContain('finite-report')
})

test('rechaza una junta rota entre los segmentos de una misma way', () => {
  const f = fixture()
  const packed = packRoads(f.lines)
  packed.positions[6] += 1
  expect(failures(f.run({ positions: packed.positions }))).toContain('bridge-continuity')
})
