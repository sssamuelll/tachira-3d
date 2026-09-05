import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { makeEnuFrame, geodeticToEnu, enuToGeodetic } from './lib/enu.mjs'

const OUT = 'public/data'
const failures = []
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : 'FALLA '} ${msg}`); if (!ok) failures.push(msg) }

const meta = JSON.parse(await readFile(`${OUT}/roads-meta.json`, 'utf8'))
const terrain = JSON.parse(await readFile(`${OUT}/terrain.json`, 'utf8'))
const municipios = JSON.parse(await readFile(`${OUT}/municipios.json`, 'utf8'))
const bin = await readFile(`${OUT}/terrain.bin`)
const grid = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2)

// 1. round-trip geodetic → ENU → geodetic bajo 1 m en todo el bbox, con altura != 0.
// Si la proyección está mal, todo el mapa está mal y no se nota a simple vista.
const frame = makeEnuFrame(terrain.origin.lat, terrain.origin.lon, terrain.origin.h)
let worst = 0
for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
  const lat = terrain.bbox.s + (terrain.bbox.n - terrain.bbox.s) * i / 20
  const lon = terrain.bbox.w + (terrain.bbox.e - terrain.bbox.w) * j / 20
  const [e, n, u] = geodeticToEnu(frame, lat, lon, 1000)
  const [lat2, lon2, h2] = enuToGeodetic(frame, e, n, u)
  worst = Math.max(worst, Math.hypot(
    (lat2 - lat) * 111320,
    (lon2 - lon) * 111320 * Math.cos(lat * Math.PI / 180),
    h2 - 1000,
  ))
}
check(worst < 1, `round-trip ENU: peor error ${worst.toExponential(2)} m (umbral 1 m)`)

// 2. ningún osmId se repite en roads-meta.json (doble conteo)
const ids = meta.ways.map(w => w.osmId)
const uniqueIds = new Set(ids)
check(uniqueIds.size === ids.length, `osmId únicos: ${uniqueIds.size} de ${ids.length}`)

// 3. todo municipio asignado existe de verdad en municipios.json (no es un nombre inventado)
const municipioNames = new Set(municipios.map(m => m.name))
const invented = meta.ways.filter(w => w.municipio && !municipioNames.has(w.municipio))
check(invented.length === 0, `vías con municipio inventado: ${invented.length}`)

// 4. km y km3d finitos y positivos en toda vía (cierra el hueco de NaN, que "< umbral" no detecta)
const badLengths = meta.ways.filter(w =>
  !Number.isFinite(w.km) || !Number.isFinite(w.km3d) || w.km <= 0 || w.km3d <= 0)
check(badLengths.length === 0, `vías con km/km3d no finito o no positivo: ${badLengths.length}`)

// 5. toda vía tiene municipio
const noMunicipio = meta.ways.filter(w => !w.municipio)
check(noMunicipio.length === 0, `vías sin municipio: ${noMunicipio.length}`)

// 6. terreno no degenerado: rango, media, clamp y tamaño de grid, cada uno con su propio umbral
let sum = 0, clamped = 0
for (const v of grid) { sum += v; if (v === -500 || v === 9000) clamped++ }
const mean = sum / grid.length
const range = terrain.max - terrain.min
check(range >= 1000, `rango de elevación: ${range} m (umbral >= 1000 m)`)
check(terrain.max <= 4200, `elevación máxima: ${terrain.max} m (umbral <= 4200 m)`)
check(mean >= 100 && mean <= 2000, `elevación media: ${mean.toFixed(1)} m (esperado 100-2000)`)
check(clamped / grid.length < 0.01,
  `celdas en el tope del clamp: ${clamped} de ${grid.length} (${(clamped / grid.length * 100).toFixed(2)}%, umbral < 1%)`)
check(grid.length === terrain.width * terrain.height,
  `terrain.bin tiene ${grid.length} celdas, esperadas ${terrain.width * terrain.height}`)

// 7. drapeado no plano: la mayoría de las vías sube o baja con el terreno, y ninguna queda invertida
const draped = meta.ways.filter(w => w.km3d > w.km).length
const inverted = meta.ways.filter(w => w.km3d < w.km - 1e-6)
check(draped / meta.ways.length >= 0.5,
  `vías con km3d > km: ${draped} de ${meta.ways.length} (${(draped / meta.ways.length * 100).toFixed(1)}%, umbral >= 50%)`)
check(inverted.length === 0, `vías con km3d menor que km: ${inverted.length}`)

// 8. cuántos ids de pci-tachira.json ya no existen en roads-meta.json.
// INFORMA, no falla: un huérfano dejó de ser un defecto de datos. La app los
// conserva a propósito, los re-emite en cada guardado y avisa en la interfaz
// para que el usuario decida en su tiempo qué hacer con ellos (store.ts,
// App.tsx) -- eso es el comportamiento correcto del sistema, y una puerta de
// verificación que se pone roja ante lo correcto se aprende a ignorar, y con
// ella los otros doce checks.
// Ausente se omite; ilegible o con JSON inválido sí falla (no aborta el script).
if (existsSync('pci-tachira.json')) {
  try {
    const pci = JSON.parse(await readFile('pci-tachira.json', 'utf8'))
    const knownIds = new Set(meta.ways.map(w => String(w.osmId)))
    const orphanIds = Object.keys(pci.registros ?? {}).filter(id => !knownIds.has(id))
    console.log(orphanIds.length === 0
      ? '  --   ids huérfanos en pci-tachira.json: 0'
      : `  --   ids huérfanos en pci-tachira.json: ${orphanIds.length} → ${orphanIds.slice(0, 5).join(', ')}` +
        `${orphanIds.length > 5 ? ', …' : ''} (se conservan, decide tú qué hacer con ellos)`)
  } catch (e) {
    check(false, `pci-tachira.json existe pero no se pudo leer/parsear: ${e.message}`)
  }
} else {
  console.log('  --   pci-tachira.json todavía no existe, se omite el chequeo de huérfanos')
}

console.log(`\n${failures.length === 0 ? 'todo en orden' : `${failures.length} fallas`}`)
process.exit(failures.length === 0 ? 0 : 1)
