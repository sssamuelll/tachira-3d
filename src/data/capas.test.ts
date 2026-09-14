import { describe, it, expect } from 'vitest'
import { CAPAS, CAPAS_FIJAS, RESERVADOS, validarCapa, type Capa } from './capas'
// @ts-ignore  node:fs no está en los types del tsconfig de la app (solo
// vite/client). Mismo patrón que usa src/data/buildings.test.ts.
import { readFileSync, existsSync } from 'node:fs'
import { NINGUNA } from '../ui/capasUrl'

// Se lee y se parsea en vez de importarlo: Vite resuelve .json, no .geojson, y
// registrar un plugin para una extensión sería más de lo que hace falta.
const hospitales = JSON.parse(readFileSync('public/data/capas/hospitales.geojson', 'utf8'))

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

  // Con una capa llamada 'ninguna', "no hay ninguna capa visible" y "solo está
  // esa capa" se escribirían igual en la URL, y capasDesdeUrl devolvería la
  // capa donde debería devolver el conjunto vacío.
  it('ninguna capa usa el id que la URL reserva para el conjunto vacío', () => {
    const ids = [...CAPAS_FIJAS.map(c => c.id), ...CAPAS.map(c => c.id)]
    expect(ids).not.toContain(NINGUNA)
  })

  it('los campos de opción declaran sus opciones', () => {
    for (const c of CAPAS) {
      for (const campo of c.campos) {
        if (campo.tipo === 'opcion') expect(campo.opciones?.length, `${c.id}.${campo.clave}`).toBeGreaterThan(0)
      }
    }
  })

  // Tripwire, no una regla de negocio: CapaPuntos es hoy el único componente
  // que dibuja una capa (App.tsx filtra por geometria === 'punto'). Una capa
  // 'linea' o 'poligono' pasaría el validador y saldría en el panel sin
  // dibujar nada, así que esto la para acá y señala el componente que falta.
  //
  // El texto de este `it` es lo que ve un contribuidor en su PR rojo, y
  // CONTRIBUTING.md lo cita palabra por palabra junto con qué hacer entonces
  // (abrir un issue). Si se cambia acá, hay que cambiarlo allá.
  it('todas las capas del catálogo son de puntos, que es lo único que se dibuja hoy', () => {
    for (const c of CAPAS) expect(c.geometria, c.id).toBe('punto')
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
    expect(() => validarCapa(capa, coleccion([sinId]))).toThrow(/sin id/)
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

  // Sin este par, un origen 'osm' sin osmId pasaba el portero y FichaRasgo
  // terminaba enlazando a https://www.openstreetmap.org/undefined.
  it('rechaza un origen osm sin osmId', () => {
    const sinOsmId = rasgo()
    delete (sinOsmId.properties as Record<string, unknown>).osmId
    expect(() => validarCapa(capa, coleccion([sinOsmId]))).toThrow(/osmId/)
  })

  it('rechaza un origen comunidad que sí trae osmId', () => {
    expect(() => validarCapa(capa, coleccion([rasgo({ origen: 'comunidad' })]))).toThrow(/osmId/)
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

  // La capa de arriba es de puntos, así que su rasgo LineString muere en la
  // comprobación de geometría antes de que nadie mire una coordenada. Para
  // llegar al recorrido de coordenadas hace falta una capa que SÍ las case.
  const capaPoligono: Capa = {
    ...capa, id: 'poligonos', geometria: 'poligono', archivo: 'capas/poligonos.geojson',
  }

  const poligono = (anillo: [number, number][]) => ({
    type: 'Feature',
    id: 'osm/way/7',
    geometry: { type: 'Polygon', coordinates: [anillo] },
    properties: { clase: 'a', origen: 'osm', osmId: 'way/7', version: 1 },
  })

  it('acepta un polígono con todos sus vértices dentro del bbox', () => {
    const dentro: [number, number][] = [[-72.2, 7.8], [-72.1, 7.8], [-72.1, 7.9], [-72.2, 7.9]]
    expect(validarCapa(capaPoligono, coleccion([poligono(dentro)], 'poligonos'))).toHaveLength(1)
  })

  // El que ejercita la recursión de verdad: el vértice malo está DOS niveles de
  // anidamiento abajo, dentro de su anillo. Un recorrido que solo mirara el
  // primer nivel lo dejaría pasar.
  it('rechaza un vértice de polígono invertido, anidado dentro de su anillo', () => {
    const conUnoMalo: [number, number][] = [[-72.2, 7.8], [7.8, -72.1], [-72.1, 7.9], [-72.2, 7.9]]
    expect(() => validarCapa(capaPoligono, coleccion([poligono(conUnoMalo)], 'poligonos')))
      .toThrow(/fuera del bbox/)
  })

  // Los seis de abajo cierran el mismo agujero por seis lados. El recorrido de
  // coordenadas decidía si algo era un punto mirando SOLO su primer elemento:
  // si ese no era un número, trataba el array como contenedor y bajaba un
  // nivel -- a la nada. El resultado no era una comprobación laxa sino NINGUNA
  // comprobación: el bucle del bbox no llegaba a correr una sola vez.
  const conCoords = (coordinates: unknown) =>
    coleccion([rasgo({}, { type: 'Point', coordinates })])

  it('rechaza un punto que no es un par de números', () => {
    const malas: [string, unknown][] = [
      ['vacío', []],
      ['un solo número', [-72.2]],
      ['tres números', [-72.2, 7.8, 900]],
      ['textos', ['-72.2', '7.8']],
      ['lon nula', [null, 7.8]],
      ['anidado de más', [[-72.2, 7.8]]],
      ['un objeto', { lon: -72.2, lat: 7.8 }],
      ['ausente', undefined],
      ['nulo', null],
      ['un texto suelto', '-72.2,7.8'],
    ]
    for (const [nombre, coords] of malas) {
      expect(() => validarCapa(capa, conCoords(coords)), nombre).toThrow(/coordenadas/)
    }
  })

  // El caso que prueba que la comprobación del bbox estaba apagada y no solo
  // mal: el MISMO punto de Australia se rechazaba como números y pasaba como
  // texto. Si algún día vuelve a colarse, es acá donde se ve.
  it('rechaza un punto fuera del bbox aunque venga escrito como texto', () => {
    expect(() => validarCapa(capa, conCoords([133.7, -25.2]))).toThrow(/bbox/)
    expect(() => validarCapa(capa, conCoords(['133.7', '-25.2']))).toThrow(/coordenadas|bbox/)
  })

  it('rechaza una coordenada no finita', () => {
    expect(() => validarCapa(capa, conCoords([-72.2, Number.NaN]))).toThrow(/coordenadas/)
    expect(() => validarCapa(capa, conCoords([Number.POSITIVE_INFINITY, 7.8]))).toThrow(/coordenadas/)
    // 1e400 no es representable: JSON.parse lo entrega como Infinity, así que
    // este es el camino por el que un archivo de verdad mete un no finito.
    expect(() => validarCapa(capa, conCoords(JSON.parse('[-72.2, 1e400]')))).toThrow(/coordenadas/)
  })

  it('rechaza un anillo de polígono que no es una lista de puntos', () => {
    const plano = {
      type: 'Feature', id: 'osm/way/7',
      geometry: { type: 'Polygon', coordinates: [-72.2, 7.8] },
      properties: { clase: 'a', origen: 'osm', osmId: 'way/7', version: 1 },
    }
    expect(() => validarCapa(capaPoligono, coleccion([plano], 'poligonos'))).toThrow(/coordenadas/)
  })

  // El catálogo declara cuatro tipos de campo y el portero solo comprobaba uno.
  // Lo que pasaba se veía en la ficha: un booleano que no era booleano dejaba
  // de leerse "Sí/No" y salía como texto crudo o como [object Object].
  const capaTipos: Capa = {
    ...capa,
    id: 'tipos',
    campos: [
      { clave: 'nombre', nombre: 'Nombre', tipo: 'texto' },
      { clave: 'clase', nombre: 'Clase', tipo: 'opcion', opciones: ['a', 'b'], obligatorio: true },
      { clave: 'camas', nombre: 'Camas', tipo: 'numero' },
      { clave: 'urgencias', nombre: 'Urgencias', tipo: 'booleano' },
    ],
  }
  const conCampo = (extra: Record<string, unknown>) =>
    validarCapa(capaTipos, coleccion([rasgo(extra)], 'tipos'))

  it('rechaza un campo de texto que no es texto', () => {
    expect(() => conCampo({ nombre: 12345 })).toThrow(/nombre/)
    expect(() => conCampo({ nombre: ['a', 'b'] })).toThrow(/nombre/)
    expect(() => conCampo({ nombre: null })).toThrow(/nombre/)
  })

  it('rechaza un booleano que no es booleano', () => {
    expect(() => conCampo({ urgencias: 'quiza' })).toThrow(/urgencias/)
    expect(() => conCampo({ urgencias: { a: 1 } })).toThrow(/urgencias/)
    expect(() => conCampo({ urgencias: 1 })).toThrow(/urgencias/)
  })

  it('rechaza un número que no es un número finito', () => {
    expect(() => conCampo({ camas: '40' })).toThrow(/camas/)
    expect(() => conCampo({ camas: Number.NaN })).toThrow(/camas/)
  })

  it('acepta los cuatro tipos bien puestos', () => {
    expect(conCampo({ nombre: 'Central', camas: 40, urgencias: true })).toHaveLength(1)
  })

  it('rechaza un osmId que no tiene forma de osmId', () => {
    for (const osmId of ['123', 'nodo/1', 'node/', 'node/abc', 7, true, ['node/1'], { id: 1 }]) {
      expect(() => validarCapa(capa, coleccion([rasgo({ osmId })])), String(osmId)).toThrow(/osmId/)
    }
    expect(validarCapa(capa, coleccion([rasgo({ osmId: 'relation/99' })]))).toHaveLength(1)
  })
})

describe('la capa de hospitales, contra el archivo real', () => {
  const capa = CAPAS.find(c => c.id === 'hospitales')!

  it('está en el catálogo', () => {
    expect(capa).toBeDefined()
  })

  // Esta es la prueba que importa: el archivo que se sirve pasa por el mismo
  // portero que un aporte de la comunidad. Si alguien edita el GeoJSON a mano
  // y lo rompe, se entera acá y no en el navegador de un vecino.
  it('el archivo que se versiona pasa el validador', () => {
    expect(validarCapa(capa, hospitales).length).toBeGreaterThan(100)
  })

  /**
   * Lo que el CI le exige al archivo servido, en un solo sitio para que el caso
   * del archivo mixto de abajo ejerza EXACTAMENTE este bucle y no una copia.
   *
   * El filtro por origen es el arreglo: antes esto exigía `origen === 'osm'` a
   * todos los rasgos, así que el primer aporte de la comunidad -- lo que
   * CONTRIBUTING invita a mandar, y para lo que existe la capa -- ponía el CI
   * en rojo diciendo que se esperaba 'osm'. Quitar el filtro vuelve a romperlo:
   * es lo que hace fallar el test del archivo mixto.
   */
  const exigirloDeOsm = (coleccion: unknown) => {
    for (const f of validarCapa(capa, coleccion)) {
      if (f.properties.origen !== 'osm') continue
      expect(f.properties.osmId, f.id).toMatch(/^(node|way|relation)\/\d+$/)
    }
  }

  it('los rasgos que dicen venir de OSM traen su osmId bien formado', () => {
    exigirloDeOsm(hospitales)
  })

  it('hoy el archivo es todo de OSM: ningún aporte pendiente de revisar', () => {
    const origenes = new Set(validarCapa(capa, hospitales).map(f => f.properties.origen))
    expect([...origenes]).toEqual(['osm'])
  })

  it('un aporte de la comunidad no rompe lo que el CI le exige al archivo', () => {
    const propio = {
      type: 'Feature',
      id: 'comunidad/ambulatorio-la-concordia',
      geometry: { type: 'Point', coordinates: [-72.235, 7.745] },
      properties: {
        nombre: 'Ambulatorio La Concordia', clase: 'ambulatorio', tipo: 'publico',
        origen: 'comunidad', version: 1,
      },
    }
    const mixto = { ...hospitales, features: [...hospitales.features, propio] }
    expect(validarCapa(capa, mixto)).toHaveLength(hospitales.features.length + 1)
    exigirloDeOsm(mixto)
  })
})

/**
 * El portero corre sobre CADA archivo declarado, no sobre uno escrito a mano.
 *
 * Antes esto solo leía `hospitales.geojson`: una capa nueva con el archivo mal
 * escrito -- o sin archivo -- pasaba el CI entero y solo fallaba al prenderla
 * en el navegador, donde el único aviso es un console.warn. Y el sembrador
 * justifica no validar él (scripts/capa.mjs) apuntando precisamente acá.
 */
describe('el archivo de cada capa del catálogo', () => {
  for (const c of CAPAS) {
    it(`${c.id}: existe y pasa su propio validador`, () => {
      const ruta = `public/data/${c.archivo}`
      expect(existsSync(ruta), ruta).toBe(true)
      expect(validarCapa(c, JSON.parse(readFileSync(ruta, 'utf8'))).length).toBeGreaterThan(0)
    })
  }
})
