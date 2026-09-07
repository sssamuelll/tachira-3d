import { test, expect } from 'vitest'
import { packRoads } from '../lib/pack.mjs'

test('una polilinea de 3 puntos produce 2 segmentos', () => {
  const p = packRoads([{ enu: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] }])
  expect(p.segmentCount).toBe(2)
  expect(p.positions.length).toBe(2 * 6)
  expect(p.segIds.length).toBe(2)
})

test('convierte ENU a ejes de three: X=este, Y=arriba, Z=-norte', () => {
  const p = packRoads([{ enu: [[10, 20, 30], [40, 50, 60]] }])
  expect(Array.from(p.positions.slice(0, 6))).toEqual([10, 30, -20, 40, 60, -50])
})

test('el indice CSR marca el inicio de cada via', () => {
  const p = packRoads([
    { enu: [[0, 0, 0], [1, 0, 0]] },                 // 1 segmento
    { enu: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },      // 2 segmentos
  ])
  expect(Array.from(p.index)).toEqual([0, 1, 3])
  expect(p.segmentCount).toBe(3)
})

test('cada segmento lleva el indice de su via', () => {
  const p = packRoads([
    { enu: [[0, 0, 0], [1, 0, 0]] },
    { enu: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
  ])
  expect(Array.from(p.segIds)).toEqual([0, 1, 1])
})

test('escribe una normal Int8 por extremo de tramo, desde l.nrm', () => {
  const lines = [{ enu: [[0, 0, 0], [10, 0, 0], [20, 0, 0]], nrm: [[0, 1, 0], [0.6, 0.8, 0], [0, 0, 1]] }]
  const { nrm, segmentCount } = packRoads(lines)
  expect(segmentCount).toBe(2)
  expect(nrm).toBeInstanceOf(Int8Array)
  expect(Array.from(nrm)).toEqual([0, 127, 0, 76, 102, 0, 76, 102, 0, 0, 0, 127])
})

test('sin l.nrm la normal es la vertical', () => {
  const { nrm } = packRoads([{ enu: [[0, 0, 0], [1, 0, 0]] }])
  expect(Array.from(nrm)).toEqual([0, 127, 0, 0, 127, 0])
})

test('una via con menos de dos puntos no aporta segmentos', () => {
  const p = packRoads([{ enu: [[0, 0, 0]] }, { enu: [[0, 0, 0], [1, 0, 0]] }])
  expect(p.segmentCount).toBe(1)
  expect(Array.from(p.index)).toEqual([0, 0, 1])
})
