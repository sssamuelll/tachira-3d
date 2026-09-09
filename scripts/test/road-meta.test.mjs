import { describe, expect, it } from 'vitest'
import { normalizeLanes, normalizeOneway, orientar } from '../lib/road-meta.mjs'

describe('normalizeLanes', () => {
  it('conserva los enteros OSM entre uno y doce', () => {
    for (let n = 1; n <= 12; n++) {
      expect(normalizeLanes(String(n))).toBe(n)
      expect(normalizeLanes(n)).toBe(n)
    }
    expect(normalizeLanes(' 2 ')).toBe(2)
  })

  it('rechaza valores ambiguos sin convertir un prefijo en carriles', () => {
    for (const value of ['2;3', '2|3', '2 lanes', '2.5', '1e1', '0x2', '2.0', 'yes']) {
      expect(normalizeLanes(value)).toBeNull()
    }
  })

  it('conserva como desconocidos los ausentes y los valores fuera de rango', () => {
    for (const value of [undefined, null, '', ' ', 0, -1, 13, 99, NaN, Infinity, 1.5, true, [], {}]) {
      expect(normalizeLanes(value)).toBeNull()
    }
  })
})

describe('normalizeOneway', () => {
  it('normaliza los sentidos únicos, incluido el sentido inverso', () => {
    for (const value of ['yes', 'true', '1', '-1', ' YES ', true, 1, -1]) {
      expect(normalizeOneway(value)).toBe(true)
    }
  })

  it('conserva el doble sentido explícito', () => {
    for (const value of ['no', 'false', '0', ' NO ', false, 0]) {
      expect(normalizeOneway(value)).toBe(false)
    }
  })

  it('distingue un tag ausente o desconocido de un no explícito', () => {
    for (const value of [undefined, null, '', ' ', 'reversible', 'alternating', 'yes;no', 2, [], {}]) {
      expect(normalizeOneway(value)).toBeNull()
    }
  })
})

describe('orientar', () => {
  const coords = [[-72.1, 7.7], [-72.2, 7.8], [-72.3, 7.9]]

  it('invierte los nodos de un oneway=-1 para que el orden sea el sentido de circulación', () => {
    for (const value of ['-1', ' -1 ', -1]) {
      expect(orientar(coords, value)).toEqual([[-72.3, 7.9], [-72.2, 7.8], [-72.1, 7.7]])
    }
  })

  it('no toca la geometría de ninguna otra vía, ni la copia', () => {
    for (const value of ['yes', 'no', undefined, null, '1', 'reversible']) {
      expect(orientar(coords, value)).toBe(coords)
    }
  })

  it('no muta la entrada', () => {
    const copia = coords.map(c => [...c])
    orientar(coords, '-1')
    expect(coords).toEqual(copia)
  })
})
