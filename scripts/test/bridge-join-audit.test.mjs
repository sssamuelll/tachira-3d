import { describe, expect, it } from 'vitest'
import { makeEnuFrame, geodeticToEnu } from '../lib/enu.mjs'
import { packRoads } from '../lib/pack.mjs'
import { auditBridgeJoins, compareBridgeBakes, distribution } from '../lib/bridge-join-audit.mjs'

const frame = makeEnuFrame(0, 0, 0)
const road = (id, nodes, points, bridge = false) => ({ id, type: 'way', nodes, points,
  geometry: points.map(([lon, lat]) => ({ lon, lat })),
  tags: { highway: 'primary', ...(bridge ? { bridge: 'yes' } : {}) } })
function fixture (extra = [], tweak = () => {}) {
  const ways = [road(1, [10, 11], [[0, 0, 100], [0.001, 0, 110]], true),
    road(2, [9, 10], [[-0.001, 0, 90], [0, 0, 100]]),
    road(3, [11, 12], [[0.001, 0, 110], [0.002, 0, 120]]), ...extra]
  tweak(ways)
  const packed = packRoads(ways.map(w => ({ enu: w.points.map(([lon, lat, h]) => geodeticToEnu(frame, lat, lon, h)) })))
  return { raw: { elements: ways }, data: { ...packed, frame,
    meta: { ways: ways.map(w => ({ osmId: w.id, ...w.tags })) },
    report: { chains: [{ id: 1, wayIds: [1], endpoints: [[0, 0, 100], [0.001, 0, 110]],
      ways: [{ osmId: 1, minClearanceM: 0 }] }], penetratingWays: 0, clearanceToleranceM: 0.2 } } }
}

describe('independent bridge join audit', () => {
  it('admite sustituir solo los corredores simulados sin empaquetar toda la red', () => {
    const { data, raw } = fixture()
    data.pointsOf = id => raw.elements.find(w => w.id === id).points.map(p =>
      id === 3 ? [p[0], p[1], p[2] + .5] : p)
    expect(auditBridgeJoins(data, raw).heightStepM.max).toBeCloseTo(.5, 7)
  })

  it('uses signed travel slopes: constant uphill grade has zero kink at both ends', () => {
    const { data, raw } = fixture()
    const result = auditBridgeJoins(data, raw)
    expect(result.expectedAbutments).toBe(2)
    expect(result.measuredAbutments).toBe(2)
    expect(result.slopeBreakPp.max).toBeLessThan(0.0001)
    expect(result.heightStepM.max).toBe(0)
  })

  it('is independent of OSM way direction', () => {
    const { data, raw } = fixture([], ways => {
      for (const way of ways) { way.nodes.reverse(); way.geometry.reverse(); way.points.reverse() }
    })
    expect(auditBridgeJoins(data, raw).slopeBreakPp.max).toBeLessThan(0.0001)
  })

  it('detects a peak rather than subtracting unsigned slope magnitudes', () => {
    const { data, raw } = fixture([], ways => { ways[2].points[1][2] = 100 })
    const result = auditBridgeJoins(data, raw)
    expect(result.endpoints[1].breakPp).toBeGreaterThan(17)
    expect(result.endpoints[0].breakPp).toBeLessThan(0.0001)
  })

  it('measures an actual binary step even when structure report claims continuity', () => {
    const { data, raw } = fixture([], ways => { ways[2].points[0][2] += 0.3 })
    expect(auditBridgeJoins(data, raw).heightStepM.max).toBeCloseTo(0.3, 4)
  })

  it('does not invent topology from a coincident coordinate with another node ID', () => {
    const { data, raw } = fixture([], ways => { ways[2].nodes[0] = 99 })
    const result = auditBridgeJoins(data, raw)
    expect(result.expectedAbutments).toBe(2)
    expect(result.measuredAbutments).toBe(1)
    expect(result.missingAbutments).toBe(1)
    expect(result.endpoints[1].breakPp).toBeNull()
    expect(result.slopeBreakPp.count).toBe(1)
  })

  it('includes both interior-node branches and selects the worst', () => {
    const extra = road(4, [13, 10, 14], [[0, -0.001, 100], [0, 0, 100], [0, 0.001, 125]])
    const { data, raw } = fixture([extra])
    const endpoint = auditBridgeJoins(data, raw).endpoints[0]
    expect(endpoint.branchCount).toBe(3)
    expect(endpoint.candidates[0].osmId).toBe(4)
    expect(endpoint.breakPp).toBeGreaterThan(31)
  })

  it('uses explicit missing values rather than zero padding the percentile', () => {
    expect(distribution([null, 1, 3, null])).toEqual({ count: 2, max: 3, median: 2, p99: 3 })
  })

  it('compares every baked bridge coordinate and every per-way clearance', () => {
    const before = fixture().data
    const after = fixture([], ways => { ways[0].points[0][2] += 0.4 }).data
    after.report.chains[0].ways[0].minClearanceM = -0.4
    after.report.penetratingWays = 1
    const result = compareBridgeBakes(before, after)
    expect(result.changedBridgeWays).toEqual([1])
    expect(result.unchangedWays).toBe(2)
    expect(result.maxBridgeVertexMovementM).toBeCloseTo(0.4, 4)
    expect(result.newlyPenetratingWays).toEqual([1])
    expect(result.clearanceRegressions).toEqual([{ osmId: 1, beforeM: 0, afterM: -0.4 }])
  })
})
