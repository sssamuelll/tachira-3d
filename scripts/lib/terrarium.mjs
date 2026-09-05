import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { PNG } from 'pngjs'

const BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const CACHE = '.cache/dem'
const TILE = 256

export const decodeTerrarium = (r, g, b) => (r * 256 + g + b / 256) - 32768

export const lonToTileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z)
export const latToTileY = (lat, z) => {
  const r = lat * Math.PI / 180
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z)
}
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
  return { data, width, height, bounds }
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
