import type { RoadsMeta, TerrainMeta, Municipio } from './types'

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
export function checkCoherence (roads: RoadsMeta, positions: Float32Array, segIds: Float32Array, index: Uint32Array) {
  if (index.length !== roads.count + 1) {
    throw new Error(`roads-index.bin incoherente: ${index.length} entradas, esperado roads.count + 1 = ${roads.count + 1}`)
  }
  if (segIds.length !== positions.length / 6) {
    throw new Error(`roads-segid.bin incoherente: ${segIds.length} segmentos, esperado positions.length / 6 = ${positions.length / 6}`)
  }
}

export async function loadAll () {
  const [terrain, roads, municipios, tBuf, pBuf, sBuf, iBuf] = await Promise.all([
    json<TerrainMeta>('/data/terrain.json'),
    json<RoadsMeta>('/data/roads-meta.json'),
    json<Municipio[]>('/data/municipios.json'),
    bin('/data/terrain.bin'),
    bin('/data/roads-pos.bin'),
    bin('/data/roads-segid.bin'),
    bin('/data/roads-index.bin'),
  ])
  const positions = new Float32Array(pBuf)
  const segIds = new Float32Array(sBuf)
  const index = new Uint32Array(iBuf)
  checkCoherence(roads, positions, segIds, index)
  return {
    terrain,
    terrainGrid: new Int16Array(tBuf),
    roads,
    positions,
    segIds,
    index,
    municipios,
  }
}
