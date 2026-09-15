import { mkdir, writeFile, rename } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { ASSET, CONTENIDO } from './datos-empaquetar.mjs'

/**
 * Baja los datos base del último Release y los desempaca en public/.
 * Es el segundo de los tres comandos que abren el README:
 *   npm ci  ·  npm run datos:bajar  ·  npm run dev
 *
 * ponytail: los datos van por Release y no dentro del sitio porque GitHub
 * Pages sirve sitios de hasta 1 GB y unos 100 GB de tráfico al mes, y el
 * paquete de datos se comería los dos presupuestos.
 *
 * Con TACHIRA_DATOS_TAG se fija una etiqueta concreta, que es lo que hay que
 * hacer para reproducir un estado viejo del mapa.
 *
 * La Action le pasa su GITHUB_TOKEN: sin él son 60 peticiones por hora
 * compartidas entre todos los corredores de GitHub, y sobre un repo privado
 * la API contesta 404. En local no hace falta mientras el repo sea público.
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

/** La cabecera de autenticación, si hay token. Sin él la API pública da 60
 *  peticiones por hora COMPARTIDAS entre todos los corredores de GitHub, y
 *  sobre un repo privado contesta 404 en vez de pedir credenciales. Con token
 *  son 5.000 por hora y ve el repo. En local no suele haber, y está bien. */
export function autorizacion (entorno = process.env) {
  const token = entorno.GITHUB_TOKEN ?? entorno.GH_TOKEN
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Check the archive itself, not public/: a stale local file can mask an old Release. */
export function faltantesDelPaquete (rutas, contenido = CONTENIDO) {
  const entradas = new Set(rutas.map(r => r.replace(/^\.\//, '').replace(/\/$/, '')))
  return contenido.filter(rel =>
    !entradas.has(rel) && ![...entradas].some(r => r.startsWith(`${rel}/`)))
}

/** Si el paquete que ya está en la caché sirve. Un archivo del tamaño
 *  equivocado es una descarga a medias, no un paquete: se vuelve a bajar en
 *  vez de dar por bueno que el archivo exista. */
export function sirveLoCacheado (existe, tamañoLocal, tamañoEsperado) {
  return existe && tamañoLocal === tamañoEsperado
}

async function main () {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
    headers: { Accept: 'application/vnd.github+json', ...autorizacion() },
  })
  if (res.status === 404) {
    throw new Error('la API de GitHub contestó HTTP 404. Si el repo todavía es privado, necesitas exportar GITHUB_TOKEN con un token que lo pueda leer.')
  }
  if (!res.ok) throw new Error(`la API de GitHub contestó HTTP ${res.status}`)

  const release = elegirRelease(await res.json(), process.env.TACHIRA_DATOS_TAG)
  const asset = assetDe(release)
  const local = `${CACHE}/${release.tag_name}.tar.gz`

  if (sirveLoCacheado(existsSync(local), existsSync(local) ? statSync(local).size : 0, asset.size)) {
    console.log(`${release.tag_name} ya estaba en ${CACHE}`)
  } else {
    console.log(`bajando ${release.tag_name}  (${(asset.size / 1e6).toFixed(1)} MB)`)
    await mkdir(CACHE, { recursive: true })
    // Por la URL de la API y no por browser_download_url: es el único camino
    // que sirve para los dos casos. En un repo público funciona sin
    // autenticar (comprobado), y en uno privado es el que acepta el token.
    const paquete = await fetch(asset.url, {
      headers: { Accept: 'application/octet-stream', ...autorizacion() },
    })
    if (!paquete.ok) throw new Error(`el asset contestó HTTP ${paquete.status}`)
    // ponytail: el paquete entero en memoria de una vez. Techo conocido: un
    // asset de Release admite 2 GB y hoy son 56 MB. Si se acerca, streaming a
    // disco en vez de arrayBuffer().
    const bytes = Buffer.from(await paquete.arrayBuffer())
    if (bytes.length !== asset.size) {
      throw new Error(`descarga incompleta: ${bytes.length} bytes de ${asset.size}. Vuelve a correr el comando.`)
    }
    // A un temporal y después rename: una interrupción a media escritura deja
    // el .parcial, no un paquete truncado que la próxima corrida daría por
    // bueno solo porque el archivo existe.
    await writeFile(`${local}.parcial`, bytes)
    await rename(`${local}.parcial`, local)
  }

  const rutas = execFileSync('tar', ['-tzf', local], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
  const faltantes = faltantesDelPaquete(rutas)
  if (faltantes.length) {
    throw new Error(`el Release ${release.tag_name} no trae los datos que exige este código: ${faltantes.join(', ')}`)
  }

  await mkdir('public', { recursive: true })
  try {
    execFileSync('tar', ['-xzf', local, '-C', 'public'], { stdio: 'inherit' })
  } catch (e) {
    throw new Error(`no se pudo desempacar ${local}.\nSi el paquete quedó a medias, bórralo y vuelve a correr el comando:\n  rm -rf ${CACHE}\n${e.message}`)
  }
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
