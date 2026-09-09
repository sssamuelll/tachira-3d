import { test, expect } from 'vitest'
import { lineLengthMeters, lineLength3dMeters, midpointIndex, pointInPolygon } from '../lib/geo.mjs'

test('un grado de longitud en el ecuador mide ~111,3 km', () => {
  expect(lineLengthMeters([[0, 0], [1, 0]])).toBeCloseTo(111319.5, -1)
})

test('un grado de latitud mide ~110,6 km cerca del ecuador', () => {
  const d = lineLengthMeters([[0, 0], [0, 1]])
  expect(d).toBeGreaterThan(110000); expect(d).toBeLessThan(111000)
})

test('la longitud es la suma de los tramos', () => {
  const a = lineLengthMeters([[-72, 8], [-71.99, 8]])
  const b = lineLengthMeters([[-71.99, 8], [-71.98, 8]])
  const total = lineLengthMeters([[-72, 8], [-71.99, 8], [-71.98, 8]])
  expect(total).toBeCloseTo(a + b, 6)
})

test('una linea de un solo punto mide cero', () => {
  expect(lineLengthMeters([[-72, 8]])).toBe(0)
})

test('la longitud 3d es mayor que la plana cuando hay desnivel', () => {
  const coords = [[-72, 8], [-71.99, 8]]
  const plana = lineLengthMeters(coords)
  const conCuesta = lineLength3dMeters(coords, [0, 500])
  expect(conCuesta).toBeGreaterThan(plana)
  expect(conCuesta).toBeCloseTo(Math.hypot(plana, 500), 0)
})

test('el punto medio de una linea uniforme cae en el centro', () => {
  expect(midpointIndex([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])).toBe(2)
})

test('point-in-polygon dentro, fuera y en un hueco', () => {
  const cuadro = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
  expect(pointInPolygon(5, 5, cuadro)).toBe(true)
  expect(pointInPolygon(15, 5, cuadro)).toBe(false)
  const conHueco = [cuadro[0], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]
  expect(pointInPolygon(5, 5, conHueco)).toBe(false)
  expect(pointInPolygon(2, 2, conHueco)).toBe(true)
})
