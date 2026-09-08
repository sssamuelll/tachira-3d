import { readFile, writeFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { makeEnuFrame } from './lib/enu.mjs'
import { bakedWayPoints, distribution } from './lib/bridge-join-audit.mjs'
import { lineLengthMeters } from './lib/geo.mjs'
import { PENDIENTE_MAX, nivelDe } from './lib/carving.mjs'
import { tileXf, tileYf } from './lib/terrarium.mjs'
import { alturaEnPosts } from './lib/drape.mjs'

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const directory = option('--data', 'public/data')
async function load (directory) {
  const [meta, terrain, pos, csr] = await Promise.all([
    readJson(`${directory}/roads-meta.json`), readJson(`${directory}/terrain.json`),
    readFile(`${directory}/roads-pos.bin`), readFile(`${directory}/roads-index.bin`),
  ])
  const o = terrain.origin
  const data = { meta, frame: makeEnuFrame(o.lat, o.lon, o.h),
    positions: new Float32Array(pos.buffer, pos.byteOffset, pos.byteLength / 4),
    index: new Uint32Array(csr.buffer, csr.byteOffset, csr.byteLength / 4) }
  const ids = new Map(meta.ways.map((w, i) => [w.osmId, i])), cache = new Map()
  return { ...data, points: id => {
    if (!cache.has(id)) cache.set(id, ids.has(id) ? bakedWayPoints(data, ids.get(id)) : [])
    return cache.get(id)
  } }
}
const [before, after, approach, raw] = await Promise.all([
  load(option('--before', '.cache/bridge-joins/before')), load(directory),
  readJson(`${directory}/roads-approaches.json`), readJson('.cache/vias.json'),
])
const planar = (a, b) => lineLengthMeters([a, b])
const grade = (a, b) => (b[2] - a[2]) / planar(a, b) * 100
const interpolateBaseline = (p, points) => {
  let best = null
  const scale = Math.cos(p[1] * Math.PI / 180)
  for (let j = 1; j < points.length; j++) {
    const a = points[j - 1], b = points[j], dx = (b[0] - a[0]) * scale, dy = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * scale * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    const gap = Math.hypot((p[0] - a[0]) * scale - t * dx, p[1] - a[1] - t * dy)
    if (!best || gap < best.gap) best = { gap, height: a[2] + t * (b[2] - a[2]), segment: j - 1, t }
  }
  return best
}
const ids = new Set(approach.changedWayIds)
const meta = new Map(after.meta.ways.map(w => [w.osmId, w]))
const allGrades = [], modifiedGrades = [], interiorBreaks = [], boundaryBreaks = [], violations = []
const clearance = [], missingTiles = new Set(), tileCache = new Map(), lowest = []
async function ground (lon, lat) {
  const tx = tileXf(lon, 12), ty = tileYf(lat, 12), x = Math.floor(tx), y = Math.floor(ty), key = `${x}/${y}`
  if (!tileCache.has(key)) {
    try {
      const png = PNG.sync.read(await readFile(`${directory}/dem/12/${key}.png`))
      const data = Float32Array.from({ length: png.width * png.height }, (_, i) =>
        png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768)
      tileCache.set(key, { width: png.width, height: png.height, data })
    } catch (e) { if (e.code !== 'ENOENT') throw e; tileCache.set(key, null); missingTiles.add(key) }
  }
  const tile = tileCache.get(key)
  return tile ? alturaEnPosts(tile, (tx - x) * 256, (ty - y) * 256) : null
}
for (const id of ids) {
  const p = after.points(id), old = before.points(id), cap = (PENDIENTE_MAX[nivelDe(meta.get(id).highway)] || Infinity) * 100
  const projected = p.map(q => interpolateBaseline(q, old))
  const delta = p.map((q, i) => q[2] - projected[i].height)
  const grades = p.slice(1).map((q, i) => grade(p[i], q))
  const oldGrades = p.slice(1).map((q, i) => (projected[i + 1].height - projected[i].height) / planar(p[i], q) * 100)
  // La primera versión del informe no tenía rangos CSR. Inferencia independiente:
  // solo considera cambiado un segmento si su cota difiere >1 cm de la línea
  // horneada anterior, o si reemplaza una arista vertical interior del perfil.
  const changed = grades.map((_, i) => Math.abs(delta[i]) > .01 || Math.abs(delta[i + 1]) > .01 ||
    projected[i + 1].segment > projected[i].segment + 1)
  for (let i = 0; i < grades.length; i++) {
    const g = Math.abs(grades[i]); allGrades.push(g)
    if (changed[i]) {
      modifiedGrades.push(g)
      if (g > cap + .03) violations.push({ osmId: id, segment: i, gradePct: g, capPct: cap,
        beforeGradePct: Math.abs(oldGrades[i]), lon: p[i][0], lat: p[i][1], deltaStartM: delta[i], deltaEndM: delta[i + 1] })
      const count = Math.max(1, Math.ceil(planar(p[i], p[i + 1]) / 5))
      for (let k = 0; k <= count; k++) {
        const t = k / count, q = p[i].map((v, c) => v + (p[i + 1][c] - v) * t)
        const h = await ground(q[0], q[1])
        if (h === null) continue
        const gap = q[2] - h; clearance.push(gap)
        if (gap < -.2) lowest.push({ osmId: id, segment: i, clearanceM: gap, lon: q[0], lat: q[1] })
      }
    }
    if (i > 0 && (changed[i - 1] || changed[i])) {
      const item = { osmId: id, vertex: i, breakPp: Math.abs(grades[i] - grades[i - 1]),
        beforeBreakPp: Math.abs(oldGrades[i] - oldGrades[i - 1]), lon: p[i][0], lat: p[i][1] }
      if (changed[i - 1] !== changed[i]) boundaryBreaks.push(item)
      else interiorBreaks.push(item)
    }
  }
}

// C0 en TODOS los nodos compartidos de las vías tocadas, incluidos cruces
// interiores y conexiones a calles que no pertenecen al acceso.
const ways = raw.elements.filter(w => w.type === 'way' && Array.isArray(w.nodes) && Array.isArray(w.geometry))
const nodes = new Set(ways.filter(w => ids.has(w.id)).flatMap(w => w.nodes)), at = new Map()
for (const w of ways) w.nodes.forEach((node, i) => {
  if (!nodes.has(node)) return
  if (!at.has(node)) at.set(node, [])
  at.get(node).push({ id: w.id, target: [w.geometry[i].lon, w.geometry[i].lat] })
})
const sharedNodes = []
for (const [node, occurrences] of at) {
  if (new Set(occurrences.map(o => o.id)).size < 2) continue
  const heights = []
  for (const { id, target } of occurrences) {
    const p = after.points(id)
    for (const q of p) if (planar(q, target) < .05) heights.push({ id, height: q[2] })
  }
  if (heights.length < 2) continue
  const stepM = Math.max(...heights.map(h => h.height)) - Math.min(...heights.map(h => h.height))
  sharedNodes.push({ node, stepM, heights, lon: occurrences[0].target[0], lat: occurrences[0].target[1] })
}
const report = {
  source: directory, changedWays: ids.size,
  changedSegmentMethod: 'Baked geodetic height differs from original polyline by > 0.01 m at either endpoint or skips original internal vertical vertices; ownRanges not required',
  allGradesPctOnTouchedWays: distribution(allGrades), modifiedGradesPct: distribution(modifiedGrades),
  violations: violations.sort((a, b) => b.gradePct - a.gradePct),
  internalBreakPp: distribution(interiorBreaks.map(x => x.breakPp)), worstInternal: interiorBreaks.sort((a, b) => b.breakPp - a.breakPp).slice(0, 20),
  beforeInternalBreakPpAtSameSites: distribution(interiorBreaks.map(x => x.beforeBreakPp)),
  exteriorBreakPp: distribution(boundaryBreaks.map(x => x.breakPp)), worstExterior: boundaryBreaks.sort((a, b) => b.breakPp - a.breakPp).slice(0, 20),
  beforeExteriorBreakPpAtSameSites: distribution(boundaryBreaks.map(x => x.beforeBreakPp)),
  sharedNodeStepM: distribution(sharedNodes.map(n => n.stepM)), discontinuousNodes: sharedNodes.filter(n => n.stepM > .01),
  clearanceM: { ...distribution(clearance), min: Math.min(...clearance) },
  penetrationSamples: lowest.length, penetratingApproachWays: new Set(lowest.map(x => x.osmId)).size,
  worstClearance: lowest.sort((a, b) => a.clearanceM - b.clearanceM).slice(0, 20), missingDemTiles: [...missingTiles],
}
await writeFile(option('--output', '.cache/bridge-joins/approaches-audit.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ ...report, violations: report.violations.slice(0, 8), worstInternal: report.worstInternal.slice(0, 3),
  worstExterior: report.worstExterior.slice(0, 3), discontinuousNodes: report.discontinuousNodes.slice(0, 5),
  worstClearance: report.worstClearance.slice(0, 5) }, null, 2))
