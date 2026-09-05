import { test, expect } from 'vitest'
import { PCI_RANGES, pciColor, pciRange, SIN_EVALUAR, ATTR_SIZE } from './constants'

test('los 7 rangos ASTM cubren 0-100 sin huecos ni solapes', () => {
  const ordenados = [...PCI_RANGES].sort((a, b) => a.min - b.min)
  expect(ordenados[0].min).toBe(0)
  expect(ordenados[ordenados.length - 1].max).toBe(100)
  for (let i = 1; i < ordenados.length; i++) {
    expect(ordenados[i].min).toBe(ordenados[i - 1].max + 1)
  }
  expect(PCI_RANGES).toHaveLength(7)
})

test('pciColor devuelve gris para sin evaluar y color para los extremos', () => {
  const sinEvaluar = pciColor(null)
  expect(sinEvaluar[0]).toBe(sinEvaluar[1])
  expect(sinEvaluar[1]).toBe(sinEvaluar[2])
  expect(sinEvaluar).not.toBe(SIN_EVALUAR) // copia, no la instancia compartida
  expect(pciColor(100)).not.toEqual(pciColor(0))
})

test('la data texture cabe para 26.712 vias', () => {
  expect(ATTR_SIZE * ATTR_SIZE).toBeGreaterThanOrEqual(26712)
})

test('pciRange encuentra el tramo correcto en los bordes de cada lado', () => {
  expect(pciRange(86)?.label).toBe('Bueno')
  expect(pciRange(85)?.label).toBe('Satisfactorio')
  expect(pciRange(11)?.label).toBe('Grave')
  expect(pciRange(10)?.label).toBe('Colapsado')
  expect(pciRange(null)).toBeNull()
})
