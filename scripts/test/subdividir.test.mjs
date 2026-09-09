import { describe, expect, it } from 'vitest'
import { subdividir, apoyar } from '../lib/subdividir.mjs'
import { lineLengthMeters } from '../lib/geo.mjs'

const tramo = (a, b) => lineLengthMeters([a, b])

describe('apoyar', () => {
  // Relieve sintético: una cresta triangular a lo largo de la longitud, con
  // el pico en lon = -72.195 (subida y bajada de 10 m cada 0,001° ~ 110 m).
  const cresta = (lon) => Math.max(0, 10 - Math.abs(lon + 72.195) * 10000)
  const alturaDe = (lon) => cresta(lon)

  it('parte por bisección un tramo que cruza la cresta hasta que la cuerda la sigue', () => {
    const coords = [[-72.2, 7.7], [-72.19, 7.7]]     // ~1,1 km, cruza el pico
    const out = apoyar(coords, alturaDe, 0.2, 4)
    expect(out.length).toBeGreaterThan(2)
    expect(out[0]).toBe(coords[0])
    expect(out[out.length - 1]).toBe(coords[1])
    for (let i = 1; i < out.length; i++) {
      const [lon0] = out[i - 1], [lon1] = out[i]
      const h0 = alturaDe(lon0), h1 = alturaDe(lon1)
      for (const t of [0.25, 0.5, 0.75]) {
        const lon = lon0 + (lon1 - lon0) * t
        expect(Math.abs(alturaDe(lon) - (h0 + (h1 - h0) * t))).toBeLessThanOrEqual(0.2 + 1e-9)
      }
    }
  })

  it('no toca un tramo sobre terreno plano', () => {
    const coords = [[-72.3, 7.7], [-72.29, 7.7]]     // lejos de la cresta
    expect(apoyar(coords, alturaDe, 0.2, 4)).toEqual(coords)
  })

  it('no parte por debajo del mínimo aunque no alcance el umbral', () => {
    const escalon = (lon) => (lon > -72.195 ? 5 : 0)   // discontinuidad: nunca se cumple el umbral
    const out = apoyar([[-72.2, 7.7], [-72.19, 7.7]], escalon, 0.2, 4)
    for (let i = 1; i < out.length; i++) expect(tramo(out[i - 1], out[i])).toBeGreaterThanOrEqual(2)
    expect(out.length).toBeLessThan(600)
  })
})

describe('subdividir', () => {
  const coords = [[-72.2, 7.7], [-72.19, 7.7], [-72.19, 7.705]]   // ~1,1 km y ~550 m

  it('ningún tramo mide más del paso, y los extremos originales quedan intactos', () => {
    const out = subdividir(coords, 30)
    for (let i = 1; i < out.length; i++) expect(tramo(out[i - 1], out[i])).toBeLessThanOrEqual(30.001)
    expect(out[0]).toBe(coords[0])
    expect(out[out.length - 1]).toBe(coords[2])
    expect(out).toContain(coords[1])
  })

  it('reparte cada tramo en partes iguales', () => {
    const out = subdividir([coords[0], coords[1]], 30)
    const largos = out.slice(1).map((p, i) => tramo(out[i], p))
    for (const l of largos) expect(l).toBeCloseTo(largos[0], 3)
    expect(out.length - 1).toBe(Math.ceil(tramo(coords[0], coords[1]) / 30))
  })

  it('no toca una vía cuyos tramos ya son cortos', () => {
    const cortos = [[-72.2, 7.7], [-72.2001, 7.7], [-72.2002, 7.7]]
    expect(subdividir(cortos, 30)).toEqual(cortos)
  })
})
