import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { PNG } from 'pngjs'

const BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const CACHE = '.cache/dem'
const TILE = 256

export const decodeTerrarium = (r, g, b) => (r * 256 + g + b / 256) - 32768

// Coordenada de tesela fraccionaria: la parte entera es la tesela, la
// fraccionaria dónde cae el punto dentro de ella. Misma matemática que
// src/data/mercator.ts en el navegador.
export const tileXf = (lon, z) => (lon + 180) / 360 * 2 ** z
export const tileYf = (lat, z) => {
  const r = lat * Math.PI / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z
}
export const lonToTileX = (lon, z) => Math.floor(tileXf(lon, z))
export const latToTileY = (lat, z) => Math.floor(tileYf(lat, z))
export const tileXToLon = (x, z) => x / 2 ** z * 360 - 180
export const tileYToLat = (y, z) =>
  Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI

export function tileRangeForBbox (bbox, z) {
  const x0 = lonToTileX(bbox.w, z), x1 = lonToTileX(bbox.e, z)
  const y0 = latToTileY(bbox.n, z), y1 = latToTileY(bbox.s, z)   // y crece hacia el sur
  return { x0, x1, y0, y1, nx: x1 - x0 + 1, ny: y1 - y0 + 1 }
}

async function fetchTile (z, x, y) {
  const path = `${CACHE}/${z}_${x}_${y}.png`
  if (existsSync(path)) {
    try {
      return PNG.sync.read(await readFile(path))
    } catch (err) {
      throw new Error(`cache corrupta en ${path} (tile ${z}/${x}/${y}): ${err.message}`)
    }
  }
  const res = await fetch(`${BASE}/${z}/${x}/${y}.png`)
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} devolvió ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(CACHE, { recursive: true })
  // temporal + rename: si se interrumpe a mitad de escritura (Ctrl+C, corte de
  // red, suspensión) el .png final nunca queda a medias — o está completo o no existe.
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, buf)
  await rename(tmp, path)
  return PNG.sync.read(buf)
}

export async function fetchDem (bbox, z) {
  const r = tileRangeForBbox(bbox, z)
  const width = r.nx * TILE, height = r.ny * TILE
  const data = new Float32Array(width * height)
  let n = 0
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      const png = await fetchTile(z, tx, ty)
      const ox = (tx - r.x0) * TILE, oy = (ty - r.y0) * TILE
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          const i = (py * TILE + px) * 4
          data[(oy + py) * width + ox + px] =
            decodeTerrarium(png.data[i], png.data[i + 1], png.data[i + 2])
        }
      }
      if (++n % 25 === 0) console.log(`  DEM ${n}/${r.nx * r.ny} tiles`)
    }
  }
  // La grilla slippy cubre algo más que el bbox; guardamos sus bordes reales.
  const bounds = {
    w: tileXToLon(r.x0, z), e: tileXToLon(r.x1 + 1, z),
    n: tileYToLat(r.y0, z), s: tileYToLat(r.y1 + 1, z),
  }
  // El rango de teselas es la convención de rejilla del resto del pipeline
  // (drape.mjs, dem-tiles.mjs) y del navegador: el post (c, f) está en la
  // coordenada de tesela (x0 + c/256, y0 + f/256).
  return { data, width, height, bounds, tile: { z, x0: r.x0, y0: r.y0, nx: r.nx, ny: r.ny } }
}

/** Desplazamientos del anillo Chebyshev r=2: los 16 posts del borde del 5x5. */
const ANILLO = (() => {
  const o = []
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) o.push([dx, dy])
    }
  }
  return o
})()

/** Tope de pasadas. Sobre el DEM del Tachira converge en 3; esto solo evita que
 *  un dato patologico deje el horneado girando. */
const PASADAS = 20

/**
 * Limpia agujas y pozos del DEM; modifica dem.data en sitio.
 *
 * Un post se juzga contra la MEDIANA de su anillo Chebyshev r=2 -- los 16 posts
 * del borde del 5x5 -- y si se desvia mas de `umbral` se sustituye por ella.
 *
 * El anillo, y no los 8 vecinos inmediatos: el ruido de Terrarium viene casi
 * siempre en GRUMOS de 2x2 o 3x3, y contra los 8 vecinos cada miembro del grumo
 * tiene a sus complices pegados, asi que su desvio da ~10 m y no se dispara
 * nunca. Medido sobre el DEM real (2026-09-12): de 266 anomalias de mas de
 * 100 m, 205 estaban en grumo. El anillo r=2 queda fuera de cualquier grumo de
 * hasta 3x3, asi que no se deja tapar por sus propios complices.
 *
 * La mediana deja quieto el relieve real: sobre una ladera recta la mediana del
 * anillo es exactamente el valor del centro, asi que no desplaza nada. Sobre el
 * DEM real toca el 0,0102 % de los posts.
 *
 * Se repite hasta que una pasada no corrija nada: un grumo grande se erosiona de
 * afuera hacia adentro y su centro solo queda a la vista cuando ya se limpio lo
 * que lo rodeaba. Una sola pasada dejaba 199 posts todavia anomalos (el peor,
 * 217 m); iterando quedan 0. Cada pasada detecta sobre un snapshot, asi que el
 * orden del recorrido no cambia el resultado.
 *
 * Los dos posts del borde del DEM se quedan como estan: no tienen anillo. Caen
 * fuera del contorno del estado, que es lo que se dibuja.
 *
 * Un terraplen o corte de varias celdas es asunto de tallar(), no de este filtro.
 */
export function limpiarAnomalias (dem, umbral = 80) {
  const { data, width, height } = dem
  const anillo = new Array(16)
  let posts = 0
  for (let pasada = 0; pasada < PASADAS; pasada++) {
    const original = data.slice()
    let corregidos = 0
    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const i = y * width + x
        for (let k = 0; k < 16; k++) {
          anillo[k] = original[i + ANILLO[k][1] * width + ANILLO[k][0]]
        }
        anillo.sort((a, b) => a - b)
        const mediana = (anillo[7] + anillo[8]) / 2
        if (Math.abs(original[i] - mediana) > umbral) {
          data[i] = mediana
          corregidos++
        }
      }
    }
    posts += corregidos
    if (corregidos === 0) break
  }
  return { posts }
}

export function sampleBilinear (dem, lon, lat) {
  const { data, width, height, bounds } = dem
  const fx = (lon - bounds.w) / (bounds.e - bounds.w) * (width - 1)
  const fy = (bounds.n - lat) / (bounds.n - bounds.s) * (height - 1)   // fila 0 = norte
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)))
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
  const tx = fx - x0, ty = fy - y0
  const a = data[y0 * width + x0], b = data[y0 * width + x1]
  const c = data[y1 * width + x0], d = data[y1 * width + x1]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

export function downsample (dem, outW, outH) {
  const { data, width, height } = dem
  const out = new Int16Array(outW * outH)
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(height - 1, Math.round(y / (outH - 1) * (height - 1)))
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(width - 1, Math.round(x / (outW - 1) * (width - 1)))
      // Terrarium marca el océano muy por debajo; recortamos para que quepa en Int16
      out[y * outW + x] = Math.max(-500, Math.min(9000, Math.round(data[sy * width + sx])))
    }
  }
  return out
}
