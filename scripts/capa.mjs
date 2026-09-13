#!/usr/bin/env node
/**
 * npm run capa -- <id>
 *
 * Siembra o resiembra el GeoJSON de una capa desde OSM. Lo que la comunidad
 * haya añadido a mano se conserva; lo que vino de OSM se reemplaza por lo que
 * OSM diga hoy.
 *
 * El archivo se escribe ORDENADO POR ID y con sangría de dos espacios. No es
 * estética: es lo que hace que el diff de un pull request se pueda leer. Un
 * GeoJSON en una sola línea convierte "moví un hospital dos metros" en una
 * línea de 400 KB cambiada.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { overpass } from './lib/overpass.mjs'
import { REGISTRO } from './lib/capas-osm.mjs'

const DIR = 'public/data/capas'

export function fusionar (existentes, nuevos) {
  const propios = existentes.filter(f => f.properties?.origen === 'comunidad')
  return [...propios, ...nuevos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
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
  const features = fusionar(existentes, nuevos)

  await mkdir(DIR, { recursive: true })
  // Este script no llama a validarCapa (spec §5.9): es TypeScript y este
  // archivo es un .mjs suelto sin transpilar. El portero de verdad corre
  // después, sobre el archivo ya escrito: src/data/capas.test.ts ("el archivo
  // que se versiona pasa el validador").
  await writeFile(ruta, JSON.stringify({
    type: 'FeatureCollection',
    capa: id,
    generado: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    fuente: 'OSM vía Overpass',
    features,
  }, null, 2) + '\n')

  const comunidad = features.length - nuevos.length
  console.log(`${ruta}: ${features.length} rasgos (${nuevos.length} de OSM, ${comunidad} de la comunidad)`)
  console.log(`  descartados por no tener etiqueta de la capa: ${descartados}`)
}

// Mismo idioma que datos-bajar.mjs y build-buildings.mjs. pathToFileURL importa: en Windows
// import.meta.url trae file:///D:/... con tres barras, y concatenar 'file://'
// a mano da dos, asi que la comparacion seria false siempre y el script no
// ejecutaria nada. Comprobado en esta maquina.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
