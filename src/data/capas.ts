import { urlVersionado } from './rutas'
import { BBOX } from './constants'

/**
 * El catálogo de capas del mapa: qué se puede prender, y de dónde sale.
 *
 * Hay dos clases. Las FIJAS no salen de un archivo sino de componentes que ya
 * existen desde antes de que hubiera capas -- los edificios horneados, los
 * límites municipales dibujados en el shader del relieve -- y están acá solo
 * para que el panel pueda listarlas junto a las demás. Las del catálogo de
 * archivo llegan en la tanda de hospitales.
 *
 * `pci` es fija pero de otra especie: no dibuja nada, conmuta de qué habla el
 * color de la red vial. Vive acá igual porque lo que el panel ofrece es "qué
 * enseña el mapa", y eso es exactamente lo que hace.
 */

export interface CapaFija {
  id: 'edificios' | 'municipios' | 'pci'
  nombre: string
  /** Visible sin ?capas= en la URL. */
  porDefecto: boolean
}

/**
 * `edificios` por defecto porque es lo que el mapa dibujaba antes de que
 * existiera el panel, y prender el panel no puede cambiar lo que ve alguien
 * que abre el enlace de siempre. `municipios` apagado por lo mismo: hoy no se
 * dibuja, así que encenderlo de oficio cambiaría el mapa de todo el mundo.
 */
export const CAPAS_FIJAS: readonly CapaFija[] = [
  { id: 'edificios', nombre: 'Edificaciones', porDefecto: true },
  { id: 'municipios', nombre: 'Municipios', porDefecto: false },
  // No dibuja nada nuevo: conmuta de qué habla el COLOR de la red vial. Con
  // ella apagada manda la cartografía (la paleta de Liberty por clase de vía,
  // constants.ts); encendida manda el dato (la rampa ASTM por PCI, con los
  // contornos por procedencia). Los dos quieren el mismo canal -- el tono --
  // y por eso es un conmutador y no dos cosas que se suman.
  //
  // Apagada de fábrica: el mapa abre pareciéndose a un mapa vial, y el estado
  // del pavimento se enciende cuando se va a buscar. Además, encenderla de
  // oficio cambiaría lo que ve quien abre un enlace sin `?capas=`.
  { id: 'pci', nombre: 'Estado del pavimento', porDefecto: false },
]

export type Geometria = 'punto' | 'linea' | 'poligono'

/**
 * Convención entre CapaPuntos.tsx y FichaRasgo.tsx, no una regla de este
 * archivo: un campo con `clave: 'nombre'` es el título del rasgo. El marcador
 * lo usa como etiqueta y la ficha lo muestra como encabezado en vez de
 * listarlo junto a los demás campos.
 */
export interface Campo {
  clave: string
  nombre: string
  tipo: 'texto' | 'opcion' | 'numero' | 'booleano'
  /** Solo si tipo === 'opcion'. */
  opciones?: readonly string[]
  obligatorio?: boolean
}

export interface Capa {
  id: string
  nombre: string
  geometria: Geometria
  campos: readonly Campo[]
  /** Relativo al raíz de datos; se resuelve con urlVersionado. */
  archivo: string
  porDefecto: boolean
  color: string
}

/** Nombres que ningún campo del catálogo puede usar: los pone el sistema. */
export const RESERVADOS = ['origen', 'osmId', 'version'] as const

export const CAPAS: readonly Capa[] = [
  {
    id: 'hospitales',
    nombre: 'Hospitales y centros médicos',
    geometria: 'punto',
    campos: [
      // 'nombre' NO es obligatorio: en OSM muchos centros vienen sin nombre, y
      // eso es un dato sobre el centro, no un error del archivo.
      { clave: 'nombre', nombre: 'Nombre', tipo: 'texto' },
      {
        clave: 'clase', nombre: 'Clase', tipo: 'opcion',
        opciones: ['hospital', 'clinica', 'consultorio', 'ambulatorio'], obligatorio: true,
      },
      {
        clave: 'tipo', nombre: 'Tipo', tipo: 'opcion',
        opciones: ['publico', 'privado', 'sin_dato'], obligatorio: true,
      },
      { clave: 'emergencias', nombre: 'Emergencias', tipo: 'booleano' },
    ],
    archivo: 'capas/hospitales.geojson',
    porDefecto: false,
    color: '#e0453a',
  },
]

/**
 * La geometría de un rasgo, tipada acá y no con @types/geojson: el tsconfig
 * restringe los tipos globales a `vite/client`, así que el namespace GeoJSON
 * no existe en este proyecto, y añadir la dependencia por tres formas es más
 * de lo que hace falta. Las coordenadas anidan según el tipo, igual que en el
 * estándar: un punto es [lon, lat], una línea una lista de puntos, un polígono
 * una lista de anillos.
 */
export type Geometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }

export interface Rasgo {
  type: 'Feature'
  id: string
  geometry: Geometry
  properties: Record<string, unknown> & {
    origen: 'osm' | 'comunidad'
    osmId?: string
    version: number
  }
}

const GEOMETRIA: Record<Geometria, string> = {
  punto: 'Point', linea: 'LineString', poligono: 'Polygon',
}

/** Cuántos niveles de lista envuelven al par [lon, lat] en cada geometría: el
 *  punto es el par pelado, la línea una lista de pares, el polígono una lista
 *  de anillos de pares. Es la forma que manda el estándar. */
const PROFUNDIDAD: Record<Geometria, number> = { punto: 0, linea: 1, poligono: 2 }

/**
 * Recorre las coordenadas COMPROBANDO la forma que la geometría declara, y va
 * entregando los pares.
 *
 * Antes esto decidía si algo ya era un punto mirando solo `coords[0]`: si ese
 * primer elemento no era un número -- un texto, un null, un objeto -- daba el
 * array por contenedor y bajaba un nivel, a la nada. El efecto no era una
 * comprobación laxa sino NINGUNA: el bucle del bbox no llegaba a correr, y
 * `["133.7","-25.2"]` (Australia) entraba mientras que los mismos números sin
 * comillas se rechazaban. Bajar por niveles contados, y exigir el par al
 * llegar al fondo, es lo que cierra las dos puertas a la vez.
 */
function * puntos (coords: unknown, nivel: number, donde: string): Generator<[number, number]> {
  if (nivel > 0) {
    if (!Array.isArray(coords)) {
      throw new Error(`${donde}: coordenadas mal formadas, se esperaba una lista`)
    }
    for (const c of coords) yield * puntos(c, nivel - 1, donde)
    return
  }
  if (!Array.isArray(coords) || coords.length !== 2) {
    throw new Error(`${donde}: coordenadas mal formadas, se esperaba un par [lon, lat]`)
  }
  const [lon, lat] = coords
  // Number.isFinite descarta de una vez NaN, ±Infinity y todo lo que no sea
  // número. El 1e400 de un archivo escrito a mano llega acá como Infinity:
  // JSON.parse no falla con él, así que este es su único filtro.
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`${donde}: coordenadas no numéricas [${lon}, ${lat}]`)
  }
  yield [lon, lat]
}

/** La forma de un osmId de OpenStreetMap: el tipo de elemento y su número. */
const OSM_ID = /^(node|way|relation)\/\d+$/

/**
 * El portero del formato. Lo que entra por acá lo escribió una persona en un
 * editor de texto dentro de un pull request, así que cada rechazo nombra el
 * rasgo y el motivo: el mensaje ES la respuesta a esa contribución.
 *
 * Comprueba el bbox porque el error más común de escribir GeoJSON a mano es
 * poner [lat, lon]: el estándar manda [lon, lat] y lo contrario no falla en
 * ninguna parte, solo manda el hospital al océano Índico.
 */
export function validarCapa (capa: Capa, coleccion: unknown): Rasgo[] {
  for (const campo of capa.campos) {
    if ((RESERVADOS as readonly string[]).includes(campo.clave)) {
      throw new Error(`capa ${capa.id}: el campo '${campo.clave}' usa un nombre que pone el sistema`)
    }
  }
  const c = coleccion as { type?: string; capa?: string; features?: unknown[] }
  if (c?.type !== 'FeatureCollection' || !Array.isArray(c.features)) {
    throw new Error(`capa ${capa.id}: se esperaba una FeatureCollection`)
  }
  if (c.capa !== capa.id) {
    throw new Error(`capa ${capa.id}: la colección dice ser de '${c.capa}'`)
  }
  const esperada = GEOMETRIA[capa.geometria]
  const vistos = new Set<string>()
  const rasgos: Rasgo[] = []

  for (const f of c.features as Rasgo[]) {
    const id = f?.id
    if (typeof id !== 'string' || id === '') throw new Error(`capa ${capa.id}: un rasgo sin id`)
    if (vistos.has(id)) throw new Error(`capa ${capa.id}: el id '${id}' está repetido`)
    vistos.add(id)
    const donde = `capa ${capa.id}, rasgo '${id}'`

    const tipo = f.geometry?.type
    if (tipo !== esperada) throw new Error(`${donde}: geometría ${tipo}, se esperaba ${esperada}`)
    for (const [lon, lat] of puntos(f.geometry?.coordinates, PROFUNDIDAD[capa.geometria], donde)) {
      if (lon < BBOX.w || lon > BBOX.e || lat < BBOX.s || lat > BBOX.n) {
        throw new Error(`${donde}: [${lon}, ${lat}] cae fuera del bbox del estado (¿[lat, lon] al revés?)`)
      }
    }

    const p = f.properties
    if (p === null || typeof p !== 'object') throw new Error(`${donde}: sin properties`)
    for (const campo of capa.campos) {
      const v = p[campo.clave]
      if (v === undefined) {
        if (campo.obligatorio) throw new Error(`${donde}: falta el campo obligatorio '${campo.clave}'`)
        continue
      }
      // El catálogo declara cuatro tipos y antes solo se comprobaba 'opcion'.
      // Lo que se colaba no era inofensivo: FichaRasgo lee un booleano como
      // "Sí/No" y cualquier otra cosa la pasa por String(), así que un
      // `emergencias: "quiza"` salía como texto crudo y un objeto como
      // [object Object], en la ficha que lee un vecino.
      if (campo.tipo === 'texto' && typeof v !== 'string') {
        throw new Error(`${donde}: '${campo.clave}' vale ${JSON.stringify(v)}, se esperaba texto`)
      }
      if (campo.tipo === 'numero' && !Number.isFinite(v)) {
        throw new Error(`${donde}: '${campo.clave}' vale ${JSON.stringify(v)}, se esperaba un número`)
      }
      if (campo.tipo === 'booleano' && typeof v !== 'boolean') {
        throw new Error(`${donde}: '${campo.clave}' vale ${JSON.stringify(v)}, se esperaba true o false`)
      }
      if (campo.tipo === 'opcion' && !campo.opciones?.includes(v as string)) {
        throw new Error(`${donde}: '${campo.clave}' vale '${v}', que no está entre ${campo.opciones?.join(', ')}`)
      }
    }
    if (p.origen !== 'osm' && p.origen !== 'comunidad') {
      throw new Error(`${donde}: origen '${p.origen}', se esperaba 'osm' o 'comunidad'`)
    }
    // Sin este par, un origen 'osm' sin osmId pasaba el portero y FichaRasgo
    // terminaba enlazando a openstreetmap.org/undefined -- la única puerta de
    // este validador que un PR ajeno puede de verdad activar. Se comprueba la
    // forma y no solo que haya algo: un osmId truthy pero con cualquier
    // contenido ('123', un número, un array) daba un enlace roto igual.
    if (p.origen === 'osm' && (typeof p.osmId !== 'string' || !OSM_ID.test(p.osmId))) {
      throw new Error(`${donde}: osmId ${JSON.stringify(p.osmId)}, se esperaba node|way|relation/<número>`)
    }
    if (p.origen === 'comunidad' && p.osmId !== undefined) {
      throw new Error(`${donde}: origen 'comunidad' no debería traer osmId ('${p.osmId}')`)
    }
    if (!Number.isInteger(p.version) || (p.version as number) < 1) {
      throw new Error(`${donde}: version '${p.version}', se esperaba un entero ≥ 1`)
    }
    rasgos.push(f)
  }
  return rasgos
}

/**
 * Los rasgos de una capa. En la tanda del editor esto lee de Supabase y cae al
 * archivo si no responde; la firma no cambia, y por eso el visor tampoco.
 */
export async function cargarCapa (capa: Capa): Promise<Rasgo[]> {
  const url = urlVersionado(capa.archivo)
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return validarCapa(capa, await r.json())
}
