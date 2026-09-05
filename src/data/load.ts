import type { RoadsMeta, TerrainMeta, Municipio } from './types'

const bin = async (path: string) => (await fetch(path)).arrayBuffer()
const json = async <T>(path: string): Promise<T> => (await fetch(path)).json()

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
  return {
    terrain,
    terrainGrid: new Int16Array(tBuf),
    roads,
    positions: new Float32Array(pBuf),
    segIds: new Float32Array(sBuf),
    index: new Uint32Array(iBuf),
    municipios,
  }
}
