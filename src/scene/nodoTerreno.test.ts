import { describe, expect, it } from 'vitest'
import { geometriaNodo, ventana, raices, VERTICES, LADO_NODO } from './nodoTerreno'
import { LADO, type Tesela } from './demTiles'
import { makeEnuFrame } from '../data/enu'

const dem = { z: 12, x0: 1223, y0: 1948, nx: 14, ny: 17 }

describe('ventana', () => {
  it('z ≤ 12 lee su propia tesela cada 8 píxeles', () => {
    expect(ventana({ z: 11, x: 611, y: 974 }, dem)).toEqual({ zt: 11, xt: 611, yt: 974, paso: 8, offI: 0, offJ: 0 })
  })

  it('z 13 a 15 leen la tesela z12 ancestro con paso 4, 2 y 1', () => {
    expect(ventana({ z: 13, x: 2447, y: 3897 }, dem)).toEqual({ zt: 12, xt: 1223, yt: 1948, paso: 4, offI: 128, offJ: 128 })
    expect(ventana({ z: 15, x: 9784 + 3, y: 15584 + 5 }, dem)).toEqual({ zt: 12, xt: 1223, yt: 1948, paso: 1, offI: 96, offJ: 160 })
  })
})

describe('raices', () => {
  it('son las 4 teselas z8 que cubren el rango z12', () => {
    expect(raices(dem)).toEqual([
      { z: 8, x: 76, y: 121 }, { z: 8, x: 77, y: 121 }, { z: 8, x: 76, y: 122 }, { z: 8, x: 77, y: 122 },
    ])
  })
})

describe('geometriaNodo', () => {
  const frame = makeEnuFrame(8.021973, -71.901563, 0)
  // Tesela plana a 1000 m, toda dentro salvo la fila 0.
  const alturas = new Float32Array(LADO * LADO).fill(1000)
  const dentro = new Uint8Array(LADO * LADO).fill(1)
  dentro.fill(0, 0, LADO)
  const tesela: Tesela = { alturas, dentro, min: 1000, max: 1000 }
  const nodo = { z: 12, x: 1230, y: 1956 }

  it('33x33 vértices más el faldón, y los triángulos que tocan', () => {
    const { geometry } = geometriaNodo(nodo, tesela, dem, frame)
    expect(geometry.getAttribute('position').count).toBe(VERTICES + 4 * LADO_NODO)
    expect(geometry.getIndex()!.count).toBe((32 * 32 * 2 + 4 * 32 * 2) * 3)
    expect(geometry.getAttribute('uvMascara').count).toBe(VERTICES + 4 * LADO_NODO)
    expect(geometry.getAttribute('elevation').array[0]).toBe(1000)
  })

  it('el faldón cuelga por debajo del borde y hereda su normal', () => {
    const { geometry } = geometriaNodo(nodo, tesela, dem, frame)
    const pos = geometry.getAttribute('position'), nor = geometry.getAttribute('normal')
    const borde = 0, faldon = VERTICES   // el primer vértice del faldón copia al (0,0)
    expect(pos.getY(faldon)).toBeLessThan(pos.getY(borde) - 4)
    expect(pos.getX(faldon)).toBeCloseTo(pos.getX(borde), 6)
    expect(nor.getX(faldon)).toBeCloseTo(nor.getX(borde), 6)
    expect(nor.getY(faldon)).toBeCloseTo(nor.getY(borde), 6)
  })

  it('la caja envuelve todos los vértices y el terreno plano da normales verticales', () => {
    const { geometry, caja } = geometriaNodo(nodo, tesela, dem, frame)
    const pos = geometry.getAttribute('position'), nor = geometry.getAttribute('normal')
    for (let i = 0; i < VERTICES + 4 * LADO_NODO; i++) {
      expect(caja.containsPoint({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) } as any)).toBe(true)
    }
    for (let i = 0; i < VERTICES; i++) expect(nor.getY(i)).toBeGreaterThan(0.99)
  })

  it('cada vértice lleva su posición en la máscara del estado, en [0,1] sobre el bbox', () => {
    // El recorte al contorno no va por vértice: a z8 una celda mide 4,6 km y
    // el borde saldría en bloques. Va por textura (stateMask a 1024², la
    // rejilla de siempre) y el vértice solo dice dónde muestrearla.
    const bbox = { s: 7.3612911, w: -72.4878225, n: 8.6826552, e: -71.3153029 }
    const { geometry } = geometriaNodo(nodo, tesela, dem, frame, 0, bbox)
    const uv = geometry.getAttribute('uvMascara')
    expect(uv.itemSize).toBe(2)
    expect(uv.count).toBe(VERTICES + 4 * LADO_NODO)
    for (let i = 0; i < VERTICES; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0)
      expect(uv.getX(i)).toBeLessThanOrEqual(1)
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0)
      expect(uv.getY(i)).toBeLessThanOrEqual(1)
    }
    // u crece hacia el este, v hacia el sur (fila 0 = norte, como la máscara).
    expect(uv.getX(1)).toBeGreaterThan(uv.getX(0))
    expect(uv.getY(LADO_NODO)).toBeGreaterThan(uv.getY(0))
    expect(geometry.getAttribute('inside')).toBeUndefined()
  })

  it('un nodo de 9,7 km de lado mide eso en ENU', () => {
    const { caja } = geometriaNodo(nodo, tesela, dem, frame)
    const lado = caja.max.x - caja.min.x
    expect(lado).toBeGreaterThan(9500)
    expect(lado).toBeLessThan(9900)
  })
})
