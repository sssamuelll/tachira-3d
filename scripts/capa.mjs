#!/usr/bin/env node
/**
 * npm run capa -- <id>
 *
 * Siembra el GeoJSON de una capa desde OSM. Lo que la comunidad haya añadido a
 * mano se conserva; lo que vino de OSM se reemplaza por lo que OSM diga hoy, y
 * si los dos reclaman el mismo id manda la comunidad (ver `fusionar`).
 *
 * OJO CON EL CACHÉ: `overpass()` guarda cada respuesta en `.cache/capa-<id>.json`
 * y la reusa mientras exista. O sea que correr esto dos veces NO vuelve a
 * preguntarle a OSM -- reconstruye el archivo con la misma respuesta de antes.
 * Para resembrar de verdad hay que borrar ese archivo primero. Es a propósito:
 * Overpass es un servicio público y gratuito, y repetir una consulta de todo un
 * estado porque sí es justo lo que pide que no le hagas.
 *
 * El archivo se escribe ORDENADO POR ID y con sangría de dos espacios. No es
 * estética: es lo que hace que el diff de un pull request se pueda leer. Un
 * GeoJSON en una sola línea convierte "moví un hospital dos metros" en una
 * línea de 400 KB cambiada.
 */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { overpass } from './lib/overpass.mjs'
import { REGISTRO } from './lib/capas-osm.mjs'

const DIR = 'public/data/capas'

/**
 * Lo de la comunidad se conserva; lo de OSM se reemplaza por lo que OSM diga
 * hoy. Y cuando los dos reclaman el MISMO id, manda la comunidad.
 *
 * Esa última regla no es un detalle: el caso es alguien que corrige un hospital
 * de OSM y le deja su id estable, que es justo lo que se quiere permitir. Antes
 * el rasgo salía dos veces, y validarCapa rechaza la colección entera por un id
 * repetido -- la capa dejaba de cargar y el CI se caía por haber aceptado una
 * corrección. Si la comunidad se tomó el trabajo de arreglarlo, su versión es
 * la buena; volver a pisarla con OSM tiraría la corrección a la basura.
 */
export function fusionar (existentes, nuevos) {
  const propios = existentes.filter(f => f.properties?.origen === 'comunidad')
  const tomados = new Set(propios.map(f => f.id))
  const deOsm = nuevos.filter(f => !tomados.has(f.id))
  return [...propios, ...deOsm].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * ¿Esta siembra se ve como un fallo río arriba disfrazado de "no hay nada"?
 *
 * El guardia de overpass.mjs es `if (!json.elements) throw`, y `![]` es false:
 * una respuesta con `elements: []` -- consulta rota, timeout parcial de
 * Overpass -- pasa sin error. Sin este freno el sembrador reescribía el archivo
 * sin un solo hospital de OSM y lo anunciaba en el log DESPUÉS de haberlo
 * hecho. Se recuperaba con git, si alguien lo notaba antes de comitear.
 */
export function siembraSospechosa (existentes, nuevos) {
  return nuevos.length === 0 && existentes.some(f => f.properties?.origen === 'osm')
}

async function main () {
  const id = process.argv[2]
  const registro = REGISTRO[id]
  if (!registro) {
    console.error(`capa '${id}' desconocida. Las que hay: ${Object.keys(REGISTRO).join(', ')}`)
    process.exit(1)
  }

  const json = await overpass(registro.consulta, `capa-${id}`)
  const nuevos = []
  let descartados = 0
  for (const el of json.elements) {
    const r = registro.traducir(el)
    if (r) nuevos.push(r)
    else descartados++
  }

  const ruta = `${DIR}/${id}.geojson`
  const existentes = existsSync(ruta) ? JSON.parse(await readFile(ruta, 'utf8')).features : []

  if (siembraSospechosa(existentes, nuevos)) {
    console.error(`Overpass no devolvió ningún rasgo y ${ruta} sí tiene datos de OSM.`)
    console.error('Escribir ahora los borraría. No se toca el archivo.')
    console.error(`Si la consulta cambió a propósito, borra .cache/capa-${id}.json y vuelve a correr.`)
    process.exit(1)
  }

  const features = fusionar(existentes, nuevos)

  await mkdir(DIR, { recursive: true })
  // Este script no llama a validarCapa (spec §5.9): es TypeScript y este
  // archivo es un .mjs suelto sin transpilar. El portero de verdad corre
  // después, sobre el archivo ya escrito: src/data/capas.test.ts valida el
  // archivo de CADA capa del catálogo, no solo el de hospitales.
  const texto = JSON.stringify({
    type: 'FeatureCollection',
    capa: id,
    generado: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    fuente: 'OSM vía Overpass',
    features,
  }, null, 2) + '\n'
  // Al temporal y renombrar, igual que overpass.mjs: writeFile trunca el
  // destino antes de escribir, así que un fallo a media escritura dejaba
  // corrupto el único archivo donde viven los aportes de la comunidad -- y la
  // corrida siguiente ni podía leerlo para recuperarlos.
  const tmp = `${ruta}.tmp`
  await writeFile(tmp, texto)
  await rename(tmp, ruta)

  // Contado sobre la salida y no restando `nuevos`: desde que una colisión de
  // id descarta el rasgo de OSM, la resta ya no cuadra.
  const comunidad = features.filter(f => f.properties?.origen === 'comunidad').length
  const pisados = nuevos.length - (features.length - comunidad)
  console.log(`${ruta}: ${features.length} rasgos (${features.length - comunidad} de OSM, ${comunidad} de la comunidad)`)
  console.log(`  descartados por no tener etiqueta de la capa: ${descartados}`)
  if (pisados > 0) console.log(`  de OSM ignorados por tener una corrección de la comunidad: ${pisados}`)
}

// Mismo idioma que datos-bajar.mjs y build-buildings.mjs. pathToFileURL importa: en Windows
// import.meta.url trae file:///D:/... con tres barras, y concatenar 'file://'
// a mano da dos, asi que la comparacion seria false siempre y el script no
// ejecutaria nada. Comprobado en esta maquina.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
