import { describe, it, expect } from 'vitest'
import { stateMask } from './stateMask'
import { pointInPolygon } from '../../scripts/lib/geo.mjs'
import municipiosJson from '../../public/data/municipios.json'
import terrainJson from '../../public/data/terrain.json'
import type { Municipio } from '../data/types'

const municipios = municipiosJson as Municipio[]
const bbox = terrainJson.bbox

const muni = (polygons: number[][][][]): Municipio =>
  ({ osmId: 0, name: 'x', polygons, orphanFragments: 0 })

const cuadrado = (w: number, e: number, s: number, n: number) =>
  [[[[w, s], [e, s], [e, n], [w, n]]]]

describe('stateMask', () => {
  it('rellena un polígono simple y deja fuera el resto del bbox', () => {
    const m = stateMask([muni(cuadrado(-0.5, 0.5, -0.5, 0.5))], { w: -1, e: 1, s: -1, n: 1 }, 21, 21)
    expect(m[10 * 21 + 10]).toBe(255)   // centro
    expect(m[0]).toBe(0)                // esquina NO del bbox
    expect(m[20 * 21 + 20]).toBe(0)     // esquina SE
  })

  // El caso que motiva rasterizar municipio por municipio: dos vecinos no
  // pueden dejar una grieta sobre el borde que comparten.
  it('no deja costura entre dos polígonos que comparten borde', () => {
    const W = 64, H = 64
    const m = stateMask(
      [muni(cuadrado(-0.5, 0, -0.5, 0.5)), muni(cuadrado(0, 0.5, -0.5, 0.5))],
      { w: -1, e: 1, s: -1, n: 1 }, W, H)
    for (let y = 0; y < H; y++) {
      const fila = [...m.subarray(y * W, y * W + W)]
      const ini = fila.indexOf(255)
      if (ini < 0) continue
      const fin = fila.lastIndexOf(255)
      // los rellenos de ambos cuadrados tienen que salir contiguos
      expect(fila.slice(ini, fin + 1).every(v => v === 255)).toBe(true)
    }
  })

  describe('contra los 29 municipios reales', () => {
    const W = 512, H = 512
    const mask = stateMask(municipios, bbox, W, H)

    // Contraste contra una implementación independiente (ray casting punto a
    // punto, scripts/lib/geo.mjs — la misma que asigna cada vía a su
    // municipio) sobre vértices exactos de la rejilla, donde la máscara no
    // interpola nada y las dos respuestas tienen que coincidir.
    it('coincide con pointInPolygon en una muestra de vértices', () => {
      let semilla = 12345
      const rnd = () => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
      let dentro = 0, discrepan = 0
      for (let k = 0; k < 400; k++) {
        const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H)
        const lon = bbox.w + (bbox.e - bbox.w) * x / (W - 1)
        const lat = bbox.n - (bbox.n - bbox.s) * y / (H - 1)
        const real = municipios.some(m => m.polygons.some(p => pointInPolygon(lon, lat, p)))
        if (real) dentro++
        if (real !== (mask[y * W + x] === 255)) discrepan++
      }
      expect(discrepan).toBe(0)
      expect(dentro).toBeGreaterThan(100)   // la muestra tocó el estado de verdad
    })

    it('no deja pinchazos de un vértice dentro del estado', () => {
      let huecos = 0
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x
          if (!mask[i] && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W]) huecos++
        }
      }
      expect(huecos).toBe(0)
    })

    it('cubre una fracción del bbox coherente con el área del estado', () => {
      // Táchira ~11.100 km2; el bbox del terreno ~136 x 164 km ~ 22.200 km2.
      const frac = mask.reduce((a, v) => a + (v ? 1 : 0), 0) / (W * H)
      expect(frac).toBeGreaterThan(0.44)
      expect(frac).toBeLessThan(0.56)
    })
  })
})
