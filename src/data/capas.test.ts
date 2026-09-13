import { describe, it, expect } from 'vitest'
import { CAPAS, CAPAS_FIJAS, RESERVADOS, validarCapa, type Capa } from './capas'

const capa: Capa = {
  id: 'prueba',
  nombre: 'De prueba',
  geometria: 'punto',
  campos: [
    { clave: 'nombre', nombre: 'Nombre', tipo: 'texto' },
    { clave: 'clase', nombre: 'Clase', tipo: 'opcion', opciones: ['a', 'b'], obligatorio: true },
  ],
  archivo: 'capas/prueba.geojson',
  porDefecto: false,
  color: '#000000',
}

const rasgo = (extra: Record<string, unknown> = {}, geometry?: unknown) => ({
  type: 'Feature',
  id: 'osm/node/1',
  geometry: geometry ?? { type: 'Point', coordinates: [-72.2, 7.8] },
  properties: { clase: 'a', origen: 'osm', osmId: 'node/1', version: 1, ...extra },
})

const coleccion = (features: unknown[], capaId = 'prueba') =>
  ({ type: 'FeatureCollection', capa: capaId, features })

describe('el catálogo', () => {
  it('no repite ids entre las capas fijas y las de archivo', () => {
    const ids = [...CAPAS_FIJAS.map(c => c.id), ...CAPAS.map(c => c.id)]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ningún campo se llama como algo que pone el sistema', () => {
    for (const c of CAPAS) {
      for (const campo of c.campos) expect(RESERVADOS, `${c.id}.${campo.clave}`).not.toContain(campo.clave)
    }
  })

  it('los campos de opción declaran sus opciones', () => {
    for (const c of CAPAS) {
      for (const campo of c.campos) {
        if (campo.tipo === 'opcion') expect(campo.opciones?.length, `${c.id}.${campo.clave}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('validarCapa', () => {
  it('acepta una colección bien formada y devuelve sus rasgos', () => {
    expect(validarCapa(capa, coleccion([rasgo()]))).toHaveLength(1)
  })

  it('rechaza lo que no es una FeatureCollection', () => {
    expect(() => validarCapa(capa, { type: 'Feature' })).toThrow(/FeatureCollection/)
  })

  it('rechaza una colección que dice ser de otra capa', () => {
    expect(() => validarCapa(capa, coleccion([rasgo()], 'otra'))).toThrow(/otra/)
  })

  it('rechaza un rasgo sin id', () => {
    const sinId = { ...rasgo(), id: undefined }
    expect(() => validarCapa(capa, coleccion([sinId]))).toThrow(/id/)
  })

  it('rechaza dos rasgos con el mismo id, nombrándolo', () => {
    expect(() => validarCapa(capa, coleccion([rasgo(), rasgo()]))).toThrow(/osm\/node\/1/)
  })

  it('rechaza una geometría que no corresponde a la capa', () => {
    const linea = rasgo({}, { type: 'LineString', coordinates: [[-72.2, 7.8], [-72.1, 7.9]] })
    expect(() => validarCapa(capa, coleccion([linea]))).toThrow(/LineString/)
  })

  // El error más probable de una edición a mano: GeoJSON va [lon, lat] y todo
  // el mundo escribe [lat, lon]. Invertido, el punto cae fuera del bbox.
  it('rechaza coordenadas fuera del bbox del estado', () => {
    const invertido = rasgo({}, { type: 'Point', coordinates: [7.8, -72.2] })
    expect(() => validarCapa(capa, coleccion([invertido]))).toThrow(/bbox|fuera/i)
  })

  it('rechaza un rasgo al que le falta un campo obligatorio', () => {
    const sinClase = rasgo()
    delete (sinClase.properties as Record<string, unknown>).clase
    expect(() => validarCapa(capa, coleccion([sinClase]))).toThrow(/clase/)
  })

  it('rechaza un valor que no está entre las opciones del campo', () => {
    expect(() => validarCapa(capa, coleccion([rasgo({ clase: 'z' })]))).toThrow(/clase/)
  })

  it('rechaza un campo del catálogo que use un nombre reservado', () => {
    const conReservado: Capa = { ...capa, campos: [{ clave: 'version', nombre: 'V', tipo: 'numero' }] }
    expect(() => validarCapa(conReservado, coleccion([rasgo()]))).toThrow(/version/)
  })

  it('rechaza un origen que no es ni osm ni comunidad', () => {
    expect(() => validarCapa(capa, coleccion([rasgo({ origen: 'inventado' })]))).toThrow(/origen/)
  })

  it('rechaza una version que no es un entero ≥ 1', () => {
    expect(() => validarCapa(capa, coleccion([rasgo({ version: 0 })]))).toThrow(/version/)
    expect(() => validarCapa(capa, coleccion([rasgo({ version: 1.5 })]))).toThrow(/version/)
  })

  it('acepta un rasgo de la comunidad, que no trae osmId', () => {
    const propio = rasgo({ origen: 'comunidad', osmId: undefined })
    delete (propio.properties as Record<string, unknown>).osmId
    expect(validarCapa(capa, coleccion([propio]))).toHaveLength(1)
  })

  it('el mensaje de un rasgo malo dice cuál es', () => {
    const malo = { ...rasgo({ version: 0 }), id: 'osm/node/42' }
    expect(() => validarCapa(capa, coleccion([malo]))).toThrow(/osm\/node\/42/)
  })
})
