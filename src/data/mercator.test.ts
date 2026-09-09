import { describe, expect, it } from 'vitest'
import { xTesela, yTesela, lonDeTesela, latDeTesela } from './mercator'

describe('mercator', () => {
  it('San Cristóbal cae en la tesela 2452/3918 a z13', () => {
    // Las mismas cifras que lonToTileX/latToTileY de scripts/lib/terrarium.mjs.
    expect(Math.floor(xTesela(-72.22, 13))).toBe(2452)
    expect(Math.floor(yTesela(7.77, 13))).toBe(3918)
  })

  it('ida y vuelta', () => {
    expect(lonDeTesela(xTesela(-72.22, 12), 12)).toBeCloseTo(-72.22, 9)
    expect(latDeTesela(yTesela(7.77, 12), 12)).toBeCloseTo(7.77, 9)
  })

  it('la tesela 1223/1948 a z12 es la esquina noroeste del DEM del Táchira', () => {
    // Misma cifra que tileRangeForBbox en scripts/lib/terrarium.mjs.
    expect(Math.floor(xTesela(-72.4878225, 12))).toBe(1223)
    expect(Math.floor(yTesela(8.6826552, 12))).toBe(1948)
  })
})
