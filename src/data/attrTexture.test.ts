import { test, expect } from 'vitest'
import { encodeAttr } from './attrTexture'
import type { Registro } from './types'

const reg = (p: Partial<Registro> = {}): Registro =>
  ({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '', ...p })

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
