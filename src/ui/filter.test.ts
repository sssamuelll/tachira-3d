import { test, expect } from 'vitest'
import { applyFilter, EMPTY_FILTER } from './FilterPanel'
import { AttrStore } from '../data/store'
import type { Way } from '../data/types'

const ways: Way[] = [
  { osmId: 1, ref: null, name: null, highway: 'primary', surface: null, tipo: 'sin_definir', municipio: 'Rubio', km: 1, km3d: 1 },
  { osmId: 2, ref: null, name: null, highway: 'residential', surface: null, tipo: 'sin_definir', municipio: 'Rubio', km: 2, km3d: 2 },
  { osmId: 3, ref: null, name: null, highway: 'primary', surface: null, tipo: 'sin_definir', municipio: 'Junín', km: 3, km3d: 3 },
]

test('el filtro vacio deja pasar todo', () => {
  const s = new AttrStore(ways)
  expect(Array.from(applyFilter(ways, s, EMPTY_FILTER))).toEqual([1, 1, 1])
})

test('filtra por municipio', () => {
  const s = new AttrStore(ways)
  expect(Array.from(applyFilter(ways, s, { ...EMPTY_FILTER, municipio: 'Rubio' }))).toEqual([1, 1, 0])
})

test('filtra por tipo de via', () => {
  const s = new AttrStore(ways)
  expect(Array.from(applyFilter(ways, s, { ...EMPTY_FILTER, highway: 'primary' }))).toEqual([1, 0, 1])
})

test('los filtros se combinan con Y', () => {
  const s = new AttrStore(ways)
  const m = applyFilter(ways, s, { ...EMPTY_FILTER, municipio: 'Rubio', highway: 'primary' })
  expect(Array.from(m)).toEqual([1, 0, 0])
})

test('filtra por rango de PCI y excluye las no evaluadas', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 90, fuente: 'medido' })
  s.set([1], { pci: 30, fuente: 'medido' })
  const m = applyFilter(ways, s, { ...EMPTY_FILTER, pciMin: 80, pciMax: 100 })
  expect(Array.from(m)).toEqual([1, 0, 0])
})

test('soloSinEvaluar deja las que no tienen PCI', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 90, fuente: 'medido' })
  const m = applyFilter(ways, s, { ...EMPTY_FILTER, soloSinEvaluar: true })
  expect(Array.from(m)).toEqual([0, 1, 1])
})
