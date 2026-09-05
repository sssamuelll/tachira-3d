import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { makeEnuFrame, geodeticToEnu, enuToGeodetic } from './lib/enu.mjs'

const OUT = 'public/data'
const fallos = []
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : 'FALLA '} ${msg}`); if (!ok) fallos.push(msg) }

const meta = JSON.parse(await readFile(`${OUT}/roads-meta.json`, 'utf8'))
const terrain = JSON.parse(await readFile(`${OUT}/terrain.json`, 'utf8'))
const bin = await readFile(`${OUT}/terrain.bin`)
const grid = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2)

// 1. round-trip geodetic → ENU → geodetic bajo 1 m en todo el bbox
const f = makeEnuFrame(terrain.origin.lat, terrain.origin.lon, terrain.origin.h)
let peor = 0
for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
  const lat = terrain.bbox.s + (terrain.bbox.n - terrain.bbox.s) * i / 20
  const lon = terrain.bbox.w + (terrain.bbox.e - terrain.bbox.w) * j / 20
  const [e, n, u] = geodeticToEnu(f, lat, lon, 1000)
  const [lat2, lon2, h2] = enuToGeodetic(f, e, n, u)
  peor = Math.max(peor, Math.hypot(
    (lat2 - lat) * 111320,
    (lon2 - lon) * 111320 * Math.cos(lat * Math.PI / 180),
    h2 - 1000,
  ))
}
check(peor < 1, `round-trip ENU: peor error ${peor.toExponential(2)} m (umbral 1 m)`)

// 2. la suma de km por municipio da el total
const total = meta.ways.reduce((s, w) => s + w.km, 0)
const porMunicipio = new Map()
for (const w of meta.ways) porMunicipio.set(w.municipio, (porMunicipio.get(w.municipio) ?? 0) + w.km)
const suma = [...porMunicipio.values()].reduce((a, b) => a + b, 0)
check(Math.abs(suma - total) < 0.001, `suma por municipio ${suma.toFixed(2)} vs total ${total.toFixed(2)} km`)

// 3. toda vía tiene municipio
const huerfanas = meta.ways.filter(w => !w.municipio)
check(huerfanas.length === 0, `vías sin municipio: ${huerfanas.length}`)

// 4. las elevaciones caen en un rango plausible para el Táchira
check(terrain.min >= -500 && terrain.max <= 4200,
  `elevación entre ${terrain.min} y ${terrain.max} m (esperado -500 a 4200)`)
check(grid.length === terrain.width * terrain.height,
  `terrain.bin tiene ${grid.length} celdas, esperadas ${terrain.width * terrain.height}`)

// 5. todo id en pci-tachira.json existe en roads-meta.json
if (existsSync('pci-tachira.json')) {
  const pci = JSON.parse(await readFile('pci-tachira.json', 'utf8'))
  const conocidos = new Set(meta.ways.map(w => String(w.osmId)))
  const perdidos = Object.keys(pci.registros ?? {}).filter(id => !conocidos.has(id))
  check(perdidos.length === 0,
    `ids huérfanos en pci-tachira.json: ${perdidos.length}${perdidos.length ? ' → ' + perdidos.slice(0, 5).join(', ') : ''}`)
} else {
  console.log('  --   pci-tachira.json todavía no existe, se omite el chequeo de huérfanos')
}

// 6. km3d ≥ km siempre: la longitud con desnivel no puede ser menor que la plana
const malas = meta.ways.filter(w => w.km3d < w.km - 1e-6)
check(malas.length === 0, `vías con km3d menor que km: ${malas.length}`)

console.log(`\n${fallos.length === 0 ? 'todo en orden' : `${fallos.length} fallas`}`)
process.exit(fallos.length === 0 ? 0 : 1)
