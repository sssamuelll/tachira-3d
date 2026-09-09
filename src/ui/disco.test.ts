import { describe, it, expect } from 'vitest'
import { encajar, relieve } from './disco'
import { BBOX } from '../data/constants'
import type { TerrainMeta, Municipio } from '../data/types'

const LADO = 150
const MARGEN = 5

describe('encajar', () => {
  const e = encajar(BBOX, LADO, MARGEN)

  it('pone las cuatro esquinas del bbox en las esquinas del rectángulo', () => {
    const no = e.aPixel(BBOX.n, BBOX.w)
    const se = e.aPixel(BBOX.s, BBOX.e)
    expect(no.x).toBeCloseTo(e.x, 6)
    expect(no.y).toBeCloseTo(e.y, 6)
    expect(se.x).toBeCloseTo(e.x + e.w - 1, 6)
    expect(se.y).toBeCloseTo(e.y + e.h - 1, 6)
  })

  it('el rectángulo cabe en el disco con el margen pedido', () => {
    expect(Math.max(e.w, e.h)).toBeLessThanOrEqual(LADO - MARGEN * 2)
    expect(e.x).toBeGreaterThanOrEqual(MARGEN - 0.5)
    expect(e.y).toBeGreaterThanOrEqual(MARGEN - 0.5)
    // Centrado: lo que sobra a un lado sobra igual al otro.
    expect(e.x * 2 + e.w).toBeCloseTo(LADO, 6)
    expect(e.y * 2 + e.h).toBeCloseTo(LADO, 6)
  })

  it('no deforma: un grado de longitud es más corto que uno de latitud', () => {
    // A 8° de latitud, cos(8°) = 0,990. Si alguien quitara la corrección, la
    // proporción saldría la del bbox en grados crudos y este test lo vería.
    const cos = Math.cos((BBOX.n + BBOX.s) / 2 * Math.PI / 180)
    const esperado = (BBOX.e - BBOX.w) * cos / (BBOX.n - BBOX.s)
    expect(e.w / e.h).toBeCloseTo(esperado, 2)
    expect(e.w).toBeLessThan(e.h)   // el Táchira es más alto que ancho
  })

  it('ida y vuelta: el píxel vuelve a la coordenada de la que salió', () => {
    for (const [lat, lon] of [
      [BBOX.n, BBOX.w], [BBOX.s, BBOX.e], [7.77, -71.9], [8.02, -72.2],
    ] as const) {
      const p = e.aPixel(lat, lon)
      const g = e.aGeo(p.x, p.y)
      expect(g.lat).toBeCloseTo(lat, 9)
      expect(g.lon).toBeCloseTo(lon, 9)
    }
  })
})

// Rejilla de juguete: una ladera que sube hacia el este, con el DEM a mayor
// resolución que el minimapa (que es el caso real: 1024 contra ~140).
const meta: TerrainMeta = {
  width: 64, height: 64,
  bbox: { s: 0, w: 0, n: 1, e: 1 },
  min: 0, max: 1000,
  origin: { lat: 0.5, lon: 0.5, h: 0 },
  dem: { z: 12, x0: 0, y0: 0, nx: 1, ny: 1 },   // el minimapa no lo mira
}
const grid = new Int16Array(64 * 64)
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) grid[y * 64 + x] = x * 16

// Un "estado" que ocupa la mitad oeste del bbox.
const municipios: Municipio[] = [{
  osmId: 1, name: 'Mitad', orphanFragments: 0,
  polygons: [[[[0, 0], [0.5, 0], [0.5, 1], [0, 1]]]],
}]

describe('relieve', () => {
  const w = 32, h = 32
  const px = relieve(grid, meta, municipios, w, h)
  const at = (x: number, y: number) => {
    const o = (y * w + x) * 4
    return { r: px[o], g: px[o + 1], b: px[o + 2], a: px[o + 3] }
  }

  it('devuelve RGBA del tamaño pedido', () => {
    expect(px.length).toBe(w * h * 4)
  })

  it('recorta al contorno: opaco dentro, transparente fuera', () => {
    expect(at(4, 16).a).toBe(255)     // mitad oeste: dentro
    expect(at(28, 16).a).toBe(0)      // mitad este: fuera
  })

  it('sigue la rampa hipsométrica: lo alto sale más claro que lo bajo', () => {
    // La ladera sube hacia el este y la rampa termina en casi blanco, así que
    // dentro del estado el píxel más oriental es el más claro.
    const bajo = at(1, 16), alto = at(14, 16)
    expect(alto.r + alto.g + alto.b).toBeGreaterThan(bajo.r + bajo.g + bajo.b)
  })

  it('sombrea: la misma altura se ve distinta según hacia dónde caiga', () => {
    // Dos rejillas idénticas salvo el signo de la pendiente. Si el sombreado
    // no dependiera de la normal, saldrían del mismo color.
    const sube = new Int16Array(64 * 64)
    const baja = new Int16Array(64 * 64)
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        sube[y * 64 + x] = 500 + (x - 32) * 8
        baja[y * 64 + x] = 500 - (x - 32) * 8
      }
    }
    const a = relieve(sube, meta, municipios, w, h)
    const b = relieve(baja, meta, municipios, w, h)
    const o = (16 * w + 8) * 4
    expect(a[o + 3]).toBe(255)
    expect(Math.abs(a[o] - b[o])).toBeGreaterThan(4)
  })

  it('sale en sRGB, no en el lineal del shader', () => {
    // Terreno llano a la altura mínima: el color es la primera parada de la
    // rampa (0,18 lineal) con el sombreado al tope. En sRGB eso son ~118 de
    // 255; escrito crudo en el canvas, 46 -- el minimapa saldría verde botella
    // junto a un mapa verde oliva. El umbral separa los dos casos de sobra.
    const llano = relieve(new Int16Array(64 * 64), meta, municipios, w, h)
    expect(llano[(16 * w + 4) * 4]).toBeGreaterThan(90)
  })

  it('no se sale de la rejilla en los bordes', () => {
    // Los píxeles del borde miden su pendiente contra vecinos que no existen;
    // si el acotado fallara, saldrían NaN y el canal quedaría en 0.
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [1, h - 1]] as const) {
      const c = at(x, y)
      if (c.a === 0) continue
      expect(Number.isFinite(c.r)).toBe(true)
      expect(c.r + c.g + c.b).toBeGreaterThan(0)
    }
  })
})
