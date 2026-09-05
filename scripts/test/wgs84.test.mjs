import { test, expect } from 'vitest'
import { A, F, B, E2, EP2 } from '../lib/wgs84.mjs'

test('constantes WGS84 coherentes entre sí', () => {
  expect(A).toBe(6378137.0)
  expect(B).toBeCloseTo(6356752.314245, 6)      // semieje menor conocido
  expect(E2).toBeCloseTo(0.00669437999014, 12)  // primera excentricidad al cuadrado
  expect(EP2).toBeCloseTo(0.00673949674228, 12) // segunda excentricidad al cuadrado
  expect(E2).toBeCloseTo(F * (2 - F), 15)
  expect(EP2).toBeCloseTo((A * A - B * B) / (B * B), 12)
})
