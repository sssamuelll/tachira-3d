// @ts-ignore -- igual que buildings.test.ts: vitest corre en Node, la app solo
// tiene los tipos de vite/client. El repo no depende de @types/node.
import { readFileSync } from 'node:fs'
import { test, expect } from 'vitest'
import { PIEZAS, vaciarSustituidos, cajasSustituidas } from './piezas'
import { makeEnuFrame, geodeticToEnu, enuToGeodetic } from './enu'
import { ORIGIN } from './constants'

// Una pieza generada y el bloque genérico de OSM no pueden ocupar el mismo
// sitio: se verían uno dentro del otro. El Obelisco se libró porque ninguna
// huella lo contenía; el Centro Cívico SÍ está en OSM, así que hay que vaciar
// su bloque. Lo que se prueba aquí es el vaciado, y que la caja declarada no
// se lleve por delante a un vecino que no sea del conjunto.

// --------------------------------------------------------------- el vaciado

/** Un triángulo horizontal de 2 m de lado centrado en (x, z). */
function triangulo (x: number, z: number): number[] {
  return [x - 1, 0, z - 1, x + 1, 0, z - 1, x, 0, z + 1]
}

test('vacía los triángulos de dentro de la caja y conserva los de fuera', () => {
  const positions = new Float32Array([...triangulo(0, 0), ...triangulo(100, 100)])
  const indices = new Uint32Array([0, 1, 2, 3, 4, 5])

  const salida = vaciarSustituidos(positions, indices, [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }])

  expect([...salida]).toEqual([3, 4, 5])
})

test('un triángulo a caballo de la caja se conserva: el centroide decide', () => {
  // Vaciar por vértice suelto abriría agujeros en el vecino que comparte pared.
  const positions = new Float32Array(triangulo(11, 0))
  const indices = new Uint32Array([0, 1, 2])

  const salida = vaciarSustituidos(positions, indices, [{ minX: -10, maxX: 10, minZ: -10, maxZ: 10 }])

  expect([...salida]).toEqual([0, 1, 2])
})

test('sin cajas devuelve el mismo array, no una copia', () => {
  // El caso normal es que el chunk no tenga ninguna sustitución; copiar
  // 300.000 índices por chunk para no cambiar nada sería tirar memoria.
  const indices = new Uint32Array([0, 1, 2])

  expect(vaciarSustituidos(new Float32Array(triangulo(0, 0)), indices, [])).toBe(indices)
})

test('cajasSustituidas solo devuelve las que tocan la caja del chunk', () => {
  const lejos = cajasSustituidas([-1000, 0, -1000, -900, 100, -900])

  expect(lejos).toEqual([])
  expect(cajasSustituidas([-36600, 600, 28000, -36400, 700, 28200]).length).toBeGreaterThan(0)
})

// ------------------------------------------- la caja real del Centro Cívico

const CHUNK = 'public/data/edificios/15-9809-15674.json'
const chunk = JSON.parse(readFileSync(CHUNK, 'utf8')) as {
  buildings: { id: string; osmId: number; tags: Record<string, string>; polygons: { outer: number[][]; holes: number[][][] }[] }[]
}

test('la caja del Centro Cívico cubre su multipolígono de OSM', () => {
  const pieza = PIEZAS.find(p => p.id === 'relation/3499128')
  const caja = pieza?.sustituye
  expect(caja).toBeDefined()
  const bloque = chunk.buildings.find(b => b.osmId === 3499128)
  expect(bloque).toBeDefined()

  for (const poligono of bloque!.polygons) {
    for (const anillo of [poligono.outer, ...poligono.holes]) {
      for (const [x, , z] of anillo) {
        expect(x).toBeGreaterThanOrEqual(caja!.minX)
        expect(x).toBeLessThanOrEqual(caja!.maxX)
        expect(z).toBeGreaterThanOrEqual(caja!.minZ)
        expect(z).toBeLessThanOrEqual(caja!.maxZ)
      }
    }
  }
})

test('dentro de la caja solo hay obra del propio conjunto', () => {
  // Los tres `building=roof` son las cubiertas del zócalo comercial, que el
  // GLB ya modela. Si un re-horneado mete otra huella aquí, este test truena
  // antes de que el mapa borre en silencio el edificio de un vecino.
  const caja = PIEZAS.find(p => p.id === 'relation/3499128')!.sustituye!
  const dentro = chunk.buildings.filter(b => b.polygons.some(p =>
    [p.outer, ...p.holes].some(anillo => anillo.some(([x, , z]) =>
      x >= caja.minX && x <= caja.maxX && z >= caja.minZ && z <= caja.maxZ))))

  expect(dentro.map(b => b.id).sort()).toEqual([
    'relation/3499128', 'way/247780185', 'way/247780186', 'way/260659190',
  ])
  for (const b of dentro) {
    if (b.osmId !== 3499128) expect(b.tags.building).toBe('roof')
  }
})

// ------------------------------------------------ la Plaza Bolívar, al norte

test('la Plaza Bolívar declara su GLB y no lleva rumbo', () => {
  const pieza = PIEZAS.find(p => p.id === 'way/1326164631')!

  expect(pieza.glb).toBe('/data/piezas/plaza-bolivar.glb')
  expect(pieza.rumbo).toBeUndefined()
  expect(pieza.representación).toBe('generada')
})

test('la Plaza Bolívar no sustituye nada porque no pisa ninguna huella', () => {
  // Es la razón por la que NO lleva `sustituye`: dentro del perímetro de la
  // plaza no hay un solo edificio de OSM. Si algún día aparece uno, esto
  // truena y habrá que decidir si se sustituye o si el modelo estaba mal.
  const pieza = PIEZAS.find(p => p.id === 'way/1326164631')!
  expect(pieza.sustituye).toBeUndefined()

  const perimetro = (JSON.parse(readFileSync('scripts/plaza-bolivar.json', 'utf8')) as {
    origen: { lat: number; lon: number }; perimetro: [number, number][]
  })
  const frame = makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)
  const local = makeEnuFrame(perimetro.origen.lat, perimetro.origen.lon, 0)
  // Metros locales de la pieza → geodésicas → ENU del mapa, X este / Z sur.
  const anillo = perimetro.perimetro.map(([x, y]) => {
    const [lat, lon] = enuToGeodetic(local, x, y, 0)
    const [e, n] = geodeticToEnu(frame, lat, lon, 0)
    return [e, -n] as [number, number]
  })

  const pisados = chunk.buildings.filter(b => b.polygons.some(p =>
    p.outer.some(([x, , z]) => dentro([x, z], anillo))))

  expect(pisados.map(b => b.id)).toEqual([])
})

/** Punto en polígono por cruces; el anillo viene sin repetir el primer punto. */
function dentro ([x, z]: [number, number], anillo: [number, number][]): boolean {
  let hit = false
  for (let i = 0; i < anillo.length; i++) {
    const [x0, z0] = anillo[i]
    const [x1, z1] = anillo[(i + 1) % anillo.length]
    if ((z0 > z) !== (z1 > z) && x < ((x1 - x0) * (z - z0)) / (z1 - z0) + x0) hit = !hit
  }
  return hit
}

test('el Centro Cívico declara su GLB y no lleva rumbo', () => {
  // Como los viaductos: la geometría sale de la huella real de OSM, ya
  // orientada. Girarla la sacaría de la manzana.
  const pieza = PIEZAS.find(p => p.id === 'relation/3499128')!

  expect(pieza.glb).toBe('/data/piezas/centro-civico.glb')
  expect(pieza.rumbo).toBeUndefined()
  expect(pieza.representación).toBe('generada')
})
