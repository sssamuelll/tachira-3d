import type { Way } from '../data/types'

export interface Juntas {
  limites: Float32Array
  zonas: Float32Array
  nodos: number
}

export function prepararJuntas (positions: Float32Array, _index: Uint32Array, _ways: Way[]): Juntas {
  return {
    limites: new Float32Array(positions.length / 3).fill(1e9),
    zonas: new Float32Array(positions.length / 6 * 4),
    nodos: 0,
  }
}
