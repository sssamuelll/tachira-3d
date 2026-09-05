import { test, expect } from 'vitest'
import { encodeId, decodeId } from './PickingPass'

test('round-trip de ids en todo el rango util', () => {
  for (const i of [0, 1, 255, 256, 26712, 65535, 65536, 16777215]) {
    const [r, g, b] = encodeId(i)
    expect(decodeId(r, g, b)).toBe(i)
  }
})

test('los componentes se mantienen dentro de un byte', () => {
  const [r, g, b] = encodeId(26712)
  for (const c of [r, g, b]) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(256) }
})

test('el id 0 esta reservado para nada', () => {
  expect(decodeId(0, 0, 0)).toBe(0)
})
