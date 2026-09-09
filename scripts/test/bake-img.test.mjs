import { describe, expect, it } from 'vitest'
import { urlEsri, teselasHornear, rutaSalida } from '../bake-img.mjs'

describe('urlEsri', () => {
  it('pone la fila antes que la columna', () => {
    // Esri sirve /tile/{z}/{fila}/{columna}: al revés que la ruta {z}/{x}/{y}
    // con la que este repo nombra sus propias teselas. Invertirlo devuelve una
    // tesela de otro sitio del planeta, no un 404 -- por eso el test.
    expect(urlEsri(12, 1229, 1954)).toMatch(/\/tile\/12\/1954\/1229$/)
  })
})

describe('teselasHornear', () => {
  const errores = { '8/76/121': 900, '10/305/487': 300, '12/1229/1954': 20, '13/2458/3908': 8, '14/1/2': 3 }

  it('solo los nodos que existen, hasta z12', () => {
    expect(teselasHornear(errores)).toEqual([
      { z: 8, x: 76, y: 121 }, { z: 10, x: 305, y: 487 }, { z: 12, x: 1229, y: 1954 },
    ])
  })

  it('nada de z13 en adelante: eso se pide en vivo', () => {
    expect(teselasHornear(errores).some(t => t.z > 12)).toBe(false)
  })
})

describe('rutaSalida', () => {
  it('mismo esquema {z}/{x}/{y} que el DEM, en jpg', () => {
    expect(rutaSalida('public/data/img', { z: 12, x: 1229, y: 1954 })).toBe('public/data/img/12/1229/1954.jpg')
  })
})
