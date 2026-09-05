import { test, expect } from 'vitest'
import { enuOf, bboxCenterAndSpan } from './Camera'
import { ORIGIN, BBOX } from '../data/constants'

test('el origen del proyecto cae en el cero de la escena', () => {
  const v = enuOf(ORIGIN.lat, ORIGIN.lon, 0)
  expect(v.length()).toBeLessThan(1e-6)
})

test('el span del bbox del Tachira ronda los 200 km de diagonal', () => {
  const { span } = bboxCenterAndSpan(BBOX)
  expect(span).toBeGreaterThan(180000)
  expect(span).toBeLessThan(220000)
})
