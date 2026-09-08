import { describe, it, expect } from 'vitest'
import { capturarAccesos, empalmarAccesos } from '../lib/bridge-approaches.mjs'
import { encadenarPuentes, elevarPuentes } from '../lib/structures.mjs'
import { subdividir } from '../lib/subdividir.mjs'
import { lineLengthMeters } from '../lib/geo.mjs'

const road = (osmId, xs, nodes, bridge = false) => ({ osmId, nodes,
  tags: { highway: 'residential', ...(bridge ? { bridge: 'yes' } : {}) },
  coords: xs.map(x => [x / 111319.490793, 0]) })
function run(lines, ground) {
  const access = capturarAccesos(lines), topology = encadenarPuentes(lines)
  for (const l of lines) l.coords = subdividir(l.coords, 5)
  const bridges = elevarPuentes(topology, ground)
  return empalmarAccesos(lines, access, topology, bridges, ground)
}

describe('acuerdos verticales de acceso', () => {
  it('iguala la tangente sin mover el tablero ni la cota de un cruce exterior', () => {
    const lines = [road(1, [0, 50], [1, 2], true), road(2, [50, 80, 150], [2, 3, 4]),
      road(3, [150, 200], [4, 5]), road(4, [150, 170], [4, 6])]
    const ground = lon => { const x = lon * 111319.490793; return x <= 50 ? 100 : 100 + Math.min(x - 50, 30) * .1 }
    const out = run(lines, ground)
    const p = out.byWay.get(2)
    expect(p).toBeDefined()
    expect(p.heights[0]).toBeCloseTo(100, 8)
    expect(p.heights[1]).toBeCloseTo(100, 8)
    expect(p.heights.at(-1)).toBeCloseTo(103, 8)
    expect(out.structures.byWay.get(1).heights.every(h => h === 100)).toBe(true)
    expect(out.byWay.has(3)).toBe(false)
    for (let i = 1; i < p.heights.length; i++) {
      expect(Math.abs(p.heights[i] - p.heights[i-1]) / lineLengthMeters(lines[1].coords.slice(i-1,i+1))).toBeLessThanOrEqual(.12 + 1e-8)
    }
  })

  it('levanta solo el extremo bajo de un tablero excesivo y conserva sus claros', () => {
    const lines = [road(1, [0, 20], [1, 2], true), road(2, [-150, 0], [3, 1]), road(3, [20, 170], [2, 4])]
    const ground = lon => Math.max(100, Math.min(110, 100 + lon * 111319.490793 * .5))
    const out = run(lines, ground)
    const h = out.structures.byWay.get(1).heights
    expect(h[0]).toBeCloseTo(107.6, 5)
    expect(h.at(-1)).toBeCloseTo(110, 8)
    expect(out.report.deckChanges).toHaveLength(1)
    expect(out.byWay.get(2).heights.at(-1)).toBeCloseTo(h[0], 8)
  })

  it('no inventa conexiones por proximidad ni modifica vías remotas', () => {
    const lines = [road(1,[0,50],[1,2],true), road(2,[50,150],[20,30])]
    const original = structuredClone(lines[1])
    const out = run(lines, () => 100)
    expect(out.byWay.size).toBe(0)
    expect(lines[1].coords[0]).toEqual(original.coords[0])
  })

  it('declara anclas imposibles sin crear una rampa fuera del límite', () => {
    const lines = [road(1,[0,50],[1,2],true), road(2,[50,60],[2,3]), road(3,[60,80],[3,4]), road(4,[60,70],[3,5])]
    const out = run(lines, lon => lon * 111319.490793 <= 50 ? 100 : 130)
    expect(out.byWay.has(2)).toBe(false)
    expect(out.report.skipped.some(r => r.reason === 'infeasible-endpoints')).toBe(true)
  })
})
