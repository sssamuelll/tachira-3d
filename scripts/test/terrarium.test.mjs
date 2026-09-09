import { test, expect } from 'vitest'
import {
  decodeTerrarium, lonToTileX, latToTileY, tileRangeForBbox, sampleBilinear, downsample,
  tileXf, tileYf, tileXToLon, tileYToLat, limpiarAnomalias,
} from '../lib/terrarium.mjs'

/** Rejilla plana width x height a un valor base, para las pruebas de limpiarAnomalias. */
function rejilla (width, height, base = 1000) {
  return { data: new Float32Array(width * height).fill(base), width, height }
}

test('la tesela fraccionaria tiene por parte entera la tesela de siempre', () => {
  for (const [lon, lat, z] of [[-72.22, 7.77, 13], [-71.9, 8.02, 12], [-72.4878, 7.3613, 8]]) {
    expect(Math.floor(tileXf(lon, z))).toBe(lonToTileX(lon, z))
    expect(Math.floor(tileYf(lat, z))).toBe(latToTileY(lat, z))
  }
})

test('tesela fraccionaria: ida y vuelta exacta', () => {
  expect(tileXToLon(tileXf(-72.22, 12), 12)).toBeCloseTo(-72.22, 9)
  expect(tileYToLat(tileYf(7.77, 12), 12)).toBeCloseTo(7.77, 9)
})

const BBOX = { s: 7.3612911, w: -72.4878225, n: 8.6826552, e: -71.3153029 }

test('decodeTerrarium: el nivel del mar es el offset 32768', () => {
  expect(decodeTerrarium(128, 0, 0)).toBeCloseTo(0, 6)
  expect(decodeTerrarium(128, 100, 0)).toBeCloseTo(100, 6)
  expect(decodeTerrarium(127, 156, 0)).toBeCloseTo(-100, 6)
})

test('coordenadas de tile conocidas', () => {
  expect(lonToTileX(-180, 1)).toBe(0)
  expect(lonToTileX(0, 1)).toBe(1)
  expect(latToTileY(0, 1)).toBe(1)
})

test('el bbox del Tachira son 14 x 17 = 238 tiles a z12', () => {
  const r = tileRangeForBbox(BBOX, 12)
  expect(r.nx).toBe(14)
  expect(r.ny).toBe(17)
  expect(r.nx * r.ny).toBe(238)
})

test('sampleBilinear devuelve el valor exacto en un vertice del grid', () => {
  const dem = {
    data: Float32Array.from([0, 100, 200, 300]), width: 2, height: 2,
    bounds: { s: 0, w: 0, n: 1, e: 1 },
  }
  // fila 0 es el norte: (w,n)=0 (e,n)=100 / (w,s)=200 (e,s)=300
  expect(sampleBilinear(dem, 0, 1)).toBeCloseTo(0, 5)
  expect(sampleBilinear(dem, 1, 0)).toBeCloseTo(300, 5)
  expect(sampleBilinear(dem, 0.5, 0.5)).toBeCloseTo(150, 5)
})

test('downsample reduce a 1024x1024 conservando el rango', () => {
  const w = 2048, h = 2048
  const data = new Float32Array(w * h)
  for (let i = 0; i < data.length; i++) data[i] = (i % 1000)
  const out = downsample({ data, width: w, height: h }, 1024, 1024)
  expect(out).toBeInstanceOf(Int16Array)
  expect(out.length).toBe(1024 * 1024)
  expect(Math.max(...out.slice(0, 5000))).toBeGreaterThan(0)
})

// Un post cuyo valor supera a TODOS sus 8 vecinos (una ladera real cambia
// junto con sus vecinos, no contra los ocho a la vez) es ruido de la fuente
// Terrarium, no relieve: sale como una aguja o un pozo de una sola celda al
// triangular. limpiarAnomalias lo sustituye por la mediana de esos 8 vecinos.
// Umbral por defecto 80 m, medido contra el DEM real del Tachira (saver,
// 2026-09-09): separa los picos/crateres reportados del ruido normal de la
// rejilla sin tocar relieve real.

test('limpiarAnomalias: aguja aislada -> se sustituye por la mediana de sus vecinos', () => {
  const dem = rejilla(5, 5, 1000)
  dem.data[2 * 5 + 2] = 1200 // (x=2,y=2), rodeada de 1000
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 1 })
  expect(dem.data[2 * 5 + 2]).toBe(1000)
})

test('limpiarAnomalias: pozo aislado -> se sustituye por la mediana de sus vecinos', () => {
  const dem = rejilla(5, 5, 1000)
  dem.data[2 * 5 + 2] = 800
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 1 })
  expect(dem.data[2 * 5 + 2]).toBe(1000)
})

test('limpiarAnomalias: una ladera real (los vecinos suben con ella) queda intacta', () => {
  const w = 5, h = 5
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = 1000 + y * 10
  const dem = { data: data.slice(), width: w, height: h }
  const r = limpiarAnomalias(dem, 80)
  expect(r).toEqual({ posts: 0 })
  expect(dem.data).toEqual(data)
})

test('limpiarAnomalias: el umbral es estricto -- justo debajo no toca, justo encima si', () => {
  const bajoUmbral = rejilla(5, 5, 1000)
  bajoUmbral.data[2 * 5 + 2] = 1079 // max(vecinos) + 79 < max + 80
  expect(limpiarAnomalias(bajoUmbral, 80)).toEqual({ posts: 0 })
  expect(bajoUmbral.data[2 * 5 + 2]).toBe(1079)

  const sobreUmbral = rejilla(5, 5, 1000)
  sobreUmbral.data[2 * 5 + 2] = 1081 // max(vecinos) + 81 > max + 80
  expect(limpiarAnomalias(sobreUmbral, 80)).toEqual({ posts: 1 })
  expect(sobreUmbral.data[2 * 5 + 2]).toBe(1000)
})

test('limpiarAnomalias: un post de borde no tiene 8 vecinos y se deja intacto', () => {
  const dem = rejilla(5, 5, 1000)
  dem.data[0] = 5000 // esquina (x=0,y=0)
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 0 })
  expect(dem.data[0]).toBe(5000)
})

test('limpiarAnomalias: dos anomalias aisladas y separadas se corrigen las dos, cada una contra sus propios vecinos', () => {
  const dem = rejilla(7, 7, 1000)
  dem.data[1 * 7 + 1] = 1300 // pico, esquina superior izquierda
  dem.data[5 * 7 + 5] = 700  // pozo, esquina inferior derecha, sin vecinos en comun
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 2 })
  expect(dem.data[1 * 7 + 1]).toBe(1000)
  expect(dem.data[5 * 7 + 5]).toBe(1000)
})

test('limpiarAnomalias: el umbral es configurable', () => {
  const dem = rejilla(5, 5, 1000)
  dem.data[2 * 5 + 2] = 1050 // desvio de 50 m
  expect(limpiarAnomalias(dem, 80)).toEqual({ posts: 0 })
  expect(limpiarAnomalias(dem, 30)).toEqual({ posts: 1 })
  expect(dem.data[2 * 5 + 2]).toBe(1000)
})
