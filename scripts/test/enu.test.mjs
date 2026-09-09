import { test, expect } from 'vitest'
import {
  geodeticToEcef, ecefToGeodetic, makeEnuFrame,
  geodeticToEnu, enuToGeodetic,
} from '../lib/enu.mjs'

const LAT0 = 8.021973, LON0 = -71.901563   // origen del proyecto

test('ECEF en el ecuador y en el polo', () => {
  const [x, y, z] = geodeticToEcef(0, 0, 0)
  expect(x).toBeCloseTo(6378137.0, 3); expect(y).toBeCloseTo(0, 3); expect(z).toBeCloseTo(0, 3)
  const [, , zp] = geodeticToEcef(90, 0, 0)
  expect(zp).toBeCloseTo(6356752.314245, 3)
})

test('el origen del frame es el cero de ENU', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  const [e, n, u] = geodeticToEnu(f, LAT0, LON0, 0)
  expect(Math.hypot(e, n, u)).toBeLessThan(1e-6)
})

test('los ejes ENU apuntan a donde deben', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  const [e1, n1] = geodeticToEnu(f, LAT0, LON0 + 0.01, 0)  // al este
  expect(e1).toBeGreaterThan(1000); expect(Math.abs(n1)).toBeLessThan(10)
  const [e2, n2] = geodeticToEnu(f, LAT0 + 0.01, LON0, 0)  // al norte
  expect(n2).toBeGreaterThan(1000); expect(Math.abs(e2)).toBeLessThan(10)
})

test('CRITICO: round-trip geodetic → ENU → geodetic bajo 1 mm en todo el bbox', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  const S = 7.3612911, W = -72.4878225, N = 8.6826552, E = -71.3153029
  let peor = 0
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const lat = S + (N - S) * i / 10
      const lon = W + (E - W) * j / 10
      for (const h of [0, 1000, 3942]) {
        const [e, n, u] = geodeticToEnu(f, lat, lon, h)
        const [lat2, lon2, h2] = enuToGeodetic(f, e, n, u)
        // 1e-5 grados ≈ 1,1 m; medimos en metros para que el umbral sea legible
        const dLat = (lat2 - lat) * 111320
        const dLon = (lon2 - lon) * 111320 * Math.cos(lat * Math.PI / 180)
        peor = Math.max(peor, Math.hypot(dLat, dLon, h2 - h))
      }
    }
  }
  expect(peor).toBeLessThan(0.001)   // el spec exige < 1 m; exigimos mil veces más
})

test('la curvatura no se aplana: 147 km producen ~424 m de caída', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  const [, , u] = geodeticToEnu(f, LAT0 + 147.1 / 2 / 111.32, LON0, 0)
  expect(u).toBeLessThan(-380)
  expect(u).toBeGreaterThan(-470)
})

test('el bbox completo cabe holgado en float32', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  for (const [lat, lon] of [[7.3612911, -72.4878225], [8.6826552, -71.3153029]]) {
    const [e, n] = geodeticToEnu(f, lat, lon, 0)
    expect(Math.abs(e)).toBeLessThan(100000)
    expect(Math.abs(n)).toBeLessThan(100000)
  }
})
