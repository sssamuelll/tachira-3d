import { test, expect } from 'vitest'
import { filasCobertura } from './CoverageBar'
import { AttrStore } from '../data/store'
import type { Way } from '../data/types'

const ways: Way[] = [
  { osmId: 1, ref: null, name: null, highway: 'residential', surface: null, tipo: 'sin_definir', municipio: 'Rubio', km: 1, km3d: 1 },
  { osmId: 2, ref: null, name: null, highway: 'residential', surface: null, tipo: 'sin_definir', municipio: 'Junín', km: 1, km3d: 1 },
  // caso sintético: el dato real nunca trae municipio:null (build-data.mjs y
  // verify-data.mjs exigen 0 vías sin municipio), así que este test es la
  // única cobertura posible -- mismo criterio que el bbox multipolígono de
  // Camera.test.ts.
  { osmId: 3, ref: null, name: null, highway: 'track', surface: null, tipo: 'sin_definir', municipio: null, km: 1, km3d: 1 },
]

test('el bucket "sin municipio" existe pero no es pulsable', () => {
  const s = new AttrStore(ways)
  const filas = filasCobertura(s)
  const sinMunicipio = filas.find(f => f.name === 'sin municipio')
  expect(sinMunicipio?.clickable).toBe(false)
  expect(filas.filter(f => f.name !== 'sin municipio').every(f => f.clickable)).toBe(true)
})

test('en caso de empate ordena alfabetico, no por orden de insercion del Map', () => {
  const s = new AttrStore(ways)   // los tres arrancan en 0%, todos empatados
  expect(filasCobertura(s).map(f => f.name)).toEqual(['Junín', 'Rubio', 'sin municipio'])
})
