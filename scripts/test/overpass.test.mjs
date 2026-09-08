import { test, expect } from 'vitest'
import { waysToLines, relationsToPolygons, assembleRings, QUERY_VIAS, QUERY_MUNICIPIOS } from '../lib/overpass.mjs'

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

test('waysToLines conserva los nodos OSM para distinguir conexión de coincidencia en planta', () => {
  const geometry = [{ lat: 8, lon: -72 }, { lat: 8.1, lon: -72.1 }]
  const ways = waysToLines({ elements: [
    { type: 'way', id: 1, nodes: [10, 20], geometry },
    { type: 'way', id: 2, nodes: [30, 40], geometry },
  ] })
  expect(ways[0].coords).toEqual(ways[1].coords)
  expect(ways.map(w => w.nodes)).toEqual([[10, 20], [30, 40]])
})

test('waysToLines deja null si Overpass no entrega los nodos', () => {
  const [way] = waysToLines({ elements: [{
    type: 'way', id: 1, geometry: [{ lat: 8, lon: -72 }, { lat: 8.1, lon: -72.1 }],
  }] })
  expect(way.nodes).toBeNull()
})

// A partir de aquí: los municipios reales del Táchira traen la frontera partida
// en varios `way` con role=outer (29/29 relaciones en el dato real, hasta 68
// fragmentos en una sola). assembleRings es lo que los encadena.

test('assembleRings encadena varios fragmentos abiertos en un anillo cerrado', () => {
  const members = [
    { role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }] },
    { role: 'outer', geometry: [{ lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }] },
    { role: 'outer', geometry: [{ lat: 1, lon: 0 }, { lat: 0, lon: 0 }] },
  ]
  const { rings, orphanFragments } = assembleRings(members, 'outer')
  expect(rings).toHaveLength(1)
  expect(rings[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])
  expect(orphanFragments).toBe(0)
})

test('assembleRings invierte un fragmento cuando su orden viene al reves', () => {
  const members = [
    { role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }] },
    { role: 'outer', geometry: [{ lat: 1, lon: 0 }, { lat: 1, lon: 1 }, { lat: 0, lon: 1 }] }, // al reves
    { role: 'outer', geometry: [{ lat: 1, lon: 0 }, { lat: 0, lon: 0 }] },
  ]
  const { rings, orphanFragments } = assembleRings(members, 'outer')
  expect(rings).toHaveLength(1)
  expect(rings[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]])
  expect(orphanFragments).toBe(0)
})

test('assembleRings arma varios anillos cerrados separados', () => {
  const members = [
    { role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }] },
    { role: 'outer', geometry: [{ lat: 5, lon: 5 }, { lat: 5, lon: 6 }, { lat: 6, lon: 6 }] },
    { role: 'outer', geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 0 }, { lat: 0, lon: 0 }] },
    { role: 'outer', geometry: [{ lat: 6, lon: 6 }, { lat: 6, lon: 5 }, { lat: 5, lon: 5 }] },
  ]
  const { rings, orphanFragments } = assembleRings(members, 'outer')
  expect(rings).toHaveLength(2)
  expect(rings.every(r => r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1])).toBe(true)
  expect(orphanFragments).toBe(0)
})

test('assembleRings reporta huerfanos sin cerrar en silencio un fragmento que no conecta', () => {
  const members = [
    { role: 'outer', geometry: [{ lat: 20, lon: 20 }, { lat: 20, lon: 21 }, { lat: 21, lon: 21 }] },
  ]
  const { rings, orphanFragments } = assembleRings(members, 'outer')
  expect(rings).toHaveLength(0)
  expect(orphanFragments).toBe(1)
})

test('relationsToPolygons ensambla el anillo exterior desde fragmentos partidos', () => {
  const json = { elements: [{
    type: 'relation', id: 7, tags: { name: 'Municipio Junín' },
    members: [
      { type: 'way', role: 'outer', geometry: [{ lat: 1, lon: 0 }, { lat: 0, lon: 0 }] },
      { type: 'way', role: 'outer', geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }] },
      { type: 'way', role: 'outer', geometry: [{ lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }] },
    ],
  }] }
  const [m] = relationsToPolygons(json)
  expect(m.osmId).toBe(7)
  expect(m.name).toBe('Municipio Junín')
  expect(m.polygons).toHaveLength(1)      // un solo anillo: no hay role=inner en el dato real
  expect(m.polygons[0]).toHaveLength(1)   // [anilloExterior], sin huecos
  const ring = m.polygons[0][0]
  expect(ring).toHaveLength(5)
  expect(ring[0]).toEqual(ring[ring.length - 1])
  expect(m.orphanFragments).toBe(0)
})

test('relationsToPolygons reporta fragmentos huerfanos sin descartar el resto', () => {
  const json = { elements: [{
    type: 'relation', id: 9, tags: { name: 'Municipio Cárdenas' },
    members: [
      { type: 'way', role: 'outer', geometry: [
        { lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }, { lat: 0, lon: 0 },
      ] }, // ya viene cerrado
      { type: 'way', role: 'outer', geometry: [{ lat: 9, lon: 9 }, { lat: 9, lon: 10 }] }, // suelto, no cierra
    ],
  }] }
  const [m] = relationsToPolygons(json)
  expect(m.polygons).toHaveLength(1)
  expect(m.polygons[0][0]).toHaveLength(5)
  expect(m.orphanFragments).toBe(1)
})
