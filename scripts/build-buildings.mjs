import { readFile, readdir, mkdir, copyFile, writeFile, rename } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { ingerirEdificios } from './lib/building-input.mjs'
import { crearMuestreadorTechos } from './lib/building-roof.mjs'
import { makeEnuFrame } from './lib/enu.mjs'
import { decodeTerrarium, tileXf, tileYf } from './lib/terrarium.mjs'
import { alturaTriangulo } from './lib/drape.mjs'

const DEFAULT_INPUT = 'C:/Users/simon/AppData/Local/Temp/claude/D--Desktop-projects-vialidad-tachira/d8f6c1dd-dceb-4bcf-a185-9aa374c14000/scratchpad/osm-edificios'
const DEFAULT_SAT = 'D:/Desktop/projects/isometric_sc/data/sat-cache'

/** Read the final carved z12 PNGs, never original Terrarium or minimap terrain.bin. */
export function crearMuestreadorDem (dir = 'public/data/dem', max = 64) {
  const cache = new Map()
  return (lat, lon) => {
    const x = Math.floor(tileXf(lon, 12)), y = Math.floor(tileYf(lat, 12)), key = `${x}/${y}`
    let dem = cache.get(key)
    if (!dem) {
      const img = PNG.sync.read(readFileSync(`${dir}/12/${key}.png`))
      if (img.width !== 257 || img.height !== 257) throw new Error(`DEM ${key}: expected 257 x 257 posts`)
      const data = new Float32Array(257 * 257)
      for (let i = 0; i < data.length; i++) data[i] = decodeTerrarium(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2])
      dem = { width: 257, height: 257, data, tile: { z: 12, x0: x, y0: y } }
    }
    cache.delete(key); cache.set(key, dem)
    while (cache.size > max) cache.delete(cache.keys().next().value)
    return alturaTriangulo(dem, lon, lat)
  }
}

/** Conservative coverage includes every z15 DEM node touched by a footprint bbox. */
export function nodosDem (building) {
  const keys = new Set()
  for (const p of building.polygons) {
    const xs = p.outer.map(([lon]) => tileXf(lon, 15)), ys = p.outer.map(([, lat]) => tileYf(lat, 15))
    for (let y = Math.floor(Math.min(...ys)); y <= Math.floor(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.floor(Math.max(...xs)); x++) keys.add(`15/${x}/${y}`)
    }
  }
  return [...keys].sort()
}

function chunkKey (building) {
  const points = building.polygons.flatMap(p => p.outer)
  const lon = points.reduce((s, p) => s + p[0], 0) / points.length, lat = points.reduce((s, p) => s + p[1], 0) / points.length
  return `15/${Math.floor(tileXf(lon, 15))}/${Math.floor(tileYf(lat, 15))}`
}

/** Index offsets are scalar indices, so raycaster faceIndex * 3 identifies OSM. */
export function indexarRegistros (geoms) {
  let vertexStart = 0, indexStart = 0
  return geoms.map(g => {
    const geometry = { vertexStart, vertexCount: g.positions.length / 3, indexStart, indexCount: g.indices.length }
    vertexStart += geometry.vertexCount; indexStart += geometry.indexCount
    return { ...g.record, geometry }
  })
}

async function atomicWrite (path, data) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, path)
}

/** Only writes the dedicated building asset directory; all existing data is read-only. */
export async function hornear ({ input = existsSync('.cache/edificios/osm') ? '.cache/edificios/osm' : DEFAULT_INPUT, satCache = DEFAULT_SAT, dataDir = 'public/data', output = 'public/data/edificios', osmCache = '.cache/edificios/osm', satelliteCache = '.cache/edificios/satelite' } = {}) {
  const start = Date.now()
  // Imports remain lazy so isolated ingestion/DEM tests do not depend on geometry.
  const { analizarHuella, hornearEdificio, empaquetarGeometrias } = await import('./lib/building-geometry.mjs')
  const { crearContexto, estimarAltura, MODEL_VERSION } = await import('./lib/building-morphology.mjs')
  await mkdir(osmCache, { recursive: true })
  const names = (await readdir(input)).filter(n => n.endsWith('.json')).sort()
  for (const name of names) {
    if (resolve(input, name) !== resolve(osmCache, name)) await copyFile(join(input, name), join(osmCache, name))
  }
  const rawDocuments = await Promise.all(names.map(n => readFile(join(osmCache, n), 'utf8')))
  const inputHash = createHash('sha256')
  for (let i = 0; i < names.length; i++) { inputHash.update(names[i]); inputHash.update(rawDocuments[i]) }
  const documents = rawDocuments.map(JSON.parse)
  const { buildings, stats: inputStats } = ingerirEdificios(documents)
  console.log(`1/4 huellas: ${buildings.length} / ${inputStats.uniqueElements} entidades OSM únicas`)
  console.log(JSON.stringify(inputStats))
  const meta = JSON.parse(await readFile(`${dataDir}/terrain.json`, 'utf8'))
  const frame = makeEnuFrame(meta.origin.lat, meta.origin.lon, meta.origin.h)
  for (const building of buildings) Object.assign(building, analizarHuella(building, frame))
  const [roadsMeta, positionsBuf, indexBuf] = await Promise.all([
    readFile(`${dataDir}/roads-meta.json`, 'utf8').then(JSON.parse), readFile(`${dataDir}/roads-pos.bin`), readFile(`${dataDir}/roads-index.bin`),
  ])
  const positions = new Float32Array(positionsBuf.buffer, positionsBuf.byteOffset, positionsBuf.byteLength / 4)
  const index = new Uint32Array(indexBuf.buffer, indexBuf.byteOffset, indexBuf.byteLength / 4)
  function * roads () {
    for (let w = 0; w < roadsMeta.ways.length; w++) for (let s = index[w]; s < index[w + 1]; s++) {
      const o = s * 6
      yield { ax: positions[o], az: positions[o + 2], bx: positions[o + 3], bz: positions[o + 5], highway: roadsMeta.ways[w].highway }
    }
  }
  console.log('2/4 contexto morfológico: densidad y vías clasificadas')
  const context = crearContexto(buildings, roads())
  const sample = crearMuestreadorDem(`${dataDir}/dem`)
  // Snapshot only useful existing z18 tiles. Rebakes no longer depend on the
  // sibling's directory, and neither network access nor sibling writes occur.
  await mkdir(satelliteCache, { recursive: true })
  const neededTiles = new Set()
  for (const b of buildings) for (const p of b.polygons) {
    const xs = p.outer.map(([lon]) => tileXf(lon, 18)), ys = p.outer.map(([, lat]) => tileYf(lat, 18))
    for (let y = Math.floor(Math.min(...ys)); y <= Math.floor(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.floor(Math.max(...xs)); x++) neededTiles.add(`z18_${x}_${y}.jpg`)
    }
  }
  for (const name of [...neededTiles].sort()) {
    const from = join(satCache, name), to = join(satelliteCache, name)
    if (resolve(from) !== resolve(to) && existsSync(from)) await copyFile(from, to)
  }
  const roof = crearMuestreadorTechos({ satCache: satelliteCache, imgDir: `${dataDir}/img` })
  const groups = new Map()
  for (const b of buildings) { const key = chunkKey(b); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(b) }
  await mkdir(output, { recursive: true })
  const stats = { ...inputStats, buildings: 0, vertices: 0, triangles: 0, bytesGeometry: 0, bytesMetadata: 0, alturaSources: {}, roofSources: {}, estimatedHeightMin: Infinity, estimatedHeightMax: -Infinity, heightSum: 0, rejectedGeometry: [] }
  const chunks = []
  const assetsHash = createHash('sha256')
  console.log(`3/4 horneado: ${groups.size} grupos z15`)
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const geoms = [], demNodes = new Set(), bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    for (const b of group) {
      const altura = estimarAltura(b, context.get(b.id)), techo = roof(b)
      let g
      try { g = hornearEdificio(b, altura, techo, sample, frame) } catch (e) {
        stats.rejectedGeometry.push({ id: b.id, reason: e.message }); continue
      }
      if (!g?.indices.length) { stats.rejectedGeometry.push({ id: b.id, reason: 'sin triangulación' }); continue }
      geoms.push(g)
      for (const node of nodosDem(b)) demNodes.add(node)
      for (let i = 0; i < g.positions.length; i += 3) for (let a = 0; a < 3; a++) {
        bounds[a] = Math.min(bounds[a], g.positions[i + a]); bounds[a + 3] = Math.max(bounds[a + 3], g.positions[i + a])
      }
      stats.buildings++
      stats.alturaSources[altura.fuente] = (stats.alturaSources[altura.fuente] ?? 0) + 1
      stats.roofSources[techo.fuente] = (stats.roofSources[techo.fuente] ?? 0) + 1
      stats.heightSum += altura.metros
      if (altura.fuente === 'estimada') { stats.estimatedHeightMin = Math.min(stats.estimatedHeightMin, altura.metros); stats.estimatedHeightMax = Math.max(stats.estimatedHeightMax, altura.metros) }
    }
    if (!geoms.length) continue
    const bin = empaquetarGeometrias(geoms), basename = key.replaceAll('/', '-')
    const metadata = JSON.stringify({ version: 1, key, buildings: indexarRegistros(geoms) })
    await atomicWrite(`${output}/${basename}.bin`, bin)
    await atomicWrite(`${output}/${basename}.json`, metadata)
    assetsHash.update(`${basename}.bin`); assetsHash.update(bin)
    assetsHash.update(`${basename}.json`); assetsHash.update(metadata)
    const vertices = geoms.reduce((s, g) => s + g.positions.length / 3, 0), triangles = geoms.reduce((s, g) => s + g.indices.length / 3, 0)
    stats.vertices += vertices; stats.triangles += triangles; stats.bytesGeometry += bin.byteLength; stats.bytesMetadata += Buffer.byteLength(metadata)
    chunks.push({ key, url: `${basename}.bin`, metadataUrl: `${basename}.json`, bounds, vertices, triangles, buildings: geoms.length, demNodes: [...demNodes].sort() })
  }
  stats.meanHeight = +(stats.heightSum / stats.buildings).toFixed(2)
  delete stats.heightSum
  stats.geometryAndMetadataSHA256 = assetsHash.digest('hex')
  const manifest = { version: 1, origin: meta.origin, modelVersion: MODEL_VERSION ?? 'morfologia-v1', sources: { osmFiles: names.length, osmSHA256: inputHash.digest('hex'), dem: 'public/data/dem/12; tallado; Terrarium 257x257', roof: 'Esri z18 offline; respaldo estimado con contexto Esri z12' }, stats, chunks }
  await atomicWrite(`${output}/index.json`, JSON.stringify(manifest))
  console.log('4/4 listo')
  console.log(JSON.stringify({ ...stats, chunks: chunks.length, durationSeconds: +((Date.now() - start) / 1000).toFixed(1) }, null, 2))
  return manifest
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }
  hornear({ input: arg('input'), satCache: arg('sat-cache') }).catch(e => { console.error(e); process.exitCode = 1 })
}
