import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stateMask } from '../lib/state-mask.mjs'
import { pointInPolygon } from '../lib/geo.mjs'
import { tileXf, tileYf, tileYToLat } from '../lib/terrarium.mjs'

const muni = (polygons) => ({ osmId: 0, name: 'x', polygons, orphanFragments: 0 })
const cuadrado = (w, e, s, n) => [[[[w, s], [e, s], [e, n], [w, n]]]]
// Rejilla uniforme en lat/lon sobre [-1, 1]².
const uniforme = (W, H) => ({
  W, H,
  colOf: lon => (lon + 1) * (W - 1) / 2,
  rowOf: lat => (1 - lat) * (H - 1) / 2,
  latDeFila: y => 1 - 2 * y / (H - 1),
})

describe('stateMask (pipeline)', () => {
  it('rellena un polígono simple y deja fuera el resto', () => {
    const m = stateMask([muni(cuadrado(-0.5, 0.5, -0.5, 0.5))], uniforme(21, 21))
    expect(m[10 * 21 + 10]).toBe(255)
    expect(m[0]).toBe(0)
    expect(m[20 * 21 + 20]).toBe(0)
  })

  it('no deja costura entre dos polígonos que comparten borde', () => {
    const W = 64, H = 64
    const m = stateMask([muni(cuadrado(-0.5, 0, -0.5, 0.5)), muni(cuadrado(0, 0.5, -0.5, 0.5))], uniforme(W, H))
    for (let y = 0; y < H; y++) {
      const fila = [...m.subarray(y * W, y * W + W)]
      const ini = fila.indexOf(255)
      if (ini < 0) continue
      expect(fila.slice(ini, fila.lastIndexOf(255) + 1).every(v => v === 255)).toBe(true)
    }
  })

  // La rejilla del DEM es uniforme en Mercator, no en latitud: por eso la
  // rejilla se abstrae. Contraste contra ray casting punto a punto sobre
  // posts exactos, donde no hay interpolación y las dos respuestas coinciden.
  it('coincide con pointInPolygon sobre una rejilla Mercator de posts del Táchira', () => {
    const municipios = JSON.parse(readFileSync('public/data/municipios.json', 'utf8'))
    const z = 12, x0 = 1223, y0 = 1948, W = 14 * 64, H = 17 * 64   // un post de cada 4
    const rej = {
      W, H,
      colOf: lon => (tileXf(lon, z) - x0) * 64,
      rowOf: lat => (tileYf(lat, z) - y0) * 64,
      latDeFila: y => tileYToLat(y0 + y / 64, z),
    }
    const m = stateMask(municipios, rej)
    let semilla = 12345, dentro = 0, discrepan = 0
    const rnd = () => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let k = 0; k < 400; k++) {
      const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H)
      const lon = (x0 + x / 64) / 2 ** z * 360 - 180
      const lat = tileYToLat(y0 + y / 64, z)
      const real = municipios.some(mu => mu.polygons.some(p => pointInPolygon(lon, lat, p)))
      if (real) dentro++
      if (real !== (m[y * W + x] === 255)) discrepan++
    }
    expect(discrepan).toBe(0)
    expect(dentro).toBeGreaterThan(100)
  })
})
