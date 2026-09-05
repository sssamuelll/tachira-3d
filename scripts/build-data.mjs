import { writeFile, mkdir } from 'node:fs/promises'
import { makeEnuFrame, geodeticToEnu } from './lib/enu.mjs'
import { lineLengthMeters, lineLength3dMeters, midpointIndex, pointInPolygon } from './lib/geo.mjs'
import { overpass, waysToLines, relationsToPolygons, QUERY_VIAS, QUERY_MUNICIPIOS } from './lib/overpass.mjs'
import { fetchDem, sampleBilinear, downsample } from './lib/terrarium.mjs'
import { packRoads, writeBin } from './lib/pack.mjs'

const BBOX = { s: 7.3612911, w: -72.4878225, n: 8.6826552, e: -71.3153029 }
const ORIGIN = { lat: 8.021973, lon: -71.901563, h: 0 }
const Z = 12
const GRID = 1024
const OUT = 'public/data'

// El surface de OSM siembra el tipo de rodadura (spec §3.2)
const SURFACE_A_TIPO = {
  asphalt: 'asfalto', paved: 'asfalto',
  concrete: 'concreto', concrete_plates: 'concreto',
  gravel: 'granzon', compacted: 'granzon', fine_gravel: 'granzon', unpaved: 'granzon',
  ground: 'tierra', dirt: 'tierra', earth: 'tierra', mud: 'tierra',
  sett: 'empedrado', cobblestone: 'empedrado', paving_stones: 'empedrado',
}

async function main () {
  await mkdir(OUT, { recursive: true })
  const frame = makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)

  console.log('1/9  municipios')
  const municipios = relationsToPolygons(await overpass(QUERY_MUNICIPIOS, 'municipios'))
  console.log(`     ${municipios.length} municipios`)

  console.log('2/9  vías')
  const lines = waysToLines(await overpass(QUERY_VIAS, 'vias'))
  console.log(`     ${lines.length} vías`)

  console.log('3/9  DEM')
  const dem = await fetchDem(BBOX, Z)
  console.log(`     grid ${dem.width} x ${dem.height}`)

  console.log('4/9  municipio por punto medio')
  // Un tramo que cruza límite cae en uno solo. Cortar en el límite duplicaría
  // segmentos y rompería los ids, que es lo que ancla los datos del usuario.
  for (const l of lines) {
    const [lon, lat] = l.coords[midpointIndex(l.coords)]
    // un municipio puede ser multipolígono (enclaves), de ahí el .some()
    const m = municipios.find(mm => mm.polygons.some(p => pointInPolygon(lon, lat, p)))
    l.municipio = m ? m.name : null
  }
  const huerfanos = municipios.reduce((s, m) => s + m.orphanFragments, 0)
  if (huerfanos > 0) console.warn(`     AVISO: ${huerfanos} fragmentos de frontera sin cerrar`)
  const sinMunicipio = lines.filter(l => !l.municipio).length
  console.log(`     sin municipio: ${sinMunicipio}`)

  console.log('5/9  drapeado y longitudes')
  let vertices = 0
  for (const l of lines) {
    const heights = l.coords.map(([lon, lat]) => sampleBilinear(dem, lon, lat))
    l.km = lineLengthMeters(l.coords) / 1000
    l.km3d = lineLength3dMeters(l.coords, heights) / 1000
    l.enu = l.coords.map(([lon, lat], i) => geodeticToEnu(frame, lat, lon, heights[i]))
    vertices += l.coords.length
  }
  console.log(`     ${vertices} vértices en total`)

  console.log('6/9  empaquetado de vías')
  const packed = packRoads(lines)
  await writeBin(`${OUT}/roads-pos.bin`, packed.positions)
  await writeBin(`${OUT}/roads-segid.bin`, packed.segIds)
  await writeBin(`${OUT}/roads-index.bin`, packed.index)
  console.log(`     ${packed.segmentCount} segmentos`)

  console.log('7/9  metadata de vías')
  await writeFile(`${OUT}/roads-meta.json`, JSON.stringify({
    count: lines.length,
    ways: lines.map(l => ({
      osmId: l.osmId,
      ref: l.tags.ref ?? null,
      name: l.tags.name ?? null,
      highway: l.tags.highway,
      surface: l.tags.surface ?? null,
      tipo: SURFACE_A_TIPO[l.tags.surface] ?? 'sin_definir',
      municipio: l.municipio,
      km: +l.km.toFixed(4),
      km3d: +l.km3d.toFixed(4),
    })),
  }))

  console.log('8/9  terreno')
  const grid = downsample(dem, GRID, GRID)
  await writeBin(`${OUT}/terrain.bin`, grid)
  let min = Infinity, max = -Infinity
  for (const v of grid) { if (v < min) min = v; if (v > max) max = v }
  await writeFile(`${OUT}/terrain.json`, JSON.stringify({
    width: GRID, height: GRID, bbox: dem.bounds, min, max, origin: ORIGIN,
  }))
  console.log(`     elevación ${min} a ${max} m`)

  console.log('9/9  municipios')
  await writeFile(`${OUT}/municipios.json`, JSON.stringify(municipios))

  const sembrados = lines.filter(l => SURFACE_A_TIPO[l.tags.surface]).length
  console.log(`\nlisto. ${lines.length} vías · ${packed.segmentCount} segmentos · ` +
              `${sembrados} con tipo sembrado desde surface`)
}

main().catch(e => { console.error(e); process.exit(1) })
