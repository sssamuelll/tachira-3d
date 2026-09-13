import { test, expect } from 'vitest'
import {
  FORMAS, MODELO_TECHO, formaTecho, caparazonTecho,
} from '../lib/building-roof-shape.mjs'

// Igual que building-morphology.test.mjs: se prueba la HIPOTESIS de forma, no
// un levantamiento. Lo que estos tests defienden no es que el techo sea el
// real -- no lo es, y el manifiesto tiene que decirlo -- sino que sea
// DETERMINISTA, que declare de donde salio, y que nunca se presente como dato
// de OSM algo que se invento aca.

const huella = (id, tags = {}) => ({ id, osmId: 1, osmType: 'way', tags, polygons: [] })

// Rectangulo de 12 x 8 m centrado en el origen: la casa tipica del valle.
const RECT = [[-6, -4], [6, -4], [6, 4], [-6, 4]]
const metrica = (over = {}) => ({ x: 0, z: 0, area: 96, compacidad: 0.95, elongacion: 1.5, ...over })

// ------------------------------------------------------------ determinismo

test('la misma huella da exactamente el mismo techo, siempre', () => {
  // Es la propiedad que hace usable esto en un colegio de ingenieros: dos
  // personas en dos maquinas tienen que estar mirando el mismo mapa. Un
  // Math.random() suelto rompe esto y no se nota hasta que alguien compara.
  const a = formaTecho(huella('way/123456'), metrica())
  const b = formaTecho(huella('way/123456'), metrica())
  expect(a).toEqual(b)
})

test('ids distintos no dan todos la misma forma: el randomizer varia de verdad', () => {
  const formas = new Set()
  for (let i = 0; i < 400; i++) {
    formas.add(formaTecho(huella(`way/${i}`), metrica()).forma)
  }
  // Al menos dos formas distintas sobre 400 huellas compactas. Un generador
  // degenerado (siempre 'plana') pasaria todo lo demas sin que se vea.
  expect(formas.size).toBeGreaterThan(1)
})

// --------------------------------------------------------- procedencia OSM

test('roof:shape de OSM manda sobre el generador, y se declara como OSM', () => {
  const t = formaTecho(huella('way/1', { 'roof:shape': 'gabled' }), metrica())
  expect(t.forma).toBe('dos-aguas')
  expect(t.fuente).toBe('osm-roof-shape')
})

test('las formas de OSM que sabemos mapear se mapean', () => {
  const pares = [
    ['flat', 'plana'],
    ['gabled', 'dos-aguas'],
    ['hipped', 'cuatro-aguas'],
    ['pyramidal', 'cuatro-aguas'],
    ['skillion', 'un-agua'],
  ]
  for (const [osm, esperada] of pares) {
    const t = formaTecho(huella('way/1', { 'roof:shape': osm }), metrica())
    expect(t.forma, osm).toBe(esperada)
    expect(t.fuente, osm).toBe('osm-roof-shape')
  }
})

test('un roof:shape que no sabemos mapear NO se inventa como dato de OSM', () => {
  // 'onion' existe en OSM y no lo sabemos construir. La respuesta correcta es
  // caer al generador y DECIRLO, no etiquetar de osm-roof-shape una forma que
  // en realidad escogimos nosotros.
  const t = formaTecho(huella('way/1', { 'roof:shape': 'onion' }), metrica())
  expect(t.fuente).toBe('estimada')
  expect(FORMAS).toContain(t.forma)
})

test('sin tags, la fuente es estimada -- nunca osm', () => {
  const t = formaTecho(huella('way/999'), metrica())
  expect(t.fuente).toBe('estimada')
  expect(t.evidencia).toBeTruthy()
})

test('roof:height de OSM se respeta en metros', () => {
  const t = formaTecho(huella('way/1', { 'roof:shape': 'gabled', 'roof:height': '2.4' }), metrica())
  expect(t.alturaM).toBeCloseTo(2.4, 3)
})

// -------------------------------------------------------------- las reglas

test('una huella grande no lleva techo a dos aguas', () => {
  // 2.000 m2 no es una casa: es un galpon o un centro comercial, y esos son
  // planos. Darle dos aguas a un galpon es la clase de detalle bonito que
  // convierte el mapa en una mentira.
  const t = formaTecho(huella('way/1'), metrica({ area: 2000 }))
  expect(t.forma).toBe('plana')
  expect(t.alturaM).toBe(0)
})

test('una huella poco compacta se queda plana', () => {
  // El caparazon se arma sobre el rectangulo orientado de la huella. Si la
  // huella no se parece a un rectangulo, ese caparazon no la cubre: mejor
  // plano que un techo que flota fuera de sus paredes.
  const t = formaTecho(huella('way/1'), metrica({ compacidad: 0.35 }))
  expect(t.forma).toBe('plana')
})

test('la altura del techo generado se queda en el rango de una casa', () => {
  for (let i = 0; i < 200; i++) {
    const t = formaTecho(huella(`way/${i}`), metrica())
    expect(t.alturaM).toBeGreaterThanOrEqual(0)
    expect(t.alturaM).toBeLessThanOrEqual(4)
    if (t.forma === 'plana') expect(t.alturaM).toBe(0)
    else expect(t.alturaM).toBeGreaterThan(1)
  }
})

test('la forma siempre sale del conjunto cerrado, y hay version de modelo', () => {
  expect(FORMAS).toEqual(expect.arrayContaining(['plana', 'un-agua', 'dos-aguas', 'cuatro-aguas']))
  for (let i = 0; i < 100; i++) {
    expect(FORMAS).toContain(formaTecho(huella(`way/${i}`), metrica()).forma)
  }
  // El manifiesto tiene que poder decir con que modelo se genero, igual que
  // MODEL_VERSION en building-morphology.mjs.
  expect(typeof MODELO_TECHO).toBe('string')
  expect(MODELO_TECHO.length).toBeGreaterThan(0)
})

// ------------------------------------------------------------- el caparazon

const tris = ({ positions, indices }) => {
  const out = []
  for (let i = 0; i < indices.length; i += 3) {
    out.push([0, 1, 2].map(k => {
      const o = indices[i + k] * 3
      return [positions[o], positions[o + 1], positions[o + 2]]
    }))
  }
  return out
}

test('el caparazon plano es el que ya se dibujaba: todo a la cota del alero', () => {
  const c = caparazonTecho(RECT, 'plana', 0, 100)
  expect(c.indices.length).toBeGreaterThanOrEqual(6)
  for (let i = 1; i < c.positions.length; i += 3) expect(c.positions[i]).toBeCloseTo(100, 6)
})

test('el caparazon a dos aguas sube, y nunca por debajo del alero', () => {
  const c = caparazonTecho(RECT, 'dos-aguas', 2, 100)
  const ys = []
  for (let i = 1; i < c.positions.length; i += 3) ys.push(c.positions[i])
  // Ni un vertice por debajo de la cota de las paredes: un techo que baja del
  // alero se mete dentro del edificio y se ve por las ventanas.
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(100 - 1e-6)
  // El caballete llega justo a la altura pedida, ni mas ni menos.
  expect(Math.max(...ys)).toBeCloseTo(102, 6)
})

test('el alero conserva el contorno: cada punto del anillo sigue en el caparazon', () => {
  // Si el caparazon no apoya en el mismo contorno que las paredes, queda una
  // rendija entre techo y pared que se ve como una linea de fondo.
  const c = caparazonTecho(RECT, 'dos-aguas', 2, 100)
  for (const [x, z] of RECT) {
    let encontrado = false
    for (let i = 0; i < c.positions.length; i += 3) {
      if (Math.abs(c.positions[i] - x) < 1e-6
        && Math.abs(c.positions[i + 1] - 100) < 1e-6
        && Math.abs(c.positions[i + 2] - z) < 1e-6) { encontrado = true; break }
    }
    expect(encontrado, `${x},${z} no esta en el alero`).toBe(true)
  }
})

test('todas las caras del caparazon miran hacia arriba', () => {
  // Una cara con la normal invertida sale negra bajo el sol: es el defecto
  // clasico de un techo generado y no se ve hasta que el sol baja.
  for (const forma of ['un-agua', 'dos-aguas', 'cuatro-aguas']) {
    const c = caparazonTecho(RECT, forma, 2, 100)
    for (const [a, b, d] of tris(c)) {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
      // Componente Y del producto cruz u x v, en la convencion de
      // building-geometry.mjs (x este, z sur).
      const ny = u[2] * v[0] - u[0] * v[2]
      expect(ny, `${forma}: cara mirando hacia abajo`).toBeGreaterThan(-1e-9)
    }
  }
})

test('las normales van en la convencion de bytes del resto del horneado', () => {
  // building-geometry.mjs empuja normales como bytes con 127 = 1.0
  // (ej. [0,127,0] para el techo plano). Un caparazon que devuelva floats
  // normalizados se veria plano y negro sin que nada falle.
  const c = caparazonTecho(RECT, 'dos-aguas', 2, 100)
  expect(c.normals.length).toBe(c.positions.length)
  for (let i = 0; i < c.normals.length; i += 3) {
    const m = Math.hypot(c.normals[i], c.normals[i + 1], c.normals[i + 2])
    expect(m).toBeGreaterThan(100)
    expect(m).toBeLessThan(150)
    for (const k of [0, 1, 2]) expect(Number.isInteger(c.normals[i + k])).toBe(true)
  }
})

test('los indices apuntan a vertices que existen', () => {
  for (const forma of FORMAS) {
    const c = caparazonTecho(RECT, forma, forma === 'plana' ? 0 : 2, 100)
    const n = c.positions.length / 3
    expect(c.indices.length % 3).toBe(0)
    for (const i of c.indices) {
      expect(Number.isInteger(i)).toBe(true)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(n)
    }
  }
})

test('un anillo degenerado no revienta el horneado', () => {
  // build-buildings.mjs procesa 45.593 huellas de OSM sin curar: si una trae
  // tres puntos colineales, el pipeline entero no se puede caer por eso.
  const c = caparazonTecho([[0, 0], [1, 0], [2, 0]], 'dos-aguas', 2, 100)
  expect(c.positions.length % 3).toBe(0)
  expect(c.indices.length % 3).toBe(0)
})
