import { test, expect } from 'vitest'
import { pointInLasso } from './LassoOverlay'

const cuadro = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]

test('dentro y fuera del lazo', () => {
  expect(pointInLasso(5, 5, cuadro)).toBe(true)
  expect(pointInLasso(15, 5, cuadro)).toBe(false)
  expect(pointInLasso(-1, 5, cuadro)).toBe(false)
})

test('un lazo concavo excluye la muesca', () => {
  const u = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 },
             { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }]
  expect(pointInLasso(5, 8, u)).toBe(false)   // en la muesca
  expect(pointInLasso(2, 8, u)).toBe(true)
})
