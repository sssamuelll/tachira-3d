import { describe, expect, it } from 'vitest'
import { geometriaNodo, ventana, raices, alturaEnTesela, alturaDeVertice, uvImagen, VERTICES, LADO_NODO } from './nodoTerreno'
import { LADO, type Tesela } from './demTiles'
import { alturaEnPosts } from '../../scripts/lib/drape.mjs'
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

  it('z16 y z17 caen entre posts: paso 0,5 y 0,25', () => {
    // La imagen satelital pide bajar dos niveles más que el DEM, y ahí los 33
    // vértices del nodo ya no caen en posts enteros de la tesela z12. El
    // arranque sí sigue siendo entero (256/2^k), lo que se vuelve fraccionario
    // es el paso.
    expect(ventana({ z: 16, x: 19568 + 5, y: 31168 + 3 }, dem)).toEqual({ zt: 12, xt: 1223, yt: 1948, paso: 0.5, offI: 80, offJ: 48 })
    expect(ventana({ z: 17, x: 39136 + 9, y: 62336 + 7 }, dem)).toEqual({ zt: 12, xt: 1223, yt: 1948, paso: 0.25, offI: 72, offJ: 56 })
  })
})

describe('alturaEnTesela', () => {
  // Celda torcida a propósito: los cuatro posts no están en un plano, así que
  // la triangulación y la bilineal dan números distintos y el test distingue
  // cuál se está usando.
  const alturas = new Float32Array(LADO * LADO)
  alturas[0] = 0; alturas[1] = 10; alturas[LADO] = 20; alturas[LADO + 1] = 0

  it('la diagonal va de arriba-derecha a abajo-izquierda, como alturaEnPosts', () => {
    // (0,25 · 0,25) cae en (a,c,b): 0 + 0,25·10 + 0,25·20 = 7,5. La bilineal
    // daría 5,625 -- si este número aparece, la diagonal se movió y las vías
    // dejarían de estar apoyadas sobre lo que se dibuja.
    expect(alturaEnTesela(alturas, 0.25, 0.25)).toBeCloseTo(7.5, 6)
    expect(alturaEnTesela(alturas, 0.75, 0.75)).toBeCloseTo(7.5, 6)
    // fx + fy = 1,1 > 1: el otro triángulo, (b,c,d).
    expect(alturaEnTesela(alturas, 0.9, 0.2)).toBeCloseTo(0 + 0.1 * 20 + 0.8 * 10, 6)
  })

  it('en un post exacto devuelve el post', () => {
    expect(alturaEnTesela(alturas, 0, 0)).toBe(0)
    expect(alturaEnTesela(alturas, 1, 0)).toBe(10)
    expect(alturaEnTesela(alturas, 0, 1)).toBe(20)
    expect(alturaEnTesela(alturas, 1, 1)).toBe(0)
  })

  it('da lo mismo que alturaEnPosts del pipeline en puntos al azar', () => {
    // La regla de diagonal vive en dos sitios (acá y scripts/lib/drape.mjs) y
    // tiene que ser LA MISMA: el pipeline apoyó cada punto de vía contra la de
    // allá, y esta dibuja el suelo debajo. Se comparan de verdad, no de
    // palabra.
    const d = new Float32Array(LADO * LADO)
    for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.37) * 100 + (i % LADO) * 3
    const pipeline = { width: LADO, height: LADO, data: d }
    for (let n = 0; n < 200; n++) {
      const u = Math.random() * (LADO - 1), v = Math.random() * (LADO - 1)
      expect(alturaEnTesela(d, u, v)).toBeCloseTo(alturaEnPosts(pipeline, u, v), 6)
    }
  })
})

describe('alturaDeVertice', () => {
  const rampa = new Float32Array(LADO * LADO)
  for (let j = 0; j < LADO; j++) for (let i = 0; i < LADO; i++) rampa[j * LADO + i] = 100 + i * 3 + j * 7

  it('a paso 1 y menos devuelve la triangulación exacta, que es donde se apoyan las vías', () => {
    for (const paso of [1, 0.5, 0.25]) {
      for (const [u, v] of [[40, 40], [40.5, 41.25], [7.3, 19.9]] as const) {
        expect(alturaDeVertice(rampa, u, v, paso)).toBeCloseTo(alturaEnTesela(rampa, u, v), 6)
      }
    }
  })

  it('sobre un plano inclinado no mueve el terreno: la media del bloque es su centro', () => {
    // Es la objeción que traía el comentario viejo —que promediar desplazaría
    // un plano— y no se sostiene si la ventana está centrada. Si alguien la
    // descentra, este número se va.
    for (const paso of [2, 4, 8]) {
      expect(alturaDeVertice(rampa, 128, 128, paso)).toBeCloseTo(alturaEnTesela(rampa, 128, 128), 6)
    }
  })

  it('a paso 8 una aguja de un solo post no se lleva el vértice entero', () => {
    const llano = new Float32Array(LADO * LADO)   // todo a 0
    llano[128 * LADO + 128] = 640                 // una aguja de 640 m
    // El vértice representa un bloque de 8x8 = 64 posts: la aguja aporta
    // 640/64 = 10 m, no 640. Muestrear el post suelto da 640 y eso es
    // exactamente el pino que sale en pantalla.
    expect(alturaDeVertice(llano, 128, 128, 8)).toBeCloseTo(10, 6)
  })

  it('a paso 8 un pozo de un solo post tampoco abre un cráter', () => {
    const llano = new Float32Array(LADO * LADO)
    llano[128 * LADO + 128] = -640
    expect(alturaDeVertice(llano, 128, 128, 8)).toBeCloseTo(-10, 6)
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

  it('cada vértice sabe dónde cae dentro de la tesela de imagen', () => {
    const { geometry } = geometriaNodo(nodo, tesela, dem, frame)
    const uv = geometry.getAttribute('uvImagen')
    expect(uv.count).toBe(VERTICES + 4 * LADO_NODO)
    // Esquinas de la rejilla: (0,0) al noroeste y (1,1) al sureste, fila 0 =
    // norte, la misma convención que uvMascara y que una tesela Web Mercator.
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 0])
    expect([uv.getX(LADO_NODO - 1), uv.getY(LADO_NODO - 1)]).toEqual([1, 0])
    expect([uv.getX(VERTICES - 1), uv.getY(VERTICES - 1)]).toEqual([1, 1])
  })

  it('el uv de imagen es el mismo objeto en todos los nodos', () => {
    // Es idéntico en cada nodo (la rejilla es siempre 33×33 sobre 0..1), así
    // que se arma una vez y se comparte: 9 KB en total en vez de 9 KB por
    // nodo, y una subida a la GPU en vez de 800.
    const a = geometriaNodo(nodo, tesela, dem, frame).geometry.getAttribute('uvImagen')
    const b = geometriaNodo({ z: 12, x: 1231, y: 1956 }, tesela, dem, frame).geometry.getAttribute('uvImagen')
    expect(a).toBe(b)
    expect(a).toBe(uvImagen())
  })

  it('un nodo de 9,7 km de lado mide eso en ENU', () => {
    const { caja } = geometriaNodo(nodo, tesela, dem, frame)
    const lado = caja.max.x - caja.min.x
    expect(lado).toBeGreaterThan(9500)
    expect(lado).toBeLessThan(9900)
  })
})
