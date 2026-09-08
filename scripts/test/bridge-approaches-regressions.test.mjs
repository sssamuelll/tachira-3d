import { describe, it, expect } from 'vitest'
import { capturarAccesos, empalmarAccesos } from '../lib/bridge-approaches.mjs'
import { encadenarPuentes, elevarPuentes } from '../lib/structures.mjs'
import { subdividir } from '../lib/subdividir.mjs'

const METROS_GRADO = 111319.490793
const road = (osmId, xs, nodes, bridge = false) => ({ osmId, nodes,
  tags: { highway: 'residential', ...(bridge ? { bridge: 'yes' } : {}) },
  coords: xs.map(x => [x / METROS_GRADO, 0]) })

function run (lines, ground) {
  const access = capturarAccesos(lines), topology = encadenarPuentes(lines)
  for (const line of lines) line.coords = subdividir(line.coords, 30)
  return empalmarAccesos(lines, access, topology, elevarPuentes(topology, ground), ground)
}

describe('regresiones de accesos de puente', () => {
  it('respeta también la clase de los ways interiores de una cadena de puente', () => {
    const lines = [road(1, [0, 20], [1, 2], true), road(2, [20, 40], [2, 3], true),
      road(3, [40, 60], [3, 4], true), road(4, [-150, 0], [5, 1]), road(5, [60, 210], [4, 6])]
    lines[1].tags.highway = 'primary'
    const out = run(lines, lon => 100 + Math.max(0, Math.min(60, lon * METROS_GRADO)) * .1)
    const h = out.structures.byWay.get(2).heights
    expect((h.at(-1) - h[0]) / 20).toBeLessThanOrEqual(.08 + 1e-7)
  })

  it('la topología de acceso no retiene los puntos de carreteras lejanas', () => {
    const bridge = road(1, [0, 50], [1, 2], true)
    const close = road(2, [50, 150], [2, 3])
    const far = road(3, [10000, 10100], [4, 5])
    const access = capturarAccesos([bridge, close, far])
    expect(access.nodeOf.get(close.coords[0])).toBe(2)
    expect(access.at.has(4)).toBe(false)
    expect(access.nodeOf.has(far.coords[0])).toBe(false)
  })

  it('comparte la cota corregida al continuar por un way con los nodos invertidos', () => {
    const lines = [road(1, [-20, 0], [1, 2], true), road(2, [0, 30], [2, 3]),
      road(3, [150, 30], [4, 3])]
    const ground = lon => 100 + Math.max(0, Math.min(lon * METROS_GRADO, 30)) * 0.1
    const out = run(lines, ground)
    const left = out.byWay.get(2), right = out.byWay.get(3)
    expect(left).toBeDefined()
    expect(right).toBeDefined()
    expect(left.heights.at(-1)).toBeCloseTo(right.heights.at(-1), 9)
    expect(left.heights.at(-1)).toBeLessThan(102.9)
    expect(right.heights[0]).toBeCloseTo(103, 9)
  })

  it('drapea el hueco entre dos acuerdos del mismo way en vez de unirlo por una cuerda propia', () => {
    const lines = [road(1, [-20, 0], [1, 2], true), road(2, [0, 310], [2, 3]),
      road(3, [310, 330], [3, 4], true)]
    const ground = lon => 100 + 20 * Math.max(0, 1 - Math.abs(lon * METROS_GRADO - 155) / 3)
    const out = run(lines, ground)
    const p = out.byWay.get(2), coords = lines[1].coords
    const atHill = coords.findIndex((point, i) => i > 0 &&
      coords[i - 1][0] * METROS_GRADO < 155 && point[0] * METROS_GRADO >= 155)
    expect(p.ownSegments[atHill - 1]).toBe(false)
    expect(Math.max(...p.heights)).toBeGreaterThan(115)
  })

  it('conserva el tablero cuando levantarlo dejaría un escalón con un acceso inviable', () => {
    const lines = [road(1, [0, 20], [1, 2], true), road(2, [-10, 0], [3, 1]),
      road(3, [20, 170], [2, 4])]
    const ground = lon => {
      const x = lon * METROS_GRADO
      return x < -0.01 ? 100 : x < 20 ? x * 0.5 : 10
    }
    const out = run(lines, ground)
    expect(out.report.skipped.some(r => r.reason === 'infeasible-endpoints' && r.end === 0)).toBe(true)
    expect(out.byWay.has(2)).toBe(false)
    expect(out.structures.byWay.get(1).heights[0]).toBe(0)
    expect(out.structures.byWay.get(1).heights.at(-1)).toBe(10)
    expect(out.report.deckChanges).toEqual([])
  })
})
