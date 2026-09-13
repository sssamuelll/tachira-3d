import { test, expect } from 'vitest'
import { geometriaChunk } from './Buildings'
import { PIEZAS } from '../data/piezas'

// El vaciado en sí se prueba en src/data/piezas.test.ts. Lo que se prueba aquí
// es que la malla de un chunk PASE por él: sin esta conexión el bloque
// genérico de OSM seguiría dibujándose dentro de la pieza y ningún otro test
// se enteraría.

const caja = PIEZAS.find(p => p.id === 'relation/3499128')!.sustituye!
const centro = { x: (caja.minX + caja.maxX) / 2, z: (caja.minZ + caja.maxZ) / 2 }

/** Un triángulo horizontal de 2 m de lado centrado en (x, z). */
function triangulo (x: number, z: number): number[] {
  return [x - 1, 700, z - 1, x + 1, 700, z - 1, x, 700, z + 1]
}

function datos (puntos: number[]) {
  const vertices = puntos.length / 3
  return {
    positions: new Float32Array(puntos),
    normals: new Int8Array(vertices * 3).fill(127),
    colors: new Uint8Array(vertices * 3).fill(200),
    indices: new Uint32Array(Array.from({ length: vertices }, (_, i) => i)),
    byteLength: 0,
  }
}

const CAJA_LEJOS: [number, number, number, number, number, number] = [0, 600, 0, 100, 800, 100]
const CAJA_CIVICO: [number, number, number, number, number, number] =
  [caja.minX - 50, 600, caja.minZ - 50, caja.maxX + 50, 800, caja.maxZ + 50]

test('la malla de un chunk sin sustitución conserva todos sus triángulos', () => {
  const data = datos([...triangulo(10, 10), ...triangulo(50, 50)])

  const geometry = geometriaChunk(data, CAJA_LEJOS)

  expect(geometry.getIndex()!.count).toBe(6)
})

test('la malla del chunk del Centro Cívico pierde lo que la pieza sustituye', () => {
  const data = datos([...triangulo(centro.x, centro.z), ...triangulo(caja.minX - 200, caja.minZ - 200)])

  const geometry = geometriaChunk(data, CAJA_CIVICO)

  expect(geometry.getIndex()!.count).toBe(3)
  expect([...geometry.getIndex()!.array]).toEqual([3, 4, 5])
})
