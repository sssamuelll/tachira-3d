import { postDe, alturaEnPosts } from './drape.mjs'
import { normalizeLanes, normalizeOneway } from './road-meta.mjs'

/**
 * Tallado de las vías en el DEM ("carving").
 *
 * El problema: una carretera real corta el cerro y rellena la vaguada. La
 * nuestra es una cinta apoyada sobre un DEM de ~38 m por post que no sabe que
 * la vía existe, así que hereda cada serrucho de la malla: en ladera la
 * calzada sale inclinada de lado a lado, y en la ciudad las calles flotan o se
 * hunden de una celda a la siguiente.
 *
 * Lo que hace este paso, ANTES de apoyar las vías y ANTES de la pirámide:
 * modificar `dem.data` en sitio para que el relieve sepa de las carreteras.
 * Para cada vía se calcula un PERFIL (la altura del DEM a lo largo del eje,
 * suavizada y con la pendiente acotada a lo que su clase permite), y se
 * rasteriza un CORREDOR alrededor del eje: dentro, la altura del DEM pasa a
 * ser la del perfil; en una banda de transición hacia afuera se funde de
 * vuelta al DEM original; más allá, intacto. Como el perfil no depende de la
 * distancia al eje, el corredor sale nivelado de lado a lado — sin peralte:
 * el bombeo lo dibuja el shader.
 *
 * Los perfiles se calculan TODOS contra el DEM original (la mutación va a
 * unos acumuladores aparte y se aplica al final), así que el resultado no
 * depende del orden de las vías.
 */

// Jerarquía: réplica mínima de src/scene/roadStyle.ts. No se importa porque
// es TypeScript y el pipeline corre en node a pelo; el test de este módulo
// comprueba que las dos tablas dicen lo mismo.
const NIVEL_DE = {
  motorway: 6, motorway_link: 6, trunk: 6, trunk_link: 6,
  primary: 5, primary_link: 5,
  secondary: 4, secondary_link: 4,
  tertiary: 3, tertiary_link: 3,
  residential: 2, unclassified: 2, living_street: 2, road: 2,
  service: 1, track: 1, raceway: 1, construction: 1, proposed: 1,
  rest_area: 1, busway: 1, escape: 1,
  footway: 0, steps: 0, path: 0, bridleway: 0, cycleway: 0,
  pedestrian: 0, platform: 0, corridor: 0,
}
const NIVEL_POR_DEFECTO = 2
export const nivelDe = highway => NIVEL_DE[highway] ?? NIVEL_POR_DEFECTO

// Ancho de referencia de cada nivel, cota de anchoCalzada (roadStyle.ts).
const METROS_NIVEL = [2.5, 5, 7, 9, 12, 16, 24]
const ANCHO_CARRIL = 3.4
const CANALES_POR_NIVEL = [1, 1, 2, 2, 2, 2, 4]
const CANALES_SENTIDO_UNICO = [1, 1, 1, 2, 2, 2, 2]
const PEATONALES = new Set([
  'footway', 'steps', 'path', 'bridleway', 'cycleway', 'pedestrian', 'platform', 'corridor',
])

/** Ancho de calzada en metros a partir de los tags crudos de OSM. Misma
 *  cuenta que `anchoCalzada` de src/scene/calzada.ts, con test de
 *  equivalencia sobre una matriz de clases, `lanes` y `oneway`. */
export function anchoCalzadaTags (tags) {
  const highway = tags.highway
  const lanes = normalizeLanes(tags.lanes)
  const oneway = normalizeOneway(tags.oneway)
  const n = nivelDe(highway)
  const unico = typeof oneway === 'boolean'
    ? oneway
    : highway === 'motorway' || highway === 'motorway_link'
  const canales = lanes ?? (PEATONALES.has(highway)
    ? 1
    : (unico ? CANALES_SENTIDO_UNICO[n] : CANALES_POR_NIVEL[n]))
  const metros = PEATONALES.has(highway) && lanes === null ? 2.5 : canales * ANCHO_CARRIL
  return Math.min(metros, METROS_NIVEL[n])
}

/**
 * Un puente no aplana el río y un túnel no abre una zanja en la cima: las
 * vías con `bridge` o `tunnel` en OSM NO tallan el terreno. Después del
 * tallado, structures.mjs da rasante propia a los puentes encadenados y el
 * empaquetado omite la geometría visible de los túneles. Las piezas 3D y
 * sus pilas se construyen aparte; la rasante no se ajusta a esas piezas.
 * Un `bridge=no` explícito sí talla: es un dato que dice que ahí no hay puente.
 */
export const tallaTerreno = tags =>
  (!tags.bridge || tags.bridge === 'no') && (!tags.tunnel || tags.tunnel === 'no')

// --- constantes calibrables -------------------------------------------------

/** Hombrillo a cada lado de la calzada, en metros. Lo que un terraplén real
 *  lleva de plataforma más allá de la línea de borde. */
export const HOMBRILLO_M = 1.5

/** Banda de transición hacia afuera del corredor, por nivel: cuánto tarda la
 *  altura en volver al DEM original. Es el talud del corte o del relleno; una
 *  troncal mueve más tierra que una calle. */
export const TRANSICION_M = [0, 10, 12, 15, 18, 22, 25]

/**
 * Piso del corredor y de la banda, en POSTS de la rejilla (~38 m cada uno).
 *
 * Una calzada real mide menos que una celda del DEM, y ahí está la trampa: si
 * el corredor pleno no cubre los posts que rodean al eje, esos posts se
 * quedan a medio camino entre la plataforma y el terreno, y la mezcla cambia
 * de un post al siguiente según por dónde cruce la vía la rejilla. El
 * resultado NO es una vía menos tallada: es una vía más serruchada que antes.
 * Medido en la primera versión, con el corredor solo del ancho de la calzada:
 * la pendiente p99 de la red estructurante subió de 35,5 % a 45,2 %, y los
 * tramos pasaron de 835.052 a 911.544 porque `apoyar` tuvo que bisecar más.
 *
 * Con 0,75 posts (~28 m) los vértices del triángulo que pisa el eje caen
 * dentro del corredor pleno o al principio de la banda, y lo que se dibuja a
 * lo largo del eje ES el perfil. Un DEM de 38 m no puede representar una
 * plataforma más angosta que su propia celda; pedírselo es pedirle ruido.
 */
export const MIN_POSTS_CORREDOR = 0.75
export const MIN_POSTS_BANDA = 0.75

/** Pendiente longitudinal máxima del perfil, por nivel. Una troncal
 *  venezolana no pasa del 8 %, una calle aguanta el 12 y una trocha el 20.
 *  El nivel 0 (peatonal) no talla, así que su valor no se usa. */
export const PENDIENTE_MAX = [0, 0.20, 0.12, 0.12, 0.10, 0.08, 0.08]

/** Ventana de la media móvil a lo largo de la vía, en metros. 150 m sobre un
 *  DEM de 38 m son unos cuatro posts a cada lado: mata el serrucho de la
 *  malla sin borrar la rasante real de una carretera de montaña. */
export const VENTANA_M = 150

/** Cuánto tira cada nivel cuando dos corredores se solapan. Con 2^nivel una
 *  troncal pesa 16 veces lo que una calle: en el cruce manda ella, pero la
 *  mezcla es continua, así que no aparece un escalón en el borde del
 *  corredor de la que perdió. Dos vías del mismo nivel dan la media exacta. */
export const PESO_NIVEL = [1, 2, 4, 8, 16, 32, 64]

// Radio de la Tierra de Web Mercator. La proyección es conforme: a una
// latitud dada un post mide lo mismo en las dos direcciones, y por eso se
// puede rasterizar el corredor en espacio de posts con un solo factor.
const R_MERCATOR = 6378137

/** Metros de terreno que mide un post de la rejilla a esa latitud. */
export const metrosPorPost = (lat, z) =>
  2 * Math.PI * R_MERCATOR * Math.cos(lat * Math.PI / 180) / (256 * 2 ** z)

/**
 * Perfil de la vía: alturas `h` a lo largo del eje (con las distancias
 * acumuladas `s`), suavizadas y con la pendiente acotada a `pend`.
 *
 * 1. Media móvil de ventana `ventanaM` CENTRADA y simétrica: cerca de los
 *    extremos la ventana se encoge en vez de truncarse. Así una rampa recta
 *    sale intacta (una ventana truncada la levantaría en la punta) y, sobre
 *    todo, el primer y el último punto conservan su altura del DEM: OSM parte
 *    las vías en los cruces, y dos trozos que comparten un nodo tienen que
 *    tallar la misma altura ahí.
 * 2. Acotado de pendiente sin iterar: `lo` es la mayor función que cumple el
 *    límite por debajo del suavizado, `hi` la menor por encima (dos pasadas
 *    cada una, ida y vuelta), y el perfil es su media — que cumple el límite
 *    por ser media de dos funciones que lo cumplen, y queda centrada en vez
 *    de pegada a un lado.
 */
export function perfil (h, s, pend, ventanaM = VENTANA_M) {
  const n = h.length
  const out = new Float64Array(n)
  if (n === 0) return out
  if (n === 1) { out[0] = h[0]; return out }

  const pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + h[i]

  const suave = new Float64Array(n)
  const largo = s[n - 1] - s[0]
  const EPS = 1e-9   // los bordes de la ventana caen sobre puntos exactos
  let a = 0, b = 0
  for (let i = 0; i < n; i++) {
    const r = Math.min(ventanaM / 2, s[i] - s[0], s[n - 1] - s[i], largo)
    while (s[a] < s[i] - r - EPS) a++
    while (b < n && s[b] <= s[i] + r + EPS) b++
    suave[i] = (pre[b] - pre[a]) / (b - a)
  }

  const lo = Float64Array.from(suave), hi = Float64Array.from(suave)
  for (let i = 1; i < n; i++) {
    const d = pend * (s[i] - s[i - 1])
    if (lo[i] > lo[i - 1] + d) lo[i] = lo[i - 1] + d
    if (hi[i] < hi[i - 1] - d) hi[i] = hi[i - 1] - d
  }
  for (let i = n - 2; i >= 0; i--) {
    const d = pend * (s[i + 1] - s[i])
    if (lo[i] > lo[i + 1] + d) lo[i] = lo[i + 1] + d
    if (hi[i] < hi[i + 1] - d) hi[i] = hi[i + 1] - d
  }
  for (let i = 0; i < n; i++) out[i] = (lo[i] + hi[i]) / 2
  return out
}

// smoothstep: 1 en el borde del corredor, 0 al final de la banda, con
// derivada nula en los dos extremos — sin arista en el empalme.
const desvanecer = x => 1 - x * x * (3 - 2 * x)

/**
 * Talla las vías en `dem.data` (lo modifica en sitio). Devuelve
 * `{ vias, posts }`: cuántas vías tallaron y cuántos posts se movieron.
 *
 * Las vías llegan ya partidas a 30 m (`subdividir`), que es el paso con el
 * que se muestrea el perfil.
 */
export function tallar (dem, lines, opts = {}) {
  const {
    hombrillo = HOMBRILLO_M,
    transicion = TRANSICION_M,
    pendienteMax = PENDIENTE_MAX,
    ventanaM = VENTANA_M,
    pesoNivel = PESO_NIVEL,
    minPostsCorredor = MIN_POSTS_CORREDOR,
    minPostsBanda = MIN_POSTS_BANDA,
  } = opts
  const W = dem.width, H = dem.height, N = W * H

  // Acumuladores sobre la rejilla entera. La mezcla final de un post es
  //     altura = lerp(DEM original, Σ w·k·h / Σ w·k, max w)
  // con w el peso del corredor de cada vía (1 dentro, cayendo a 0 al final de
  // la banda) y k el de su nivel. Es continua en todas partes: donde una vía
  // se apaga, su w se apaga con ella. De ahí que no haga falta decidir "quién
  // gana" con un if, que es lo que dejaría el escalón.
  const sumW = new Float32Array(N)
  const sumWH = new Float32Array(N)
  const maxW = new Float32Array(N)

  let vias = 0
  for (const l of lines) {
    const c = l.coords
    if (!c || c.length < 2 || !tallaTerreno(l.tags)) continue
    const n = nivelDe(l.tags.highway)
    // Una acera, una escalera o un camino de tierra no mueven tierra. Además
    // ahorra decidir qué pendiente le toca a un `highway=steps`.
    if (n === 0) continue

    const uv = c.map(([lon, lat]) => postDe(dem, lon, lat))
    const mpp = metrosPorPost(c[c.length >> 1][1], dem.tile.z)
    const s = new Float64Array(c.length)
    for (let i = 1; i < c.length; i++) {
      s[i] = s[i - 1] + Math.hypot(uv[i][0] - uv[i - 1][0], uv[i][1] - uv[i - 1][1]) * mpp
    }
    const h = uv.map(([u, v]) => alturaEnPosts(dem, u, v))
    const z = perfil(h, s, pendienteMax[n], ventanaM)

    const medio = Math.max(anchoCalzadaTags(l.tags) / 2 + hombrillo, minPostsCorredor * mpp)
    const banda = Math.max(transicion[n], minPostsBanda * mpp)
    const k = pesoNivel[n]
    const R = (medio + banda) / mpp      // radio de influencia, en posts

    for (let i = 1; i < c.length; i++) {
      const u0 = uv[i - 1][0], v0 = uv[i - 1][1]
      const du = uv[i][0] - u0, dv = uv[i][1] - v0
      const L2 = du * du + dv * dv
      const z0 = z[i - 1], dz = z[i] - z0
      // bbox local del tramo: rasterizar por tramo y no por vía es lo que
      // mantiene el paso en segundos con 664.531 tramos sobre 15,6 M de posts.
      const ca = Math.max(0, Math.floor(Math.min(u0, u0 + du) - R))
      const cb = Math.min(W - 1, Math.ceil(Math.max(u0, u0 + du) + R))
      const fa = Math.max(0, Math.floor(Math.min(v0, v0 + dv) - R))
      const fb = Math.min(H - 1, Math.ceil(Math.max(v0, v0 + dv) + R))
      for (let f = fa; f <= fb; f++) {
        const fila = f * W
        for (let cc = ca; cc <= cb; cc++) {
          let t = L2 > 0 ? ((cc - u0) * du + (f - v0) * dv) / L2 : 0
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const ex = cc - (u0 + t * du), ey = f - (v0 + t * dv)
          const d = Math.sqrt(ex * ex + ey * ey) * mpp
          if (d >= medio + banda) continue
          const w = d <= medio ? 1 : desvanecer((d - medio) / banda)
          const j = fila + cc
          const wk = w * k
          sumW[j] += wk
          sumWH[j] += wk * (z0 + t * dz)
          if (w > maxW[j]) maxW[j] = w
        }
      }
    }
    vias++
  }

  let posts = 0
  for (let j = 0; j < N; j++) {
    const w = maxW[j]
    if (w <= 0) continue
    dem.data[j] += (sumWH[j] / sumW[j] - dem.data[j]) * w
    posts++
  }
  return { vias, posts }
}
