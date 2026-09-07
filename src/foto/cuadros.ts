import * as THREE from 'three'
import { ERROR_PX } from '../scene/quadtree'
import { ALZA_MIN_M } from '../scene/roadsShader'

// La calzada, tal como la EXTRUYE el vertex shader (extrusionGlsl en
// scene/roadsShader.ts), pero en CPU y en coordenadas de mundo.
//
// El trazador de rayos no ejecuta el shader de LineMaterial: necesita
// triángulos de verdad, con sus vértices ya donde van. Así que hay que
// rehacer en TypeScript lo que la GPU hace por vértice -- y hacerlo IGUAL, o
// la foto trazada enseña una red vial que no es la que se ve en pantalla:
// otro ancho, otro lado de la ladera, otra alza sobre el relieve.
//
// Dos diferencias deliberadas con el GLSL, las dos documentadas y sin efecto
// visible en el encuadre:
//
//  1. El shader trabaja en espacio de CÁMARA porque ahí es donde three ya le
//     dejó `start`/`end` recortados al near plane. Acá se trabaja en mundo.
//     Da lo mismo: viewMatrix es una transformación rígida (rotación +
//     traslación), y para una rotación R vale R(a × b) = (Ra) × (Rb), así que
//     el "lado" sale idéntico. Lo único que sí depende de la cámara es la
//     profundidad de cada extremo, y esa entra como parámetro (`mpp`).
//  2. No se recorta al near plane. Un tramo que atraviesa el plano cercano se
//     extruye entero; el trazador no tiene near plane que respetar, traza
//     rayos desde el ojo.
//
// Lo que NO se reconstruye: las tapas redondas de los extremos (los vértices
// con |position.y| > 1 del cuadrilátero de LineSegmentsGeometry, que rematan
// las curvas entre tramo y tramo) y las marcas viales, que son fragment
// shader puro. Ver el spec y el reporte: en una lámina de presentación la
// junta abierta entre dos tramos de una curva mide una fracción de píxel.

/** El `anchoBase` del shader: la calzada real de la vía en metros, con el piso
 *  en píxeles del nivel como suelo. A vista de estado manda el piso; a escala
 *  de calle, la calzada. */
export const anchoBase = (calzadaM: number, pisoPx: number, mpp: number): number =>
  Math.max(calzadaM, pisoPx * mpp)

/** Cuánto se levanta la calzada sobre el relieve dibujado, en metros: la
 *  tolerancia del LOD a esa profundidad, nunca menos de ALZA_MIN_M. */
export const alza = (mpp: number): number => Math.max(ERROR_PX * mpp, ALZA_MIN_M)

const dir = new THREE.Vector3()
const terr = new THREE.Vector3()
const lado = new THREE.Vector3()
const centro = new THREE.Vector3()
const esfera = new THREE.Sphere()

// Fuera de la ladera no hay dato de normal: el pipeline deja (0,0,0) y el
// shader se cae al "arriba" del mundo. Mismo umbral que el GLSL (dot > 0.25).
const ARRIBA = new THREE.Vector3(0, 1, 0)
const NORMAL_MIN2 = 0.25

/** La normal del terreno en un extremo, o el arriba del mundo si no hay dato.
 *  Escribe en `out` y lo devuelve. */
function normalDe (n: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return n.lengthSq() > NORMAL_MIN2 ? out.copy(n).normalize() : out.copy(ARRIBA)
}

/**
 * Los cuatro vértices del cuerpo del cuadrilátero de un tramo, en el mismo
 * orden que los emite LineSegmentsGeometry (v2..v5 de su plantilla):
 *
 *     0 = b - lado·hw     1 = b + lado·hw
 *     2 = a - lado·hw     3 = a + lado·hw
 *
 * con los triángulos (0,2,1) y (2,3,1), que es el sentido en que la GPU los
 * dibuja. Escribe 4×3 floats de posición en `pos[o..o+11]` y sus normales en
 * `nrm[o..o+11]`.
 *
 * `mppA`/`mppB` son los metros por píxel a la PROFUNDIDAD de cada extremo
 * (roadStyle.metrosPorPixel con la distancia a lo largo del eje de la cámara).
 * Cada extremo tiene su ancho, su alza y su lado: es lo que hace que un tramo
 * que se aleja de la cámara salga en cuña y no en banda paralela, igual que en
 * pantalla.
 */
export function cuadro (
  a: THREE.Vector3, b: THREE.Vector3,
  na: THREE.Vector3, nb: THREE.Vector3,
  calzadaM: number, pisoPx: number, mppA: number, mppB: number,
  pos: Float32Array, nrm: Float32Array, o: number,
): void {
  dir.subVectors(b, a)
  // Tramo de longitud cero: el shader se cae a (1,0,0) y nosotros también, o
  // normalize() devuelve NaN y un solo vértice NaN envenena el BVH entero.
  if (dir.lengthSq() > 0) dir.normalize()
  else dir.set(1, 0, 0)

  for (const [k, eje, n, mpp] of [[6, a, na, mppA], [0, b, nb, mppB]] as const) {
    normalDe(n, terr)
    lado.crossVectors(dir, terr)
    // dir paralela a la normal (una vía vertical, que no existe, o un dato de
    // normal roto): sin esto normalize() da NaN. Se cae a cualquier
    // perpendicular a la normal -- el ancho queda arbitrario, pero la malla
    // sigue siendo una malla.
    if (lado.lengthSq() < 1e-12) lado.set(terr.y, -terr.x, 0).normalize()
    else lado.normalize()
    if (lado.lengthSq() < 1e-12) lado.set(1, 0, 0)

    const hw = 0.5 * anchoBase(calzadaM, pisoPx, mpp)
    const s = alza(mpp)
    for (const [j, signo] of [[0, -1], [3, 1]] as const) {
      const i = o + k + j
      pos[i] = eje.x + terr.x * s + lado.x * hw * signo
      pos[i + 1] = eje.y + terr.y * s + lado.y * hw * signo
      pos[i + 2] = eje.z + terr.z * s + lado.z * hw * signo
      nrm[i] = terr.x; nrm[i + 1] = terr.y; nrm[i + 2] = terr.z
    }
  }
}

/** ¿Toca este tramo lo que la cámara ve? Una esfera que envuelve el tramo con
 *  `margen` metros de holgura (la mitad del ancho extruido más lo que se alza
 *  sobre el relieve): barata y conservadora -- deja pasar de más en las
 *  esquinas del frustum, nunca de menos. */
export function enFrustum (
  frustum: THREE.Frustum, a: THREE.Vector3, b: THREE.Vector3, margen: number,
): boolean {
  centro.addVectors(a, b).multiplyScalar(0.5)
  esfera.set(centro, 0.5 * a.distanceTo(b) + margen)
  return frustum.intersectsSphere(esfera)
}
