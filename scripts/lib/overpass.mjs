import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const ENDPOINT = 'https://overpass-api.de/api/interpreter'
const CACHE = '.cache'

export const QUERY_MUNICIPIOS = `[out:json][timeout:600];
area["ISO3166-2"="VE-S"][admin_level=4]->.a;
relation(area.a)["boundary"="administrative"]["admin_level"="6"];
out geom;`

export const QUERY_VIAS = `[out:json][timeout:900];
area["ISO3166-2"="VE-S"][admin_level=4]->.a;
way(area.a)["highway"];
out geom;`

export async function overpass (query, cacheKey) {
  const path = `${CACHE}/${cacheKey}.json`
  if (existsSync(path)) {
    console.log(`  cache: ${path}`)
    return JSON.parse(await readFile(path, 'utf8'))
  }
  console.log(`  consultando Overpass (${cacheKey})…`)
  const res = await fetch(ENDPOINT, { method: 'POST', body: query })
  if (!res.ok) throw new Error(`Overpass devolvió ${res.status} para ${cacheKey}`)
  const json = await res.json()
  if (!json.elements) throw new Error(`Overpass no devolvió elements para ${cacheKey}`)
  await mkdir(CACHE, { recursive: true })
  // escritura atómica: la consulta de vías tarda minutos: si el proceso muere a
  // mitad de writeFile(path), la corrida siguiente lee un JSON truncado. Escribir
  // al temporal y renombrar deja `path` siempre completo o intacto.
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(json))
  await rename(tmp, path)
  return json
}

export function waysToLines (json) {
  return json.elements
    .filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2)
    .map(el => ({
      osmId: el.id,
      tags: el.tags ?? {},
      coords: el.geometry.map(g => [g.lon, g.lat]),
    }))
}

const RING_EPS = 1e-7 // grados, ~1 cm — tolerancia para "mismo punto" al empalmar fragmentos

function samePoint (a, b) {
  return Math.abs(a[0] - b[0]) <= RING_EPS && Math.abs(a[1] - b[1]) <= RING_EPS
}

// Cómo conecta `frag` con los extremos de `chain`, o null si no conecta.
function connectionMode (chain, frag) {
  const cs = chain[0], ce = chain[chain.length - 1]
  const fs = frag[0], fe = frag[frag.length - 1]
  if (samePoint(ce, fs)) return 'append'
  if (samePoint(ce, fe)) return 'appendReversed'
  if (samePoint(cs, fe)) return 'prepend'
  if (samePoint(cs, fs)) return 'prependReversed'
  return null
}

function mergeFragment (chain, frag, mode) {
  switch (mode) {
    case 'append': return chain.concat(frag.slice(1))
    case 'appendReversed': return chain.concat(frag.slice(0, -1).reverse())
    case 'prepend': return frag.slice(0, -1).concat(chain)
    case 'prependReversed': return frag.slice(1).reverse().concat(chain)
  }
}

// Los bordes administrativos de OSM vienen partidos en varios `way` (se
// comparten entre municipios vecinos): en el Táchira real, 29/29 relaciones
// tienen 2+ miembros outer, hasta 68 en una sola. assembleRings encadena esos
// fragmentos por extremos compartidos —invirtiendo el que haga falta— hasta
// cerrar cada anillo; puede salir más de uno. Un fragmento que no logra cerrar
// se cuenta como huérfano en vez de cerrarse en silencio con una cuerda arbitraria.
export function assembleRings (members, role) {
  const fragments = members
    .filter(m => m.role === role && Array.isArray(m.geometry) && m.geometry.length >= 2)
    .map(m => m.geometry.map(g => [g.lon, g.lat]))

  const rings = []
  let orphanFragments = 0

  while (fragments.length > 0) {
    let chain = fragments.shift()
    let used = 1
    while (!samePoint(chain[0], chain[chain.length - 1])) {
      const i = fragments.findIndex(f => connectionMode(chain, f) !== null)
      if (i === -1) break // no hay nada más que conecte: se queda abierto
      const [frag] = fragments.splice(i, 1)
      chain = mergeFragment(chain, frag, connectionMode(chain, frag))
      used++
    }
    if (samePoint(chain[0], chain[chain.length - 1]) && chain.length >= 4) {
      rings.push(chain)
    } else {
      orphanFragments += used // cuenta los fragmentos originales atrapados en la cadena sin cerrar
    }
  }

  return { rings, orphanFragments }
}

export function relationsToPolygons (json) {
  return json.elements
    .filter(el => el.type === 'relation' && Array.isArray(el.members))
    .map(el => {
      const { rings, orphanFragments } = assembleRings(el.members, 'outer')
      return {
        osmId: el.id,
        name: el.tags?.name ?? `relación ${el.id}`,
        // sin role=inner en el dato real: un polígono por anillo, sin huecos.
        // La forma [anillo] ya admite huecos si algún día aparecen — no se
        // implementa el emparejamiento porque no hay caso real que lo pida.
        polygons: rings.map(ring => [ring]),
        orphanFragments,
      }
    })
    .filter(m => m.polygons.length > 0 || m.orphanFragments > 0)
}
