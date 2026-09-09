// @ts-expect-error -- Sólo Vitest/Node; el proyecto del navegador no incluye @types/node.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Way } from '../data/types'
import { anchoCalzada } from './calzada'
import { bordeDe } from './seccion'
import { prepararJuntas, type Juntas } from './juntas'

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

  it('propaga a través de ways partidas e invertidas en un nodo de grado dos', () => {
    const j = preparar([
      [[-100, 0, 0], O, [100, 0, 0]],
      [[0, 0, 0.005], O],
      [[0, 0, 0.005], [0, 0, 2]], // Continuación orientada al revés.
      [[0, 0, 100], [0, 0, 2]],
    ])
    expect(j.nodos).toBe(1)
    expect(j.limites[6]).toBeCloseTo(0.005)
    expect(j.limites[9]).toBeCloseTo(2)
    expect(j.zonas[12]).toBeCloseTo(0.005)
    expect(j.zonas[18]).toBeCloseTo(2)
    expect(j.zonas[13]).toBe(j.zonas[19])
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

  it('una curva junto a la junta acumula distancia de arco y deja intacta la vía lejana', () => {
    const j = preparar([[[ -100, 0, 0 ], O, [100, 0, 0]], [O, [0, 0, 3], [4, 0, 3], [4, 0, 200], [4, 0, 300]]])
    expect(j.zonas[16]).toBe(7) // 3 + 4, no la distancia recta de 5 m.
    expect(j.limites[8]).toBe(7)
    expect(j.zonas.slice(20).every(v => v === 0)).toBe(true)
    expect(j.limites.slice(10).every(v => v === 1e9)).toBe(true)
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
    expect(j.limites[7]).toBe(1e9) // El tramo invisible queda neutro.
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

  it('el núcleo cubre el solape de bandas de anchos distintos en ángulos distintos', () => {
    for (const grados of [15, 30, 60, 90, 120, 150]) {
      const angulo = grados * Math.PI / 180
      const cos = Math.cos(angulo), sin = Math.sin(angulo)
      const r = red([[O, [100, 0, 0]], [O, [100 * cos, 0, 100 * sin]], [O, [-100, 0, 0]]])
      r.ways[0] = via({ lanes: 1 })
      r.ways[1] = via({ lanes: 6, highway: 'motorway' })
      const j = prepararJuntas(r.positions, r.index, r.ways)
      const hA = anchoCalzada(r.ways[0]) / 2 + Math.abs(bordeDe(r.ways[0]))
      const hB = anchoCalzada(r.ways[1]) / 2 + Math.abs(bordeDe(r.ways[1]))
      // Muestreo independiente de pertenencia a DOS semibandas. No reproduce
      // la fórmula del radio: encuentra puntos del solape que deben estar
      // dentro del núcleo desde ambos brazos.
      let peor = 0
      for (let longitudinal = 0; longitudinal < 80; longitudinal += 0.5) {
        for (let lateral = -hA; lateral <= hA; lateral += 0.25) {
          const sobreB = longitudinal * cos + lateral * sin
          const distanciaB = Math.abs(longitudinal * sin - lateral * cos)
          if (sobreB >= 0 && distanciaB <= hB) peor = Math.max(peor, longitudinal, sobreB)
        }
      }
      expect(peor).toBeLessThanOrEqual(j.zonas[1] + 1e-5)
    }
  })

  it('la jerarquía de una junta pertenece a sus vías incidentes, no a la troncal vecina', () => {
    const r = red([
      [[-100, 0, 0], O, [100, 0, 0]], [[0, 0, 100], [0, 0, 2], O],
      [[-100, 0, 1], [100, 0, 1]],
    ])
    r.ways[0] = via({ highway: 'secondary' })
    r.ways[2] = via({ highway: 'motorway' })
    const j = prepararJuntas(r.positions, r.index, r.ways)
    expect(Array.from(j.niveles)).toEqual([4, 4, 4, 4, 0])
  })

  it('un segmento influido por dos juntas conserva la jerarquía más alta sin transmitirla a la otra', () => {
    const r = red([
      [[-100, 0, 0], O, [10, 0, 0], [100, 0, 0]],
      [O, [0, 0, 100]], [[10, 0, 0], [10, 0, 100]],
    ])
    r.ways[1] = via({ highway: 'secondary' })
    const j = prepararJuntas(r.positions, r.index, r.ways)
    expect(Array.from(j.niveles)).toEqual([4, 4, 2, 4, 2])
  })
})

describe('juntas del buffer real: Obelisco de los Italianos', () => {
  const casos = [
    { nombre: 'T norte inmediata, 7.768989 / -72.214222', xyz: [-34492.734375, 807.2229004, 27969.8925781], grado: 3 },
    { nombre: 'T norte siguiente, 7.769107 / -72.214262', xyz: [-34497.0703125, 807.5610352, 27956.8378906], grado: 3 },
    { nombre: 'encuentro este de cuatro brazos', xyz: [-34486.7421875, 807.01550293, 27985.857421875], grado: 4 },
    { nombre: 'encuentro sur de cinco brazos', xyz: [-34478.52734375, 806.58673096, 28020.1171875], grado: 5 },
    { nombre: 'encuentro oeste de seis brazos', xyz: [-34505.78125, 806.10095215, 27988.31640625], grado: 6 },
  ]
  let juntas: Juntas
  let segmentos: number
  const extremos = new Map<string, number[]>()
  const clave = (xyz: ArrayLike<number>) => `${Math.fround(xyz[0])},${Math.fround(xyz[1])},${Math.fround(xyz[2])}`
  beforeAll(() => {
    const posBin = readFileSync('public/data/roads-pos.bin')
    const idxBin = readFileSync('public/data/roads-index.bin')
    const positions = new Float32Array(posBin.buffer, posBin.byteOffset, posBin.byteLength / 4)
    const index = new Uint32Array(idxBin.buffer, idxBin.byteOffset, idxBin.byteLength / 4)
    const ways = JSON.parse(readFileSync('public/data/roads-meta.json', 'utf8')).ways as Way[]
    juntas = prepararJuntas(positions, index, ways)
    segmentos = positions.length / 6
    const xs = new Set(casos.map(c => Math.fround(c.xyz[0])))
    for (const c of casos) extremos.set(clave(c.xyz), [])
    for (let e = 0; e < positions.length / 3; e++) {
      if (!xs.has(positions[e * 3])) continue
      extremos.get(clave(positions.subarray(e * 3, e * 3 + 3)))?.push(e)
    }
  })

  it.each(casos)('$nombre: todos sus brazos cierran la tapa en el XYZ compartido', ({ xyz, grado }) => {
    const encontrados = extremos.get(clave(xyz))!
    expect(encontrados).toHaveLength(grado)
    const radio = juntas.zonas[encontrados[0] * 2 + 1]
    expect(radio).toBeGreaterThan(0)
    expect(radio).toBeLessThan(80)
    for (const e of encontrados) {
      expect(juntas.limites[e]).toBe(0)
      expect(juntas.zonas[e * 2]).toBe(0)
      expect(juntas.zonas[e * 2 + 1]).toBe(radio)
    }
  })

  it('mantiene más de 85% de los segmentos reales completamente neutros', () => {
    let neutros = 0
    for (let s = 0; s < segmentos; s++) {
      if (juntas.zonas[s * 4 + 1] === 0 && juntas.zonas[s * 4 + 3] === 0) {
        neutros++
        if (juntas.limites[s * 2] !== 1e9 || juntas.limites[s * 2 + 1] !== 1e9) throw new Error(`Tapa afectada fuera de una junta: ${s}`)
      }
    }
    expect(juntas.nodos).toBeGreaterThan(0)
    expect(neutros / segmentos).toBeGreaterThan(0.85)
  })
})
