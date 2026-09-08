import { describe, expect, it } from 'vitest'
import { ingerirEdificios, limpiarAnillo } from '../lib/building-input.mjs'

const ring = [[-72, 8], [-71.999, 8], [-71.999, 8.001], [-72, 8.001], [-72, 8]]
const geom = r => r.map(([lon, lat]) => ({ lon, lat }))
const way = (id, geometry = geom(ring)) => ({ type: 'way', id, tags: { building: 'yes' }, geometry })

describe('ingestión de edificios OSM', () => {
  it('deduplica type/id conservando geometría completa y resultado independiente del orden', () => {
    const full = way(12), short = way(12, geom(ring.slice(0, 2)))
    const a = ingerirEdificios([{ elements: [full, short] }]), b = ingerirEdificios([{ elements: [short, full] }])
    expect(a).toEqual(b)
    expect(a.buildings[0]).toMatchObject({ id: 'way/12', osmId: 12, osmType: 'way' })
    expect(a.stats.duplicateElements).toBe(1)
  })

  it('une fragmentos de relación, conserva patios y suprime outer way duplicado', () => {
    const hole = [[-71.9998, 8.0002], [-71.9992, 8.0002], [-71.9992, 8.0008], [-71.9998, 8.0008], [-71.9998, 8.0002]]
    const relation = { type: 'relation', id: 12, tags: { building: 'yes', type: 'multipolygon' }, members: [
      { type: 'way', ref: 10, role: 'outer', geometry: geom(ring.slice(0, 3)) },
      { type: 'way', ref: 11, role: 'outer', geometry: geom([ring[0], ring[3], ring[2]]) },
      { type: 'way', ref: 13, role: 'inner', geometry: geom(hole) },
    ] }
    const result = ingerirEdificios([{ elements: [way(10), relation] }])
    expect(result.buildings).toHaveLength(1)
    expect(result.buildings[0].id).toBe('relation/12')
    expect(result.buildings[0].polygons[0].holes).toHaveLength(1)
    expect(result.stats.suppressedMemberWays).toBe(1)
  })

  it('rechaza anillos abiertos y auto-intersecciones sin cerrar con una cuerda inventada', () => {
    expect(limpiarAnillo(ring.slice(0, 4))).toBeNull()
    expect(limpiarAnillo([ring[0], ring[2], ring[1], ring[3], ring[0]])).toBeNull()
    expect(ingerirEdificios([{ elements: [way(2, geom(ring.slice(0, 4)))] }]).stats.invalidElements).toBe(1)
  })

  it('un patio exterior inválido queda contabilizado', () => {
    const result = ingerirEdificios([{ elements: [{ type: 'relation', id: 1, tags: { building: 'yes' }, members: [
      { type: 'way', ref: 1, role: 'outer', geometry: geom(ring) },
      { type: 'way', ref: 2, role: 'inner', geometry: geom(ring.map(([x, y]) => [x + 0.1, y])) },
    ] }] }])
    expect(result.stats.invalidHoles).toBe(1)
    expect(result.buildings[0].polygons[0].holes).toEqual([])
  })

  it('no confunde números OSM de tipos distintos y conserva tags reales', () => {
    const relation = { type: 'relation', id: 12, tags: { height: '19 m', building: 'yes' }, members: [{ type: 'way', ref: 40, role: 'outer', geometry: geom(ring.map(([x, y]) => [x + 0.01, y])) }] }
    const result = ingerirEdificios([{ elements: [way(12), relation] }])
    expect(result.buildings.map(b => b.id)).toEqual(['relation/12', 'way/12'])
    expect(result.buildings[0].tags.height).toBe('19 m')
  })
})
