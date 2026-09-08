import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'
import { waysToLines } from './lib/overpass.mjs'
import { encadenarPuentes, esPuente, esTunel, elevarPuentes } from './lib/structures.mjs'
import { capturarAccesos, empalmarAccesos } from './lib/bridge-approaches.mjs'
import { subdividir } from './lib/subdividir.mjs'
import { orientar } from './lib/road-meta.mjs'
import { lineLengthMeters } from './lib/geo.mjs'
import { auditBridgeJoins, distribution } from './lib/bridge-join-audit.mjs'
import { nivelDe, PENDIENTE_MAX } from './lib/carving.mjs'
import { crearDemTalladoDisperso } from './lib/sparse-carved-dem.mjs'
import { tallarAccesos } from './lib/approach-terrain.mjs'
import { readJson, loadBridgeBake,
  packedGeodeticPoints, wayPointReader, structuralNetworkGrade, corridorInfluencePosts } from './lib/bridge-audit-input.mjs'

// Solo lectura de public/data: el informe se escribe fuera de ese árbol.
// node --max-old-space-size=384 scripts/simulate-bridge-joins.mjs --output docs/empalmes-puentes-simulacion.json
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const baselineDirectory = option('--before', '.cache/bridge-joins/before')
const currentDirectory = option('--data', 'public/data')
const output = option('--output')
if (output) {
  const rel = relative(resolve('public/data'), resolve(output))
  if (!rel || !rel.startsWith('..') && !resolve(output).startsWith('\\\\')) throw new Error('La simulación no escribe dentro de public/data')
}
const started = performance.now()
const baseline = loadBridgeBake(baselineDirectory)
const current = loadBridgeBake(currentDirectory)
const raw = readJson(option('--osm', '.cache/vias.json'))
const baselinePoints = wayPointReader(baseline)
const baselineAudit = auditBridgeJoins(baseline, raw)
const currentAudit = auditBridgeJoins(current, raw)
console.log(`Baseline ${baselineAudit.measuredAbutments}/${baselineAudit.expectedAbutments}; actual ${currentAudit.measuredAbutments}/${currentAudit.expectedAbutments}`)

const lines = waysToLines(raw)
const topology = encadenarPuentes(lines)
const accesses = capturarAccesos(lines)
const sparse = crearDemTalladoDisperso({ tile: baseline.terrain.dem, lines,
  cacheDir: option('--dem-cache', '.cache/dem'), maxRawTiles: 8, maxBlocks: 128 })
const byId = new Map(lines.map(l => [l.osmId, l]))
let preparedWays = 0, preparedVertices = 0
// Exactamente orientar + subdividir(30 m) del horneado, pero de forma perezosa:
// la red que empalmarAccesos no visita conserva sus coordenadas OSM sin densificar.
for (const line of lines) {
  let coords = line.coords, prepared = false
  Object.defineProperty(line, 'coords', { enumerable: true, configurable: true,
    get () {
      if (!prepared) {
        coords = subdividir(orientar(coords, line.tags.oneway))
        prepared = true; preparedWays++; preparedVertices += coords.length
      }
      return coords
    }, set (value) { coords = value; prepared = true } })
}
const ground = sparse.alturaDe
console.log('DEM baseline exacto: solo bloques consultados alrededor de puentes')
const initial = elevarPuentes(topology, ground)
const originalById = new Map(baseline.report.chains.map(c => [c.id, c]))
const reconstruction = { endpointErrorsM: distribution(initial.report.chains.flatMap(c => c.endpoints.map((p, i) => Math.abs(p[2] - originalById.get(c.id).endpoints[i][2])))),
  clearanceErrorsM: distribution(initial.report.chains.flatMap(c => c.ways.map(w => Math.abs(w.minClearanceM - originalById.get(c.id).ways.find(b => b.osmId === w.osmId).minClearanceM)))),
  penetratingWays: initial.report.penetratingWays }
if (reconstruction.endpointErrorsM.max > 1e-7 || reconstruction.clearanceErrorsM.max > 1e-7) {
  throw new Error(`El DEM reconstruido no coincide con el snapshot: ${JSON.stringify(reconstruction)}`)
}
console.log(`DEM comprobado; resolviendo acuerdos con ${preparedWays} ways preparados`)
const result = empalmarAccesos(lines, accesses, topology, initial, ground)
console.log(`${result.report.paths.length} acuerdos resueltos; midiendo Float32`)
const overrides = new Map()
for (const [id, value] of result.structures.byWay) overrides.set(id,
  packedGeodeticPoints(byId.get(id).coords, value.heights, baseline.frame))
for (const [id, value] of result.byWay) overrides.set(id,
  packedGeodeticPoints(byId.get(id).coords, value.heights, baseline.frame))
for (const [id, points] of overrides) {
  const original = baselinePoints(id)
  if (points.length === original.length && points.every((p, i) => p.every((v, j) => v === original[i][j]))) overrides.delete(id)
}
const simulated = { ...baseline, report: result.structures.report,
  pointsOf: id => overrides.get(id) ?? baselinePoints(id) }
const finalAudit = auditBridgeJoins(simulated, raw)
const measuredIds = audit => audit.endpoints.filter(e => e.breakPp !== null).map(e => `${e.chainId}/${e.side}`).sort()
if (JSON.stringify(measuredIds(baselineAudit)) !== JSON.stringify(measuredIds(finalAudit))) throw new Error('La simulación cambió el conjunto de estribos medibles')

const exactGradeViolations = [], packedGradeViolations = []
const internalBreaks = [], exteriorBreaks = []
const gradePct = (a, b) => (b[2] - a[2]) / lineLengthMeters([a, b]) * 100
for (const [id, value] of result.byWay) {
  const line = byId.get(id), points = overrides.get(id) ?? baselinePoints(id)
  const cap = PENDIENTE_MAX[nivelDe(line.tags.highway)] || Infinity
  for (let i = 0; i < value.ownSegments.length; i++) if (value.ownSegments[i]) {
    const exact = Math.abs(value.heights[i + 1] - value.heights[i]) / lineLengthMeters([line.coords[i], line.coords[i + 1]])
    const packed = Math.abs(points[i + 1][2] - points[i][2]) / lineLengthMeters([points[i], points[i + 1]])
    if (exact > cap + 1e-7) exactGradeViolations.push({ osmId: id, segment: i, grade: exact, cap })
    if (packed > cap + .001) packedGradeViolations.push({ osmId: id, segment: i, grade: packed, cap })
  }
  for (let i = 1; i < points.length - 1; i++) {
    const left = value.ownSegments[i - 1], right = value.ownSegments[i]
    if (!left && !right) continue
    const valuePp = Math.abs(gradePct(points[i], points[i + 1]) - gradePct(points[i - 1], points[i]))
    const record = { osmId: id, vertex: i, lon: points[i][0], lat: points[i][1], breakPp: valuePp }
    const records = left && right ? internalBreaks : exteriorBreaks
    records.push(record)
  }
}
// En el cruce que termina un acuerdo el siguiente segmento puede vivir en
// otro way. Medir también todas esas ramas, no solamente vecinos del array.
const auditedNodes = new Set()
for (const path of result.report.paths) {
  const node = accesses.nodeOf.get(path.finish)
  if (node === undefined || auditedNodes.has(node)) continue
  auditedNodes.add(node)
  const branches = []
  for (const { line } of accesses.at.get(node) ?? []) {
    if (esPuente(line.tags) || esTunel(line.tags)) continue
    const points = overrides.get(line.osmId) ?? baselinePoints(line.osmId)
    for (let i = 0; i < points.length; i++) {
      if (lineLengthMeters([points[i], path.finish]) >= .05) continue
      for (const direction of [-1, 1]) {
        if (!points[i + direction]) continue
        const own = result.byWay.get(line.osmId)?.ownSegments[direction < 0 ? i - 1 : i] ?? false
        branches.push({ osmId: line.osmId, i, direction, own,
          grade: gradePct(points[i], points[i + direction]) })
      }
    }
  }
  for (let i = 0; i < branches.length; i++) for (let j = i + 1; j < branches.length; j++) {
    const a = branches[i], b = branches[j]
    if (a.osmId === b.osmId || !a.own && !b.own) continue
    const record = { nodeId: node, osmIds: [a.osmId, b.osmId], lon: path.finish[0], lat: path.finish[1], breakPp: Math.abs(a.grade + b.grade) }
    const records = a.own && b.own ? internalBreaks : exteriorBreaks
    records.push(record)
  }
}

const fixedEnds = new Map(result.structures.report.chains.map(c => [c.id, c.endpoints.map(p => p[2])]))
const posts = corridorInfluencePosts(sparse.dem, result.corridors)
console.log(`Terreno de accesos: ${posts.size} posts candidatos; sin rejilla global`)
const terrainAfter = tallarAccesos(sparse.dem, result.corridors, topology, { posts })
const finalClearance = elevarPuentes(topology, sparse.alturaDe, fixedEnds).report
const originalChains = new Map(baseline.report.chains.map(c => [c.id, c]))
const clearanceBounds = []
for (const c of result.structures.report.chains) {
  const before = originalChains.get(c.id)
  const delta = c.endpoints.map((p, i) => p[2] - before.endpoints[i][2])
  for (const w of before.ways) clearanceBounds.push({ osmId: w.osmId, beforeM: w.minClearanceM,
    guaranteedAfterMinM: w.minClearanceM + Math.min(...delta), minDeckRaiseM: Math.min(...delta), maxDeckRaiseM: Math.max(...delta) })
}
const summaries = audit => ({ chains: audit.chains, expectedAbutments: audit.expectedAbutments,
  measuredAbutments: audit.measuredAbutments, missingAbutments: audit.missingAbutments,
  slopeBreakPp: audit.slopeBreakPp, heightStepM: audit.heightStepM })
const pieces = [
  { name: 'Viejo', lat: 7.76271285, lon: -72.23427815, wayIds: [1203013290, 1203013292] },
  { name: 'Nuevo', lat: 7.76432975, lon: -72.2206145, wayIds: [74534876, 1211907172, 1223380938, 1223380940] },
]
const movement = pieces.map(piece => ({ ...piece, chains: result.structures.report.chains
  .filter(c => c.wayIds.some(id => piece.wayIds.includes(id))).map(c => {
    const before = originalChains.get(c.id)
    return { chainId: c.id, wayIds: c.wayIds, endChangesM: c.endpoints.map((p, i) => p[2] - before.endpoints[i][2]),
      midpointChangeM: c.heightMidM - before.heightMidM }
  }) }))
const report = {
  version: 1, mode: 'exact-sparse-baseline-dem; no bake; no writes to public/data',
  inputs: { baseline: baselineDirectory, current: currentDirectory, osm: option('--osm', '.cache/vias.json') },
  limitations: [
    'Se ejecuta el mismo código del horneado sobre los corredores de puente. El DEM base se reconstruye por bloques consultados con todos sus contribuyentes, mismo orden y acumulación Float32.',
    'La distribución posterior usa los mismos segmentos Float32 que produciría el horneado para los ways cambiados; los demás se leen del snapshot. public/data sigue sin actualizarse.',
    'No se abrió Chrome y queda pendiente revisar visualmente el terreno, las piezas y los acuerdos después de regenerar.',
  ],
  baselineReconstruction: reconstruction,
  before: summaries(baselineAudit), currentOnDisk: summaries(currentAudit), afterSimulation: summaries(finalAudit),
  missing: finalAudit.endpoints.filter(e => e.breakPp === null),
  endpoints: finalAudit.endpoints,
  approaches: { preparedWays, preparedVertices, changedWayCount: result.byWay.size,
    actuallyChangedWayCount: overrides.size, unchangedWayCount: baseline.meta.ways.length - overrides.size, paths: result.report.paths,
    skipped: result.report.skipped, deckChanges: result.report.deckChanges },
  terrainAfter,
  gradeConstraints: { exactNewSegmentViolations: exactGradeViolations,
    packedNewSegmentViolationsBeyondPoint1Pp: packedGradeViolations,
    internalSlopeBreakPp: distribution(result.report.paths.map(p => p.maxInternalBreak * 100)),
    actualInternalSlopeBreakPp: distribution(internalBreaks.map(p => p.breakPp)),
    actualExteriorSlopeBreakPp: distribution(exteriorBreaks.map(p => p.breakPp)),
    worstInternalBreaks: internalBreaks.sort((a, b) => b.breakPp - a.breakPp).slice(0, 20),
    worstExteriorBreaks: exteriorBreaks.sort((a, b) => b.breakPp - a.breakPp).slice(0, 20),
    bridgeSlopeLimitResiduals: result.structures.report.chains.flatMap(c => {
      const cap = Math.min(...c.wayIds.map(id => PENDIENTE_MAX[nivelDe(byId.get(id).tags.highway)] || Infinity))
      const grade = Math.abs(c.endpoints[1][2] - c.endpoints[0][2]) / c.lengthM
      return grade > cap + 1e-7 ? [{ chainId: c.id, grade, cap }] : []
    }) },
  structuralNetwork: { before: structuralNetworkGrade(baseline), currentOnDisk: structuralNetworkGrade(current),
    afterSimulation: structuralNetworkGrade(baseline, overrides) },
  clearance: { beforePenetratingWays: baseline.report.penetratingWays,
    currentOnDiskPenetratingWays: current.report.penetratingWays,
    afterSimulationPenetratingWays: finalClearance.penetratingWays,
    afterSimulationClearWays: finalClearance.clearWays,
    actualRegressions: finalClearance.chains.flatMap(c => c.ways.flatMap(w => {
      const before = originalById.get(c.id).ways.find(b => b.osmId === w.osmId)
      return w.minClearanceM < before.minClearanceM - 1e-7 ? [{ osmId: w.osmId, beforeM: before.minClearanceM, afterM: w.minClearanceM }] : []
    })),
    newlyPenetratingWays: finalClearance.chains.flatMap(c => c.ways.flatMap(w => {
      const before = originalById.get(c.id).ways.find(b => b.osmId === w.osmId)
      return w.minClearanceM < -.2 && before.minClearanceM >= -.2 ? [w.osmId] : []
    })),
    remainingPenetratingWays: finalClearance.chains.flatMap(c => c.ways.flatMap(w => {
      const before = originalById.get(c.id).ways.find(b => b.osmId === w.osmId)
      return w.minClearanceM < -.2 ? [{ osmId: w.osmId, beforeM: before.minClearanceM, afterM: w.minClearanceM }] : []
    })).sort((a, b) => a.afterM - b.afterM),
    guaranteedNonRegressingWays: clearanceBounds.filter(w => w.minDeckRaiseM >= -1e-8).length,
    afterOriginalDemConservativeUpperBoundPenetratingWays: clearanceBounds.filter(w => w.guaranteedAfterMinM < -.2).length,
    bounds: clearanceBounds },
  viaductDeckMovement: movement,
  sparseDem: sparse.stats,
  runtime: { seconds: (performance.now() - started) / 1000,
    peakRssMiB: process.resourceUsage().maxRSS > 0 ? +(process.resourceUsage().maxRSS / 1024).toFixed(1) : null,
    memoryMiB: Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [k, +(v / 1048576).toFixed(1)])) },
}
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify({ ...report, endpoints: undefined, missing: report.missing.map(e => ({ chainId: e.chainId, side: e.side, status: e.status })),
  approaches: { ...report.approaches, paths: report.approaches.paths.length, skipped: report.approaches.skipped.length, deckChanges: report.approaches.deckChanges.length },
  gradeConstraints: { ...report.gradeConstraints,
    exactNewSegmentViolations: exactGradeViolations.length,
    packedNewSegmentViolationsBeyondPoint1Pp: packedGradeViolations.length,
    bridgeSlopeLimitResiduals: report.gradeConstraints.bridgeSlopeLimitResiduals.length,
    worstInternalBreaks: undefined, worstExteriorBreaks: undefined },
  clearance: { ...report.clearance, bounds: undefined, remainingPenetratingWays: report.clearance.remainingPenetratingWays.length,
    worstRemainingPenetration: report.clearance.remainingPenetratingWays[0] ?? null } }, null, 2))
