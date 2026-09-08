import { perfil, desvanecer, PENDIENTE_MAX, VENTANA_M, nivelDe } from './carving.mjs'
import { elevarPuentes, esPuente, esTunel } from './structures.mjs'
import { lineLengthMeters } from './geo.mjs'
import { subdividir, apoyar } from './subdividir.mjs'
import { geodeticToEcef } from './enu.mjs'

const PASO_M = 5
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

/** Capturar ANTES de orientar/subdividir. También conserva cruces interiores;
 * coordenadas iguales sin nodo OSM compartido no crean una conexión. */
export function capturarAccesos (lines) {
  // Un recorrido de hasta dos ventanas no puede visitar un nodo cuya
  // distancia al estribo supere ese recorrido. Índice ECEF: sin supuestos
  // sobre latitud ni retener cientos de miles de nodos de vías remotas.
  const radius = 2 * VENTANA_M + PASO_M
  const nearby = new Map(), cell = xyz => xyz.map(v => Math.floor(v / radius))
  for (const line of lines) if (esPuente(line.tags) && line.coords.length) {
    for (const [lon, lat] of [line.coords[0], line.coords.at(-1)]) {
      const xyz = geodeticToEcef(lat, lon, 0), [x, y, z] = cell(xyz)
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const key = `${x + dx}/${y + dy}/${z + dz}`
        if (!nearby.has(key)) nearby.set(key, [])
        nearby.get(key).push(xyz)
      }
    }
  }
  const nodeOf = new Map(), at = new Map()
  for (const line of lines) {
    if (!line.nodes || line.nodes.length !== line.coords.length) continue
    line.coords.forEach((p, i) => {
      const xyz = geodeticToEcef(p[1], p[0], 0)
      if (!(nearby.get(cell(xyz).join('/')) ?? []).some(q =>
        Math.hypot(q[0] - xyz[0], q[1] - xyz[1], q[2] - xyz[2]) <= radius)) return
      const node = line.nodes[i]
      nodeOf.set(p, node)
      if (!at.has(node)) at.set(node, [])
      at.get(node).push({ line, p })
    })
  }
  return { nodeOf, at }
}

/** Acuerdos hasta el siguiente cruce, atravesando ways de grado dos. Cotas
 * exteriores fijas; tableros solo pueden subir. La rasante propia no se vuelve
 * a drapear. Reutiliza perfil, ventana y smoothstep del carving longitudinalmente. */
export function empalmarAccesos (lines, access, topology, originalStructures, ground) {
  const sampled = new Map(), indexOf = new Map()
  const prepare = line => {
    if (!sampled.has(line)) {
      const c = subdividir(line.coords, PASO_M)
      sampled.set(line, c)
      indexOf.set(line, new Map(c.map((p, i) => [p, i])))
    }
    return sampled.get(line)
  }
  const ports = node => (access.at.get(node) ?? []).flatMap(({ line, p }) => {
    const c = prepare(line), i = indexOf.get(line).get(p)
    return [i > 0 ? { line, i, dir: -1 } : null,
      i < c.length - 1 ? { line, i, dir: 1 } : null].filter(Boolean)
  })
  const roots = new Map(), report = { version: 1, supportM: VENTANA_M,
    paths: [], skipped: [], deckChanges: [], changedWayIds: [], ownRanges: [] }
  const chainById = new Map(originalStructures.report.chains.map(c => [c.id, c]))
  const chainCaps = new Map(topology.chains.map(chain => [Math.min(...chain.map(e => e.line.osmId)),
    Math.min(...chain.map(e => PENDIENTE_MAX[nivelDe(e.line.tags.highway)] || Infinity))]))
  for (const chain of topology.chains) {
    const id = Math.min(...chain.map(e => e.line.osmId)), info = chainById.get(id)
    if (!info) continue
    for (const [end, p] of [[0, chain[0].from], [1, chain.at(-1).to]]) {
      const entry = chain[end ? chain.length - 1 : 0], node = access.nodeOf.get(p)
      const root = { id, end, node, p, h: info.endpoints[end][2],
        grade: (end ? 1 : -1) * (info.endpoints[1][2] - info.endpoints[0][2]) / info.lengthM,
        cap: PENDIENTE_MAX[nivelDe(entry.line.tags.highway)] || Infinity }
      if (!roots.has(node)) roots.set(node, [])
      roots.get(node).push(root)
    }
  }
  const paths = [], used = new Set()
  for (const rr of roots.values()) for (const root of rr) {
    const starts = ports(root.node).filter(p => !esPuente(p.line.tags) && !esTunel(p.line.tags))
    if (!starts.length) report.skipped.push({ id: root.id, end: root.end, reason: 'no-access' })
    for (const first of starts) {
      let port = first, length = 0, terminal = null
      const points = [{ p: prepare(port.line)[port.i], line: port.line, i: port.i }], s = [0], edges = [], seen = new Set()
      // Dos ventanas permiten resolver juntos dos estribos con acuerdos solapados.
      while (length < 2 * VENTANA_M) {
        const c = prepare(port.line), next = port.i + port.dir
        const edge = `${port.line.osmId}/${Math.min(port.i, next)}`
        if (seen.has(edge)) break
        seen.add(edge)
        const ds = lineLengthMeters([c[port.i], c[next]])
        if (ds <= 1e-6) break
        length += ds; s.push(length); edges.push(edge)
        points.push({ p: c[next], line: port.line, i: next })
        const node = access.nodeOf.get(c[next])
        if (node !== undefined) {
          if (roots.has(node)) { terminal = roots.get(node)[0]; break }
          const all = ports(node)
          if (all.length !== 2) break
          const follow = all.find(p => !(p.line === port.line && p.i === next && p.dir === -port.dir))
          if (!follow || esPuente(follow.line.tags) || esTunel(follow.line.tags)) break
          port = follow
        } else port = { ...port, i: next }
      }
      if (!terminal && length > VENTANA_M) {
        // Si 150 m no permiten volver al suelo con margen de pendiente,
        // aprovechar hasta otra ventana antes del cruce, nunca atravesarlo.
        const limit = Math.min(...points.map(p => PENDIENTE_MAX[nivelDe(p.line.tags.highway)] || Infinity))
        const feasible = s.findIndex((d, i) => d >= VENTANA_M &&
          Math.abs(ground(...points[i].p) - root.h) <= limit * d * .75)
        const stop = feasible < 0 ? s.length - 1 : feasible
        points.length = stop + 1; s.length = stop + 1; edges.length = stop
      }
      if (edges.some(e => used.has(e))) continue
      for (const e of edges) used.add(e)
      if (points.length < 3) {
        report.skipped.push({ id: root.id, end: root.end, reason: 'short-access', lengthM: s.at(-1) })
        continue
      }
      const cap = Math.min(...points.map(p => PENDIENTE_MAX[nivelDe(p.line.tags.highway)] || Infinity))
      // El cero peatonal significa que no talla, no una pendiente física nula.
      const effectiveCap = Number.isFinite(cap) ? cap : Math.max(Math.abs(root.grade), .2)
      paths.push({ root, terminal, points, edges, s, cap: effectiveCap, h: points.map(({ p }) => ground(...p)) })
    }
  }
  const endpoints = new Map(), allRoots = [...roots.values()].flat()
  for (const c of originalStructures.report.chains) {
    const h = c.endpoints.map(p => p[2]), ownRoots = allRoots.filter(r => r.id === c.id)
    const cap = Math.min(chainCaps.get(c.id), ...ownRoots.map(r => r.cap), ...paths.filter(p => p.root.id === c.id || p.terminal?.id === c.id).map(p => p.cap))
    const low = h[0] <= h[1] ? 0 : 1, high = 1 - low, wanted = h[high] - cap * c.lengthM
    if (wanted > h[low] + 1e-9) {
      let ceiling = wanted
      const branches = paths.filter(p => p.root.id === c.id && p.root.end === low || p.terminal?.id === c.id && p.terminal.end === low)
      const r = ownRoots.find(r => r.end === low)
      const branchCount = ports(r.node).filter(p => !esPuente(p.line.tags) && !esTunel(p.line.tags)).length
      if (!branchCount || branches.length !== branchCount) ceiling = h[low]
      for (const p of branches) {
        const atStart = p.root.id === c.id && p.root.end === low
        ceiling = Math.min(ceiling, (atStart ? p.h.at(-1) : p.h[0]) + p.cap * p.s.at(-1))
      }
      h[low] = Math.max(h[low], ceiling)
    }
    endpoints.set(c.id, h)
  }
  // Una subida que deje cualquier acceso inviable crearía un escalón al
  // omitir ese acceso. Comprobar las propuestas juntas y retirar esas subidas
  // antes de materializar tableros. Cada extremo solo puede volver una vez a
  // su cota original: la cola es finita y no itera el suavizado del perfil.
  const affected = new Map(), rootKey = r => `${r.id}/${r.end}`
  for (const path of paths) for (const r of [path.root, path.terminal].filter(Boolean)) {
    const key = rootKey(r)
    if (!affected.has(key)) affected.set(key, [])
    affected.get(key).push(path)
  }
  const pending = [...paths]
  while (pending.length) {
    const path = pending.pop(), a = endpoints.get(path.root.id)[path.root.end]
    const b = path.terminal ? endpoints.get(path.terminal.id)[path.terminal.end] : path.h.at(-1)
    if (Math.abs(b - a) <= path.cap * path.s.at(-1) + 1e-8) continue
    for (const r of [path.root, path.terminal].filter(Boolean)) {
      const h = endpoints.get(r.id), original = chainById.get(r.id).endpoints[r.end][2]
      if (h[r.end] <= original) continue
      h[r.end] = original
      pending.push(...affected.get(rootKey(r)))
    }
  }
  for (const c of originalStructures.report.chains) {
    const h = endpoints.get(c.id)
    for (let end = 0; end < 2; end++) if (h[end] > c.endpoints[end][2]) {
      report.deckChanges.push({ id: c.id, end, raiseM: h[end] - c.endpoints[end][2],
        gradeBefore: Math.abs(c.endpoints[1][2] - c.endpoints[0][2]) / c.lengthM,
        gradeAfter: Math.abs(h[1] - h[0]) / c.lengthM })
    }
  }
  const structures = elevarPuentes(topology, ground, endpoints)
  const rootValues = r => {
    const h = endpoints.get(r.id), c = chainById.get(r.id)
    return { h: h[r.end], g: (r.end ? 1 : -1) * (h[1] - h[0]) / c.lengthM }
  }
  const edits = new Map(), corridors = [], resolvedEdges = new Set()
  for (const path of paths) {
    const { points, s, h, cap, root, terminal } = path, L = s.at(-1), n = s.length
    const a = rootValues(root), b = terminal ? rootValues(terminal) : { h: h.at(-1) }
    if (Math.abs(b.h - a.h) > cap * L + 1e-8) {
      report.skipped.push({ id: root.id, end: root.end, reason: 'infeasible-endpoints', lengthM: L,
        gradeRequired: Math.abs(b.h - a.h) / L, cap })
      continue
    }
    // Reservar hasta 20 m para la tangente evita esconder el quiebre a 10 cm.
    let ia = Math.max(1, s.findIndex(d => d >= Math.min(20, L / 4)))
    ia = Math.min(ia, n - 2)
    const ha = clamp(a.h + clamp(a.g, -cap, cap) * s[ia],
      Math.max(a.h - cap * s[ia], b.h - cap * (L - s[ia])),
      Math.min(a.h + cap * s[ia], b.h + cap * (L - s[ia])))
    const anchors = [[0, a.h], [ia, ha], [n - 1, b.h]]
    for (let i = 1; i < ia; i++) anchors.push([i, a.h + (ha - a.h) * s[i] / s[ia]])
    const ib = n - 2
    let hb = b.h
    if (ib > ia) {
      const wanted = terminal ? b.h + clamp(b.g, -cap, cap) * (L - s[ib]) : h[ib]
      hb = clamp(wanted,
        Math.max(ha - cap * (s[ib] - s[ia]), b.h - cap * (L - s[ib])),
        Math.min(ha + cap * (s[ib] - s[ia]), b.h + cap * (L - s[ib])))
      anchors.push([ib, hb])
    }
    // Apagar una tangente y encender la otra con la MISMA banda smoothstep.
    // La mezcla comienza en el final de la cuerda anclada: mezclar desde el
    // estribo y sobrescribir 20 m después trasladaba ahí el quiebre.
    const ga = (ha - a.h) / s[ia]
    const gb = ib > ia ? (b.h - hb) / (L - s[ib]) : (b.h - ha) / (L - s[ia])
    const blendEnd = ib > ia ? s[ib] : L
    const target = s.map(d => {
      if (d <= s[ia]) return a.h + ga * d
      if (d >= blendEnd) return b.h + gb * (d - L)
      const w = desvanecer((d - s[ia]) / (blendEnd - s[ia]))
      return w * (ha + ga * (d - s[ia])) + (1 - w) * (b.h + gb * (d - L))
    })
    const z = perfil(target, s, cap, 0, anchors)
    if (!z) throw new Error(`Anclas de acceso inconsistentes: ${root.id}/${root.end}`)
    let maxGrade = 0, maxInternalBreak = 0, prev
    for (let i = 1; i < n; i++) {
      const grade = (z[i] - z[i-1]) / (s[i] - s[i-1])
      maxGrade = Math.max(maxGrade, Math.abs(grade))
      if (prev !== undefined) maxInternalBreak = Math.max(maxInternalBreak, Math.abs(grade-prev))
      prev = grade
    }
    if (!Number.isFinite(maxGrade) || maxGrade > cap + 1e-7) throw new Error(`Pendiente imposible en acceso ${root.id}`)
    for (const edge of path.edges) resolvedEdges.add(edge)
    points.forEach(({ line, p }, i) => {
      if (!edits.has(line)) edits.set(line, new Map())
      edits.get(line).set(p, z[i])
    })
    // Anclar también la copia del nodo al comienzo del way siguiente.
    for (let i = 1; i < n; i++) if (points[i].line !== points[i-1].line) {
      const node = access.nodeOf.get(points[i-1].p)
      const next = (access.at.get(node) ?? []).find(e => e.line === points[i].line)
      if (next) edits.get(next.line).set(next.p, z[i-1])
    }
    const weights = s.map(d => terminal ? 1 : desvanecer(Math.max(0, (d / L - .75) / .25)))
    corridors.push({ tags: points[0].line.tags, coords: points.map(p => p.p), carvingHeights: z, carvingWeights: weights })
    report.paths.push({ id: root.id, end: root.end, terminal: terminal ? { id: terminal.id, end: terminal.end } : null,
      start: points[0].p, finish: points.at(-1).p,
      wayIds: [...new Set(points.map(p => p.line.osmId))], lengthM: L, cap, maxGrade, maxInternalBreak,
      startBreak: Math.abs((z[1] - z[0]) / (s[1] - s[0]) - a.g),
      endBreak: terminal ? Math.abs((z[n-1] - z[n-2]) / (s[n-1] - s[n-2]) + b.g)
        : Math.abs((z[n-1] - z[n-2] - h[n-1] + h[n-2]) / (s[n-1] - s[n-2])) })
  }
  const byWay = new Map()
  for (const [line, changed] of edits) {
    const original = new Set(line.coords), keep = sampled.get(line).filter(p => original.has(p) || changed.has(p))
    const coords = [keep[0]], heights = [changed.get(keep[0]) ?? ground(...keep[0])], ownSegments = []
    for (let i = 1; i < keep.length; i++) {
      const ia = indexOf.get(line).get(keep[i-1]), ib = indexOf.get(line).get(keep[i])
      const own = ib === ia + 1 && resolvedEdges.has(`${line.osmId}/${ia}`)
      const part = own ? [keep[i-1], keep[i]] : apoyar([keep[i-1], keep[i]], ground)
      for (const p of part.slice(1)) {
        coords.push(p); heights.push(changed.get(p) ?? ground(...p)); ownSegments.push(own)
      }
    }
    line.coords = coords
    byWay.set(line.osmId, { heights, ownSegments })
    const ranges = []
    for (let i = 0; i < ownSegments.length; i++) if (ownSegments[i]) {
      const from = i
      while (i + 1 < ownSegments.length && ownSegments[i + 1]) i++
      ranges.push([from, i + 1])
    }
    report.ownRanges.push({ osmId: line.osmId, ranges })
  }
  report.changedWayIds = [...byWay.keys()].sort((a,b) => a-b)
  return { byWay, structures, report, corridors }
}
