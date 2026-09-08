import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { decodeTerrarium } from './terrarium.mjs'
import { alturaTriangulo, postDe } from './drape.mjs'
import { orientar } from './road-meta.mjs'
import { subdividir } from './subdividir.mjs'
import {
  tallar, tallaTerreno, nivelDe, metrosPorPost, anchoCalzadaTags,
  HOMBRILLO_M, TRANSICION_M, MIN_POSTS_CORREDOR, MIN_POSTS_BANDA,
} from './carving.mjs'

const numericIndex = key => typeof key === 'string' && key !== '' && Number.isInteger(+key) && +key >= 0

/** DEM Terrarium original de solo lectura, sin descargar ni asignar la
 * rejilla completa. Cada tesela decodificada vive en una LRU acotada. */
export function createCachedRawDem ({ tile, cacheDir = '.cache/dem', maxRawTiles = 8 }) {
  if (!Number.isInteger(maxRawTiles) || maxRawTiles < 1) throw new Error('maxRawTiles debe ser positivo')
  const width = tile.nx * 256, height = tile.ny * 256
  const tiles = new Map()
  const stats = { tilesRead: 0, residentTiles: 0, peakResidentTiles: 0 }
  const readPost = j => {
    if (j >= width * height) return undefined
    const row = Math.floor(j / width), col = j % width
    const tx = tile.x0 + Math.floor(col / 256), ty = tile.y0 + Math.floor(row / 256)
    const key = `${tx}_${ty}`
    let png = tiles.get(key)
    if (png) tiles.delete(key)
    else {
      const path = `${cacheDir}/${tile.z}_${key}.png`
      png = PNG.sync.read(readFileSync(path))
      if (png.width !== 256 || png.height !== 256) throw new Error(`Tesela DEM inválida: ${path}`)
      stats.tilesRead++
      if (tiles.size >= maxRawTiles) tiles.delete(tiles.keys().next().value)
    }
    tiles.set(key, png)
    stats.residentTiles = tiles.size
    stats.peakResidentTiles = Math.max(stats.peakResidentTiles, tiles.size)
    const p = ((row % 256) * 256 + col % 256) * 4
    // fetchDem escribe cada valor en Float32 antes de cualquier operación.
    return Math.fround(decodeTerrarium(png.data[p], png.data[p + 1], png.data[p + 2]))
  }
  const data = new Proxy({}, {
    get: (_, key) => key === 'length' ? width * height : numericIndex(key) ? readPost(+key) : undefined,
    set: () => { throw new Error('El DEM original es de solo lectura') },
  })
  return { tile, width, height, data, stats }
}

/** Reconstruye únicamente bloques consultados del tallado BASELINE.
 *
 * `lines` son las vías originales, antes de orientar/subdividir. Se indexan
 * sus segmentos sin densificar la red. Cada bloque selecciona todas las
 * vías que podrían contribuir, en su orden original. Sus perfiles se
 * calculan sobre la vía COMPLETA y el DEM original, igual que build-data;
 * recortar la vía al bloque cambiaría la media y el acotador de pendiente.
 *
 * tallar(..., { posts }) conserva sus acumuladores Float32, su orden y su
 * mezcla; solo omite posts que no se consultan. Por eso el resultado no es
 * una aproximación tomada de terrain.bin ni de la pirámide Int16.
 *
 * Cachés de bloques y PNG acotadas. Las escrituras a dem.data se guardan en
 * un overlay independiente para una intervención pequeña; no se hornea ni
 * se serializa ningún archivo. No se debe rasterizar sobre toda la rejilla.
 */
export function createSparseCarvedDem ({ rawDem, lines, blockSize = 32, maxBlocks = 128, carveOptions = {} }) {
  if (!Number.isInteger(blockSize) || blockSize < 1) throw new Error('blockSize debe ser positivo')
  if (!Number.isInteger(maxBlocks) || maxBlocks < 1) throw new Error('maxBlocks debe ser positivo')
  const { width: W, height: H, tile } = rawDem
  const blocksWide = Math.ceil(W / blockSize)
  const byBlock = new Map()
  // Capturar los arrays originales: el consumidor puede reemplazar después
  // line.coords al subdividir únicamente sus corredores con puente.
  const originals = lines.filter(l => l.coords?.length >= 2 && tallaTerreno(l.tags) && nivelDe(l.tags.highway) > 0)
    .map(l => ({ ...l, coords: l.coords }))
  const hombrillo = carveOptions.hombrillo ?? HOMBRILLO_M
  const transicion = carveOptions.transicion ?? TRANSICION_M
  const minCorredor = carveOptions.minPostsCorredor ?? MIN_POSTS_CORREDOR
  const minBanda = carveOptions.minPostsBanda ?? MIN_POSTS_BANDA
  for (let i = 0; i < originals.length; i++) {
    const l = originals[i], n = nivelDe(l.tags.highway)
    let minMpp = Infinity
    const uv = l.coords.map(([lon, lat]) => {
      minMpp = Math.min(minMpp, metrosPorPost(lat, tile.z))
      return postDe(rawDem, lon, lat)
    })
    // El mpp real usa la latitud de la muestra central subdividida. El
    // mínimo de los extremos es una cota conservadora para todo el trazado.
    const radius = Math.max((anchoCalzadaTags(l.tags) / 2 + hombrillo) / minMpp, minCorredor) +
      Math.max(transicion[n] / minMpp, minBanda)
    const seen = new Set()
    for (let j = 1; j < uv.length; j++) {
      const a = uv[j - 1], b = uv[j]
      const x0 = Math.floor(Math.max(0, Math.floor(Math.min(a[0], b[0]) - radius)) / blockSize)
      const x1 = Math.floor(Math.min(W - 1, Math.ceil(Math.max(a[0], b[0]) + radius)) / blockSize)
      const y0 = Math.floor(Math.max(0, Math.floor(Math.min(a[1], b[1]) - radius)) / blockSize)
      const y1 = Math.floor(Math.min(H - 1, Math.ceil(Math.max(a[1], b[1]) + radius)) / blockSize)
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) seen.add(y * blocksWide + x)
    }
    for (const block of seen) {
      if (!byBlock.has(block)) byBlock.set(block, [])
      byBlock.get(block).push(i)
    }
  }

  const blocks = new Map(), overlay = new Map()
  const stats = { indexedWays: originals.length, indexedBlocks: byBlock.size, blocksCarved: 0,
    residentBlocks: 0, peakResidentBlocks: 0, peakCandidateWays: 0, peakCandidateVertices: 0,
    carvedPosts: 0, writtenPosts: 0, raw: rawDem.stats ?? null }
  const loadBlock = key => {
    let block = blocks.get(key)
    if (block) { blocks.delete(key); blocks.set(key, block); return block }
    const x0 = key % blocksWide * blockSize, y0 = Math.floor(key / blocksWide) * blockSize
    const width = Math.min(blockSize, W - x0), height = Math.min(blockSize, H - y0)
    const posts = new Set(), values = new Float32Array(width * height)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) posts.add((y0 + y) * W + x0 + x)
    const changed = new Map()
    const data = new Proxy({}, {
      get: (_, j) => numericIndex(j) ? changed.get(+j) ?? rawDem.data[j] : undefined,
      set: (_, j, value) => { changed.set(+j, Math.fround(value)); return true },
    })
    const selected = (byBlock.get(key) ?? []).map(i => {
      const l = originals[i]
      return { ...l, coords: subdividir(orientar(l.coords, l.tags.oneway)) }
    })
    stats.peakCandidateWays = Math.max(stats.peakCandidateWays, selected.length)
    stats.peakCandidateVertices = Math.max(stats.peakCandidateVertices, selected.reduce((n, l) => n + l.coords.length, 0))
    const result = tallar({ ...rawDem, data }, selected, { ...carveOptions, posts })
    stats.carvedPosts += result.posts
    let i = 0
    for (const j of posts) values[i++] = changed.get(j) ?? rawDem.data[j]
    block = { x0, y0, width, values }
    if (blocks.size >= maxBlocks) blocks.delete(blocks.keys().next().value)
    blocks.set(key, block)
    stats.blocksCarved++
    stats.residentBlocks = blocks.size
    stats.peakResidentBlocks = Math.max(stats.peakResidentBlocks, blocks.size)
    return block
  }
  const readPost = j => {
    if (j >= W * H) return undefined
    if (overlay.has(j)) return overlay.get(j)
    const row = Math.floor(j / W), col = j % W
    const block = loadBlock(Math.floor(row / blockSize) * blocksWide + Math.floor(col / blockSize))
    return block.values[(row - block.y0) * block.width + col - block.x0]
  }
  const dem = { width: W, height: H, tile, data: new Proxy({}, {
    get: (_, key) => key === 'length' ? W * H : numericIndex(key) ? readPost(+key) : undefined,
    set: (_, key, value) => {
      if (!numericIndex(key) || +key >= W * H) throw new Error('Post DEM inválido')
      overlay.set(+key, Math.fround(value)); stats.writtenPosts = overlay.size
      return true
    },
  }) }
  return { dem, rawDem, alturaDe: (lon, lat) => alturaTriangulo(dem, lon, lat), stats,
    clear: () => { blocks.clear(); overlay.clear(); stats.residentBlocks = 0; stats.writtenPosts = 0 } }
}

export function crearDemTalladoDisperso ({ tile, cacheDir, maxRawTiles, ...options }) {
  return createSparseCarvedDem({ ...options, rawDem: createCachedRawDem({ tile, cacheDir, maxRawTiles }) })
}
