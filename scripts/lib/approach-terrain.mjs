import { tallar } from './carving.mjs'
import { alturaTriangulo, postDe } from './drape.mjs'
import { lineLengthMeters } from './geo.mjs'
import { AUDIT_STEP_M, CLEARANCE_TOLERANCE_M } from './structures.mjs'
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

/** Talla únicamente los acuerdos resueltos, con la banda transversal y los
 * pesos longitudinales del carving existente. Nunca rellena el soporte del
 * eje de un puente por encima de su DEM anterior: mantener/subir la rasante
 * del tablero conserva entonces todos sus gálibos. Las piezas se colocan
 * sobre el terreno de su centro, cuyos cuatro posts quedan fijos. */
export function tallarAccesos (dem, corridors, topology, opts = {}) {
  const before = axisClearance(dem, corridors)
  const maxHeight = new Map()
  const protectedPosts = new Set()
  for (const chain of topology.chains) for (const { line } of chain) {
    visitAxis(line.coords, (lon, lat) => {
      for (const j of supportPosts(dem, lon, lat)) {
        maxHeight.set(j, dem.data[j])
        protectedPosts.add(j)
      }
    })
  }
  const fixed = new Map(), centers = []
  for (const center of VIADUCTOS) {
    const { z, x0, y0 } = dem.tile
    const u = (tileXf(center.lon, z) - x0) * 256, v = (tileYf(center.lat, z) - y0) * 256
    if (u < 0 || v < 0 || u > dem.width - 1 || v > dem.height - 1) continue
    centers.push({ ...center, beforeM: alturaTriangulo(dem, center.lon, center.lat) })
    for (const j of supportPosts(dem, center.lon, center.lat)) fixed.set(j, dem.data[j])
  }
  const result = tallar(dem, corridors, { ...opts, maxHeight })
  for (const [j, h] of fixed) dem.data[j] = h
  return { ...result, protectedBridgePosts: protectedPosts.size, fixedCenterPosts: fixed.size,
    centerGroundChanges: centers.map(c => {
      const afterM = alturaTriangulo(dem, c.lon, c.lat)
      return { ...c, afterM, changeM: afterM - c.beforeM }
    }), axisClearance: { before, after: axisClearance(dem, corridors) } }
}
