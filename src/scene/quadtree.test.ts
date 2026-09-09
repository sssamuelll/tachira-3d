import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { ERROR_PX, clave, hijos, seleccionar, type Nodo } from './quadtree'

const todo = { intersecta: () => true }
// Cajas de 1000 m de lado en el origen, sin altura, y un error fijo por nivel.
const datos = (errorPorZ: Record<number, number | null>, listos: (n: Nodo) => boolean = () => true) => {
  const pedidos: string[] = []
  return {
    pedidos,
    error: (n: Nodo) => errorPorZ[n.z] ?? null,
    listo: listos,
    pedir: (n: Nodo) => { pedidos.push(clave(n)) },
    caja: () => new Box3(new Vector3(-500, 0, -500), new Vector3(500, 0, 500)),
  }
}
const vista = (d: number) => ({ ...todo, posicion: new Vector3(0, d, 0), mpp: (dist: number) => dist / 1000 })
const raiz: Nodo = { z: 8, x: 76, y: 121 }

describe('hijos', () => {
  it('los cuatro de z+1, en orden', () => {
    expect(hijos({ z: 8, x: 76, y: 121 }).map(clave)).toEqual(['9/152/242', '9/153/242', '9/152/243', '9/153/243'])
  })
})

describe('seleccionar', () => {
  it('a lo lejos dibuja la raíz sin pedir nada', () => {
    // error 100 m a 100 km = 1 px < ERROR_PX
    const d = datos({ 8: 100, 9: 50 })
    expect(seleccionar([raiz], vista(100_000), d, 15).map(clave)).toEqual(['8/76/121'])
    expect(d.pedidos).toEqual([])
  })

  it('de cerca subdivide hasta que el error proyectado baja de ERROR_PX', () => {
    // a 10 km: 100 m = 10 px -> subdivide; 50 m = 5 px -> subdivide; 10 m = 1 px -> se queda en z10
    const d = datos({ 8: 100, 9: 50, 10: 10, 11: 5 })
    const sel = seleccionar([raiz], vista(10_000), d, 15)
    expect(sel.every(n => n.z === 10)).toBe(true)
    expect(sel).toHaveLength(16)
  })

  it('respeta zMax', () => {
    const d = datos({ 8: 100, 9: 100, 10: 100, 11: 100 })
    const sel = seleccionar([raiz], vista(1_000), d, 9)
    expect(sel).toHaveLength(4)
    expect(sel.every(n => n.z === 9)).toBe(true)
  })

  it('si faltan hijos, pide los que existen y dibuja al padre', () => {
    const d = datos({ 8: 100, 9: 50 }, n => n.z === 8)
    const sel = seleccionar([raiz], vista(10_000), d, 15)
    expect(sel.map(clave)).toEqual(['8/76/121'])
    expect(d.pedidos).toHaveLength(4)
  })

  it('un hijo vacío (error null) ni se pide ni se dibuja', () => {
    const d = datos({ 8: 100, 9: 50 }, n => n.z === 8)
    d.error = (n: Nodo) => (n.z === 9 && n.x === 152 ? null : ({ 8: 100, 9: 50 } as Record<number, number>)[n.z] ?? null)
    seleccionar([raiz], vista(10_000), d, 15)
    expect(d.pedidos).toHaveLength(2)
  })

  it('si todos los hijos están vacíos, se dibuja el padre igual', () => {
    const d = datos({ 8: 100 })
    expect(seleccionar([raiz], vista(1_000), d, 15).map(clave)).toEqual(['8/76/121'])
  })

  it('fuera del frustum no dibuja ni pide', () => {
    const d = datos({ 8: 100, 9: 50 })
    const sel = seleccionar([raiz], { ...vista(10_000), intersecta: () => false }, d, 15)
    expect(sel).toEqual([])
    expect(d.pedidos).toEqual([])
  })

  it('ERROR_PX es 2', () => { expect(ERROR_PX).toBe(2) })
})
