import type { Box3, Vector3 } from 'three'

/** Tolerancia del LOD en píxeles. Un nodo se subdivide mientras su error
 *  geométrico proyectado pase de esto, y las vías se levantan exactamente
 *  esto (roadsShader.ts): a cualquier distancia, el relieve dibujado se
 *  aparta de la superficie real menos de lo que la calzada está levantada,
 *  así que nunca la tapa. Es la única definición de la cifra. */
export const ERROR_PX = 2

export interface Nodo { z: number; x: number; y: number }
export const clave = (n: Nodo): string => `${n.z}/${n.x}/${n.y}`
export const hijos = (n: Nodo): Nodo[] => [
  { z: n.z + 1, x: n.x * 2, y: n.y * 2 }, { z: n.z + 1, x: n.x * 2 + 1, y: n.y * 2 },
  { z: n.z + 1, x: n.x * 2, y: n.y * 2 + 1 }, { z: n.z + 1, x: n.x * 2 + 1, y: n.y * 2 + 1 },
]

export interface Vista {
  intersecta (caja: Box3): boolean
  posicion: Vector3
  /** Metros por píxel a `d` metros de la cámara (metrosPorPixel, roadStyle.ts). */
  mpp (d: number): number
}

export interface Datos {
  /** Error geométrico en metros (errores.json); null = nodo vacío, ningún
   *  post dentro del estado: no existe para el árbol. */
  error (n: Nodo): number | null
  listo (n: Nodo): boolean
  pedir (n: Nodo): void
  /** Solo se llama con el nodo listo. */
  caja (n: Nodo): Box3
}

/**
 * Los nodos a dibujar este cuadro. Puro: decide, no carga ni dibuja.
 *
 * Un nodo se refina si su error proyectado pasa de ERROR_PX y sus hijos con
 * datos están todos listos; si a alguno le falta la tesela, se pide y se
 * dibuja el padre mientras tanto, para que el relieve nunca tenga huecos.
 * Fuera del frustum ni se dibuja ni se pide nada.
 */
export function seleccionar (raices: Nodo[], vista: Vista, datos: Datos, zMax: number): Nodo[] {
  const salida: Nodo[] = []
  const visitar = (n: Nodo) => {
    const error = datos.error(n)
    if (error == null) return
    if (!datos.listo(n)) { datos.pedir(n); return }
    const caja = datos.caja(n)
    if (!vista.intersecta(caja)) return
    if (n.z < zMax) {
      const d = Math.max(1, caja.distanceToPoint(vista.posicion))
      if (error / vista.mpp(d) > ERROR_PX) {
        const h = hijos(n).filter(c => datos.error(c) != null)
        if (h.length > 0 && h.every(c => datos.listo(c))) { for (const c of h) visitar(c); return }
        for (const c of h) if (!datos.listo(c)) datos.pedir(c)
      }
    }
    salida.push(n)
  }
  for (const r of raices) visitar(r)
  return salida
}
