import { test, expect } from 'vitest'
import * as THREE from 'three'
import { ERROR_PX } from '../scene/quadtree'
import { ALZA_MIN_M, extrusionGlsl } from '../scene/roadsShader'
import { anchoBase, alza, cuadro, enFrustum } from './cuadros'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

/** Los cuatro vértices del cuadro como Vector3, para poder leer el test. */
function corners (
  a: THREE.Vector3, b: THREE.Vector3, na: THREE.Vector3, nb: THREE.Vector3,
  calzadaM: number, pisoPx: number, mppA: number, mppB = mppA,
): THREE.Vector3[] {
  const pos = new Float32Array(12)
  const nrm = new Float32Array(12)
  cuadro(a, b, na, nb, calzadaM, pisoPx, mppA, mppB, pos, nrm, 0)
  return [0, 3, 6, 9].map(i => v(pos[i], pos[i + 1], pos[i + 2]))
}

// ---------------------------------------------------------------------------
// Que la copia siga siendo copia. No se puede ejecutar GLSL acá, pero sí
// comprobar que las CIFRAS que este módulo usa son las que están escritas en
// el shader generado: si mañana alguien cambia el piso de alza o la
// tolerancia, la fórmula de allá y la de acá dejan de coincidir en silencio.
test('el shader generado sigue usando las mismas constantes de ancho y alza', () => {
  const glsl = extrusionGlsl(false)
  expect(glsl).toContain('float anchoBase = max( aCalzada, uPisoPx * mppV );')
  expect(glsl).toContain(`terrV * max( ${ERROR_PX.toFixed(1)} * mppV, ${ALZA_MIN_M.toFixed(2)} )`)
  // El contorno es el otro pase (roadStyle.ts lo dibuja debajo, más ancho): la
  // foto solo reconstruye el relleno, así que su ancho tiene que ser el de la
  // calzada pelada.
  expect(glsl).toContain('float anchoM = anchoBase;')
})

test('manda la calzada real cuando el piso en píxeles se queda corto', () => {
  // 1 m/px: 8 m de calzada contra un piso de 2,3 px = 2,3 m.
  expect(anchoBase(8, 2.3, 1)).toBe(8)
})

test('manda el piso en píxeles a vista de estado', () => {
  // 105 m/px (el estado entero en pantalla): la troncal de 24 m mide 0,23 px,
  // y sin piso desaparecería.
  expect(anchoBase(24, 3.4, 105)).toBeCloseTo(357, 6)
})

test('el alza nunca baja del mínimo, y crece con la distancia', () => {
  expect(alza(0.01)).toBe(ALZA_MIN_M)          // de cerca manda el mínimo
  expect(alza(105)).toBeCloseTo(ERROR_PX * 105, 6)  // de lejos, la tolerancia del LOD
})

// ---------------------------------------------------------------------------
// El cuadrilátero, contra casos que se pueden calcular a mano.

test('en llano, el cuadro sale centrado en el eje y levantado sobre él', () => {
  // Tramo de 10 m hacia el este, terreno horizontal, calzada de 8 m.
  // dir = +X, terr = +Y, lado = dir × terr = (1,0,0)×(0,1,0) = (0,0,1).
  const [b0, b1, a0, a1] = corners(v(0, 0, 0), v(10, 0, 0), v(0, 1, 0), v(0, 1, 0), 8, 1, 0.05)
  const s = ALZA_MIN_M
  expect(a0.toArray()).toEqual([0, s, -4])
  expect(a1.toArray()).toEqual([0, s, 4])
  expect(b0.toArray()).toEqual([10, s, -4])
  expect(b1.toArray()).toEqual([10, s, 4])
})

test('el orden de los vértices es el del cuadrilátero de LineSegmentsGeometry', () => {
  // Sus dos triángulos del cuerpo son (0,2,1) y (2,3,1), y con la derecha del
  // sentido de marcha en +1 salen antihorarios vistos desde arriba: es lo que
  // hace que la GPU no se coma la red entera por descarte de caras traseras
  // (ver el comentario de ladoV en roadsShader.ts). La foto va a DoubleSide,
  // pero si el orden se invierte acá también se invierte la normal geométrica
  // y el trazador ilumina la calzada por debajo.
  const [b0, b1, a0, a1] = corners(v(0, 0, 0), v(10, 0, 0), v(0, 1, 0), v(0, 1, 0), 8, 1, 0.05)
  const cara = new THREE.Vector3().crossVectors(
    new THREE.Vector3().subVectors(a0, b0),   // 0 -> 2
    new THREE.Vector3().subVectors(b1, b0),   // 0 -> 1
  )
  expect(cara.y).toBeGreaterThan(0)           // mira al cielo, no al suelo
  expect(a1.z).toBeGreaterThan(a0.z)          // +1 a la derecha del sentido
})

test('cada extremo lleva su propio ancho: un tramo que se aleja sale en cuña', () => {
  // Mismo tramo, pero el extremo b está al doble de metros por píxel (más
  // lejos de la cámara) y el piso es lo que manda en los dos.
  const [b0, b1, a0, a1] = corners(v(0, 0, 0), v(10, 0, 0), v(0, 1, 0), v(0, 1, 0), 0, 4, 1, 2)
  expect(a1.z - a0.z).toBeCloseTo(4, 6)       // 4 px · 1 m/px
  expect(b1.z - b0.z).toBeCloseTo(8, 6)       // 4 px · 2 m/px
})

test('la calzada se acuesta sobre la ladera, no sobre el plano horizontal', () => {
  // Ladera de 45° cayendo al norte: normal = (0, √½, √½) en un mundo con
  // Z = -norte. La vía va al este, así que el ancho tiene que quedar en el
  // plano de la ladera -- ni la mitad de arriba enterrada ni la de abajo
  // flotando.
  const n = v(0, Math.SQRT1_2, Math.SQRT1_2)
  const [, , a0, a1] = corners(v(0, 0, 0), v(10, 0, 0), n, n, 8, 1, 0.05)
  const ancho = new THREE.Vector3().subVectors(a1, a0)
  expect(ancho.length()).toBeCloseTo(8, 5)
  expect(ancho.dot(n)).toBeCloseTo(0, 5)      // perpendicular a la normal
  expect(ancho.x).toBeCloseTo(0, 5)           // y perpendicular al sentido
})

test('sin dato de normal se cae al arriba del mundo, como el shader', () => {
  const cero = v(0, 0, 0)
  const [, , a0, a1] = corners(v(0, 0, 0), v(10, 0, 0), cero, cero, 8, 1, 0.05)
  expect(a0.y).toBeCloseTo(ALZA_MIN_M, 6)
  expect(a1.z - a0.z).toBeCloseTo(8, 6)
})

test('un tramo de longitud cero no produce NaN', () => {
  const p = v(3, 4, 5)
  for (const c of corners(p, p.clone(), v(0, 1, 0), v(0, 1, 0), 8, 1, 0.05)) {
    expect(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)).toBe(true)
  }
})

// ---------------------------------------------------------------------------
// El recorte por frustum.

function camaraMirando (): THREE.PerspectiveCamera {
  // En el origen, mirando a -Z (la orientación por defecto de three).
  const cam = new THREE.PerspectiveCamera(45, 1, 1, 1000)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  return cam
}

function frustumDe (cam: THREE.PerspectiveCamera): THREE.Frustum {
  return new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
}

test('entra lo que está delante de la cámara', () => {
  const f = frustumDe(camaraMirando())
  expect(enFrustum(f, v(-5, 0, -100), v(5, 0, -100), 1)).toBe(true)
})

test('queda fuera lo que está detrás', () => {
  const f = frustumDe(camaraMirando())
  expect(enFrustum(f, v(-5, 0, 100), v(5, 0, 100), 1)).toBe(false)
})

test('queda fuera lo que está de lado, más allá del ángulo de visión', () => {
  const f = frustumDe(camaraMirando())
  expect(enFrustum(f, v(500, 0, -100), v(600, 0, -100), 1)).toBe(false)
})

test('un tramo que sale del cuadro por un extremo se conserva entero', () => {
  // El otro extremo sí está dentro: recortarlo dejaría un agujero en la foto
  // justo en el borde, que es donde más se nota.
  const f = frustumDe(camaraMirando())
  expect(enFrustum(f, v(0, 0, -100), v(5000, 0, -100), 1)).toBe(true)
})

test('el margen mete lo que roza el borde', () => {
  const f = frustumDe(camaraMirando())
  // A 100 m de la cámara, con fov 45 y aspecto 1, el medio cuadro mide
  // 100·tan(22,5°) = 41,42 m. Un punto a 60 m del eje está fuera...
  const a = v(60, 0, -100)
  expect(enFrustum(f, a, a.clone(), 0)).toBe(false)
  // ...y con 25 m de holgura (una troncal a vista de estado) entra.
  expect(enFrustum(f, a, a.clone(), 25)).toBe(true)
})
