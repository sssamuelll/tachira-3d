import { test, expect } from 'vitest'
import { encodeAttr, AttrTexture } from './attrTexture'
import { AttrStore } from './store'
import type { Registro, Way } from './types'

const reg = (p: Partial<Registro> = {}): Registro =>
  ({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '', ...p })

const ways: Way[] = [
  { osmId: 1, ref: null, name: null, highway: 'residential', surface: null, tipo: 'sin_definir', municipio: null, km: 1, km3d: 1 },
  { osmId: 2, ref: null, name: null, highway: 'residential', surface: null, tipo: 'sin_definir', municipio: null, km: 1, km3d: 1 },
]

test('sin evaluar se codifica como 255 en R', () => {
  expect(encodeAttr(reg(), true, false)[0]).toBe(255)
})

test('el PCI va crudo en R y la fuente indexada en G', () => {
  const [r, g] = encodeAttr(reg({ pci: 45, fuente: 'medido' }), true, false)
  expect(r).toBe(45)
  expect(g).toBe(3)                       // sin=0 heredado=1 estimado=2 medido=3
})

test('los flags de visible y seleccionado van en bits distintos de B', () => {
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

test('el constructor deja todas las vias visibles y ninguna seleccionada', () => {
  const store = new AttrStore(ways)
  const attr = new AttrTexture(store)
  const data = attr.texture.image.data as Uint8Array
  for (let i = 0; i < ways.length; i++) {
    const b = data[i * 4 + 2]
    expect(b & 1).toBe(1)   // visible
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
