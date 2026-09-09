import { enuToGeodetic } from './enu.mjs'
import { lineLengthMeters } from './geo.mjs'
import { esPuente, esTunel } from './structures.mjs'
import { tagsViales } from './road-tag-overrides.mjs'

// Las pendientes se miden en el primer segmento REAL del binario a cada
// lado de la junta, en altura geodésica (no el eje Y regional de Three).
// Topología exclusivamente por ID OSM. La distancia solo localiza ese nodo
// ya identificado dentro de su propia vía, con tolerancia Float32 de 5 cm.
export const NODE_TOLERANCE_M = 0.05

export function distribution (values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const percentile = p => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null
  return { count: sorted.length, max: sorted.at(-1) ?? null,
    median: !sorted.length ? null : sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    p99: percentile(0.99) }
}

export function bakedWayPoints ({ positions, index, frame }, wayIndex) {
  const first = index[wayIndex], last = index[wayIndex + 1]
  if (first === last) return []
  const geo = offset => {
    const [lat, lon, height] = enuToGeodetic(frame,
      positions[offset], -positions[offset + 2], positions[offset + 1])
    return [lon, lat, height]
  }
  const points = [geo(first * 6)]
  for (let s = first; s < last; s++) points.push(geo(s * 6 + 3))
  return points
}

const planarGap = (a, b) => lineLengthMeters([a, b])
const grade = (from, to) => (to[2] - from[2]) / planarGap(from, to) * 100

export function auditBridgeJoins (data, raw) {
  const rawWays = raw.elements
    .filter(w => w.type === 'way' && Array.isArray(w.nodes) && Array.isArray(w.geometry))
    .map(w => ({ ...w, tags: tagsViales(w) }))
  const rawById = new Map(rawWays.map(w => [w.id, w]))
  const bakedById = new Map(data.meta.ways.map((w, i) => [w.osmId, i]))
  const bridgeNodes = new Set(rawWays.filter(w => esPuente(w.tags ?? {})).flatMap(w => w.nodes))
  const atNode = new Map()
  for (const way of rawWays) for (const node of new Set(way.nodes)) {
    if (!bridgeNodes.has(node)) continue
    if (!atNode.has(node)) atNode.set(node, [])
    atNode.get(node).push(way)
  }
  const cached = new Map()
  const pointsOf = id => {
    if (!cached.has(id)) cached.set(id, data.pointsOf ? data.pointsOf(id) : bakedWayPoints(data, bakedById.get(id)))
    return cached.get(id)
  }
  const endpoints = []
  for (const chain of data.report.chains) for (let side = 0; side < 2; side++) {
    const target = chain.endpoints[side]
    const bridgeId = side === 0 ? chain.wayIds[0] : chain.wayIds.at(-1)
    const rawBridge = rawById.get(bridgeId)
    const rawEnd = [0, rawBridge.nodes.length - 1].find(i =>
      planarGap(target, [rawBridge.geometry[i].lon, rawBridge.geometry[i].lat]) < NODE_TOLERANCE_M)
    if (rawEnd === undefined) throw new Error(`No se localizó extremo OSM ${chain.id}/${side}`)
    const nodeId = rawBridge.nodes[rawEnd]
    const bridgePoints = pointsOf(bridgeId)
    const start = planarGap(bridgePoints[0], target) < planarGap(bridgePoints.at(-1), target)
    const bridgeEnd = start ? bridgePoints[0] : bridgePoints.at(-1)
    const bridgeNext = start ? bridgePoints[1] : bridgePoints.at(-2)
    const bridgeInGradePct = grade(bridgeEnd, bridgeNext)
    const candidates = [], unavailable = []
    for (const way of atNode.get(nodeId) ?? []) {
      if (esPuente(way.tags ?? {})) continue
      if (esTunel(way.tags ?? {})) { unavailable.push({ osmId: way.id, reason: 'hidden-tunnel' }); continue }
      if (!bakedById.has(way.id)) { unavailable.push({ osmId: way.id, reason: 'not-baked' }); continue }
      const points = pointsOf(way.id)
      if (!points.length) { unavailable.push({ osmId: way.id, reason: 'no-visible-segments' }); continue }
      const matches = points.map((p, i) => planarGap(p, target) < NODE_TOLERANCE_M ? i : -1).filter(i => i >= 0)
      if (!matches.length) { unavailable.push({ osmId: way.id, reason: 'node-not-found-in-binary' }); continue }
      for (const i of matches) for (const direction of [-1, 1]) {
        const next = points[i + direction]
        if (!next || planarGap(points[i], next) < 1e-6) continue
        const accessOutGradePct = grade(points[i], next)
        candidates.push({ osmId: way.id, vertex: i, direction, highway: way.tags?.highway,
          accessOutGradePct, breakPp: Math.abs(bridgeInGradePct + accessOutGradePct),
          stepM: Math.abs(bridgeEnd[2] - points[i][2]),
          accessSegmentLengthM: planarGap(points[i], next) })
      }
    }
    candidates.sort((a, b) => b.breakPp - a.breakPp || a.osmId - b.osmId || a.direction - b.direction)
    endpoints.push({ chainId: chain.id, side, nodeId, bridgeId, lon: target[0], lat: target[1],
      bridgeInGradePct, bridgeSegmentLengthM: planarGap(bridgeEnd, bridgeNext),
      branchCount: candidates.length, breakPp: candidates[0]?.breakPp ?? null,
      stepM: candidates.length ? Math.max(...candidates.map(c => c.stepM)) : null,
      status: candidates.length ? candidates.length > 1 ? 'multiple-access-branches-worst' : 'one-access-branch'
        : unavailable.length ? 'no-measurable-visible-access' : 'no-connected-nonbridge-way',
      candidates, unavailable })
  }
  return { method: 'Exact OSM node connectivity; first baked segment on each side; geodetic height; absolute sum of grades pointing away from abutment, percentage points; worst access branch; p99 nearest rank',
    chains: data.report.chains.length, expectedAbutments: data.report.chains.length * 2,
    measuredAbutments: endpoints.filter(e => e.breakPp !== null).length,
    missingAbutments: endpoints.filter(e => e.breakPp === null).length,
    branchingAbutments: endpoints.filter(e => e.branchCount > 1).length,
    slopeBreakPp: distribution(endpoints.map(e => e.breakPp)),
    heightStepM: distribution(endpoints.map(e => e.stepM)), endpoints }
}

export function compareBridgeBakes (before, after) {
  const beforeIds = new Map(before.meta.ways.map((w, i) => [w.osmId, i]))
  const changedWays = [], changedBridgeWays = [], unchangedWays = []
  let maxBridgeVertexMovementM = 0
  for (let j = 0; j < after.meta.ways.length; j++) {
    const way = after.meta.ways[j], i = beforeIds.get(way.osmId)
    const a = before.positions.subarray(before.index[i] * 6, before.index[i + 1] * 6)
    const b = after.positions.subarray(after.index[j] * 6, after.index[j + 1] * 6)
    const unchanged = a.length === b.length && a.every((v, k) => v === b[k])
    if (unchanged) { unchangedWays.push(way.osmId); continue }
    changedWays.push(way.osmId)
    if (esPuente(way)) {
      changedBridgeWays.push(way.osmId)
      if (a.length !== b.length) maxBridgeVertexMovementM = Infinity
      else for (let k = 0; k < a.length; k += 3) maxBridgeVertexMovementM = Math.max(maxBridgeVertexMovementM,
        Math.hypot(a[k] - b[k], a[k + 1] - b[k + 1], a[k + 2] - b[k + 2]))
    }
  }
  const beforeClearance = new Map(before.report.chains.flatMap(c => c.ways).map(w => [w.osmId, w.minClearanceM]))
  const afterWays = after.report.chains.flatMap(c => c.ways)
  const clearanceRegressions = afterWays.filter(w => w.minClearanceM < beforeClearance.get(w.osmId) - 1e-8)
    .map(w => ({ osmId: w.osmId, beforeM: beforeClearance.get(w.osmId), afterM: w.minClearanceM }))
  return { comparedWays: after.meta.ways.length, unchangedWays: unchangedWays.length, changedWays,
    changedBridgeWays, maxBridgeVertexMovementM, clearanceRegressions,
    beforePenetratingWays: before.report.penetratingWays,
    afterPenetratingWays: after.report.penetratingWays,
    newlyPenetratingWays: afterWays.filter(w => {
      const previous = beforeClearance.get(w.osmId)
      return w.minClearanceM < -after.report.clearanceToleranceM &&
        (previous === undefined || previous >= -before.report.clearanceToleranceM)
    }).map(w => w.osmId) }
}
