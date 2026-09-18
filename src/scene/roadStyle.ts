import type { Way } from '../data/types'
import type { Juntas } from './juntas'
import { marcasPermitidas } from './calzada'

// Jerarquía de dibujo de la red vial. Todo lo que decide cuánto se ve una vía
// vive acá: en qué nivel cae cada clase de OSM, qué piso en píxeles tiene a
// lo lejos y cuánta presencia tiene. Roads.tsx solo aplica los números, y el
// ancho lo extruye el vertex shader (roadsShader.ts):
//
//     ancho = max(calzada de la vía en metros, pisoPx · metrosPorPixel)
//
// evaluado en cada vértice. A vista de estado (~105 m por píxel) hasta una
// troncal de 24 m mide 0,23 px: ahí manda el piso, y es el piso el que dibuja
// la jerarquía -- una troncal se ve gruesa junto a una calle porque su piso
// es mayor, no porque sea más ancha en el terreno. A escala de calle (~1 m
// por píxel) manda el ancho real, y de ahí para abajo la vía crece como crece
// una carretera al acercarse. No hay techo: el que había existía por las
// tapas de LineSegments2, que ahora salen del ancho de la vía por
// construcción. La transición entre los dos regímenes es continua, sin
// escalones ni niveles de zoom discretos como en un mapa de teselas.

export interface Desvanecido {
  /** Hasta este m/px el nivel va a plena presencia. */
  lleno: number
  /** Desde este m/px el nivel está apagado del todo. Entre los dos, lineal.
   *
   *  Apagar de verdad, y no hasta un mínimo perceptible, es lo que hace que el
   *  mapa se aclare al alejarse en vez de acumular rayado: a vista de estado
   *  las 26.712 vías dibujadas a 0,12 de opacidad sumaban una trama gris sobre
   *  el relieve, y las calles residenciales llegaban a 10 km con opacidad
   *  entera. Es el mismo criterio de cualquier mapa: a 10 km, autopistas y
   *  carreteras; las calles entran al acercarse.
   *
   *  Que llegue a 0 obliga al pase de ids a descartar por el mismo corte
   *  (mppCorte, y el discard de PickingPass.tsx). Lo que se dibuja se puede
   *  tocar, y lo que no se dibuja no: las dos mitades salen de acá. */
  tenue: number
}

export interface Nivel {
  clave: string
  /** Ancho de referencia del nivel, en metros: calzada completa (ambos
   *  sentidos donde los hay) de proyecto vial venezolano. Es la cota de
   *  anchoCalzada (calzada.ts); el ancho que se dibuja es el de cada vía. */
  metros: number
  /** Ancho mínimo en pantalla. Es la jerarquía visible a lo lejos. */
  pisoPx: number
  /** null = nunca se desvanece. La red estructurante tiene que seguir legible
   *  a cualquier acercamiento: es el esqueleto del mapa. */
  desvanece: Desvanecido | null
}

// El índice ES el orden de dibujo: 0 abajo, 6 arriba. Una troncal pasa por
// encima de una calle con su propio contorno, como en cualquier mapa vial.
// Las bandas de desvanecimiento están en m/px y no en metros de distancia
// porque es lo que de verdad decide si algo se lee: en una ventana más alta
// cabe más detalle a la misma altura. Con fov 45 sobre 900 px de alto la
// equivalencia es casi exactamente `m/px = distancia / 1.086`, así que la
// columna de la derecha es la lectura en distancia de cámara.
//
//   nivel        entero desde   apagado desde
//   peatonal        1,7 km          4,3 km
//   rustica         2,2 km          6,0 km
//   local           2,7 km          6,0 km  (calles: enteras a 1 km)
//   terciaria       4,3 km          9,8 km
//
// El piso de todas ellas no es libre: seleccionar una vía la encuadra a
// ~1,26 m/px (SPAN_MINIMO y FlyTo, Camera.tsx), y un nivel que se apagara
// antes de eso llevaría la cámara hasta una vía para no enseñar nada. De ahí
// que ni el `lleno` más bajo baje de 1,6.
export const NIVELES: readonly Nivel[] = [
  { clave: 'peatonal',   metros: 2.5, pisoPx: 0.8, desvanece: { lleno: 1.6, tenue: 4 } },
  { clave: 'rustica',    metros: 5,   pisoPx: 1.0, desvanece: { lleno: 2,   tenue: 5.5 } },
  { clave: 'local',      metros: 7,   pisoPx: 1.4, desvanece: { lleno: 2.5, tenue: 7 } },
  { clave: 'terciaria',  metros: 9,   pisoPx: 1.9, desvanece: { lleno: 4,   tenue: 9 } },
  { clave: 'secundaria', metros: 12,  pisoPx: 2.3, desvanece: null },
  { clave: 'principal',  metros: 16,  pisoPx: 2.8, desvanece: null },
  { clave: 'troncal',    metros: 24,  pisoPx: 3.4, desvanece: null },
] as const

// Los 26 valores de `highway` que trae la red del Táchira, más los que OSM
// usa en otros estados y podrían aparecer al regenerar los datos.
const NIVEL_DE: Record<string, number> = {
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

// Una clase que OSM invente mañana cae en 'local': peso medio, no se
// desvanece del todo y no se pierde. El otro extremo (mandarla a 'peatonal')
// escondería una carretera nueva sin que nadie se enterara.
export const NIVEL_POR_DEFECTO = 2

export const nivelDe = (highway: string): number => NIVEL_DE[highway] ?? NIVEL_POR_DEFECTO

/** La unión queda encima de sus participantes y debajo de jerarquías ajenas
 * superiores. Su nivel es el máximo de los brazos, calculado en juntas.ts. */
export const ordenCapa = (nivel: number, capa: 'contorno' | 'relleno' | 'union'): number =>
  nivel * 2 + (capa === 'contorno' ? 0 : capa === 'relleno' ? 1 : 1.5)

/** Las clases que esta tabla clasifica a propósito. Existe para que un test
 *  pueda comprobar que ninguna clase del dataset real está cayendo al nivel
 *  de reserva: `nivelDe` sola no distingue "clasificada como local" de "no
 *  clasificada", porque las dos devuelven NIVEL_POR_DEFECTO. */
export const CLASES_CONOCIDAS: readonly string[] = Object.keys(NIVEL_DE)

/** Cuánto terreno cabe en un píxel de pantalla, para una cámara en
 *  perspectiva mirando a `distancia` metros. La mitad vertical del plano
 *  visible mide `distancia * tan(fov/2)`; el alto en píxeles lo reparte. */
export function metrosPorPixel (distancia: number, fovGrados: number, altoPx: number): number {
  return (2 * distancia * Math.tan((fovGrados * Math.PI) / 360)) / Math.max(1, altoPx)
}

export function presencia (n: Nivel, mpp: number): number {
  const d = n.desvanece
  if (!d) return 1
  if (mpp <= d.lleno) return 1
  if (mpp >= d.tenue) return 0
  return 1 - (mpp - d.lleno) / (d.tenue - d.lleno)
}

/** El m/px a partir del cual este nivel deja de dibujarse. `Infinity` para la
 *  red estructurante, que no se apaga nunca.
 *
 *  Es la definición ÚNICA del corte: la consumen el pase visible (que apaga el
 *  objeto) y el de ids (que descarta el fragmento). Tenerla dos veces era la
 *  forma segura de que un retoque de la tabla dejara el id buffer devolviendo
 *  vías que ya no están en pantalla. */
export const mppCorte = (n: Nivel): number => n.desvanece ? n.desvanece.tenue : Infinity

/** Tope finito del corte que viaja a la GPU. Un atributo de vértice con
 *  Infinity queda indefinido en WebGL1 y a merced del driver en WebGL2, y no
 *  hace falta: a la distancia máxima de OrbitControls (400 km, App.tsx) el
 *  mapa va a ~368 m/px, ocho millones de veces por debajo de esto. */
export const SIN_CORTE = 1e9

/** Expande un valor por VÍA a uno por SEGMENTO, en el orden plano del buffer
 *  de posiciones. `index` es el mismo CSR que usa repartirPorNivel. Lo usan
 *  el corte y la calzada del pase de ids (PickingPass.tsx), que dibuja toda
 *  la red en un solo objeto y necesita sus atributos en ese orden. */
export function porSegmento (ways: Way[], index: Uint32Array, f: (w: Way) => number): Float32Array {
  const out = new Float32Array(index[ways.length])
  for (let i = 0; i < ways.length; i++) out.fill(f(ways[i]), index[i], index[i + 1])
  return out
}

/** El corte de cada SEGMENTO, para que el pase de ids pueda descartar lo que
 *  el acercamiento ya apagó (PickingPass.tsx). */
export const cortePorSegmento = (ways: Way[], index: Uint32Array): Float32Array =>
  porSegmento(ways, index, w => Math.min(mppCorte(NIVELES[nivelDe(w.highway)]), SIN_CORTE))

export interface Tanda {
  nivel: number; positions: Float32Array; segIds: Float32Array
  /** Los `porVia` de la llamada, expandidos a un valor por SEGMENTO,
   *  INTERCALADOS (stride porVia.length) y repartidos en el mismo orden que
   *  `segIds`. Un solo Float32Array y no uno por valor -- Roads.tsx los
   *  cuelga como un único atributo vec3 (aVia, roadsShader.ts): sueltos, los
   *  tres se sumaban a los de LineMaterial y pasaban de 16 atributos de
   *  vértice en la GPU de referencia (GTX 980, MAX_VERTEX_ATTRIBS = 16). */
  via: Float32Array
  /** Metros recorridos a lo largo de la vía en cada extremo del segmento. Le
   *  dan fase a las rayas discontinuas del shader. Se cuentan desde el
   *  arranque de CADA vía, no del buffer entero: el computeLineDistances() de
   *  three acumula sobre todos los segmentos del objeto, y la red de un nivel
   *  suma miles de kilómetros -- pasados los diez millones de metros el
   *  épsilon de un float32 vale más de un metro y el patrón de 4 m cada 10 se
   *  degrada a ruido en las últimas vías del buffer. Reiniciar por vía deja
   *  los valores en el orden de la decena de kilómetros, y la fase solo tiene
   *  que ser continua dentro de un mismo trazo. */
  d0: Float32Array
  d1: Float32Array
  /** Normal del terreno en cada extremo (Int8 ×3 ×2 por segmento,
   *  roads-nrm.bin), repartida en el mismo orden que `segIds`. */
  normales: Int8Array
  limites?: Float32Array
  /** Sólo la tanda adicional de asfalto necesita las zonas en la GPU. */
  zonas?: Float32Array
  /** Piso en px y límites lleno/tenue del brazo original, no del receptor. */
  estilos?: Float32Array
}

/**
 * Reparte los segmentos de la red en una tanda por nivel. Hace falta porque
 * `linewidth` de LineMaterial es un uniform, no un atributo: un solo objeto
 * dibuja un solo ancho, y la jerarquía necesita siete.
 *
 * `index` es CSR sobre segmentos (los de la vía i van de index[i] a
 * index[i+1], seis floats cada uno: los dos extremos). Se cuenta primero y se
 * reserva exacto -- con 450.261 segmentos, ir empujando a arrays que crecen
 * solos duplica la memoria pico sin necesidad.
 *
 * Los niveles sin ninguna vía salen de la lista: LineSegmentsGeometry no
 * tiene nada sensato que hacer con cero posiciones.
 *
 * `porVia` son valores de UNA por vía (ancho de calzada, canales) que hay que
 * llevar al shader por segmento. Se expanden y reparten en el mismo recorrido
 * que ya hace falta para las posiciones -- recorrer 450.261 segmentos una vez
 * más, por separado, para copiar un float sería recorrerlos por gusto.
 */
export function repartirPorNivel (
  positions: Float32Array, segIds: Float32Array, index: Uint32Array, ways: Way[],
  porVia: Float32Array[] = [], normals?: Int8Array,
  juntas?: Juntas, soloJuntas = false,
): Tanda[] {
  const nivel = new Uint8Array(ways.length)
  const cuenta = new Uint32Array(NIVELES.length)
  const incluida = (s: number) => !soloJuntas || !!juntas &&
    (juntas.zonas[s * 4 + 1] > 0 || juntas.zonas[s * 4 + 3] > 0)
  const nivelUnion = (s: number, n: number) => Math.max(n, juntas!.niveles[s])
  for (let i = 0; i < ways.length; i++) {
    const n = nivelDe(ways[i].highway)
    nivel[i] = n
    if (!soloJuntas) cuenta[n] += index[i + 1] - index[i]
    else if (marcasPermitidas(ways[i])) {
      for (let s = index[i]; s < index[i + 1]; s++) if (incluida(s)) cuenta[nivelUnion(s, n)]++
    }
  }

  const pos = NIVELES.map((_, n) => new Float32Array(cuenta[n] * 6))
  const ids = NIVELES.map((_, n) => new Float32Array(cuenta[n]))
  const via = NIVELES.map((_, n) => new Float32Array(cuenta[n] * porVia.length))
  const d0 = NIVELES.map((_, n) => new Float32Array(cuenta[n]))
  const d1 = NIVELES.map((_, n) => new Float32Array(cuenta[n]))
  const nrm = NIVELES.map((_, n) => new Int8Array(cuenta[n] * 6))
  const limites = juntas ? NIVELES.map((_, n) => new Float32Array(cuenta[n] * 2)) : undefined
  const zonas = soloJuntas ? NIVELES.map((_, n) => new Float32Array(cuenta[n] * 4)) : undefined
  const estilos = soloJuntas ? NIVELES.map((_, n) => new Float32Array(cuenta[n] * 3)) : undefined
  const k = new Uint32Array(NIVELES.length)
  // Dentro de una unión manda el asfalto de la receptora sobre el del brazo
  // menor, igual que en las bases. La fase sigue reiniciándose por vía.
  const orden = soloJuntas ? Array.from(ways.keys()).sort((a, b) => nivel[a] - nivel[b]) : undefined
  for (let w = 0; w < ways.length; w++) {
    const i = orden ? orden[w] : w
    if (soloJuntas && !marcasPermitidas(ways[i])) continue
    let recorrido = 0
    for (let s = index[i]; s < index[i + 1]; s++) {
      const src = s * 6
      const desde = recorrido
      recorrido += Math.hypot(
        positions[src + 3] - positions[src],
        positions[src + 4] - positions[src + 1],
        positions[src + 5] - positions[src + 2],
      )
      if (!incluida(s)) continue
      const n = soloJuntas ? nivelUnion(s, nivel[i]) : nivel[i]
      const p = pos[n]
      const dst = k[n] * 6
      for (let c = 0; c < 6; c++) p[dst + c] = positions[src + c]
      if (normals) for (let c = 0; c < 6; c++) nrm[n][dst + c] = normals[src + c]
      ids[n][k[n]] = segIds[s]
      // El valor es de la VÍA: todos sus segmentos se llevan el mismo.
      // Intercalado (stride porVia.length): es el mismo atributo vec3 que
      // cuelga Roads.tsx, no uno por valor.
      for (let e = 0; e < porVia.length; e++) via[n][k[n] * porVia.length + e] = porVia[e][i]
      d0[n][k[n]] = desde
      d1[n][k[n]] = recorrido
      if (juntas && limites) {
        for (let c = 0; c < 2; c++) limites[n][k[n] * 2 + c] = juntas.limites[s * 2 + c]
        if (zonas) for (let c = 0; c < 4; c++) zonas[n][k[n] * 4 + c] = juntas.zonas[s * 4 + c]
      }
      if (estilos) {
        const fuente = NIVELES[nivel[i]]
        estilos[n][k[n] * 3] = fuente.pisoPx
        estilos[n][k[n] * 3 + 1] = fuente.desvanece?.lleno ?? 0
        estilos[n][k[n] * 3 + 2] = fuente.desvanece?.tenue ?? 0
      }
      k[n]++
    }
  }

  return NIVELES
    .map((_, n) => ({
      nivel: n, positions: pos[n], segIds: ids[n], via: via[n], d0: d0[n], d1: d1[n], normales: nrm[n],
      limites: limites?.[n], zonas: zonas?.[n], estilos: estilos?.[n],
    }))
    .filter(t => t.segIds.length > 0)
}
