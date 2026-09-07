import { writeFile, mkdir } from 'node:fs/promises'
import { makeEnuFrame, geodeticToEnu } from './lib/enu.mjs'
import { lineLengthMeters, lineLength3dMeters, midpointIndex, pointInPolygon } from './lib/geo.mjs'
import { overpass, waysToLines, relationsToPolygons, QUERY_VIAS, QUERY_MUNICIPIOS } from './lib/overpass.mjs'
import { fetchDem, downsample, tileXf, tileYf, tileYToLat } from './lib/terrarium.mjs'
import { packRoads, writeBin } from './lib/pack.mjs'
import { normalizeLanes, normalizeOneway, orientar } from './lib/road-meta.mjs'
import { subdividir, apoyar } from './lib/subdividir.mjs'
import { alturaTriangulo, normalTriangulo } from './lib/drape.mjs'
import { stateMask } from './lib/state-mask.mjs'
import { escribirPiramide } from './lib/dem-tiles.mjs'

const BBOX = { s: 7.3612911, w: -72.4878225, n: 8.6826552, e: -71.3153029 }
const ORIGIN = { lat: 8.021973, lon: -71.901563, h: 0 }
const Z = 12
const GRID = 1024
const OUT = 'public/data'

// El surface de OSM siembra el tipo de rodadura (spec §3.2)
// wood, metal y asfalto_y_grava quedan fuera a propósito: los dos primeros son
// superficie de puente, no rodadura de carretera, y el tercero es un valor
// libre inventado por un mapeador que no pertenece al esquema de OSM. Meterlos
// en una categoría que no les toca es peor que dejarlos en sin_definir.
const SURFACE_A_TIPO = {
  asphalt: 'asfalto', paved: 'asfalto', chipseal: 'asfalto',
  concrete: 'concreto', 'concrete:plates': 'concreto', 'concrete:lanes': 'concreto',
  gravel: 'granzon', compacted: 'granzon', fine_gravel: 'granzon', unpaved: 'granzon',
  ground: 'tierra', dirt: 'tierra', earth: 'tierra', mud: 'tierra', grass: 'tierra',
  sett: 'empedrado', cobblestone: 'empedrado', paving_stones: 'empedrado',
  unhewn_cobblestone: 'empedrado', pebblestone: 'empedrado',
}

async function main () {
  await mkdir(OUT, { recursive: true })
  const frame = makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)

  console.log('1/9  municipios')
  const municipios = relationsToPolygons(await overpass(QUERY_MUNICIPIOS, 'municipios'))
  console.log(`     ${municipios.length} municipios`)

  console.log('2/9  vías')
  const lines = waysToLines(await overpass(QUERY_VIAS, 'vias'))
  // Un oneway=-1 circula contra el orden de sus nodos: se invierte acá, para
  // que en el frontend "sentido único" signifique siempre "hacia el final".
  for (const l of lines) l.coords = subdividir(orientar(l.coords, l.tags.oneway))
  console.log(`     ${lines.length} vías`)

  console.log('3/9  DEM')
  const dem = await fetchDem(BBOX, Z)
  console.log(`     grid ${dem.width} x ${dem.height}`)

  console.log('4/9  municipio por punto medio')
  // Un tramo que cruza límite cae en uno solo. Cortar en el límite duplicaría
  // segmentos y rompería los ids, que es lo que ancla los datos del usuario.
  const findMunicipio = (lon, lat) =>
    // un municipio puede ser multipolígono (enclaves), de ahí el .some()
    municipios.find(mm => mm.polygons.some(p => pointInPolygon(lon, lat, p)))
  let resolvedByVote = 0
  for (const l of lines) {
    const [lon, lat] = l.coords[midpointIndex(l.coords)]
    const mid = findMunicipio(lon, lat)
    if (mid) {
      l.municipio = mid.name
      continue
    }
    // el punto medio cayó en una grieta de precisión entre municipios vecinos
    // (frontera compartida, puente internacional): votar con todos los
    // vértices de la vía y quedarnos con el municipio que más vértices tenga,
    // en vez del primero que caiga — eso dependía del orden del array (un
    // ramal corto al inicio no debe ganarle al grueso de la vía en otro
    // municipio). Empate: gana el primero que alcanzó el máximo recorriendo
    // los vértices en orden — arbitrario pero determinista, no un descuido.
    const votes = new Map()
    for (const [vlon, vlat] of l.coords) {
      const v = findMunicipio(vlon, vlat)
      if (v) votes.set(v.name, (votes.get(v.name) ?? 0) + 1)
    }
    let winner = null, best = 0
    for (const [name, count] of votes) {
      if (count > best) { best = count; winner = name }
    }
    l.municipio = winner
    if (winner) resolvedByVote++
  }
  const totalOrphanFragments = municipios.reduce((s, m) => s + m.orphanFragments, 0)
  if (totalOrphanFragments > 0) console.warn(`     AVISO: ${totalOrphanFragments} fragmentos de frontera sin cerrar`)
  const unassigned = lines.filter(l => !l.municipio).length
  console.log(`     resueltas por voto: ${resolvedByVote} · sin municipio: ${unassigned}`)

  console.log('5/9  drapeado y longitudes')
  // Sobre la TRIANGULACIÓN del DEM, no bilineal: es la superficie exacta que
  // el nivel fino del relieve dibuja (nodoTerreno.ts), y con los tramos ya
  // partidos a 30 m ningún tramo cruza por debajo de ella. La normal del
  // triángulo inclina la calzada con la ladera (roadsShader.ts).
  let vertices = 0
  const alturaDe = (lon, lat) => alturaTriangulo(dem, lon, lat)
  for (const l of lines) {
    // Los tramos que aún se aparten del relieve más de 20 cm se parten por
    // bisección: un tramo recto entre dos puntos apoyados cruza por debajo de
    // una arista convexa del DEM, y 20 cm es la alza mínima con la que el
    // navegador dibuja la calzada (ALZA_MIN_M, roadsShader.ts).
    l.coords = apoyar(l.coords, alturaDe)
    const heights = l.coords.map(([lon, lat]) => alturaDe(lon, lat))
    l.nrm = l.coords.map(([lon, lat]) => normalTriangulo(dem, frame, lon, lat))
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
  await writeBin(`${OUT}/roads-nrm.bin`, packed.nrm)
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
      lanes: normalizeLanes(l.tags.lanes),
      oneway: normalizeOneway(l.tags.oneway),
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
    width: GRID, height: GRID, bbox: dem.bounds, min, max, origin: ORIGIN, dem: dem.tile,
  }))
  console.log(`     elevación ${min} a ${max} m`)

  console.log('8b/9 pirámide del DEM')
  // "Dentro del estado" a la resolución del DEM, sobre su rejilla Mercator.
  const dentro = stateMask(municipios, {
    W: dem.width, H: dem.height,
    colOf: lon => (tileXf(lon, Z) - dem.tile.x0) * 256,
    rowOf: lat => (tileYf(lat, Z) - dem.tile.y0) * 256,
    latDeFila: f => tileYToLat(dem.tile.y0 + f / 256, Z),
  })
  const pir = await escribirPiramide(dem, dentro, `${OUT}/dem`)
  console.log(`     ${pir.teselas} teselas z8-z12 · ${pir.nodos} nodos con error`)

  console.log('9/9  municipios')
  await writeFile(`${OUT}/municipios.json`, JSON.stringify(municipios))

  const seeded = lines.filter(l => SURFACE_A_TIPO[l.tags.surface]).length
  console.log(`\nlisto. ${lines.length} vías · ${packed.segmentCount} segmentos · ` +
              `${seeded} con tipo sembrado desde surface`)
}

main().catch(e => { console.error(e); process.exit(1) })
