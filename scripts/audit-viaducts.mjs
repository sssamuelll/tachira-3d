// Compara los datos horneados con los GLB existentes sin modificar ninguno.
// node scripts/audit-viaducts.mjs -> .cache/viaduct-comparison.json
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { alturaEnPosts } from './lib/drape.mjs'
import { tileXf, tileYf, tileXToLon, tileYToLat, decodeTerrarium } from './lib/terrarium.mjs'
import { makeEnuFrame, geodeticToEnu } from './lib/enu.mjs'
import { lineLengthMeters } from './lib/geo.mjs'
import { tagsViales } from './lib/road-tag-overrides.mjs'

const json = path => JSON.parse(readFileSync(path, 'utf8'))
const terrain = json('public/data/terrain.json')
const frame = makeEnuFrame(terrain.origin.lat, terrain.origin.lon, terrain.origin.h)
const vias = json('.cache/vias.json').elements.filter(w => w.type === 'way' && w.geometry)
const pieces = json('.cache/viaductos.json')
const metadata = json('public/data/roads-meta.json').ways
const positions = readFileSync('public/data/roads-pos.bin')
const normals = readFileSync('public/data/roads-nrm.bin')
const index = readFileSync('public/data/roads-index.bin')
const tiles = new Map()
const z = terrain.dem.z
const MIN_LIFT_M = 0.25 // ALZA_MIN_M en src/scene/roadsShader.ts.

function elevation (lon, lat) {
  const tx = tileXf(lon, z), ty = tileYf(lat, z)
  const x = Math.floor(tx), y = Math.floor(ty), key = `${x}/${y}`
  if (!tiles.has(key)) {
    const png = PNG.sync.read(readFileSync(`public/data/dem/${z}/${key}.png`))
    const data = Float32Array.from({ length: png.width * png.height }, (_, i) =>
      decodeTerrarium(png.data[i * 4], png.data[i * 4 + 1], png.data[i * 4 + 2]))
    tiles.set(key, { width: png.width, height: png.height, data })
  }
  return alturaEnPosts(tiles.get(key), (tx - x) * 256, (ty - y) * 256)
}

const worldY = (lon, lat, h = elevation(lon, lat)) => geodeticToEnu(frame, lat, lon, h)[2]
const range = values => ({ min: Math.min(...values), max: Math.max(...values) })
const coords = way => way.geometry.map(p => [p.lon, p.lat])
const distances = points => {
  const result = [0]
  for (let i = 1; i < points.length; i++) result.push(result.at(-1) + lineLengthMeters(points.slice(i - 1, i + 1)))
  return result
}
const interpolate = (stations, values, targets) => targets.map(target => {
  let i = 1
  while (i < stations.length - 1 && stations[i] < target) i++
  const span = stations[i] - stations[i - 1]
  const t = span > 0 ? (target - stations[i - 1]) / span : 0
  return values[i - 1] + t * (values[i] - values[i - 1])
})

function ribbonWays (piece) {
  const result = []
  for (const ribbon of piece.cintas) {
    const ids = ribbon.wayIds ?? [ribbon.id]
    let cursor = 0
    for (const id of ids) {
      const way = vias.find(w => w.id === id)
      if (!way) throw new Error(`way/${id} falta en .cache/vias.json`)
      const count = way.geometry.length
      const localHeights = ribbon.alturas?.slice(cursor, cursor + count) ?? null
      if (localHeights && localHeights.length !== count) throw new Error(`Perfil incompleto para way/${id}`)
      if (localHeights && (ribbon.reversedWayIds ?? []).includes(id)) localHeights.reverse()
      result.push({ id, localHeights })
      cursor += count - 1
    }
    if (ribbon.alturas && cursor + 1 !== ribbon.pts.length) {
      throw new Error(`La partición por way no consume la cinta ${ribbon.id}`)
    }
  }
  return result
}

/** Rayo vertical contra los mismos triángulos y posiciones Float32 que
 * geometriaNodo usa a z15. step=8 reproduce la geometría gruesa de z12.
 * h mueve también XZ: reproduce las iteraciones de Piezas.apoyar. */
function rayHeight (lon, lat, h, step = 1) {
  const p = geodeticToEnu(frame, lat, lon, h)
  const u = tileXf(lon, z) * 256, v = tileYf(lat, z) * 256
  const point = (i, j) => {
    const lo = tileXToLon(i / 256, z), la = tileYToLat(j / 256, z)
    return geodeticToEnu(frame, la, lo, elevation(lo, la)).map(Math.fround)
  }
  let hit = -Infinity
  for (let j = Math.floor(v / step) * step - step * 2; j <= v + step * 2; j += step) {
    for (let i = Math.floor(u / step) * step - step * 2; i <= u + step * 2; i += step) {
      const a = point(i, j), b = point(i + step, j)
      const c = point(i, j + step), d = point(i + step, j + step)
      for (const [q, r, s] of [[a, c, b], [b, c, d]]) {
        const dx = p[0] - q[0], dn = p[1] - q[1]
        const a1 = r[0] - q[0], a2 = r[1] - q[1], b1 = s[0] - q[0], b2 = s[1] - q[1]
        const det = a1 * b2 - a2 * b1
        const t = (dx * b2 - dn * b1) / det, w = (a1 * dn - a2 * dx) / det
        if (t >= -1e-6 && w >= -1e-6 && t + w <= 1 + 1e-6) {
          hit = Math.max(hit, q[2] + t * (r[2] - q[2]) + w * (s[2] - q[2]))
        }
      }
    }
  }
  if (!Number.isFinite(hit)) throw new Error(`Sin triángulo en ${lat}, ${lon}`)
  return hit
}

function pieceAnchor (lon, lat) {
  let h = 0, y
  const zeroY = worldY(lon, lat, 0), dy = worldY(lon, lat, 1) - zeroY
  for (let i = 0; i < 4; i++) {
    y = rayHeight(lon, lat, h)
    h = (y - zeroY) / dy
  }
  return y
}

function glbLevels (path) {
  const data = readFileSync(path)
  const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString())
  const top = prefix => Math.max(...gltf.meshes.filter(m => m.name.startsWith(prefix))
    .flatMap(m => m.primitives.map(p => gltf.accessors[p.attributes.POSITION].max[1])))
  return { deck: top('tablero-'), pavement: top('rodadura-') }
}

function bakedProfile (osmId) {
  const i = metadata.findIndex(w => w.osmId === osmId)
  if (i < 0) throw new Error(`way/${osmId} falta en roads-meta.json`)
  const first = index.readUInt32LE(i * 4), end = index.readUInt32LE((i + 1) * 4)
  const points = [], liftedYs = []
  const append = (s, offset) => {
    const point = [0, 1, 2].map(k => positions.readFloatLE((s * 6 + offset + k) * 4))
    const normal = [0, 1, 2].map(k => normals.readInt8(s * 6 + offset + k))
    const length = Math.hypot(...normal)
    points.push(point)
    liftedYs.push(point[1] + MIN_LIFT_M * (length > 63.5 ? normal[1] / length : 1))
  }
  for (let s = first; s < end; s++) {
    if (s === first) append(s, 0)
    append(s, 3)
  }
  if (points.length < 2) throw new Error(`way/${osmId} no tiene segmentos dibujables`)
  const distances = [0]
  for (let k = 1; k < points.length; k++) distances.push(distances[k - 1] +
    Math.hypot(points[k][0] - points[k - 1][0], points[k][2] - points[k - 1][2]))
  const half = distances.at(-1) / 2
  const k = distances.findIndex(s => s >= half)
  const t = (half - distances[k - 1]) / (distances[k] - distances[k - 1])
  return {
    segments: end - first,
    endpointsY: [points[0][1], points.at(-1)[1]],
    midpointY: points[k - 1][1] + t * (points[k][1] - points[k - 1][1]),
    ...range(points.map(p => p[1])),
    minimumLift: { ...range(liftedYs), midpointY: liftedYs[k - 1] + t * (liftedYs[k] - liftedYs[k - 1]) },
    samples: { points, distances, liftedYs },
  }
}

const report = {
  units: 'metros; Y ENU de escena, salvo endpointDemH (altura geodésica del DEM)',
  source: 'public/data/roads-pos.bin, roads-index.bin, DEM z12 y GLB; sin correcciones a las piezas',
  visualLift: 'El shader añade como mínimo 0,25 m según la normal; baked.minimumLift usa la normal Int8 renormalizada como el shader. El alza efectiva aumenta con la distancia a cámara.',
  viaducts: [],
}
for (const [name, piece] of Object.entries(pieces)) {
  const old = name === 'Viaducto Viejo'
  const { lon, lat } = piece.centro
  const rootY = pieceAnchor(lon, lat)
  const levels = glbLevels(`public/data/piezas/viaducto-${old ? 'viejo' : 'nuevo'}.glb`)
  const givenDeckY = old ? 649.8 : 753.2
  const profiles = ribbonWays(piece)
  const localDeckRange = profiles.some(p => p.localHeights)
    ? range(profiles.flatMap(p => p.localHeights ?? []))
    : { min: levels.deck, max: levels.deck }
  const localPavementRange = { min: localDeckRange.min + .06, max: localDeckRange.max + .06 }
  const deckYRange = { min: rootY + localDeckRange.min, max: rootY + localDeckRange.max }
  const pavementYRange = { min: rootY + localPavementRange.min, max: rootY + localPavementRange.max }
  const deckY = deckYRange.max, pavementY = pavementYRange.max
  const ways = profiles.map(profile => {
    const way = vias.find(w => w.id === profile.id), cs = coords(way)
    const endpoints = [cs[0], cs.at(-1)]
    const bakedWithSamples = bakedProfile(way.id)
    const { samples, ...baked } = bakedWithSamples
    let expectedYs
    if (profile.localHeights) {
      let sourceCoords = cs, sourceHeights = profile.localHeights
      const [e0, n0] = geodeticToEnu(frame, sourceCoords[0][1], sourceCoords[0][0], 0)
      const [e1, n1] = geodeticToEnu(frame, sourceCoords.at(-1)[1], sourceCoords.at(-1)[0], 0)
      const first = samples.points[0]
      if (Math.hypot(first[0] - e1, first[2] + n1) < Math.hypot(first[0] - e0, first[2] + n0)) {
        sourceCoords = [...sourceCoords].reverse()
        sourceHeights = [...sourceHeights].reverse()
      }
      const sourceDistances = distances(sourceCoords), sourceLength = sourceDistances.at(-1)
      const bakedLength = samples.distances.at(-1)
      expectedYs = interpolate(sourceDistances, sourceHeights,
        samples.distances.map(s => s / bakedLength * sourceLength)).map(h => rootY + h + .06)
    } else expectedYs = samples.distances.map(() => pavementY)
    const axisDelta = samples.points.map((p, i) => p[1] - expectedYs[i])
    const liftDelta = samples.liftedYs.map((y, i) => y - expectedYs[i])
    const halfIndex = samples.distances.findIndex(s => s >= samples.distances.at(-1) / 2)
    return {
      osmId: way.id, nodes: way.nodes, lengthMeters: lineLengthMeters(cs), endpoints,
      endpointDemH: endpoints.map(p => elevation(...p)),
      endpointTerrainY: endpoints.map(p => worldY(...p)), baked,
      midpointMinusGivenDeck: baked.midpointY - givenDeckY,
      midpointMinusActualPavement: axisDelta[halfIndex],
      rangeMinusActualPavement: range(axisDelta),
      minimumLiftMinusActualPavement: {
        ...range(liftDelta), midpoint: liftDelta[halfIndex],
      },
    }
  })
  const localOverrides = old ? [] : [1223380942, 1223380941, 1223380939, 1223380943].map(id => {
    const way = vias.find(w => w.id === id), cs = coords(way)
    return { osmId: id, osmTags: way.tags, effectiveTags: tagsViales(way), lengthMeters: lineLengthMeters(cs),
      endpoints: [cs[0], cs.at(-1)], terrainY: range(cs.map(p => worldY(...p))) }
  })
  report.viaducts.push({
    name, center: piece.centro, givenDeckY, rootY, localLevels: levels,
    localDeckRange, localPavementRange, deckYRange, pavementYRange, deckY, pavementY,
    expectedChrome: 'La verificación visual sigue pendiente. Las diferencias se calculan contra la rasante variable de cada cinta cuando `alturas` existe.',
    // Ayuda a identificar la antigua cota del Viejo (~649,8) sin adoptarla.
    coarseUncorrectedRayDeckY: rayHeight(lon, lat, 0, 8) + levels.deck,
    sampleTerrainY: Object.fromEntries(Object.entries(piece.muestras).map(([key, ps]) =>
      [key, range(ps.map(p => worldY(p.lon, p.lat)))])),
    ways, localOverrides,
  })
}
writeFileSync('.cache/viaduct-comparison.json', JSON.stringify(report, null, 2) + '\n')
for (const v of report.viaducts) {
  console.log(`${v.name}: tablero dado ${v.givenDeckY.toFixed(2)}; ` +
    `GLB fino ${v.deckYRange.min.toFixed(2)}–${v.deckYRange.max.toFixed(2)}; ` +
    `rodadura ${v.pavementYRange.min.toFixed(2)}–${v.pavementYRange.max.toFixed(2)}`)
  console.table(v.ways.map(w => ({ way: w.osmId, segmentos: w.baked.segments,
    minimo: w.baked.min.toFixed(3), medio: w.baked.midpointY.toFixed(3), maximo: w.baked.max.toFixed(3),
    diferenciaReferencia: w.midpointMinusGivenDeck.toFixed(3), diferenciaRodadura: w.midpointMinusActualPavement.toFixed(3),
    alzaMinimaVsRodadura: `${w.minimumLiftMinusActualPavement.min.toFixed(3)} a ${w.minimumLiftMinusActualPavement.max.toFixed(3)}`,
  })))
}
console.log('Escrito .cache/viaduct-comparison.json')
