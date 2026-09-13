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
 */

export interface CapaFija {
  id: 'edificios' | 'municipios'
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

/** Recorre las coordenadas de cualquier geometría GeoJSON anidada. */
function * puntos (coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return
  if (typeof coords[0] === 'number') { yield coords as [number, number]; return }
  for (const c of coords) yield * puntos(c)
}

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
    for (const [lon, lat] of puntos(f.geometry?.coordinates)) {
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
      if (campo.tipo === 'opcion' && !campo.opciones?.includes(v as string)) {
        throw new Error(`${donde}: '${campo.clave}' vale '${v}', que no está entre ${campo.opciones?.join(', ')}`)
      }
    }
    if (p.origen !== 'osm' && p.origen !== 'comunidad') {
      throw new Error(`${donde}: origen '${p.origen}', se esperaba 'osm' o 'comunidad'`)
    }
    // Sin este par, un origen 'osm' sin osmId pasaba el portero y FichaRasgo
    // terminaba enlazando a openstreetmap.org/undefined -- la única puerta de
    // este validador que un PR ajeno puede de verdad activar.
    if (p.origen === 'osm' && !p.osmId) {
      throw new Error(`${donde}: origen 'osm' sin osmId`)
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
