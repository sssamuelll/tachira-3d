import { tallar } from './carving.mjs'
import { alturaTriangulo, postDe } from './drape.mjs'
import { lineLengthMeters } from './geo.mjs'
import { AUDIT_STEP_M, CLEARANCE_TOLERANCE_M } from './structures.mjs'
import { apoyar } from './subdividir.mjs'
import { tileXf, tileYf } from './terrarium.mjs'

const VIADUCTOS = [
  { id: 'viaducto-viejo', lon: -72.23427815, lat: 7.76271285 },
  { id: 'viaducto-nuevo', lon: -72.2206145, lat: 7.76432975 },
]

// Los cuatro posts de la celda protegen cualquiera de sus dos triángulos.
// Muestrear cada 5 m usa el mismo paso que la auditoría de los puentes.
function supportPosts (dem, lon, lat) {
  const [u, v] = postDe(dem, lon, lat)
  const x = Math.min(dem.width - 2, Math.floor(u)), y = Math.min(dem.height - 2, Math.floor(v))
  const a = y * dem.width + x
  return [a, a + 1, a + dem.width, a + dem.width + 1]
}

function triangleWeights (dem, lon, lat) {
  const [u, v] = postDe(dem, lon, lat)
  const x = Math.min(dem.width - 2, Math.floor(u)), y = Math.min(dem.height - 2, Math.floor(v))
  const fx = u - x, fy = v - y, a = y * dem.width + x
  return fx + fy <= 1
    ? [{ j: a, w: 1 - fx - fy }, { j: a + 1, w: fx }, { j: a + dem.width, w: fy }]
    : [{ j: a + 1, w: 1 - fy }, { j: a + dem.width, w: 1 - fx },
        { j: a + dem.width + 1, w: fx + fy - 1 }]
}

function visitAxis (coords, visit) {
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i]
    const n = Math.max(1, Math.ceil(lineLengthMeters([a, b]) / AUDIT_STEP_M))
    for (let k = 0; k <= n; k++) {
      const t = k / n
      visit(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), i, t)
    }
  }
}

function axisClearance (dem, corridors) {
  let samples = 0, penetratingSamples = 0, minClearanceM = Infinity, maxClearanceM = -Infinity
  for (const c of corridors) visitAxis(c.coords, (lon, lat, i, t) => {
    const h = c.carvingHeights[i - 1] + t * (c.carvingHeights[i] - c.carvingHeights[i - 1])
    const gap = h - alturaTriangulo(dem, lon, lat)
    if (!Number.isFinite(gap)) throw new Error('Altura no finita en el terreno de un acceso')
    minClearanceM = Math.min(minClearanceM, gap)
    maxClearanceM = Math.max(maxClearanceM, gap)
    if (gap < -CLEARANCE_TOLERANCE_M) penetratingSamples++
    samples++
  })
  return { samples, penetratingSamples, minClearanceM: samples ? minClearanceM : null,
    maxClearanceM: samples ? maxClearanceM : null }
}

// Plano de la celda que pasa exactamente por los cruces. Con dos anclas queda
// un grado de libertad: se escoge por mínimos cuadrados contra las muestras
// vecinas de la rasante. Con una sola, se ajustan sus dos pendientes. La banda
// exterior sigue siendo la del carving; esto solo evita que la rasterización
// de ~38 m promedie y pierda las cotas dentro de una misma celda.
function crossingPlane (dem, crossings) {
  const anchor = crossings.map(c => ({ uv: postDe(dem, ...c.point), h: c.heightM }))
  const samples = crossings.flatMap(c => c.deckSamples ?? []).map(s => ({ uv: postDe(dem, ...s.point), h: s.heightM }))
  const origin = anchor[0]
  if (anchor.length > 1) {
    let other = anchor[1]
    for (const candidate of anchor.slice(2)) {
      if (Math.hypot(candidate.uv[0] - origin.uv[0], candidate.uv[1] - origin.uv[1]) >
          Math.hypot(other.uv[0] - origin.uv[0], other.uv[1] - origin.uv[1])) other = candidate
    }
    const dx = other.uv[0] - origin.uv[0], dy = other.uv[1] - origin.uv[1]
    const d2 = dx * dx + dy * dy
    if (d2 <= 1e-12) throw new Error('Cruces distintos comparten coordenadas con cotas diferentes')
    const dh = other.h - origin.h
    const gx0 = dh * dx / d2, gy0 = dh * dy / d2
    const nx = -dy, ny = dx
    let aa = 0, ab = 0
    for (const sample of samples) {
      const qx = sample.uv[0] - origin.uv[0], qy = sample.uv[1] - origin.uv[1]
      const a = nx * qx + ny * qy
      const b = sample.h - origin.h - gx0 * qx - gy0 * qy
      aa += a * a; ab += a * b
    }
    const k = aa > 1e-12 ? ab / aa : 0
    const gx = gx0 + k * nx, gy = gy0 + k * ny
    return (u, v) => origin.h + gx * (u - origin.uv[0]) + gy * (v - origin.uv[1])
  }
  let xx = 0, xy = 0, yy = 0, xh = 0, yh = 0
  for (const sample of samples) {
    const x = sample.uv[0] - origin.uv[0], y = sample.uv[1] - origin.uv[1], h = sample.h - origin.h
    xx += x * x; xy += x * y; yy += y * y; xh += x * h; yh += y * h
  }
  const det = xx * yy - xy * xy
  const gx = Math.abs(det) > 1e-12 ? (xh * yy - yh * xy) / det : 0
  const gy = Math.abs(det) > 1e-12 ? (yh * xx - xh * xy) / det : 0
  return (u, v) => origin.h + gx * (u - origin.uv[0]) + gy * (v - origin.uv[1])
}

/** Talla únicamente los acuerdos resueltos, con la banda transversal y los
 * pesos longitudinales del carving existente. Nunca rellena el soporte del
 * eje de un puente por encima de su DEM anterior, salvo en los cruces a nivel
 * declarados, donde lo lleva exactamente a la rasante. Las piezas conservan
 * la altura interpolada del terreno en su centro aunque compartan un post. */
export function tallarAccesos (dem, corridors, topology, opts = {}) {
  const { fixedCenters = VIADUCTOS, ...carveOpts } = opts
  const before = axisClearance(dem, corridors)
  const maxHeight = new Map()
  const protectedPosts = new Set()
  const crossings = new Map()
  for (const corridor of corridors) for (const crossing of corridor.terrainCrossings ?? []) {
    crossings.set(crossing.nodeId, crossing)
  }
  const crossingPosts = new Set([...crossings.values()].flatMap(crossing =>
    supportPosts(dem, ...crossing.point)))
  const crossingCells = new Map()
  for (const crossing of crossings.values()) {
    const key = supportPosts(dem, ...crossing.point).join('/')
    if (!crossingCells.has(key)) crossingCells.set(key, [])
    crossingCells.get(key).push(crossing)
  }
  for (const chain of topology.chains) for (const { line } of chain) {
    visitAxis(line.coords, (lon, lat) => {
      for (const j of supportPosts(dem, lon, lat)) {
        if (!crossingPosts.has(j)) maxHeight.set(j, dem.data[j])
        protectedPosts.add(j)
      }
    })
  }
  const fixed = new Map(), centers = []
  for (const center of fixedCenters) {
    const { z, x0, y0 } = dem.tile
    const u = (tileXf(center.lon, z) - x0) * 256, v = (tileYf(center.lat, z) - y0) * 256
    if (u < 0 || v < 0 || u > dem.width - 1 || v > dem.height - 1) continue
    centers.push({ ...center, beforeM: alturaTriangulo(dem, center.lon, center.lat) })
    for (const j of supportPosts(dem, center.lon, center.lat)) fixed.set(j, dem.data[j])
  }
  const result = tallar(dem, corridors, { ...carveOpts, maxHeight })
  // La mezcla con todos los demás accesos puede inclinar el borde de la
  // celda excepcional. Reaplicar únicamente los corredores que llegan a un
  // cruce hace que su perfil longitudinal —ya suavizado y acotado— gobierne
  // la loma, con la misma plataforma y el mismo smoothstep de tallar().
  const crossingCorridors = corridors.filter(corridor => corridor.terrainCrossings?.length)
  if (crossingCorridors.length) tallar(dem, crossingCorridors, { ...carveOpts })
  for (const group of crossingCells.values()) {
    const plane = crossingPlane(dem, group)
    for (const j of supportPosts(dem, ...group[0].point)) {
      const u = j % dem.width, v = Math.floor(j / dem.width)
      dem.data[j] = Math.fround(plane(u, v))
    }
  }
  for (const [j, h] of fixed) if (!crossingPosts.has(j)) dem.data[j] = h
  // Si la celda del cruce comparte un post con el ancla de una pieza, no se
  // puede restaurar ese post sin perder la intersección. Compensar la misma
  // interpolación triangular en sus otros vértices conserva la altura exacta
  // con la que Piezas apoya el GLB, sin mover el tablero ni su archivo.
  for (const center of centers) {
    const weights = triangleWeights(dem, center.lon, center.lat)
    if (!weights.some(({ j }) => crossingPosts.has(j))) continue
    const adjustable = weights.filter(({ j, w }) => !crossingPosts.has(j) && w > 1e-12)
    const denom = adjustable.reduce((sum, p) => sum + p.w * p.w, 0)
    if (denom <= 1e-12) throw new Error(`No se puede conservar el apoyo de ${center.id}`)
    const correction = center.beforeM - alturaTriangulo(dem, center.lon, center.lat)
    for (const { j, w } of adjustable) dem.data[j] = Math.fround(dem.data[j] + correction * w / denom)
    const residual = center.beforeM - alturaTriangulo(dem, center.lon, center.lat)
    const strongest = adjustable.reduce((a, b) => a.w >= b.w ? a : b)
    dem.data[strongest.j] = Math.fround(dem.data[strongest.j] + residual / strongest.w)
  }
  return { ...result, protectedBridgePosts: protectedPosts.size, fixedCenterPosts: fixed.size,
    terrainCrossings: [...crossings.values()].map(crossing => ({ nodeId: crossing.nodeId,
      targetHeightM: crossing.heightM, terrainHeightM: alturaTriangulo(dem, ...crossing.point),
      differenceM: alturaTriangulo(dem, ...crossing.point) - crossing.heightM })),
    centerGroundChanges: centers.map(c => {
      const afterM = alturaTriangulo(dem, c.lon, c.lat)
      return { ...c, afterM, changeM: afterM - c.beforeM }
    }), axisClearance: { before, after: axisClearance(dem, corridors) } }
}

/** Reapoya solo las calles que forman los cruces declarados. Sus perfiles se
 * resolvieron antes de tallar para conducir el relleno; una vez modificado el
 * DEM, esta pasada hace que la geometría visible use la superficie resultante
 * en vez de conservar aquella aproximación previa. */
export function redrapearCrucesTerreno (lines, approaches, ground) {
  const ids = new Set(approaches.report.terrainCrossings.flatMap(c => c.roadWayIds))
  const byId = new Map(lines.map(line => [line.osmId, line]))
  let vertices = 0, insertedVertices = 0, maxHeightChangeM = 0
  for (const id of ids) {
    const line = byId.get(id), profile = approaches.byWay.get(id)
    if (!line || !profile) throw new Error(`Vía ${id} del cruce sin perfil para redrapear`)
    if (profile.heights.length !== line.coords.length || profile.ownSegments.length !== line.coords.length - 1) {
      throw new Error(`Perfil desalineado al redrapear vía ${id}`)
    }
    const originalCoords = line.coords, coords = [originalCoords[0]], ownSegments = []
    for (let i = 1; i < originalCoords.length; i++) {
      // Dos centímetros son mucho menores que el alza visual mínima, pero
      // bastan para que una cuerda no atraviese el plano de la nueva loma.
      const part = apoyar(originalCoords.slice(i - 1, i + 1), ground, .02, .5)
      for (const p of part.slice(1)) { coords.push(p); ownSegments.push(profile.ownSegments[i - 1]) }
    }
    const heights = coords.map(([lon, lat]) => ground(lon, lat))
    for (let i = 0; i < originalCoords.length; i++) {
      maxHeightChangeM = Math.max(maxHeightChangeM,
        Math.abs(ground(...originalCoords[i]) - profile.heights[i]))
    }
    insertedVertices += coords.length - originalCoords.length
    line.coords = coords
    profile.heights = heights
    profile.ownSegments = ownSegments
    const ranges = []
    for (let i = 0; i < ownSegments.length; i++) if (ownSegments[i]) {
      const from = i
      while (i + 1 < ownSegments.length && ownSegments[i + 1]) i++
      ranges.push([from, i + 1])
    }
    const rangeReport = approaches.report.ownRanges?.find(entry => entry.osmId === id)
    if (rangeReport) rangeReport.ranges = ranges
    vertices += heights.length
  }
  return { ways: ids.size, vertices, insertedVertices, maxHeightChangeM }
}

/** Muestreo fino de los tableros que tocan la loma. Solo la celda que contiene
 * cada cruce admite el contacto deliberado; una penetración en cualquier otra
 * celda sigue siendo un error. */
export function auditarContactosPuente (dem, topology, structures, terrainCrossings, opts = {}) {
  const stepM = opts.stepM ?? .25, toleranceM = opts.toleranceM ?? .005
  const ground = opts.ground ?? ((lon, lat) => alturaTriangulo(dem, lon, lat))
  const cellsByWay = new Map()
  for (const crossing of terrainCrossings) {
    const [u, v] = postDe(dem, ...crossing.point)
    const cell = `${Math.min(dem.width - 2, Math.floor(u))}/${Math.min(dem.height - 2, Math.floor(v))}`
    for (const id of crossing.bridgeWayIds) {
      if (!cellsByWay.has(id)) cellsByWay.set(id, new Set())
      cellsByWay.get(id).add(cell)
    }
  }
  const entries = topology.chains.flat(), ways = [], violations = []
  for (const [osmId, localCells] of cellsByWay) {
    const entry = entries.find(candidate => candidate.line.osmId === osmId)
    const profile = structures.byWay.get(osmId)
    if (!entry || !profile || profile.heights.length !== entry.line.coords.length) {
      violations.push({ osmId, reason: 'missing-contact-profile' })
      continue
    }
    let samples = 0, localSamples = 0, minLocalClearanceM = Infinity,
      minOutsideClearanceM = Infinity
    const coords = entry.line.coords
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i]
      const count = Math.max(1, Math.ceil(lineLengthMeters([a, b]) / stepM))
      for (let k = i === 1 ? 0 : 1; k <= count; k++) {
        const t = k / count, lon = a[0] + (b[0] - a[0]) * t,
          lat = a[1] + (b[1] - a[1]) * t
        const [u, v] = postDe(dem, lon, lat)
        const cell = `${Math.min(dem.width - 2, Math.floor(u))}/${Math.min(dem.height - 2, Math.floor(v))}`
        const gap = profile.heights[i - 1] + (profile.heights[i] - profile.heights[i - 1]) * t - ground(lon, lat)
        if (!Number.isFinite(gap)) throw new Error(`Gálibo no finito en contacto ${osmId}`)
        if (localCells.has(cell)) { minLocalClearanceM = Math.min(minLocalClearanceM, gap); localSamples++ }
        else minOutsideClearanceM = Math.min(minOutsideClearanceM, gap)
        samples++
      }
    }
    const record = { osmId, samples, localSamples,
      minLocalClearanceM: localSamples ? minLocalClearanceM : null,
      minOutsideClearanceM: samples > localSamples ? minOutsideClearanceM : null }
    ways.push(record)
    if (record.minLocalClearanceM !== null && record.minLocalClearanceM < -toleranceM) {
      violations.push({ osmId, reason: 'local-terrain-penetration', clearanceM: record.minLocalClearanceM })
    }
    if (record.minOutsideClearanceM !== null && record.minOutsideClearanceM < -toleranceM) {
      violations.push({ osmId, reason: 'outside-crossing-penetration', clearanceM: record.minOutsideClearanceM })
    }
  }
  return { stepM, toleranceM, ways, violations }
}
