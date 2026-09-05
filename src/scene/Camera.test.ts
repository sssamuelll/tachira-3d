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

// Fija la convencion de ejes (X=este, Y=arriba, Z=-norte) eje por eje.
// El test del origen da (0,0,0) sin importar el orden/signo de los ejes, y
// bboxCenterAndSpan usa distanceTo, invariante ante cualquier permutacion:
// ninguno de los dos revienta si enuOf devuelve, p.ej., (e, n, u) en vez de
// (e, u, -n). Este si: cada eje se mueve solo, y solo debe moverse el
// componente que le toca.
test('mover al este/norte/arriba solo mueve el eje que le corresponde', () => {
  const este = enuOf(ORIGIN.lat, ORIGIN.lon + 0.01, 0)
  expect(este.x).toBeGreaterThan(500)      // este -> +X
  expect(Math.abs(este.z)).toBeLessThan(1) // sin componente norte

  const norte = enuOf(ORIGIN.lat + 0.01, ORIGIN.lon, 0)
  expect(norte.z).toBeLessThan(-500)        // norte -> -Z
  expect(Math.abs(norte.x)).toBeLessThan(1) // sin componente este

  const arriba = enuOf(ORIGIN.lat, ORIGIN.lon, 1000)
  expect(arriba.y).toBeGreaterThan(999) // altura -> +Y
  expect(arriba.y).toBeLessThan(1001)
})
