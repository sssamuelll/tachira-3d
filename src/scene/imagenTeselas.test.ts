import { describe, expect, it } from 'vitest'
import { urlImagen, ancestroCargado, Z_HORNEADO } from './imagenTeselas'

describe('urlImagen', () => {
  it('z8..z12 salen del horneado propio, con la ruta {z}/{x}/{y}', () => {
    expect(urlImagen(8, 76, 121)).toBe('/data/img/8/76/121.jpg')
    expect(urlImagen(Z_HORNEADO, 1229, 1954)).toBe('/data/img/12/1229/1954.jpg')
  })

  it('de z13 en adelante van a Esri, que pone la fila antes que la columna', () => {
    expect(urlImagen(15, 9832, 15633)).toMatch(/World_Imagery\/MapServer\/tile\/15\/15633\/9832$/)
  })
})

describe('ancestroCargado', () => {
  it('si la tesela del nodo está cargada, es ella misma sin transformar', () => {
    expect(ancestroCargado({ z: 14, x: 4916, y: 7816 }, () => true)).toEqual({
      z: 14, x: 4916, y: 7816, ox: 0, oy: 0, esc: 1,
    })
  })

  it('si no, el ancestro más cercano cargado, con su ventana dentro de él', () => {
    // El nodo z14 (4916, 7816) está dentro del z12 (1229, 1954) en la celda
    // (0, 0) de las 4×4 en que se parte: escala 1/4, sin desplazamiento.
    const tiene = (z: number) => z === 12
    expect(ancestroCargado({ z: 14, x: 4916, y: 7816 }, tiene)).toEqual({
      z: 12, x: 1229, y: 1954, ox: 0, oy: 0, esc: 0.25,
    })
    // Y el vecino de la esquina opuesta cae en la celda (3, 3) de esa misma
    // tesela: 0,75 de desplazamiento en las dos direcciones.
    expect(ancestroCargado({ z: 14, x: 4919, y: 7819 }, tiene)).toEqual({
      z: 12, x: 1229, y: 1954, ox: 0.75, oy: 0.75, esc: 0.25,
    })
  })

  it('sin ninguna tesela cargada no hay imagen: el nodo se queda con la hipsometría', () => {
    expect(ancestroCargado({ z: 17, x: 39331, y: 62534 }, () => false)).toBeNull()
  })

  it('no sube más allá de z8, que es la raíz del quadtree', () => {
    const vistos: number[] = []
    ancestroCargado({ z: 11, x: 614, y: 977 }, z => { vistos.push(z); return false })
    expect(vistos).toEqual([11, 10, 9, 8])
  })
})
