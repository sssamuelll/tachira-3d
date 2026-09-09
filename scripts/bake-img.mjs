import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'

/**
 * Horneado de la imagen satelital de los niveles gruesos:
 * public/data/img/{z}/{x}/{y}.jpg para z8..z12, SOLO de los nodos que existen
 * (public/data/dem/errores.json). Son 217 teselas, unos 5 MB.
 *
 * Por qué solo hasta z12: es el corte natural del resto del pipeline (la
 * pirámide del DEM llega hasta ahí, dem-tiles.mjs) y es lo que hace falta para
 * que la vista de estado y la de municipio se dibujen sin red. De z13 en
 * adelante son miles de teselas y las pide el navegador al vuelo
 * (src/scene/imagenTeselas.ts), con el horneado como red de seguridad: sin
 * conexión, el nodo fino cae al ancestro horneado en vez de quedar en gris.
 *
 * Caché en .cache/img/, igual que .cache/dem: correrlo dos veces no vuelve a
 * bajar nada, y el segundo horneado sale sin red.
 *
 * Uso: node scripts/bake-img.mjs
 */

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'
const CACHE = '.cache/img'
const ERRORES = 'public/data/dem/errores.json'
const SALIDA = 'public/data/img'
const REINTENTOS = 3

/** Esri sirve /tile/{z}/{fila}/{columna}: la y va ANTES que la x, al revés que
 *  la ruta {z}/{x}/{y} con la que este repo nombra sus teselas. Invertirlo no
 *  da 404, da una tesela de otro sitio del planeta. */
export const urlEsri = (z, x, y) => `${ESRI}/${z}/${y}/${x}`

/** Los nodos de errores.json que llevan tesela horneada. errores.json es la
 *  lista de qué nodos EXISTEN (los que tienen algún post dentro del estado):
 *  bajar el rectángulo completo del bbox sería el triple de teselas, y el
 *  relieve nunca dibuja las de afuera. */
export function teselasHornear (errores, zMax = 12) {
  return Object.keys(errores)
    .map(k => k.split('/').map(Number))
    .filter(([z]) => z <= zMax)
    .map(([z, x, y]) => ({ z, x, y }))
}

export const rutaSalida = (dir, { z, x, y }) => `${dir}/${z}/${x}/${y}.jpg`

// temporal + rename, como terrarium.mjs: si se interrumpe a mitad de escritura
// (Ctrl+C, corte de red) el .jpg final nunca queda a medias -- o está completo
// o no existe, y la próxima corrida lo vuelve a pedir.
async function escribirAtomico (ruta, buf) {
  const tmp = `${ruta}.${process.pid}.tmp`
  await writeFile(tmp, buf)
  await rename(tmp, ruta)
}

async function bajar (z, x, y) {
  const cache = `${CACHE}/${z}_${x}_${y}.jpg`
  if (existsSync(cache)) return readFile(cache)
  let ultimo
  for (let intento = 1; intento <= REINTENTOS; intento++) {
    try {
      const res = await fetch(urlEsri(z, x, y))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      // Un cuerpo minúsculo es la tesela "sin datos" de Esri o un error
      // envuelto en 200: no vale la pena guardarlo como si fuera imagen.
      if (buf.length < 512) throw new Error(`respuesta de ${buf.length} bytes`)
      await mkdir(CACHE, { recursive: true })
      await escribirAtomico(cache, buf)
      return buf
    } catch (err) {
      ultimo = err
      if (intento < REINTENTOS) await new Promise(r => setTimeout(r, 400 * intento))
    }
  }
  throw new Error(`tesela ${z}/${x}/${y}: ${ultimo.message}`)
}

async function main () {
  const errores = JSON.parse(await readFile(ERRORES, 'utf8'))
  const teselas = teselasHornear(errores)
  console.log(`imagen satelital: ${teselas.length} teselas z8..z12 (Esri World Imagery)`)
  let n = 0, bytes = 0
  for (const t of teselas) {
    const buf = await bajar(t.z, t.x, t.y)
    await mkdir(`${SALIDA}/${t.z}/${t.x}`, { recursive: true })
    await escribirAtomico(rutaSalida(SALIDA, t), buf)
    bytes += buf.length
    if (++n % 25 === 0) console.log(`  ${n}/${teselas.length}`)
  }
  console.log(`  ${n} teselas, ${(bytes / 1e6).toFixed(1)} MB en ${SALIDA}`)
}

// Solo corre como programa; el test importa las funciones puras de arriba.
if (process.argv[1] && process.argv[1].endsWith('bake-img.mjs')) {
  main().catch(e => { console.error(e); process.exit(1) })
}
