import { test, expect } from 'vitest'
import {
  decodeTerrarium, lonToTileX, latToTileY, tileRangeForBbox, sampleBilinear, downsample,
  tileXf, tileYf, tileXToLon, tileYToLat,
} from '../lib/terrarium.mjs'

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
