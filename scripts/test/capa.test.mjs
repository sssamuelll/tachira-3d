import { describe, expect, it } from 'vitest'
import { REGISTRO } from '../lib/capas-osm.mjs'
import { fusionar, siembraSospechosa } from '../capa.mjs'

const { traducir } = REGISTRO.hospitales

const node = (tags, id = 1) => ({ type: 'node', id, lat: 7.8, lon: -72.2, tags })
const way = (tags, id = 2) => ({ type: 'way', id, center: { lat: 7.8, lon: -72.2 }, tags })

describe('traducir hospitales', () => {
  it('un nodo con amenity=hospital sale como hospital, con id de OSM', () => {
    const r = traducir(node({ amenity: 'hospital', name: 'Central' }))
    expect(r.id).toBe('osm/node/1')
    expect(r.geometry).toEqual({ type: 'Point', coordinates: [-72.2, 7.8] })
    expect(r.properties.clase).toBe('hospital')
    expect(r.properties.nombre).toBe('Central')
    expect(r.properties.origen).toBe('osm')
    expect(r.properties.osmId).toBe('node/1')
    expect(r.properties.version).toBe(1)
  })

  it('un way usa su center, porque no es un punto', () => {
    expect(traducir(way({ amenity: 'clinic' })).geometry.coordinates).toEqual([-72.2, 7.8])
  })

  it('traduce cada amenity a su clase', () => {
    expect(traducir(node({ amenity: 'clinic' })).properties.clase).toBe('clinica')
    expect(traducir(node({ amenity: 'doctors' })).properties.clase).toBe('consultorio')
    expect(traducir(node({ healthcare: 'centre' })).properties.clase).toBe('ambulatorio')
  })

  // En OSM muchos centros vienen sin nombre, y eso es un dato, no un error.
  it('sin name deja el nombre vacío en vez de descartar', () => {
    expect(traducir(node({ amenity: 'hospital' })).properties.nombre).toBe('')
  })

  it('descarta lo que no tiene ninguna etiqueta de salud reconocible', () => {
    expect(traducir(node({ shop: 'bakery' }))).toBeNull()
  })

  it('traduce operator:type a público, privado o sin dato', () => {
    for (const v of ['public', 'government', 'community']) {
      expect(traducir(node({ amenity: 'hospital', 'operator:type': v })).properties.tipo).toBe('publico')
    }
    expect(traducir(node({ amenity: 'hospital', 'operator:type': 'private' })).properties.tipo).toBe('privado')
    expect(traducir(node({ amenity: 'hospital', 'operator:type': 'raro' })).properties.tipo).toBe('sin_dato')
    expect(traducir(node({ amenity: 'hospital' })).properties.tipo).toBe('sin_dato')
  })

  it('emergency se omite cuando OSM no lo dice', () => {
    expect(traducir(node({ amenity: 'hospital', emergency: 'yes' })).properties.emergencias).toBe(true)
    expect(traducir(node({ amenity: 'hospital', emergency: 'no' })).properties.emergencias).toBe(false)
    expect('emergencias' in traducir(node({ amenity: 'hospital' })).properties).toBe(false)
  })
})

describe('fusionar', () => {
  const osm = { type: 'Feature', id: 'osm/node/1', geometry: {}, properties: { origen: 'osm', version: 1 } }
  const propio = { type: 'Feature', id: 'com/abc', geometry: {}, properties: { origen: 'comunidad', version: 3 } }

  it('conserva lo que puso la comunidad', () => {
    const salida = fusionar([propio, osm], [])
    expect(salida.map(f => f.id)).toEqual(['com/abc'])
  })

  it('reemplaza lo de OSM por lo recién bajado', () => {
    const nuevo = { ...osm, properties: { ...osm.properties, nombre: 'Nuevo' } }
    const salida = fusionar([osm], [nuevo])
    expect(salida).toHaveLength(1)
    expect(salida[0].properties.nombre).toBe('Nuevo')
  })

  it('devuelve todo ordenado por id, para que el diff del PR se lea', () => {
    const salida = fusionar([propio], [{ ...osm, id: 'osm/node/9' }, { ...osm, id: 'osm/node/2' }])
    expect(salida.map(f => f.id)).toEqual(['com/abc', 'osm/node/2', 'osm/node/9'])
  })

  // El caso que el proyecto entero existe para permitir: alguien corrige un
  // hospital de OSM y conserva su id estable. Antes esto devolvía el rasgo DOS
  // veces, y validarCapa rechaza la colección completa por el id repetido: la
  // capa dejaba de cargar y el CI se caía, por haber aceptado una corrección.
  it('no duplica un id que la comunidad corrigió y OSM vuelve a traer', () => {
    const corregido = { ...osm, properties: { origen: 'comunidad', version: 2, nombre: 'Corregido' } }
    const salida = fusionar([corregido], [osm])
    expect(salida.map(f => f.id)).toEqual(['osm/node/1'])
    expect(salida).toHaveLength(1)
  })

  it('en esa colisión manda la comunidad, que es la corrección', () => {
    const corregido = { ...osm, properties: { origen: 'comunidad', version: 2, nombre: 'Corregido' } }
    const deOsm = { ...osm, properties: { ...osm.properties, nombre: 'El de OSM' } }
    expect(fusionar([corregido], [deOsm])[0].properties.nombre).toBe('Corregido')
  })

  it('nunca devuelve ids repetidos, vengan como vengan', () => {
    const salida = fusionar(
      [propio, { ...osm, properties: { origen: 'comunidad', version: 2 } }],
      [osm, { ...osm, id: 'osm/node/2' }],
    )
    expect(new Set(salida.map(f => f.id)).size).toBe(salida.length)
  })
})

describe('siembraSospechosa', () => {
  const osm = { type: 'Feature', id: 'osm/node/1', geometry: {}, properties: { origen: 'osm', version: 1 } }
  const propio = { type: 'Feature', id: 'com/abc', geometry: {}, properties: { origen: 'comunidad', version: 3 } }

  // El guardia de overpass.mjs es `if (!json.elements) throw`, y `![]` es false:
  // una respuesta con elements vacío -- consulta rota, timeout parcial -- pasa
  // sin error. Sin esto, el sembrador reescribía el archivo sin un solo
  // hospital de OSM y lo contaba en el log DESPUÉS de haberlo hecho.
  it('avisa si la siembra viene vacía y el archivo tenía datos de OSM', () => {
    expect(siembraSospechosa([osm, propio], [])).toBe(true)
  })

  it('no se queja de un archivo que solo tenía aportes de la comunidad', () => {
    expect(siembraSospechosa([propio], [])).toBe(false)
  })

  it('no se queja de la primera siembra, con el archivo aún sin crear', () => {
    expect(siembraSospechosa([], [])).toBe(false)
  })

  it('no se queja de una siembra que sí trajo rasgos', () => {
    expect(siembraSospechosa([osm], [osm])).toBe(false)
  })
})
