import { test, expect } from 'vitest'
import { waysToLines, relationsToPolygons, QUERY_VIAS, QUERY_MUNICIPIOS } from '../lib/overpass.mjs'

test('las consultas apuntan al Tachira y piden geometria', () => {
  for (const q of [QUERY_VIAS, QUERY_MUNICIPIOS]) {
    expect(q).toContain('VE-S')
    expect(q).toContain('out geom')
  }
})

test('waysToLines extrae id, tags y coordenadas en orden lon,lat', () => {
  const json = { elements: [{
    type: 'way', id: 42, tags: { highway: 'primary', name: 'Troncal 5', surface: 'asphalt' },
    geometry: [{ lat: 8.0, lon: -72.0 }, { lat: 8.1, lon: -72.1 }],
  }] }
  const [w] = waysToLines(json)
  expect(w.osmId).toBe(42)
  expect(w.tags.highway).toBe('primary')
  expect(w.coords).toEqual([[-72.0, 8.0], [-72.1, 8.1]])
})

test('waysToLines descarta ways sin geometria o con menos de dos nodos', () => {
  const json = { elements: [
    { type: 'way', id: 1, tags: { highway: 'primary' } },
    { type: 'way', id: 2, tags: { highway: 'primary' }, geometry: [{ lat: 8, lon: -72 }] },
    { type: 'node', id: 3 },
  ] }
  expect(waysToLines(json)).toHaveLength(0)
})

test('relationsToPolygons arma el anillo exterior desde los members outer', () => {
  const json = { elements: [{
    type: 'relation', id: 7, tags: { name: 'Municipio Junín' },
    members: [{ type: 'way', role: 'outer', geometry: [
      { lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }, { lat: 0, lon: 0 },
    ] }],
  }] }
  const [m] = relationsToPolygons(json)
  expect(m.osmId).toBe(7)
  expect(m.name).toBe('Municipio Junín')
  expect(m.polygon[0]).toHaveLength(5)
  expect(m.polygon[0][0]).toEqual([0, 0])
})
