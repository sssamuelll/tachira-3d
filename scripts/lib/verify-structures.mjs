import { enuToGeodetic } from './enu.mjs'
import { lineLengthMeters } from './geo.mjs'
import { esPuente, esTunel } from './structures.mjs'

// El error de cuantización Float32 del ENU regional es milimétrico. Este
// margen admite esa pérdida, pero no una rasante desplazada decímetros.
export const POSITION_TOLERANCE_M = 0.05

/** Verifica lo que quedó en disco, sin reconstruir el perfil con el mismo
 * algoritmo que lo produjo. La distancia se mide sobre el binario invertido
 * a lon/lat y la rasante se contrasta en TODOS los vértices de cada cadena. */
export function verifyRoadStructures ({ meta, positions, segIds, index, normals, report, frame }) {
  const checks = []
  const check = (code, ok, message) => checks.push({ code, ok, message })
  const stats = { penetratingWays: 0, checkedVertices: 0, worstHeightErrorM: 0, worstJoinErrorM: 0 }
  const result = { checks, stats }
  const n = positions.length / 6
  const layout = Number.isInteger(n) && meta.count === meta.ways.length &&
    segIds.length === n && normals.length === n * 6 && index.length === meta.count + 1 &&
    index[0] === 0 && index.at(-1) === n &&
    index.every((v, i) => Number.isInteger(v) && v >= 0 && v <= n && (i === 0 || v >= index[i - 1]))
  check('binary-layout', layout, `binarios y CSR coherentes: ${n} segmentos, ${meta.count} vías`)
  const finitePositions = positions.every(Number.isFinite)
  check('finite-positions', finitePositions, 'todas las coordenadas del binario son finitas')
  if (!layout || !finitePositions) return result

  let badIds = 0, visibleTunnels = 0
  const expectedBridges = [], expectedTunnels = []
  const wayIndex = new Map(meta.ways.map((w, i) => [w.osmId, i]))
  for (let i = 0; i < meta.ways.length; i++) {
    for (let s = index[i]; s < index[i + 1]; s++) if (segIds[s] !== i) badIds++
    if (esPuente(meta.ways[i])) expectedBridges.push(meta.ways[i].osmId)
    if (esTunel(meta.ways[i])) {
      expectedTunnels.push(meta.ways[i].osmId)
      if (index[i] !== index[i + 1]) visibleTunnels++
    }
  }
  check('segment-ids', badIds === 0, `segmentos asignados a una vía incorrecta: ${badIds}`)
  check('tunnels-hidden', visibleTunnels === 0,
    `túneles sin segmentos: ${expectedTunnels.length - visibleTunnels} de ${expectedTunnels.length}`)

  const schema = report?.version === 1 && Array.isArray(report.chains) &&
    Array.isArray(report.excludedWays) && Array.isArray(report.tunnels) &&
    report.chains.every(c => Array.isArray(c.ways) && Array.isArray(c.wayIds) &&
      Array.isArray(c.endpoints) && c.endpoints.length === 2)
  check('structure-report', schema, 'informe de estructuras presente y con formato reconocido')
  if (!schema) return result
  const reportedWays = report.chains.flatMap(c => c.ways)
  const sameIds = (actual, expected) => actual.length === expected.length &&
    new Set(actual).size === actual.length && actual.every(id => expected.includes(id))
  const bridgeCoverage = sameIds([...reportedWays, ...report.excludedWays].map(w => w.osmId), expectedBridges) &&
    report.bridgeWays === expectedBridges.length && report.interpolatedWays === reportedWays.length &&
    report.chains.every(c => c.ways.length > 0 && c.wayIds.length === c.ways.length &&
      c.wayIds.every((id, i) => id === c.ways[i].osmId))
  check('bridge-coverage', bridgeCoverage,
    `cobertura de puentes: ${reportedWays.length} interpolados + ${report.excludedWays.length} excluidos, ${expectedBridges.length} en metadata`)
  check('report-counts', report.wayCount === meta.count && report.segmentCount === n &&
    sameIds(report.tunnels.map(w => w.osmId), expectedTunnels), 'conteos del informe coinciden con metadata y binarios')
  const finiteReport = Number.isFinite(report.clearanceToleranceM) && report.clearanceToleranceM >= 0 &&
    report.chains.every(c => Number.isFinite(c.lengthM) && c.lengthM > 0 &&
      c.endpoints.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) &&
      c.ways.every(w => [w.startHeightM, w.endHeightM, w.minClearanceM, w.maxClearanceM].every(Number.isFinite) &&
        Number.isInteger(w.vertices) && w.vertices >= 2)) &&
    report.excludedWays.every(w => typeof w.reason === 'string' && w.reason !== 'invalid-height')
  check('finite-report', finiteReport, 'cotas, longitudes y diagnósticos de puentes finitos')
  if (!bridgeCoverage || !finiteReport) return result
  stats.penetratingWays = reportedWays.filter(w => w.minClearanceM < -report.clearanceToleranceM).length
  check('clearance-counts', report.penetratingWays === stats.penetratingWays &&
    report.clearWays === reportedWays.length - stats.penetratingWays,
  'conteos de penetración reconciliados con el diagnóstico por vía')

  const geo = offset => {
    const [lat, lon, h] = enuToGeodetic(frame, positions[offset], -positions[offset + 2], positions[offset + 1])
    return [lon, lat, h]
  }
  const gap = (a, b) => Math.hypot(lineLengthMeters([a, b]), a[2] - b[2])
  let profileOk = true, continuityOk = true
  for (const chain of report.chains) {
    const [start, end] = chain.endpoints
    let cursor = start, travelled = 0
    for (const way of chain.ways) {
      const i = wayIndex.get(way.osmId), first = index[i], last = index[i + 1]
      if (last <= first || last - first + 1 !== way.vertices) { profileOk = false; continue }
      const points = [geo(first * 6)]
      for (let s = first; s < last; s++) {
        const join = gap(points.at(-1), geo(s * 6))
        stats.worstJoinErrorM = Math.max(stats.worstJoinErrorM, join)
        if (join >= POSITION_TOLERANCE_M) continuityOk = false
        points.push(geo(s * 6 + 3))
      }
      const endpointError = Math.max(Math.abs(points[0][2] - way.startHeightM), Math.abs(points.at(-1)[2] - way.endHeightM))
      stats.worstHeightErrorM = Math.max(stats.worstHeightErrorM, endpointError)
      if (endpointError >= POSITION_TOLERANCE_M) profileOk = false
      if (gap(points.at(-1), cursor) < gap(points[0], cursor)) points.reverse()
      const join = gap(points[0], cursor)
      stats.worstJoinErrorM = Math.max(stats.worstJoinErrorM, join)
      if (join >= POSITION_TOLERANCE_M) continuityOk = false
      for (let k = 0; k < points.length; k++) {
        if (k > 0) travelled += lineLengthMeters([points[k - 1], points[k]])
        const expected = start[2] + (end[2] - start[2]) * travelled / chain.lengthM
        const error = Math.abs(points[k][2] - expected)
        stats.worstHeightErrorM = Math.max(stats.worstHeightErrorM, error)
        if (error >= POSITION_TOLERANCE_M) profileOk = false
        stats.checkedVertices++
      }
      cursor = points.at(-1)
    }
    const finalGap = gap(cursor, end)
    stats.worstJoinErrorM = Math.max(stats.worstJoinErrorM, finalGap)
    if (finalGap >= POSITION_TOLERANCE_M) continuityOk = false
    if (Math.abs(travelled - chain.lengthM) >= Math.max(POSITION_TOLERANCE_M, chain.lengthM * 1e-5)) profileOk = false
  }
  check('bridge-profile', profileOk,
    `rasante de puentes: ${stats.checkedVertices} vértices, error vertical máximo ${stats.worstHeightErrorM.toFixed(4)} m (umbral < 0,05 m)`)
  check('bridge-continuity', continuityOk,
    `continuidad de puentes y estribos: separación máxima ${stats.worstJoinErrorM.toFixed(4)} m (umbral < 0,05 m)`)
  return result
}
