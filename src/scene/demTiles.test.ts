import { describe, expect, it } from 'vitest'
import { decodificar, LADO } from './demTiles'

describe('decodificar', () => {
  it('lee Terrarium y el alpha 255 como dentro', () => {
    const rgba = new Uint8Array(LADO * LADO * 4)
    // post (3, 2) = 1234.5 m: v = 1234.5 + 32768 = 34002.5 -> r=132, g=210, b=128
    const o = (2 * LADO + 3) * 4
    rgba[o] = 132; rgba[o + 1] = 210; rgba[o + 2] = 128; rgba[o + 3] = 255
    const t = decodificar(rgba)
    expect(t.alturas[2 * LADO + 3]).toBeCloseTo(1234.5, 2)
    expect(t.dentro[2 * LADO + 3]).toBe(1)
    expect(t.dentro[0]).toBe(0)
    expect(t.max).toBeCloseTo(1234.5, 2)
    expect(t.min).toBeCloseTo(-32768, 2)
  })

  it('el alpha 254 (fuera) no es dentro', () => {
    const rgba = new Uint8Array(LADO * LADO * 4).fill(254)
    expect(decodificar(rgba).dentro.every(v => v === 0)).toBe(true)
  })
})
