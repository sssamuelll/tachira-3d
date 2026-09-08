import { describe, expect, it } from 'vitest'
import type { Way } from '../data/types'
import { anchoCalzada } from './calzada'
import { bordeDe } from './seccion'
import { prepararJuntas } from './juntas'

type Punto = [number, number, number]
const O: Punto = [0, 0, 0]
const via = (props: Partial<Way> = {}): Way => ({
  osmId: 1, ref: null, name: null, highway: 'residential', surface: null,
  tipo: 'sin_definir', municipio: null, km: 1, km3d: 1, ...props,
})
function red (trazos: Punto[][], props: Partial<Way> = {}) {
  const coords: number[] = []
  const indices = [0]
  for (const trazo of trazos) {
    for (let i = 1; i < trazo.length; i++) coords.push(...trazo[i - 1], ...trazo[i])
    indices.push(coords.length / 6)
  }
  return { positions: new Float32Array(coords), index: new Uint32Array(indices), ways: trazos.map(() => via(props)) }
}
function preparar (trazos: Punto[][], props: Partial<Way> = {}) {
  const { positions, index, ways } = red(trazos, props)
  return prepararJuntas(positions, index, ways)
}

describe('prepararJuntas', () => {
  it('una T limita las tapas en el nodo y abre los tres brazos', () => {
    const j = preparar([[[ -100, 0, 0 ], O, [100, 0, 0]], [[0, 0, 100], O]])
    expect(j.nodos).toBe(1)
    expect(Array.from(j.limites)).toEqual([1e9, 0, 0, 1e9, 1e9, 0])
    expect(j.zonas[3]).toBeGreaterThan(0)
    expect(j.zonas[5]).toBe(j.zonas[3])
    expect(j.zonas[11]).toBe(j.zonas[3])
  })

  it.each([
    [[[ -100, 0, 0 ], O, [100, 0, 0]], [[0, 0, -100], O, [0, 0, 100]]],
    [[O, [100, 0, 0]], [O, [-50, 0, 86]], [O, [-50, 0, -86]]],
  ] as Punto[][][])('una X o una Y resuelve un solo encuentro', (...trazos) => {
    const j = preparar(trazos)
    expect(j.nodos).toBe(1)
    expect(Array.from(j.zonas).filter((_, i) => i % 2 === 1 && j.zonas[i] > 0)).toHaveLength(trazos.length === 2 ? 4 : 3)
  })

  it('deja completamente neutras rectas, curvas y uniones grado dos entre ways', () => {
    const j = preparar([[[ -10, 0, 0 ], O, [5, 1, 10]], [[5, 1, 10], [0, 2, 20]], [[100, 0, 0], [200, 0, 0]]])
    expect(j.nodos).toBe(0)
    expect(Array.from(j.zonas)).toEqual(new Array(16).fill(0))
    expect(Array.from(j.limites)).toEqual(new Array(8).fill(1e9))
  })

  it('no conecta coordenadas próximas ni cruces con distinta altura', () => {
    const j = preparar([[[ -100, 0, 0 ], O, [100, 0, 0]], [[0, 1, 100], [0, 1, 0]], [[0, 0, -100], [0.001, 0, 0]]])
    expect(j.nodos).toBe(0)
    expect(j.zonas.every(v => v === 0)).toBe(true)
  })

  it('propaga la junta por segmentos cortos sin mover las posiciones', () => {
    const r = red([[[ -100, 0, 0 ], O, [100, 0, 0]], [[0, 0, 100], [0, 0, 2], [0, 0, 0.005], O]])
    const copia = r.positions.slice()
    const j = prepararJuntas(r.positions, r.index, r.ways)
    expect(j.limites[9]).toBe(0)
    expect(j.limites[7]).toBeCloseTo(0.005)
    expect(j.limites[5]).toBeCloseTo(2)
    expect(j.zonas[10]).toBeCloseTo(2)
    expect(j.zonas[11]).toBe(j.zonas[3])
    expect(r.positions).toEqual(copia)
  })

  it('no propaga fuera del alcance local ni a través de una desconexión', () => {
    const r = red([[[ -100, 0, 0 ], O, [100, 0, 0]], [O, [0, 0, 3], [0, 0, 6], [0, 0, 200], [0, 0, 300]]])
    // Rompe la continuidad entre los segmentos [0,3] y [3,6].
    r.positions[18] = 50
    const j = prepararJuntas(r.positions, r.index, r.ways)
    expect(j.zonas[9]).toBeGreaterThan(0)
    expect(j.zonas.slice(12).every(v => v === 0)).toBe(true)
    expect(j.limites.slice(6).every(v => v === 1e9)).toBe(true)
  })

  it('dos nodos interiores conservan la junta más cercana en cada sentido', () => {
    const j = preparar([
      [[-100, 0, 0], O, [5, 0, 0], [10, 0, 0], [100, 0, 0]],
      [O, [0, 0, 100]], [[10, 0, 0], [10, 0, -100]],
    ])
    expect(j.nodos).toBe(2)
    expect(j.zonas[4]).toBe(0)
    expect(j.zonas[6]).toBe(5)
    expect(j.zonas[8]).toBe(5)
    expect(j.zonas[10]).toBe(0)
    expect(j.limites[2]).toBe(0)
    expect(j.limites[3]).toBe(5)
    expect(j.limites[4]).toBe(5)
    expect(j.limites[5]).toBe(0)
  })

  it('un segmento de longitud cero no inventa un cruce ni corta la propagación', () => {
    const normal = preparar([[[ -100, 0, 0 ], O, O, [100, 0, 0]]])
    expect(normal.nodos).toBe(0)
    const j = preparar([[[ -100, 0, 0 ], O, [100, 0, 0]], [[0, 0, 100], [0, 0, 2], [0, 0, 2], O]])
    expect(j.nodos).toBe(1)
    expect(j.limites[7]).toBe(2)
    expect(j.limites[5]).toBe(2)
  })

  it('brazos duplicados no convierten la continuidad en una junta', () => {
    const j = preparar([[[ -100, 0, 0 ], O, [100, 0, 0]], [O, [100, 0, 0]]])
    expect(j.nodos).toBe(0)
  })

  it('el radio incluye el ancho y el borde, aumenta en ángulos agudos y tiene tope', () => {
    const t = preparar([[O, [100, 0, 0]], [O, [-100, 0, 0]], [O, [0, 0, 100]]])
    const agudo = preparar([[O, [100, 0, 0]], [O, [-100, 0, 0]], [O, [100, 0, 1]]])
    const grande = preparar([[O, [100, 0, 0]], [O, [-100, 0, 0]], [O, [0, 0, 100]]], { lanes: 6, highway: 'motorway' })
    expect(t.zonas[1]).toBeGreaterThanOrEqual(anchoCalzada(via()) / 2 + Math.abs(bordeDe(via())))
    expect(agudo.zonas[1]).toBeGreaterThan(t.zonas[1])
    expect(agudo.zonas[1]).toBeLessThanOrEqual(80)
    expect(grande.zonas[1]).toBeGreaterThan(t.zonas[1])
    expect(t.zonas[1]).toBeLessThan(20) // La pareja colineal no dispara el radio.
  })
})
