import { test, expect } from 'vitest'
import { enuOf, bboxCenterAndSpan, municipioBbox } from './Camera'
import { ORIGIN, BBOX } from '../data/constants'
import type { Municipio } from '../data/types'

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

// Ningún municipio del dato real (public/data/municipios.json) tiene hoy más
// de un polígono, así que este caso no se puede ver a ojo en el navegador --
// un municipio sintético con dos polígonos separados (y un hueco con un punto
// fuera de su propio anillo exterior, algo que nunca pasaría en un GeoJSON
// real pero que fija que solo se lee ring[0]) es la única forma de probar que
// municipioBbox no se queda solo con polygons[0].
test('el bbox de un municipio multipoligono cubre todos los poligonos e ignora los huecos', () => {
  const m: Municipio = {
    osmId: 1, name: 'Test', orphanFragments: 0,
    polygons: [
      [
        [[-72.0, 8.0], [-71.9, 8.0], [-71.9, 8.1], [-72.0, 8.1]], // anillo exterior
        [[-73.0, 5.0]],                                            // hueco fuera de rango -- debe ignorarse
      ],
      [[[-70.0, 9.0], [-69.9, 9.0], [-69.9, 9.1], [-70.0, 9.1]]], // segundo poligono (enclave)
    ],
  }
  expect(municipioBbox(m)).toEqual({ s: 8.0, w: -72.0, n: 9.1, e: -69.9 })
})
