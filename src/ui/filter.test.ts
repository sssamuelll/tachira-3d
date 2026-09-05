import { test, expect } from 'vitest'
import { applyFilter, EMPTY_FILTER, visibleSelection } from './FilterPanel'
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

// Fix hallazgo PRINCIPAL (re-revisión final): una selección hecha ANTES de
// cambiar el filtro sobrevive al cambio (App.tsx no la limpia sola, ver el
// comentario junto a selectionVisible ahí) -- visibleSelection es lo que
// impide que "aplicar" alcance lo que el filtro ya oculta.
test('visibleSelection descarta de la selección lo que el filtro oculta', () => {
  const mask = new Uint8Array([0, 1, 0, 1])
  expect(visibleSelection(mask, [0, 1, 2, 3])).toEqual([1, 3])
})

test('visibleSelection con la mascara entera en 0 descarta TODA la seleccion vieja', () => {
  const mask = new Uint8Array([0, 0, 0])
  expect(visibleSelection(mask, [0, 1, 2])).toEqual([])
})

// Control opuesto, igual de importante que el anterior (pedido explícito del
// hallazgo): con todo visible, la selección debe llegar intacta -- el fix no
// puede convertirse en un "aplicar nunca escribe nada".
test('visibleSelection con todo visible conserva la seleccion entera (control opuesto)', () => {
  const mask = new Uint8Array([1, 1, 1])
  expect(visibleSelection(mask, [0, 1, 2])).toEqual([0, 1, 2])
})

// Reproduce el escenario reportado end-to-end: applyFilter + visibleSelection
// + store.set(), igual que App.tsx encadena mask -> selectionVisible ->
// onApply. Con el mapa vacío (mask en 0 para las tres vías) una selección
// vieja de las tres no debe escribir NADA -- ni el pci ni la fuente cambian.
test('aplicar con el filtro en cero vias no escribe nada sobre una seleccion vieja', () => {
  const s = new AttrStore(ways)
  const seleccionVieja = [0, 1, 2]   // armada cuando el filtro dejaba pasar todo
  const mask = applyFilter(ways, s, { ...EMPTY_FILTER, fuente: 'estimado' })   // hoy nadie tiene esa fuente
  expect(Array.from(mask)).toEqual([0, 0, 0])
  const aVisibles = visibleSelection(mask, seleccionVieja)
  expect(aVisibles).toEqual([])
  if (aVisibles.length > 0) s.set(aVisibles, { pci: 50, fuente: 'estimado' })   // onApply real: no llama a set() con []
  expect(s.get(0)).toEqual({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '' })
  expect(s.get(1)).toEqual({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '' })
  expect(s.get(2)).toEqual({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '' })
  expect(s.ediciones).toBe(0)
})

// Control opuesto sobre el mismo pipeline: con las vías visibles
// seleccionadas, aplicar SI debe escribir sobre todas ellas.
test('aplicar con las vias visibles seleccionadas si escribe sobre todas (control opuesto)', () => {
  const s = new AttrStore(ways)
  const seleccion = [0, 1, 2]
  const mask = applyFilter(ways, s, EMPTY_FILTER)   // deja pasar todo
  expect(Array.from(mask)).toEqual([1, 1, 1])
  const aVisibles = visibleSelection(mask, seleccion)
  expect(aVisibles).toEqual([0, 1, 2])
  s.set(aVisibles, { pci: 50, fuente: 'estimado' })
  expect(s.get(0).pci).toBe(50)
  expect(s.get(1).pci).toBe(50)
  expect(s.get(2).pci).toBe(50)
})
