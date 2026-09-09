import { assembleRings } from './overpass.mjs'

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

export function dentroAnillo (p, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function intersecta (a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  const on = (p, q, r) => Math.abs(cross(p, q, r)) < 1e-18 && r[0] >= Math.min(p[0], q[0]) && r[0] <= Math.max(p[0], q[0]) && r[1] >= Math.min(p[1], q[1]) && r[1] <= Math.max(p[1], q[1])
  return (abC * abD < 0 && cdA * cdB < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)
}

/** Closed OSM rings only: never invent a closing edge across missing geometry. */
export function limpiarAnillo (points) {
  if (!points || points.length < 4 || points.some(p => !p || p.length !== 2 || !p.every(Number.isFinite))) return null
  if (!same(points[0], points.at(-1))) return null
  const ring = []
  for (const p of points.slice(0, -1)) if (!ring.length || !same(p, ring.at(-1))) ring.push(p)
  if (ring.length > 1 && same(ring[0], ring.at(-1))) ring.pop()
  if (ring.length < 3) return null
  let area = 0
  const o = ring[0]
  for (let i = 0; i < ring.length; i++) area += cross(o, ring[i], ring[(i + 1) % ring.length])
  // Numerical noise and sub-decimetric footprints are not renderable buildings.
  if (Math.abs(area) * 0.5 * 111320 ** 2 * Math.cos(o[1] * Math.PI / 180) < 0.25) return null
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue
      if (intersecta(ring[i], ring[(i + 1) % ring.length], ring[j], ring[(j + 1) % ring.length])) return null
    }
  }
  return ring
}

function ringsIntersect (a, b) {
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    if (intersecta(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true
  }
  return false
}

const quality = e => (e.geometry?.length ?? 0) + (e.members ?? []).reduce((n, m) => n + (m.geometry?.length ?? 0), 0)

/** Stable OSM identity survives de-duplication, multipolygons and rebakes. */
export function ingerirEdificios (documents) {
  const stats = { inputElements: 0, uniqueElements: 0, duplicateElements: 0, invalidElements: 0, invalidRings: 0, orphanFragments: 0, invalidHoles: 0, suppressedMemberWays: 0, underground: 0, ways: 0, relations: 0, polygons: 0, holes: 0 }
  const unique = new Map()
  for (const doc of documents) {
    if (!Array.isArray(doc.elements)) throw new Error('Overpass JSON sin elements')
    for (const el of doc.elements) {
      stats.inputElements++
      if (!['way', 'relation'].includes(el.type) || !Number.isSafeInteger(el.id)) { stats.invalidElements++; continue }
      const key = `${el.type}/${el.id}`, old = unique.get(key)
      if (old) stats.duplicateElements++
      // More complete response wins; lexical tiebreak makes input order irrelevant.
      if (!old || quality(el) > quality(old) || (quality(el) === quality(old) && JSON.stringify(el) < JSON.stringify(old))) unique.set(key, el)
    }
  }
  stats.uniqueElements = unique.size
  const buildings = [], memberWays = new Set()
  const ordered = [...unique.values()].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id)
  for (const el of ordered) {
    const tags = el.tags ?? {}
    if (tags.location === 'underground' || Number(tags.layer) < 0) { stats.underground++; continue }
    let polygons = []
    if (el.type === 'way') {
      if (memberWays.has(el.id)) { stats.suppressedMemberWays++; continue }
      const outer = limpiarAnillo(el.geometry?.map(p => p && [p.lon, p.lat]))
      if (outer) polygons = [{ outer, holes: [] }]
      else stats.invalidRings++
    } else {
      const members = (el.members ?? []).map(m => ({ ...m, role: m.role || 'outer' }))
      // assembleRings is the existing, tested administrative-boundary assembler.
      const valid = members.filter(m => m.geometry?.every(p => p && Number.isFinite(p.lon) && Number.isFinite(p.lat)))
      const outerResult = assembleRings(valid, 'outer'), innerResult = assembleRings(valid, 'inner')
      stats.orphanFragments += outerResult.orphanFragments + innerResult.orphanFragments
      for (const ring of outerResult.rings) {
        const outer = limpiarAnillo(ring)
        if (outer) polygons.push({ outer, holes: [] }); else stats.invalidRings++
      }
      for (const ring of innerResult.rings) {
        const hole = limpiarAnillo(ring)
        const owner = hole && polygons.find(p => hole.every(q => dentroAnillo(q, p.outer)) && !ringsIntersect(hole, p.outer))
        if (!owner || owner.holes.some(h => ringsIntersect(h, hole) || dentroAnillo(hole[0], h) || dentroAnillo(h[0], hole))) { stats.invalidHoles++; continue }
        owner.holes.push(hole)
      }
      if (polygons.length) for (const m of members) if (m.type === 'way' && m.role === 'outer') memberWays.add(m.ref)
    }
    if (!polygons.length) { stats.invalidElements++; continue }
    const b = { id: `${el.type}/${el.id}`, osmId: el.id, osmType: el.type, tags: { ...tags }, polygons }
    buildings.push(b)
    stats[el.type === 'way' ? 'ways' : 'relations']++
    stats.polygons += polygons.length
    stats.holes += polygons.reduce((n, p) => n + p.holes.length, 0)
  }
  return { buildings, stats }
}
