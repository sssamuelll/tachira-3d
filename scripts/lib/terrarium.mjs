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

/**
 * Limpia agujas y pozos aislados de una sola celda; modifica dem.data en sitio.
 * La deteccion y la mediana usan siempre un snapshot del DEM original.
 * Un grupo de dos o mas posts anomalos contiguos puede no dispararse: cada
 * post puede incluir a su vecino anomalo en el maximo/minimo de sus 8 vecinos.
 * Un terraplen o corte de varias celdas es asunto de tallar(), no de este filtro.
 */
export function limpiarAnomalias (dem, umbral = 80) {
  const { data, width, height } = dem
  const original = data.slice()
  const vecinos = new Array(8)
  let posts = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      vecinos[0] = original[i - width - 1]
      vecinos[1] = original[i - width]
      vecinos[2] = original[i - width + 1]
      vecinos[3] = original[i - 1]
      vecinos[4] = original[i + 1]
      vecinos[5] = original[i + width - 1]
      vecinos[6] = original[i + width]
      vecinos[7] = original[i + width + 1]
      const valor = original[i]
      if (valor > Math.max(...vecinos) + umbral || valor < Math.min(...vecinos) - umbral) {
        vecinos.sort((a, b) => a - b)
        data[i] = (vecinos[3] + vecinos[4]) / 2
        posts++
      }
    }
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
