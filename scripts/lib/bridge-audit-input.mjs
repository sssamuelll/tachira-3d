import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeEnuFrame, geodeticToEnu, enuToGeodetic } from './enu.mjs'
import { bakedWayPoints } from './bridge-join-audit.mjs'
import { postDe } from './drape.mjs'
import { metrosPorPost, anchoCalzadaTags, nivelDe, tallaTerreno,
  HOMBRILLO_M, TRANSICION_M, MIN_POSTS_CORREDOR, MIN_POSTS_BANDA } from './carving.mjs'

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

export function loadBridgeBake (directory) {
  const meta = readJson(join(directory, 'roads-meta.json'))
  const report = readJson(join(directory, 'roads-structures.json'))
  const terrain = readJson(join(directory, 'terrain.json'))
  const p = readFileSync(join(directory, 'roads-pos.bin'))
  const i = readFileSync(join(directory, 'roads-index.bin'))
  const { lat, lon, h } = terrain.origin
  return { meta, report, terrain, frame: makeEnuFrame(lat, lon, h),
    positions: new Float32Array(p.buffer, p.byteOffset, p.byteLength / 4),
    index: new Uint32Array(i.buffer, i.byteOffset, i.byteLength / 4) }
}

/** Ida y vuelta por los mismos Float32 y ejes ENU del empaquetado real. */
export function packedGeodeticPoints (coords, heights, frame) {
  return coords.map(([lon, lat], i) => {
    const [e, n, u] = geodeticToEnu(frame, lat, lon, heights[i]).map(Math.fround)
    const [la, lo, h] = enuToGeodetic(frame, e, n, u)
    return [lo, la, h]
  })
}

export function wayPointReader (data) {
  const ids = new Map(data.meta.ways.map((w, i) => [w.osmId, i]))
  return id => ids.has(id) ? bakedWayPoints(data, ids.get(id)) : []
}

/** Superset exacto de los posts que tallar puede visitar para estos
 * corredores, usando su mismo radio y bbox por segmento. */
export function corridorInfluencePosts (dem, corridors) {
  const posts = new Set()
  for (const c of corridors) {
    const n = nivelDe(c.tags.highway)
    if (n === 0 || !tallaTerreno(c.tags) || c.coords.length < 2) continue
    const mpp = metrosPorPost(c.coords[c.coords.length >> 1][1], dem.tile.z)
    const radius = (Math.max(anchoCalzadaTags(c.tags) / 2 + HOMBRILLO_M, MIN_POSTS_CORREDOR * mpp) +
      Math.max(TRANSICION_M[n], MIN_POSTS_BANDA * mpp)) / mpp
    const uv = c.coords.map(p => postDe(dem, ...p))
    for (let i = 1; i < uv.length; i++) {
      const a = uv[i - 1], b = uv[i]
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - radius))
      const x1 = Math.min(dem.width - 1, Math.ceil(Math.max(a[0], b[0]) + radius))
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - radius))
      const y1 = Math.min(dem.height - 1, Math.ceil(Math.max(a[1], b[1]) + radius))
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) posts.add(y * dem.width + x)
    }
  }
  return posts
}

/** La fórmula y filtro dh >= 5 son los de verify-data.mjs. Se recorre el
 * binario ya existente y solo se sustituyen los ways modificados. */
export function structuralNetworkGrade (data, overrides = new Map()) {
  const classes = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'])
  const values = []
  const add = (x, y, z, xx, yy, zz) => {
    const dh = Math.hypot(xx - x, zz - z)
    if (dh >= 5) values.push(Math.abs(yy - y) / dh * 100)
  }
  const pos = data.positions
  for (let i = 0; i < data.meta.ways.length; i++) {
    const way = data.meta.ways[i]
    if (!classes.has(way.highway)) continue
    const replacement = overrides.get(way.osmId)
    if (replacement) {
      const enu = replacement.map(([lon, lat, h]) => geodeticToEnu(data.frame, lat, lon, h).map(Math.fround))
      for (let j = 1; j < enu.length; j++) {
        const [e, n, u] = enu[j - 1], [ee, nn, uu] = enu[j]
        add(e, u, -n, ee, uu, -nn)
      }
    } else for (let s = data.index[i]; s < data.index[i + 1]; s++) {
      const o = s * 6
      add(pos[o], pos[o + 1], pos[o + 2], pos[o + 3], pos[o + 4], pos[o + 5])
    }
  }
  values.sort((a, b) => a - b)
  const p99 = values[Math.floor(.99 * values.length)] ?? null
  return { count: values.length, maxPct: values.at(-1) ?? null, p99Pct: p99, thresholdPct: 30, passes: values.length > 10000 && p99 <= 30 }
}
