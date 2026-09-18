import { test, expect } from 'vitest'
import { encodeAttr, AttrTexture } from './attrTexture'
import { AttrStore } from './store'
import type { Registro, Way } from './types'

const reg = (p: Partial<Registro> = {}): Registro =>
  ({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '', ...p })

const via = (osmId: number, highway: string): Way =>
  ({ osmId, ref: null, name: null, highway, surface: null, tipo: 'sin_definir', municipio: null, km: 1, km3d: 1 })

const ways: Way[] = [via(1, 'residential'), via(2, 'residential')]

test('sin evaluar se codifica como 255 en R', () => {
  expect(encodeAttr(reg(), true, false)[0]).toBe(255)
})

test('el PCI va crudo en R y la fuente indexada en G', () => {
  const [r, g] = encodeAttr(reg({ pci: 45, fuente: 'medido' }), true, false)
  expect(r).toBe(45)
  expect(g).toBe(3)                       // sin=0 heredado=1 estimado=2 medido=3
})

test('los flags de foco y seleccion van en bits distintos de B', () => {
  expect(encodeAttr(reg(), false, false)[2] & 1).toBe(0)
  expect(encodeAttr(reg(), true, false)[2] & 1).toBe(1)
  expect(encodeAttr(reg(), true, true)[2] & 2).toBe(2)
  expect(encodeAttr(reg(), false, true)[2]).toBe(2)
})

test('un PCI de 0 no se confunde con sin evaluar', () => {
  expect(encodeAttr(reg({ pci: 0, fuente: 'medido' }), true, false)[0]).toBe(0)
})

test('una fuente fuera de dominio no produce un indice negativo en G', () => {
  const [, g] = encodeAttr(reg({ fuente: 'medidoo' as any }), true, false)
  expect(g).toBe(0)   // cae al indice de 'sin', mismo criterio que normalizar() en store.ts
})

test('el constructor deja todas las vias en foco y ninguna seleccionada', () => {
  const store = new AttrStore(ways)
  const attr = new AttrTexture(store)
  const data = attr.texture.image.data as Uint8Array
  for (let i = 0; i < ways.length; i++) {
    const b = data[i * 4 + 2]
    expect(b & 1).toBe(1)   // en foco
    expect(b & 2).toBe(0)   // no seleccionado
  }
})

test('refresh marca needsUpdate', () => {
  // THREE.Texture#needsUpdate es un setter puro (sin getter): asignarle
  // true incrementa `version`, que es la señal real y legible de que el
  // renderer debe resubir la textura. Leer needsUpdate siempre da undefined.
  const store = new AttrStore(ways)
  const attr = new AttrTexture(store)
  const before = attr.texture.version
  attr.refresh()
  expect(attr.texture.version).toBeGreaterThan(before)
})

// El tier de Liberty (constants.ts) es lo que decide el color de la vía cuando
// la capa de PCI está apagada, o sea en el estado normal del mapa. Viaja en el
// canal ALFA de esta textura, que estaba fijo en 0 y sin leer por nadie: es un
// valor por vía y este es el único canal por vía que ya llega al shader, así
// que ponerlo acá no cuesta ni un atributo de vértice -- y el presupuesto de
// atributos de la geometría de vías ya está al límite (LineSegments2 más las
// juntas dan 'Too many attributes' bajo WebGL por software).
test('el tier de Liberty va en el canal alfa', () => {
  expect(encodeAttr(reg(), true, false, 0)[3]).toBe(0)
  expect(encodeAttr(reg(), true, false, 1)[3]).toBe(1)
  expect(encodeAttr(reg(), true, false, 2)[3]).toBe(2)
})

test('la textura saca el tier de la clase OSM de cada via', () => {
  const store = new AttrStore([via(1, 'motorway'), via(2, 'trunk'), via(3, 'residential')])
  const attr = new AttrTexture(store)
  const data = attr.texture.image.data as Uint8Array
  expect([data[3], data[7], data[11]]).toEqual([0, 1, 2])
})

// El alfa no puede perderse al repintar por foco o seleccion: refresh() reescribe
// los cuatro canales de cada texel en cada llamada.
test('el tier sobrevive a un refresh con mascaras', () => {
  const store = new AttrStore([via(1, 'motorway'), via(2, 'residential')])
  const attr = new AttrTexture(store)
  attr.refresh(new Uint8Array([0, 1]), new Uint8Array([1, 0]))
  const data = attr.texture.image.data as Uint8Array
  expect([data[3], data[7]]).toEqual([0, 2])
})
