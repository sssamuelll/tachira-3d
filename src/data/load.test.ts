import { test, expect, vi, afterEach } from 'vitest'
import { checkCoherence, checkOrigin, loadAll } from './load'
import { ORIGIN } from './constants'
import type { RoadsMeta } from './types'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('checkCoherence pasa con binarios consistentes', () => {
  const roads: RoadsMeta = { count: 2, ways: [] }
  const positions = new Float32Array(2 * 6)
  const segIds = new Float32Array(2)
  const index = new Uint32Array(3) // CSR: count + 1
  expect(() => checkCoherence(roads, positions, segIds, index)).not.toThrow()
})

test('checkCoherence lanza si el indice CSR no cuadra con roads.count', () => {
  const roads: RoadsMeta = { count: 2, ways: [] }
  const positions = new Float32Array(2 * 6)
  const segIds = new Float32Array(2)
  const index = new Uint32Array(2) // debería ser 3
  expect(() => checkCoherence(roads, positions, segIds, index)).toThrow(/2.*3|3.*2/)
})

test('checkCoherence lanza si segIds no trae un id por segmento', () => {
  const roads: RoadsMeta = { count: 2, ways: [] }
  const positions = new Float32Array(2 * 6)
  const segIds = new Float32Array(1) // debería ser 2
  const index = new Uint32Array(3)
  expect(() => checkCoherence(roads, positions, segIds, index)).toThrow()
})

test('checkOrigin pasa si terrain.origin coincide con ORIGIN', () => {
  expect(() => checkOrigin({ ...ORIGIN }, ORIGIN)).not.toThrow()
})

test('checkOrigin lanza con ambos valores si terrain.origin difiere', () => {
  const distinto = { ...ORIGIN, lat: ORIGIN.lat + 0.001 }
  expect(() => checkOrigin(distinto, ORIGIN)).toThrow(new RegExp(`${distinto.lat}.*${ORIGIN.lat}`))
})

test('loadAll nombra la URL y el status cuando un fetch no es ok', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
  await expect(loadAll()).rejects.toThrow(/\/data\/.*: HTTP 404/)
})
