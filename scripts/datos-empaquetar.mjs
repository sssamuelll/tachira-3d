import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/**
 * Empaqueta los datos que hornea el pipeline en un solo tar.gz, para
 * publicarlo como asset de un Release. Son unos 56 MB comprimidos: no caben en git
 * y el repo tiene que poder clonarse sin ellos.
 *
 * Lo que NO entra: public/data/piezas y public/data/capas viajan en git con
 * el sitio, así que meterlos acá los duplicaría.
 *
 * Uso: npm run datos:empaquetar
 * Después, crear a mano un Release con la etiqueta datos-AAAA-MM-DD y subir
 * datos-base.tar.gz como asset. Eso es lo que baja scripts/datos-bajar.mjs.
 *
 * ponytail: un asset de Release admite hasta 2 GB, así que repartir el
 * paquete entero como un solo archivo tiene techo de sobra para los 56 MB de
 * hoy. Si algún día se acercara, toca partirlo o cambiar de sitio.
 *
 * ponytail: tar del sistema, no una librería. Viene con Windows 10+, macOS y
 * Linux. Si algún día hace falta empaquetar desde un entorno sin tar, entra
 * una dependencia; hoy sería una dependencia por nada.
 */

/** Lo que entra en el paquete, relativo a public/. Lista explícita y no
 *  exclusiones: lo que no está nombrado no viaja, y añadir una carpeta nueva
 *  al pipeline obliga a decidir acá si se reparte. */
export const CONTENIDO = [
  'data/VERSION',
  'data/dem',
  'data/edificios',
  'data/limites-pos.bin',
  'data/municipios.json',
  'data/terrain.bin',
  'data/terrain.json',
  'data/roads-approaches.json',
  'data/roads-index.bin',
  'data/roads-meta.json',
  'data/roads-nrm.bin',
  'data/roads-pos.bin',
  'data/roads-segid.bin',
  'data/roads-structures.json',
]

export const ASSET = 'datos-base.tar.gz'

/** El sello del paquete. origen y bbox salen de terrain.json porque describen
 *  los datos que de verdad viajan, no una constante que podría haberse
 *  movido después de hornear. */
export function versionDe (terrain, sha, fecha) {
  return { fecha, scripts: sha, origen: terrain.origin, bbox: terrain.bbox }
}

/** Los argumentos con los que se invoca tar. Extraído para que la prueba
 *  interrogue la invocación REAL: antes comprobaba una lista escrita dentro
 *  de la propia prueba, así que empaquetar la carpeta entera por descuido
 *  habría pasado desapercibido. */
export function argumentosTar (destino = ASSET, raiz = 'public', contenido = CONTENIDO) {
  return ['-czf', destino, '-C', raiz, ...contenido]
}

async function main () {
  for (const rel of CONTENIDO) {
    if (rel === 'data/VERSION') continue          // lo escribe este script
    if (!existsSync(`public/${rel}`)) {
      throw new Error(`falta public/${rel}: corre el pipeline antes de empaquetar`)
    }
  }

  const terrain = JSON.parse(await readFile('public/data/terrain.json', 'utf8'))
  const sha = execFileSync('git', ['rev-parse', 'HEAD:scripts'], { encoding: 'utf8' }).trim()
  const fecha = new Date().toISOString().slice(0, 10)
  const version = versionDe(terrain, sha, fecha)
  await writeFile('public/data/VERSION', JSON.stringify(version, null, 2) + '\n')

  // VERSION va DENTRO del paquete, así que hay que escribirlo antes. Si el
  // empaquetado falla, se borra: un sello ausente dice la verdad (no se
  // construyó nada), y uno que sobrevive a un fallo miente sobre un paquete
  // que no existe. El paquete bueno se lleva su copia dentro.
  try {
    execFileSync('tar', argumentosTar(), { stdio: 'inherit' })
  } catch (e) {
    rmSync('public/data/VERSION', { force: true })
    throw e
  }

  const bytes = readFileSync(ASSET)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  console.log(`\n${ASSET}  ${(bytes.length / 1e6).toFixed(1)} MB`)
  console.log(`sha256  ${sha256}`)
  console.log(`\nCrea el Release con la etiqueta  datos-${fecha}  y sube ese archivo como asset:`)
  console.log(`  gh release create datos-${fecha} ${ASSET} --title "Datos base ${fecha}" --notes "sha256 ${sha256}"`)
}

// Mismo idioma que build-buildings.mjs:171. pathToFileURL importa: en Windows
// import.meta.url trae file:///D:/... con tres barras, y concatenar 'file://'
// a mano da dos, asi que la comparacion seria false siempre y el script no
// ejecutaria nada. Comprobado en esta maquina.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
