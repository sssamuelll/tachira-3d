import { readFile, writeFile, mkdir } from 'node:fs/promises'
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
  await writeFile(path, JSON.stringify(json))
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

export function relationsToPolygons (json) {
  return json.elements
    .filter(el => el.type === 'relation' && Array.isArray(el.members))
    .map(el => {
      const rings = el.members
        .filter(m => m.role === 'outer' && Array.isArray(m.geometry) && m.geometry.length >= 4)
        .map(m => m.geometry.map(g => [g.lon, g.lat]))
      return { osmId: el.id, name: el.tags?.name ?? `relación ${el.id}`, polygon: rings }
    })
    .filter(m => m.polygon.length > 0)
}
