import { stateMask } from '../scene/stateMask'
import type { TerrainMeta, Municipio } from '../data/types'

/**
 * Lo que el minimapa dibuja, sin nada de React ni de canvas: dónde cae cada
 * coordenada dentro del disco, y de qué color es cada píxel del relieve.
 *
 * El relieve se pinta una sola vez por carga -- es el mismo DEM que ya está en
 * memoria para la malla grande, remuestreado a 150 px -- y a partir de ahí el
 * componente solo repinta la mirilla encima.
 */

export interface Bbox { s: number; w: number; n: number; e: number }

/**
 * Qué parte del mapa se está mirando. La produce la cámara viva
 * (scene/Camera.tsx) en cada cuadro y la consume el minimapa.
 */
export interface Mirilla {
  /** El punto que estás mirando. */
  lat: number; lon: number
  /** Desde dónde lo miras. */
  camLat: number; camLon: number
  /** Media apertura horizontal de la cámara, en radianes: lo que abre el cono. */
  semi: number
}

export interface Encaje {
  /** El rectángulo del bbox dentro del disco, en píxeles. */
  x: number; y: number; w: number; h: number
  aPixel: (lat: number, lon: number) => { x: number; y: number }
  aGeo: (x: number, y: number) => { lat: number; lon: number }
}

/**
 * Mete el bbox en un disco de `lado` píxeles sin deformarlo.
 *
 * El bbox del Táchira mide 1,17° de longitud por 1,32° de latitud, y esos dos
 * grados no miden lo mismo sobre el terreno: a 8° de latitud, uno de longitud
 * mide cos(8°) = 99% de uno de latitud. Poca cosa acá, pero es la diferencia
 * entre un mapa y un mapa estirado, y la corrección son dos líneas.
 *
 * Las coordenadas se cuentan por VÉRTICES, no por celdas: el píxel 0 es el
 * borde norte exacto y el h-1 el borde sur. Es la misma convención de
 * stateMask() y del DEM, así que las tres rejillas se superponen sin
 * desplazarse media celda entre ellas.
 */
export function encajar (bbox: Bbox, lado: number, margen: number): Encaje {
  const latSpan = bbox.n - bbox.s
  const lonSpan = bbox.e - bbox.w
  const cos = Math.cos((bbox.n + bbox.s) / 2 * Math.PI / 180)
  const util = lado - margen * 2
  const escala = util / Math.max(lonSpan * cos, latSpan)
  const w = Math.max(2, Math.round(lonSpan * cos * escala))
  const h = Math.max(2, Math.round(latSpan * escala))
  const x = (lado - w) / 2
  const y = (lado - h) / 2
  return {
    x, y, w, h,
    aPixel: (lat, lon) => ({
      x: x + (lon - bbox.w) / lonSpan * (w - 1),
      y: y + (bbox.n - lat) / latSpan * (h - 1),
    }),
    aGeo: (px, py) => ({
      lat: bbox.n - (py - y) / (h - 1) * latSpan,
      lon: bbox.w + (px - x) / (w - 1) * lonSpan,
    }),
  }
}

// Metros por grado. Solo alimentan la pendiente del sombreado, donde medio por
// ciento de error no se ve; la geometría de verdad la hace enu.ts.
const M_POR_GRADO = 111320

// Misma rampa hipsométrica que el relieve grande (terrainShader.ts). Que sean
// la misma es el punto: el minimapa tiene que leerse como una versión pequeña
// de lo que estás mirando, no como otro mapa del mismo sitio.
const RAMPA = [
  [0.18, 0.31, 0.22], [0.36, 0.44, 0.24], [0.60, 0.53, 0.33],
  [0.62, 0.47, 0.40], [0.90, 0.90, 0.92],
] as const

function hypso (t: number, out: [number, number, number]) {
  const p = Math.min(3, Math.floor(t * 4))
  const k = t * 4 - p
  const a = RAMPA[p], b = RAMPA[p + 1]
  out[0] = a[0] + (b[0] - a[0]) * k
  out[1] = a[1] + (b[1] - a[1]) * k
  out[2] = a[2] + (b[2] - a[2]) * k
}

// El shader del relieve grande escribe color LINEAL y deja que WebGL lo pase a
// sRGB al sacarlo a pantalla; un canvas 2D no hace esa conversión por su
// cuenta. Sin esto el minimapa sale bastante más oscuro que el mapa que
// retrata -- verde botella donde el grande es verde oliva -- y deja de
// parecerse a él, que es lo único que tiene que hacer.
const aSRGB = (lin: number) => Math.pow(Math.min(1, Math.max(0, lin)), 1 / 2.2) * 255

// Misma luz que uSun en Terrain.tsx, ya normalizada.
const SOL = (() => {
  const [x, y, z] = [0.4, 0.8, 0.3]
  const n = Math.hypot(x, y, z)
  return [x / n, y / n, z / n] as const
})()

/**
 * El relieve del estado en RGBA, recortado a su contorno: opaco dentro,
 * transparente fuera.
 *
 * La pendiente de cada píxel se mide contra sus vecinos DEL MINIMAPA, no
 * contra las celdas contiguas del DEM. A 150 px sobre una rejilla de 1024 cada
 * píxel se salta seis celdas, y sombrear con el gradiente de la celda deja un
 * ruido de sal y pimienta que no se parece a un relieve: la escala del
 * sombreado tiene que ser la escala a la que se está dibujando.
 */
export function relieve (
  grid: Int16Array, meta: TerrainMeta, municipios: Municipio[], w: number, h: number,
): Uint8ClampedArray {
  const { width: W, height: H, bbox } = meta
  const dentro = stateMask(municipios, bbox, w, h)
  const out = new Uint8ClampedArray(w * h * 4)
  const rango = Math.max(1, meta.max - meta.min)
  const cos = Math.cos((bbox.n + bbox.s) / 2 * Math.PI / 180)
  // Cuánto terreno abarca un píxel del minimapa, que es el paso con el que se
  // mide la pendiente.
  const mEste = (bbox.e - bbox.w) * cos * M_POR_GRADO / (w - 1)
  const mNorte = (bbox.n - bbox.s) * M_POR_GRADO / (h - 1)
  const col: [number, number, number] = [0, 0, 0]

  // Altura del DEM en el píxel (x, y) del minimapa, acotada al borde: las dos
  // rejillas cubren el mismo bbox y comparten la fila 0 = norte.
  const alt = (x: number, y: number) => {
    const gx = Math.min(W - 1, Math.max(0, Math.round(x / (w - 1) * (W - 1))))
    const gy = Math.min(H - 1, Math.max(0, Math.round(y / (h - 1) * (H - 1))))
    return grid[gy * W + gx]
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!dentro[i]) continue                       // fuera del estado: alpha 0
      const z = alt(x, y)
      // Fila 0 es el norte, así que y-1 está más al norte que y+1.
      const dEste = (alt(x + 1, y) - alt(x - 1, y)) / (2 * mEste)
      const dNorte = (alt(x, y - 1) - alt(x, y + 1)) / (2 * mNorte)
      // Normal en ejes de three (x=este, y=arriba, z=-norte), igual que la que
      // computeVertexNormals() le da a la malla grande.
      const n = Math.hypot(dEste, 1, dNorte)
      const luz = (-dEste * SOL[0] + SOL[1] + dNorte * SOL[2]) / n
      const sombra = Math.min(1, Math.max(0.15, luz * 0.6 + 0.5))
      hypso(Math.min(1, Math.max(0, (z - meta.min) / rango)), col)
      const o = i * 4
      out[o] = aSRGB(col[0] * sombra)
      out[o + 1] = aSRGB(col[1] * sombra)
      out[o + 2] = aSRGB(col[2] * sombra)
      out[o + 3] = 255
    }
  }
  return out
}
