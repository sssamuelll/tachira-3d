import type { RoadsMeta, TerrainMeta, Municipio } from './types'
import { ORIGIN } from './constants'
import { prepararJuntas } from '../scene/juntas'
import { urlGenerado } from './rutas'

async function getOk (path: string) {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  return res
}

const bin = async (path: string) => (await getOk(path)).arrayBuffer()
const json = async <T>(path: string): Promise<T> => (await getOk(path)).json()

// Guardas baratas contra un fetch a medias o una regeneración con formato
// distinto: json<T>() tipa sin validar, así que TypeScript no puede atrapar
// esto solo. roads-index.bin es CSR (count+1 entradas) y roads-segid.bin
// lleva un id por segmento (positions.length/6, 6 floats por segmento).
export function checkCoherence (
  roads: RoadsMeta, positions: Float32Array, segIds: Float32Array, index: Uint32Array, nrm: Int8Array,
) {
  if (index.length !== roads.count + 1) {
    throw new Error(`roads-index.bin incoherente: ${index.length} entradas, esperado roads.count + 1 = ${roads.count + 1}`)
  }
  if (segIds.length !== positions.length / 6) {
    throw new Error(`roads-segid.bin incoherente: ${segIds.length} segmentos, esperado positions.length / 6 = ${positions.length / 6}`)
  }
  // La última entrada del CSR es el total de segmentos, y se lee como tal para
  // dimensionar buffers por segmento sin volver a mirar positions
  // (cortePorSegmento, roadStyle.ts). Si termina corta, esos buffers salen más
  // chicos que la geometría que los consume.
  if (index[roads.count] !== segIds.length) {
    throw new Error(`roads-index.bin incoherente: el CSR termina en ${index[roads.count]}, esperado ${segIds.length} segmentos`)
  }
  // La normal del terreno en cada extremo del tramo (roadsShader.ts extruye
  // la calzada sobre ella): tres bytes por extremo, dos extremos.
  if (nrm.length !== segIds.length * 6) {
    throw new Error(`roads-nrm.bin incoherente: ${nrm.length} bytes, esperado 6 por segmento = ${segIds.length * 6}`)
  }
}

// Guarda barata: constants.ts (ORIGIN, usado por Sky.tsx para el rebase de
// la atmósfera) y terrain.json (meta.origin, usado por Terrain.tsx, escrito
// por build-data.mjs desde su propia constante) son hoy el mismo punto por
// coincidencia de mantenimiento, no por una única fuente compartida. Si se
// regenera la data con otro origen sin tocar constants.ts, cielo y terreno
// quedan rebaseados a puntos distintos sin que nada lo marque.
export function checkOrigin (terrainOrigin: TerrainMeta['origin'], expected: typeof ORIGIN) {
  const EPS = 1e-9
  if (Math.abs(terrainOrigin.lat - expected.lat) > EPS ||
      Math.abs(terrainOrigin.lon - expected.lon) > EPS ||
      Math.abs(terrainOrigin.h - expected.h) > EPS) {
    throw new Error(`terrain.json origin ${JSON.stringify(terrainOrigin)} no coincide con ORIGIN ${JSON.stringify(expected)}`)
  }
}

export async function loadAll () {
  const [terrain, roads, municipios, tBuf, pBuf, sBuf, iBuf, nBuf, lBuf] = await Promise.all([
    json<TerrainMeta>(urlGenerado('terrain.json')),
    json<RoadsMeta>(urlGenerado('roads-meta.json')),
    json<Municipio[]>(urlGenerado('municipios.json')),
    bin(urlGenerado('terrain.bin')),
    bin(urlGenerado('roads-pos.bin')),
    bin(urlGenerado('roads-segid.bin')),
    bin(urlGenerado('roads-index.bin')),
    bin(urlGenerado('roads-nrm.bin')),
    bin(urlGenerado('limites-pos.bin')),
  ])
  const positions = new Float32Array(pBuf)
  const segIds = new Float32Array(sBuf)
  const index = new Uint32Array(iBuf)
  const normals = new Int8Array(nBuf)
  checkCoherence(roads, positions, segIds, index, normals)
  checkOrigin(terrain.origin, ORIGIN)
  // Las posiciones llegan apoyadas desde el pipeline sobre la triangulación
  // del DEM completo (scripts/lib/drape.mjs), que es exactamente la
  // superficie que el nivel fino del relieve dibuja (nodoTerreno.ts). Ya no
  // hay que redrapearlas acá contra otra malla: la malla de 1024² que sigue
  // llegando en terrain.bin es solo la del minimapa.
  return {
    terrain,
    terrainGrid: new Int16Array(tBuf),
    roads,
    positions,
    segIds,
    index,
    normals,
    juntas: prepararJuntas(positions, index, roads.ways),
    municipios,
    limites: new Float32Array(lBuf),
  }
}
