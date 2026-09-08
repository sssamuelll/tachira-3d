import type { Box3, Vector3 } from 'three'

export const MPP_EDIFICIOS_ENTRA = 3
export const MPP_EDIFICIOS_SALE = 6
export const HALO_EDIFICIOS = 5000
export const CHUNKS_EDIFICIOS_ACTIVOS = 96
export const CHUNKS_EDIFICIOS_CACHE = 128
export const BYTES_EDIFICIOS_CACHE = 96 * 1024 * 1024

/** Corte opaco con histéresis. Un mpp inestable cerca del umbral no hace
 * titilar edificios y sombras ni introduce transparencia en el pase de AO. */
export function edificiosActivos (mpp: number, anterior: boolean): boolean {
  if (!Number.isFinite(mpp) || mpp >= MPP_EDIFICIOS_SALE) return false
  if (mpp <= MPP_EDIFICIOS_ENTRA) return true
  return anterior
}

export function distanciaHorizontal (caja: Box3, posicion: Vector3): number {
  const dx = Math.max(caja.min.x - posicion.x, 0, posicion.x - caja.max.x)
  const dz = Math.max(caja.min.z - posicion.z, 0, posicion.z - caja.max.z)
  return Math.hypot(dx, dz)
}

/** Incluye emisores a los lados y detrás de cámara. El frustum de THREE
 * recorta cada mesh para la vista y para CADA cascada, por separado. Apagar
 * aquí por el frustum principal borraría las sombras que entran desde fuera. */
export function candidatosEdificios<T extends { key: string; caja: Box3 }> (
  chunks: readonly T[], posicion: Vector3, max = CHUNKS_EDIFICIOS_ACTIVOS,
): T[] {
  return chunks.map(chunk => ({ chunk, distance: distanciaHorizontal(chunk.caja, posicion) }))
    .filter(item => item.distance <= HALO_EDIFICIOS)
    .sort((a, b) => a.distance - b.distance || a.chunk.key.localeCompare(b.chunk.key))
    .slice(0, max).map(item => item.chunk)
}

export function sueloEdificiosListo (demNodes: readonly string[], ready: Set<string> | undefined): boolean {
  return ready !== undefined && demNodes.length > 0 && demNodes.every(key => ready.has(key))
}
