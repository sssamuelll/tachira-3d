/**
 * Hipótesis de masa urbana, no levantamiento de alturas. Versión de calibración 2.
 * ENU: x hacia el este, z hacia el sur; distancias y áreas en metros y m².
 * La densidad mide lo cartografiado por OSM: una zona incompleta parece más rural.
 */
export const MODEL_VERSION = 'morfologia-tachira-v2'

const CELDA = 160
const RADIO_DENSIDAD = 260
const RADIO_VIA = 160
const PASO_CAMPO = 220
const ALTURA_PLANTA_OSM = 3
const ALTURA_PLANTA_ESTIMADA = 3.05

// [fuerza, radio]. La autopista tiene poco frente edificable: no equivale a avenida.
// Las conexiones reciben el peso de su jerarquía; nunca se suma por segmentación.
const VIAS = {
  motorway: [0.35, 100], motorway_link: [0.35, 100],
  trunk: [0.95, 160], trunk_link: [0.8, 120],
  primary: [1, 160], primary_link: [0.8, 120],
  secondary: [0.8, 140], secondary_link: [0.65, 110],
  tertiary: [0.6, 110], tertiary_link: [0.5, 90],
  unclassified: [0.28, 70], residential: [0.22, 60],
  living_street: [0.18, 50], pedestrian: [0.22, 50],
  service: [0.1, 40], track: [0.04, 30],
}

const limitar = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n))
const suave = n => { const t = limitar(n); return t * t * (3 - 2 * t) }
const rampa = (n, a, b) => suave((n - a) / (b - a))
const redondear = (n, decimales = 6) => Number(n.toFixed(decimales))
const celda = (x, z) => `${x},${z}`

function semilla(texto) {
  let hash = 2166136261
  for (let i = 0; i < texto.length; i++) {
    hash ^= texto.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  // Avalancha: los ids OSM consecutivos tampoco deben producir un gradiente.
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x7feb352d)
  hash ^= hash >>> 15
  hash = Math.imul(hash, 0x846ca68b)
  hash ^= hash >>> 16
  return (hash >>> 0) / 4294967295
}

/** Ruido de valor continuo, compartido por un vecindario de 220 m. */
function campoEspacial(x, z) {
  const px = x / PASO_CAMPO, pz = z / PASO_CAMPO
  const ix = Math.floor(px), iz = Math.floor(pz)
  const u = suave(px - ix), v = suave(pz - iz)
  const a = semilla(`barrio:${ix}:${iz}`), b = semilla(`barrio:${ix + 1}:${iz}`)
  const c = semilla(`barrio:${ix}:${iz + 1}`), d = semilla(`barrio:${ix + 1}:${iz + 1}`)
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

function añadir(indice, x, z, elemento) {
  const clave = celda(x, z)
  const bucket = indice.get(clave)
  if (bucket) bucket.push(elemento)
  else indice.set(clave, [elemento])
}

function distanciaSegmento(x, z, s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az
  const d2 = dx * dx + dz * dz
  const t = d2 ? limitar(((x - s.ax) * dx + (z - s.az) * dz) / d2) : 0
  return Math.hypot(x - (s.ax + t * dx), z - (s.az + t * dz))
}

/**
 * @param {Array<{id:string,x:number,z:number,area:number,elongacion:number,compacidad:number,tags:object}>} huellas
 * @param {Iterable<{ax:number,az:number,bx:number,bz:number,highway:string}>} roads
 * @returns {Map<string,{densidad:number,vecinosEfectivos:number,via:string|null,distanciaVia:number|null,intensidad:number,contexto:number}>}
 *
 * Hashes espaciales de 160 m evitan comparar cada huella con toda la red.
 * El orden canónico de ids fija también el orden de sumas de coma flotante.
 */
export function crearContexto(huellas, roads) {
  const ordenadas = [...huellas].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)
  const edificios = new Map(), vias = new Map()
  for (const h of ordenadas) añadir(edificios, Math.floor(h.x / CELDA), Math.floor(h.z / CELDA), h)
  for (const s of roads) {
    if (!VIAS[s.highway]) continue
    const x0 = Math.floor(Math.min(s.ax, s.bx) / CELDA), x1 = Math.floor(Math.max(s.ax, s.bx) / CELDA)
    const z0 = Math.floor(Math.min(s.az, s.bz) / CELDA), z1 = Math.floor(Math.max(s.az, s.bz) / CELDA)
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) añadir(vias, x, z, s)
    }
  }

  const resultados = new Map()
  for (const h of ordenadas) {
    let vecinos = 0
    for (let ix = Math.floor((h.x - RADIO_DENSIDAD) / CELDA); ix <= Math.floor((h.x + RADIO_DENSIDAD) / CELDA); ix++) {
      for (let iz = Math.floor((h.z - RADIO_DENSIDAD) / CELDA); iz <= Math.floor((h.z + RADIO_DENSIDAD) / CELDA); iz++) {
        for (const v of edificios.get(celda(ix, iz)) ?? []) {
          const d2 = ((h.x - v.x) ** 2 + (h.z - v.z) ** 2) / RADIO_DENSIDAD ** 2
          if (d2 < 1) vecinos += (1 - d2) ** 2
        }
      }
    }
    // Kernel biweight: peso 1 en el centro y 0 suave a 260 m.
    // <=4 vecinos efectivos: disperso. Respuesta exponencial, sin techo duro:
    // 180 efectivos (~2.540 huellas/km² bajo este kernel) fijan la escala urbana.
    // La muestra real tiene p50=123, p90=323 y máximo506: truncar en120 igualaba
    // media ciudad. Ahora esos tejidos siguen separados (.48, .83 y .94).
    const densidad = -Math.expm1(-Math.max(0, vecinos - 4) / 180)
    let intensidad = 0, via = null, distanciaVia = null
    const visitadas = new Set()
    for (let ix = Math.floor((h.x - RADIO_VIA) / CELDA); ix <= Math.floor((h.x + RADIO_VIA) / CELDA); ix++) {
      for (let iz = Math.floor((h.z - RADIO_VIA) / CELDA); iz <= Math.floor((h.z + RADIO_VIA) / CELDA); iz++) {
        for (const s of vias.get(celda(ix, iz)) ?? []) {
          if (visitadas.has(s)) continue
          visitadas.add(s)
          const [peso, radio] = VIAS[s.highway]
          const distancia = distanciaSegmento(h.x, h.z, s)
          const fuerza = peso * Math.max(0, 1 - distancia / radio) ** 2
          // Max, no suma: subdividir una carretera no debe aumentar la altura.
          if (fuerza > intensidad || (fuerza > 0 && fuerza === intensidad &&
              (distancia < distanciaVia || (distancia === distanciaVia && s.highway < via)))) {
            intensidad = fuerza
            distanciaVia = distancia
            via = s.highway
          }
        }
      }
    }
    resultados.set(h.id, {
      densidad: redondear(densidad), via,
      vecinosEfectivos: redondear(vecinos, 2),
      distanciaVia: distanciaVia === null ? null : redondear(distanciaVia, 2),
      intensidad: redondear(intensidad),
      contexto: redondear(limitar(0.58 * densidad + 0.24 * intensidad + 0.18 * campoEspacial(h.x, h.z))),
    })
  }
  return resultados
}

function numeroPositivo(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) && valor > 0 ? valor : null
  if (typeof valor !== 'string' || !/^\s*\d+(?:[.,]\d+)?\s*$/.test(valor)) return null
  const n = Number(valor.trim().replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

function alturaOsm(valor) {
  if (typeof valor === 'number') return numeroPositivo(valor)
  if (typeof valor !== 'string') return null
  const texto = valor.trim().toLowerCase()
  const metrica = texto.match(/^(\d+(?:[.,]\d+)?)\s*(?:m|meters?|metres?)?$/)
  if (metrica) return numeroPositivo(metrica[1])
  const pies = texto.match(/^(\d+(?:[.,]\d+)?)\s*(?:ft|feet|foot|')\s*(?:(\d+(?:[.,]\d+)?)\s*(?:in|inches|"))?$/)
  if (!pies) return null
  const ft = Number(pies[1].replace(',', '.'))
  const pulgadas = pies[2] ? Number(pies[2].replace(',', '.')) : 0
  // No reinterpretar una notación mixta mal formada (por ejemplo, 5' 99").
  if (!Number.isFinite(ft) || !Number.isFinite(pulgadas) || pulgadas >= 12) return null
  return numeroPositivo(ft * 0.3048 + pulgadas * 0.0254)
}

/** Devuelve tanto la altura final como su procedencia y las señales revisables. */
export function estimarAltura(huella, señales) {
  const { area, elongacion, compacidad } = huella
  const contextoLocal = señales ?? {
    densidad: 0, vecinosEfectivos: 0, intensidad: 0, contexto: 0.18 * campoEspacial(huella.x, huella.z),
    via: null, distanciaVia: null,
  }
  const evidencia = { area, elongacion, compacidad, ...contextoLocal, perfil: 'osm' }
  const tags = huella.tags ?? {}
  const real = alturaOsm(tags.height)
  const nivelesOsm = numeroPositivo(tags['building:levels'])
  if (real !== null) {
    return { metros: real, fuente: 'osm-height', niveles: nivelesOsm ?? Math.max(1, Math.round(real / ALTURA_PLANTA_ESTIMADA)), evidencia }
  }
  if (nivelesOsm !== null) {
    // OSM levels informa plantas, no metros: conversión explícita de 3 m/planta.
    return { metros: nivelesOsm * ALTURA_PLANTA_OSM, fuente: 'osm-levels', niveles: nivelesOsm, evidencia }
  }

  const tipo = String(tags.building ?? 'yes').toLowerCase()
  const industrial = ['industrial', 'warehouse', 'hangar', 'barn', 'greenhouse'].includes(tipo)
  const domestico = ['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'hut'].includes(tipo)
  // Área + compacidad + elongación: transición continua, sin un salto de casa
  // a torre porque una huella mida 1 m² más que un umbral.
  const capacidadArea = rampa(Math.log(Math.max(1, area)), Math.log(180), Math.log(900))
  const compacta = rampa(compacidad, 0.25, 0.72) * (1 - rampa(elongacion, 1.8, 4))
  const capacidad = capacidadArea * compacta * (domestico ? 0.25 : 1)
  const nave = industrial ? 1 : rampa(area, 300, 1100) * rampa(elongacion, 2, 4)
  const contexto = limitar(contextoLocal.contexto)
  const variacion = semilla(`altura:${huella.id}`) * 2 - 1
  // La banda doméstica abarca 1–3 plantas; el área compacta puede sumar hasta
  // 4.4 adicionales solo con contexto urbano. Elevar toda la banda con el área
  // inventaría torres rurales. El prior espacial pesa18%, las señales observables82%.
  // Smoothstep(t)=t²(3−2t) diferencia periferia y tejido denso sin una banda
  // central tan amplia que vuelva a fijar casi todas las viviendas en2 plantas.
  const plantasContinuas = 1 + 2.35 * suave(contexto) + 4.4 * capacidad * contexto ** 1.65
  // Id: ±0.14 plantas al escoger la banda y ±0.18 m de remate. La variación
  // principal viene del vecindario, no de la lotería de cada id.
  const plantas = Math.max(1, Math.round(plantasContinuas + variacion * 0.14))
  const alturaUrbana = plantas * ALTURA_PLANTA_ESTIMADA + 0.55 + variacion * 0.18
  const alturaNave = 5 + 2.5 * contexto + variacion * 0.25
  const metros = redondear(alturaUrbana * (1 - nave) + alturaNave * nave, 2)
  evidencia.perfil = nave >= 0.6 ? 'galpon' : capacidad >= 0.25 ? 'mixto' : 'casa'
  return {
    metros, fuente: 'estimada',
    niveles: Math.max(1, Math.round(plantas * (1 - nave) + nave)),
    evidencia,
  }
}
