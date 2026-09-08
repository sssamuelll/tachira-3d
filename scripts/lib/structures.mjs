import { lineLengthMeters } from './geo.mjs'
import { geodeticToEnu } from './enu.mjs'

export const esPuente = tags => !!tags.bridge && tags.bridge !== 'no'
export const esTunel = tags => !!tags.tunnel && tags.tunnel !== 'no'
export const layerDe = tags => /^-?\d+$/.test(String(tags.layer ?? '').trim())
  ? Number(tags.layer) : null

// Misma tolerancia vertical que apoyar(); es un diagnóstico del eje, no una
// prueba de gálibo reglamentario ni de los bordes de la calzada.
export const CLEARANCE_TOLERANCE_M = 0.2
export const AUDIT_STEP_M = 5

/** Captura topología ANTES de orientar/subdividir. Los IDs OSM identifican
 * conexiones; ni cercanía, nombre ni cruces en planta las inventan. Cada
 * calzada paralela conserva sus nodos y sus dos estribos. La ausencia de
 * layer en un puente asume 1 solo para encadenar, nunca metros de alza.
 * Conserva referencias a las líneas para leer sus coordenadas finales. */
export function encadenarPuentes (lines) {
  const entries = [], excludedWays = []
  let bridgeWays = 0
  for (const line of lines) {
    if (!esPuente(line.tags)) continue
    bridgeWays++
    const reason = esTunel(line.tags) ? 'bridge-and-tunnel'
      : line.tags.bridge === 'low_water_crossing' ? 'low-water-crossing'
        : !line.nodes || line.nodes.length !== line.coords.length ? 'missing-node-ids'
          : null
    if (reason) { excludedWays.push({ osmId: line.osmId, reason }); continue }
    const layer = layerDe(line.tags) ?? 1
    entries.push({ line, layer, keys: line.nodes.map(n => `${layer}/${n}`),
      start: line.coords[0], end: line.coords.at(-1) })
  }
  const at = new Map()
  for (const e of entries) for (const key of new Set(e.keys)) {
    if (!at.has(key)) at.set(key, [])
    at.get(key).push(e)
  }
  const seen = new Set(), components = []
  // Recorre cada nodo/way una vez, incluso si aparece una gran bifurcación.
  const seenNodes = new Set()
  for (const seed of entries) {
    if (seen.has(seed)) continue
    const component = [], pending = [seed]
    seen.add(seed)
    while (pending.length) {
      const e = pending.pop()
      component.push(e)
      for (const key of e.keys) {
        if (seenNodes.has(key)) continue
        seenNodes.add(key)
        for (const next of at.get(key)) if (!seen.has(next)) {
          seen.add(next); pending.push(next)
        }
      }
    }
    components.push(component)
  }
  const chains = []
  for (const component of components) {
    const ends = new Map()
    let reason = null
    for (const e of component) {
      if (e.keys.slice(1, -1).some(key => at.get(key).length > 1)) reason = 'interior-junction'
      if (new Set(e.keys).size < e.keys.length && e.keys[0] !== e.keys.at(-1)) reason ??= 'repeated-node'
      for (const key of [e.keys[0], e.keys.at(-1)]) {
        if (!ends.has(key)) ends.set(key, [])
        ends.get(key).push(e)
      }
    }
    const leaves = [...ends.keys()].filter(key => ends.get(key).length === 1).sort()
    if ([...ends.values()].some(es => es.length > 2)) reason ??= 'branched'
    if (leaves.length !== 2) reason ??= leaves.length === 0 ? 'closed' : 'ambiguous-endpoints'
    if (reason) {
      excludedWays.push(...component.map(e => ({ osmId: e.line.osmId, reason })))
      continue
    }
    const ordered = [], used = new Set()
    let key = leaves[0]
    while (ordered.length < component.length) {
      const e = ends.get(key).find(item => !used.has(item))
      if (!e) break
      used.add(e)
      const forward = e.keys[0] === key
      ordered.push({ ...e, from: forward ? e.start : e.end, to: forward ? e.end : e.start })
      key = forward ? e.keys.at(-1) : e.keys[0]
    }
    if (ordered.length !== component.length) {
      excludedWays.push(...component.map(e => ({ osmId: e.line.osmId, reason: 'ambiguous-endpoints' })))
    } else chains.push(ordered)
  }
  excludedWays.sort((a, b) => a.osmId - b.osmId)
  return { bridgeWays, chains, excludedWays }
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1]
const distances = coords => {
  const s = [0]
  for (let i = 1; i < coords.length; i++) s.push(s.at(-1) + lineLengthMeters([coords[i - 1], coords[i]]))
  return s
}

/** Rasante lineal por distancia acumulada sobre la cadena completa. Los
 * extremos usan el DEM ya tallado, igual que las vías de acceso. No se
 * bisecciona contra el valle ni se fuerza h >= DEM: eso recrearía el drapeado.
 * La auditoría muestrea también ENTRE vértices y declara las penetraciones. */
export function elevarPuentes (topology, alturaDe) {
  const byWay = new Map(), chains = [], excludedWays = [...topology.excludedWays]
  let auditSamples = 0
  for (const chain of topology.chains) {
    const segments = chain.map(e => {
      const coords = e.line.coords
      return { ...e, s: distances(coords), forward: same(coords[0], e.from) }
    })
    const lengthM = segments.reduce((sum, e) => sum + e.s.at(-1), 0)
    const start = chain[0].from, end = chain.at(-1).to
    const h0 = alturaDe(...start), h1 = alturaDe(...end)
    const reason = !Number.isFinite(h0) || !Number.isFinite(h1) ? 'invalid-height'
      : !(lengthM > 0) || segments.some(e => !(e.s.at(-1) > 0)) ? 'zero-length' : null
    if (reason) {
      excludedWays.push(...chain.map(e => ({ osmId: e.line.osmId, reason })))
      continue
    }
    const ways = []
    let offset = 0
    for (const e of segments) {
      const coords = e.line.coords, len = e.s.at(-1)
      const heights = e.s.map(s => h0 + (h1 - h0) * (offset + (e.forward ? s : len - s)) / lengthM)
      let minClearanceM = Infinity, maxClearanceM = -Infinity
      for (let i = 1; i < coords.length; i++) {
        const n = Math.max(1, Math.ceil((e.s[i] - e.s[i - 1]) / AUDIT_STEP_M))
        for (let k = 0; k <= n; k++) {
          const t = k / n, a = coords[i - 1], b = coords[i]
          const ground = alturaDe(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
          const gap = heights[i - 1] + (heights[i] - heights[i - 1]) * t - ground
          if (!Number.isFinite(gap)) throw new Error(`DEM no finito en puente ${e.line.osmId}`)
          minClearanceM = Math.min(minClearanceM, gap)
          maxClearanceM = Math.max(maxClearanceM, gap)
          auditSamples++
        }
      }
      byWay.set(e.line.osmId, { heights })
      ways.push({ osmId: e.line.osmId, startHeightM: heights[0], endHeightM: heights.at(-1),
        minClearanceM, maxClearanceM, vertices: coords.length })
      offset += len
    }
    chains.push({ id: Math.min(...ways.map(w => w.osmId)), wayIds: ways.map(w => w.osmId),
      layer: chain[0].layer, endpoints: [[...start, h0], [...end, h1]], lengthM,
      heightMidM: (h0 + h1) / 2, ways })
  }
  chains.sort((a, b) => a.id - b.id)
  excludedWays.sort((a, b) => a.osmId - b.osmId)
  const penetratingWays = chains.flatMap(c => c.ways).filter(w => w.minClearanceM < -CLEARANCE_TOLERANCE_M).length
  return { byWay, report: { version: 1, heightReference: 'geodetic-dem-metres',
    clearanceToleranceM: CLEARANCE_TOLERANCE_M, auditStepM: AUDIT_STEP_M, auditSamples,
    bridgeWays: topology.bridgeWays, interpolatedWays: byWay.size,
    penetratingWays, clearWays: byWay.size - penetratingWays, excludedWays, chains } }
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = a => { const n = Math.hypot(...a); return n > 0 ? a.map(v => v / n) : [0, 1, 0] }

/** Par de normales por segmento, en ejes three. La dirección transversal es horizontal
 * respecto al elipsoide local; la longitudinal sigue la rasante, nunca la
 * normal del fondo de la garganta. Solo se calcula en el horneado. */
export function normalesTablero (enu, coords, frame) {
  const up = coords.map(([lon, lat]) => {
    const p = geodeticToEnu(frame, lat, lon, 0), q = geodeticToEnu(frame, lat, lon, 1)
    return [q[0] - p[0], q[2] - p[2], -(q[1] - p[1])]
  })
  return enu.slice(1).map((b, i) => {
    const a = enu[i]
    const tangent = [b[0] - a[0], b[2] - a[2], -(b[1] - a[1])]
    // El shader cruza con ESTA tangente. Promediar las normales de tramos
    // vecinos produciría peraltes opuestos a ambos lados de una curva.
    return [up[i], up[i + 1]].map(u => unit(cross(cross(tangent, u), tangent)))
  })
}
