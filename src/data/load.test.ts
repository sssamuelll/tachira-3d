import { test, expect, vi, afterEach } from 'vitest'
import { checkCoherence, checkOrigin, loadAll, limitesBin } from './load'
import { ORIGIN } from './constants'
import type { RoadsMeta } from './types'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('checkCoherence pasa con binarios consistentes', () => {
  const roads: RoadsMeta = { count: 2, ways: [] }
  const positions = new Float32Array(2 * 6)
  const segIds = new Float32Array(2)
  const index = new Uint32Array([0, 1, 2]) // CSR: count + 1, un segmento por vía
  expect(() => checkCoherence(roads, positions, segIds, index, new Int8Array(segIds.length * 6))).not.toThrow()
})

test('checkCoherence lanza si el CSR no termina en el total de segmentos', () => {
  // La última entrada del CSR ES el número de segmentos, y hay quien la lee
  // como tal para dimensionar buffers por segmento sin volver a mirar
  // positions (cortePorSegmento, roadStyle.ts). Un CSR que termine corto los
  // deja más chicos que la geometría, y la GPU lee lo que haya detrás.
  const roads: RoadsMeta = { count: 2, ways: [] }
  const positions = new Float32Array(2 * 6)
  const segIds = new Float32Array(2)
  const index = new Uint32Array([0, 1, 1]) // termina en 1, hay 2 segmentos
  expect(() => checkCoherence(roads, positions, segIds, index, new Int8Array(segIds.length * 6))).toThrow(/1.*2|2.*1/)
})

test('checkCoherence lanza si el indice CSR no cuadra con roads.count', () => {
  const roads: RoadsMeta = { count: 2, ways: [] }
  const positions = new Float32Array(2 * 6)
  const segIds = new Float32Array(2)
  const index = new Uint32Array(2) // debería ser 3
  expect(() => checkCoherence(roads, positions, segIds, index, new Int8Array(segIds.length * 6))).toThrow(/2.*3|3.*2/)
})

test('checkCoherence lanza si segIds no trae un id por segmento', () => {
  const roads: RoadsMeta = { count: 2, ways: [] }
  const positions = new Float32Array(2 * 6)
  const segIds = new Float32Array(1) // debería ser 2
  const index = new Uint32Array(3)
  expect(() => checkCoherence(roads, positions, segIds, index, new Int8Array(segIds.length * 6))).toThrow()
})

test('checkCoherence lanza si roads-nrm.bin no trae seis bytes por segmento', () => {
  // La normal del terreno de cada extremo (roadsShader.ts la extruye con
  // ella): un buffer corto deja la GPU leyendo lo que haya detrás.
  const roads: RoadsMeta = { count: 1, ways: [] }
  expect(() => checkCoherence(roads, new Float32Array(6), new Float32Array(1), new Uint32Array([0, 1]), new Int8Array(5)))
    .toThrow(/roads-nrm/)
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

test('missing optional boundaries do not block the map', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
  await expect(limitesBin('data/limites-pos.bin')).resolves.toHaveProperty('byteLength', 0)
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('limites-pos.bin: HTTP 404'))
  warn.mockRestore()
})

test('boundary fetch failures other than 404 are reported', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
  await expect(limitesBin('data/limites-pos.bin')).rejects.toThrow('data/limites-pos.bin: HTTP 503')
})
