import type { TerrainMeta } from './types'

/**
 * La cota del DEM grueso -- la rejilla de 1024² de terrain.bin, que ya está en
 * memoria para el minimapa -- en un punto cualquiera.
 *
 * Al vértice más cercano, sin interpolar: es la regla que traía el muestreo de
 * disco.ts, y a 1024 sobre el estado cada vértice cubre ~140 m. Sirve para
 * apoyar un marcador de capa el primer cuadro, mientras el relieve fino carga;
 * la cota buena la da después alturaTerreno() por raycast contra la malla.
 *
 * Acota en vez de devolver null fuera del bbox: un rasgo justo en el borde es
 * un caso normal, y un marcador en el borde es mejor que un marcador ausente.
 */
export function alturaGruesa (grid: Int16Array, meta: TerrainMeta, lat: number, lon: number): number {
  const { width: W, height: H, bbox } = meta
  const gx = Math.min(W - 1, Math.max(0, Math.round((lon - bbox.w) / (bbox.e - bbox.w) * (W - 1))))
  const gy = Math.min(H - 1, Math.max(0, Math.round((bbox.n - lat) / (bbox.n - bbox.s) * (H - 1))))
  return grid[gy * W + gx]
}
