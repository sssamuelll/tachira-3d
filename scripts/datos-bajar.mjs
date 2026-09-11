import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { ASSET } from './datos-empaquetar.mjs'

/**
 * Baja los datos base del último Release y los desempaca en public/.
 * Es el segundo de los tres comandos que abren el README:
 *   npm ci  ·  npm run datos:bajar  ·  npm run dev
 *
 * Con TACHIRA_DATOS_TAG se fija una etiqueta concreta, que es lo que hay que
 * hacer para reproducir un estado viejo del mapa.
 *
 * ponytail: la API pública sin token admite 60 peticiones por hora por IP.
 * Acá se gasta una. Si CI llegara a toparse, se le pasa el GITHUB_TOKEN que
 * la Action ya tiene.
 */

const REPO = 'sssamuelll/tachira-3d'
const CACHE = '.cache/datos'
const ETIQUETA_DATOS = /^datos-\d{4}-\d{2}-\d{2}$/

/** El Release del que bajar: el pedido a mano, o el de datos más reciente.
 *  Las etiquetas son datos-AAAA-MM-DD, así que ordenan bien como texto. */
export function elegirRelease (releases, pedida) {
  if (pedida) {
    const encontrado = releases.find(r => r.tag_name === pedida)
    if (!encontrado) throw new Error(`no hay ningún Release con la etiqueta ${pedida}`)
    return encontrado
  }
  const datos = releases.filter(r => ETIQUETA_DATOS.test(r.tag_name))
  if (!datos.length) throw new Error(`${REPO} no tiene ningún Release con etiqueta datos-AAAA-MM-DD`)
  return datos.sort((a, b) => b.tag_name.localeCompare(a.tag_name))[0]
}

/** El asset del paquete dentro de un Release. */
export function assetDe (release) {
  const asset = (release.assets ?? []).find(a => a.name === ASSET)
  if (!asset) throw new Error(`el Release ${release.tag_name} no trae ${ASSET}`)
  return asset
}

async function main () {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`la API de GitHub contestó HTTP ${res.status}`)

  const release = elegirRelease(await res.json(), process.env.TACHIRA_DATOS_TAG)
  const asset = assetDe(release)
  const local = `${CACHE}/${release.tag_name}.tar.gz`

  if (existsSync(local)) {
    console.log(`${release.tag_name} ya estaba en ${CACHE}`)
  } else {
    console.log(`bajando ${release.tag_name}  (${(asset.size / 1e6).toFixed(1)} MB)`)
    await mkdir(CACHE, { recursive: true })
    const paquete = await fetch(asset.browser_download_url)
    if (!paquete.ok) throw new Error(`el asset contestó HTTP ${paquete.status}`)
    await writeFile(local, Buffer.from(await paquete.arrayBuffer()))
  }

  await mkdir('public', { recursive: true })
  execFileSync('tar', ['-xzf', local, '-C', 'public'], { stdio: 'inherit' })
  console.log(`\ndesempacado. public/data/VERSION:`)
  console.log(readFileSync('public/data/VERSION', 'utf8'))
}

// Mismo idioma que build-buildings.mjs:171. pathToFileURL importa: en Windows
// import.meta.url trae file:///D:/... con tres barras, y concatenar 'file://'
// a mano da dos, asi que la comparacion seria false siempre y el script no
// ejecutaria nada. Comprobado en esta maquina.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
