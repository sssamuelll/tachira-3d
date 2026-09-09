import { PNG } from 'pngjs'
import { writeFile, mkdir } from 'node:fs/promises'
import { alturaEnPosts } from './drape.mjs'

/**
 * Pirámide de teselas del DEM para el relieve por LOD del navegador
 * (src/scene/TerrainLod.tsx): public/data/dem/{z}/{x}/{y}.png de z8 a z12,
 * y errores.json con el error geométrico de cada nodo de z8 a z14.
 *
 * Cada tesela mide 257×257: los 256 posts propios más el borde de la vecina,
 * para que dos nodos contiguos compartan exactamente sus vértices de borde.
 * RGB es la altura Terrarium; A dice si el post está dentro del estado.
 */

export const LADO = 257

export function encodeTerrarium (h) {
  const v = Math.max(0, Math.min(65535.996, h + 32768))
  const r = Math.floor(v / 256), g = Math.floor(v % 256)
  const b = Math.min(255, Math.round((v - Math.floor(v)) * 256))
  return [r, g, b]
}

// Post (c0, f0) de la rejilla global G donde empieza la tesela (z, x, y), y
// cuántos posts de G hay entre dos píxeles suyos.
function origen (dem, z, x, y) {
  const s = 2 ** (12 - z)
  return { s, c0: (x * s - dem.tile.x0) * 256, f0: (y * s - dem.tile.y0) * 256 }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Altura del píxel (i, j) de la tesela (z, x, y): el post de G que le toca.
 *  Los niveles gruesos DECIMAN (toman el post, no promedian): un promedio
 *  desplaza un plano inclinado y daría error donde no lo hay, y el error que
 *  sí hay lo mide errorNodo con honestidad. Fuera de G se extiende el borde. */
export function alturaVertice (dem, z, x, y, i, j) {
  const { s, c0, f0 } = origen(dem, z, x, y)
  const c = clamp(c0 + i * s, 0, dem.width - 1), f = clamp(f0 + j * s, 0, dem.height - 1)
  return dem.data[f * dem.width + c]
}

/** Dentro del estado si algún post del bloque s×s que representa el píxel lo
 *  está: el contorno sale generoso en los niveles gruesos, nunca recortado. */
export function dentroVertice (dem, dentro, z, x, y, i, j) {
  const { s, c0, f0 } = origen(dem, z, x, y)
  for (let f = f0 + j * s; f < f0 + j * s + s; f++) {
    if (f < 0 || f >= dem.height) continue
    for (let c = c0 + i * s; c < c0 + i * s + s; c++) {
      if (c >= 0 && c < dem.width && dentro[f * dem.width + c]) return true
    }
  }
  return false
}

export function teselaRgba (dem, dentro, z, x, y) {
  const out = new Uint8Array(LADO * LADO * 4)
  for (let j = 0; j < LADO; j++) {
    for (let i = 0; i < LADO; i++) {
      const [r, g, b] = encodeTerrarium(alturaVertice(dem, z, x, y, i, j))
      const o = (j * LADO + i) * 4
      out[o] = r; out[o + 1] = g; out[o + 2] = b
      // 254 y no 0 fuera: el canvas del navegador premultiplica por alpha y
      // con 0 destruye el RGB; con 254 el error es de un metro, y solo en
      // posts que dan forma al borde que se descarta.
      out[o + 3] = dentroVertice(dem, dentro, z, x, y, i, j) ? 255 : 254
    }
  }
  return out
}

/**
 * Error geométrico del nodo (z, x, y): máximo, sobre sus posts dentro del
 * estado, de |superficie que dibuja el navegador − post|.
 *
 * El navegador arma el nodo con 33×33 vértices: píxeles 8i de la tesela de
 * su nivel si z ≤ 12, o posts a paso 2^(15−z) dentro de la tesela z12
 * ancestro si z > 12 (ventana() en nodoTerreno.ts). Acá se reproduce esa
 * misma rejilla y se interpola con la misma diagonal (alturaEnPosts), así que
 * el error mide exactamente lo que se dibuja. null si ningún post del nodo
 * está dentro: el nodo no existe para el quadtree.
 */
export function errorNodo (dem, dentro, z, x, y) {
  const k = Math.max(0, z - 12)
  const zt = Math.min(z, 12), xt = x >> k, yt = y >> k
  const paso = 8 >> k
  const offI = ((x & ((1 << k) - 1)) * 256) >> k, offJ = ((y & ((1 << k) - 1)) * 256) >> k
  const rej = { width: 33, height: 33, data: new Float32Array(33 * 33) }
  for (let j = 0; j <= 32; j++) {
    for (let i = 0; i <= 32; i++) rej.data[j * 33 + i] = alturaVertice(dem, zt, xt, yt, offI + i * paso, offJ + j * paso)
  }
  const { s, c0, f0 } = origen(dem, zt, xt, yt)
  const cIni = c0 + offI * s, fIni = f0 + offJ * s, ancho = 32 * paso * s
  let peor = 0, alguno = false
  for (let f = Math.max(0, fIni); f <= Math.min(dem.height - 1, fIni + ancho); f++) {
    for (let c = Math.max(0, cIni); c <= Math.min(dem.width - 1, cIni + ancho); c++) {
      if (!dentro[f * dem.width + c]) continue
      alguno = true
      const h = alturaEnPosts(rej, (c - cIni) / (paso * s), (f - fIni) / (paso * s))
      const d = Math.abs(h - dem.data[f * dem.width + c])
      if (d > peor) peor = d
    }
  }
  return alguno ? peor : null
}

/** Rango de teselas del nivel z que cubre el rango z12 del DEM. */
export function rangoNivel (tile, z) {
  const k = z - 12
  const lo = v => (k >= 0 ? v << k : v >> -k)
  const hi = v => (k >= 0 ? ((v + 1) << k) - 1 : v >> -k)
  return { xa: lo(tile.x0), xb: hi(tile.x0 + tile.nx - 1), ya: lo(tile.y0), yb: hi(tile.y0 + tile.ny - 1) }
}

/** Escribe la pirámide y errores.json. Devuelve cuántas teselas y nodos salieron. */
export async function escribirPiramide (dem, dentro, dir) {
  let teselas = 0
  const errores = {}
  for (let z = 8; z <= 14; z++) {
    const { xa, xb, ya, yb } = rangoNivel(dem.tile, z)
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const e = errorNodo(dem, dentro, z, x, y)
        if (e == null) continue
        errores[`${z}/${x}/${y}`] = +e.toFixed(2)
        if (z <= 12) {
          const png = new PNG({ width: LADO, height: LADO })
          png.data.set(teselaRgba(dem, dentro, z, x, y))
          await mkdir(`${dir}/${z}/${x}`, { recursive: true })
          await writeFile(`${dir}/${z}/${x}/${y}.png`, PNG.sync.write(png))
          teselas++
        }
      }
    }
  }
  await writeFile(`${dir}/errores.json`, JSON.stringify(errores))
  return { teselas, nodos: Object.keys(errores).length }
}
