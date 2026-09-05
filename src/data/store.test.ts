import { test, expect } from 'vitest'
import { AttrStore } from './store'
import type { Way } from './types'

const ways: Way[] = [
  { osmId: 1, ref: null, name: null, highway: 'residential', surface: 'asphalt', tipo: 'asfalto', municipio: 'Rubio', km: 1, km3d: 1 },
  { osmId: 2, ref: null, name: null, highway: 'track', surface: null, tipo: 'sin_definir', municipio: 'Rubio', km: 2, km3d: 2.1 },
  { osmId: 3, ref: null, name: null, highway: 'primary', surface: null, tipo: 'sin_definir', municipio: 'Junín', km: 3, km3d: 3.2 },
]

test('arranca sin evaluar y sin fuente', () => {
  const s = new AttrStore(ways)
  expect(s.get(0).pci).toBeNull()
  expect(s.get(0).fuente).toBe('sin')
})

test('seedFromSurface siembra el tipo como heredado y cuenta cuantas sembro', () => {
  const s = new AttrStore(ways)
  expect(s.seedFromSurface()).toBe(1)
  expect(s.get(0).tipo).toBe('asfalto')
  expect(s.get(0).fuente).toBe('heredado')
  expect(s.get(1).tipo).toBe('sin_definir')
  expect(s.get(1).fuente).toBe('sin')      // sin surface, no se siembra nada
})

test('set aplica el mismo parche a muchas vias de una', () => {
  const s = new AttrStore(ways)
  s.set([0, 1, 2], { pci: 45, fuente: 'heredado' })
  expect(s.get(0).pci).toBe(45)
  expect(s.get(2).pci).toBe(45)
  expect(s.get(2).fuente).toBe('heredado')
})

test('set notifica una sola vez por lote', () => {
  const s = new AttrStore(ways)
  let n = 0
  s.onChange(() => n++)
  s.set([0, 1, 2], { pci: 10, fuente: 'estimado' })
  expect(n).toBe(1)
})

test('set normaliza una fuente invalida y un pci NaN en vez de dejarlos corruptos', () => {
  const s = new AttrStore(ways)
  s.set([0], { fuente: 'medidoo' as any, pci: NaN })
  expect(s.get(0).fuente).toBe('sin')
  expect(s.get(0).pci).toBeNull()
})

test('set normaliza el merge completo, no tumba un campo valido que el patch no toca', () => {
  const s = new AttrStore(ways)
  s.set([0], { fuente: 'medido' })
  s.set([0], { pci: 80 })          // este patch no menciona fuente
  expect(s.get(0).fuente).toBe('medido')   // sigue el valor previo, no se resetea a 'sin'
  expect(s.get(0).pci).toBe(80)
})

test('la cobertura por municipio cuenta evaluados sobre total', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 80, fuente: 'medido' })
  const c = s.coverageByMunicipio()
  expect(c.get('Rubio')).toEqual({ total: 2, evaluados: 1 })
  expect(c.get('Junín')).toEqual({ total: 1, evaluados: 0 })
})

test('loadJSON restaura por osmId y reporta huerfanos sin borrarlos', () => {
  const s = new AttrStore(ways)
  const { orphans, invalid } = s.loadJSON({ version: 1, registros: {
    '2': { pci: 30, fuente: 'medido', tipo: 'tierra', fecha: '2026-09-05', nota: '' },
    '999': { pci: 50, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(1).pci).toBe(30)
  expect(orphans).toEqual(['999'])
  expect(invalid).toEqual([])
})

test('loadJSON normaliza una fuente invalida a sin y reporta el id', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: 50, fuente: 'medidoo' as any, tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(0).fuente).toBe('sin')
  expect(invalid).toEqual(['1'])
})

test('loadJSON normaliza un tipo invalido a sin_definir y reporta el id', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: 50, fuente: 'medido', tipo: 'adoquin' as any, fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(0).tipo).toBe('sin_definir')
  expect(invalid).toEqual(['1'])
})

test('loadJSON normaliza un pci no finito o fuera de 0-100 a null y reporta el id', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: 150, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
    '2': { pci: NaN, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(0).pci).toBeNull()
  expect(s.get(1).pci).toBeNull()
  expect(invalid).toEqual(['1', '2'])
})

test('un pci null (sin evaluar) no cuenta como invalido', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: null, fuente: 'heredado', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(invalid).toEqual([])
})

test('un registro corrupto no impide cargar los sanos', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: 999, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
    '2': { pci: 30, fuente: 'medido', tipo: 'tierra', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(0).pci).toBeNull()   // el corrupto se normaliza, no se descarta el archivo
  expect(s.get(1).pci).toBe(30)     // el sano no se ve afectado
  expect(invalid).toEqual(['1'])
})

test('toJSON solo serializa lo que tiene dato', () => {
  const s = new AttrStore(ways)
  s.set([1], { pci: 30, fuente: 'medido' })
  const out = s.toJSON() as any
  expect(Object.keys(out.registros)).toEqual(['2'])
})
