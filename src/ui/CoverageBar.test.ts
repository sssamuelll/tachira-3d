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

// Los 29 nombres reales de OSM empiezan por "Municipio " (municipios.json),
// así que con el ancho de la fila y el recorte por elipsis los 29 botones se
// pintaban iguales: "Municipio…". El orden y el filtro siguen usando el
// nombre completo -- solo cambia lo que se pinta.
test('el nombre pintado pierde el prefijo "Municipio", el completo se conserva', () => {
  const conPrefijo: Way[] = ways.map((w, i) => ({ ...w, municipio: ['Municipio Andrés Bello', 'Municipio García de Hevia', 'Municipio Junín'][i] }))
  const filas = filasCobertura(new AttrStore(conPrefijo))
  expect(filas.map(f => f.corto)).toEqual(['Andrés Bello', 'García de Hevia', 'Junín'])
  expect(filas[0].name).toBe('Municipio Andrés Bello')   // el filtro y municipios.json usan este
})

test('en caso de empate ordena alfabetico, no por orden de insercion del Map', () => {
  const s = new AttrStore(ways)   // los tres arrancan en 0%, todos empatados
  expect(filasCobertura(s).map(f => f.name)).toEqual(['Junín', 'Rubio', 'sin municipio'])
})
