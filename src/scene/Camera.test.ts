import { test, expect, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { enuOf, bboxCenterAndSpan, idsCenterAndSpan, Vista } from './Camera'
import { ORIGIN, BBOX } from '../data/constants'
import type { Escala } from '../ui/escala'

// Solo se sustituye el puente de r3f: cámara, controles, mallas y el cuadro
// de Vista son reales. No hace falta WebGL para medir la escala que publica.
let estado: { camera: THREE.PerspectiveCamera; controls: OrbitControls; scene: THREE.Scene; size: { width: number; height: number } }
let cuadro: (state: unknown, dt: number) => void
vi.mock('@react-three/fiber', () => ({
  useThree: () => estado,
  useFrame: (f: typeof cuadro) => { cuadro = f },
}))

test('la escala sigue el suelo al acercarse aunque el paneo haya enterrado el target', () => {
  const camera = new THREE.PerspectiveCamera(45, 1600 / 870, 10, 2_000_000)
  const controls = new OrbitControls(camera)
  // El paneo en pantalla puede dejar el pivote kilómetros bajo el suelo.
  // La superficie está 25 km por delante de él sobre el eje de la cámara.
  controls.target.set(0, -15_000, -20_000)
  const scene = new THREE.Scene()
  const terreno = new THREE.Group()
  terreno.name = 'terrain'
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(10_000, 10_000), new THREE.MeshBasicMaterial())
  suelo.rotation.x = -Math.PI / 2
  terreno.add(suelo)
  scene.add(terreno)
  scene.updateMatrixWorld(true)
  estado = { camera, controls, scene, size: { width: 1600, height: 870 } }
  const publicadas: Escala[] = []
  renderToString(createElement(Vista, {
    api: { current: null }, mirilla: { current: null }, onEscala: e => publicadas.push(e),
  }))

  // En cada paso, 2*d*tan(22,5°)/870 da 1,904 / 0,952 / 0,095 m/px.
  // La barra de 104 px debe bajar de 100 m a 50 m y a 5 m.
  for (const d of [2000, 1000, 100]) {
    camera.position.set(0, d * 0.6, d * 0.8)
    controls.update()
    cuadro(null, 1 / 60)
  }
  expect(publicadas.map(e => e.metros)).toEqual([100, 50, 5])
  expect(publicadas.map(e => e.px)).toEqual([53, 53, 53])
  suelo.geometry.dispose()
  suelo.material.dispose()
})

test('el origen del proyecto cae en el cero de la escena', () => {
  const v = enuOf(ORIGIN.lat, ORIGIN.lon, 0)
  expect(v.length()).toBeLessThan(1e-6)
})

test('el span del bbox del Tachira ronda los 200 km de diagonal', () => {
  const { span } = bboxCenterAndSpan(BBOX)
  expect(span).toBeGreaterThan(180000)
  expect(span).toBeLessThan(220000)
})

// Fija la convencion de ejes (X=este, Y=arriba, Z=-norte) eje por eje.
// El test del origen da (0,0,0) sin importar el orden/signo de los ejes, y
// bboxCenterAndSpan usa distanceTo, invariante ante cualquier permutacion:
// ninguno de los dos revienta si enuOf devuelve, p.ej., (e, n, u) en vez de
// (e, u, -n). Este si: cada eje se mueve solo, y solo debe moverse el
// componente que le toca.
test('mover al este/norte/arriba solo mueve el eje que le corresponde', () => {
  const este = enuOf(ORIGIN.lat, ORIGIN.lon + 0.01, 0)
  expect(este.x).toBeGreaterThan(500)      // este -> +X
  expect(Math.abs(este.z)).toBeLessThan(1) // sin componente norte

  const norte = enuOf(ORIGIN.lat + 0.01, ORIGIN.lon, 0)
  expect(norte.z).toBeLessThan(-500)        // norte -> -Z
  expect(Math.abs(norte.x)).toBeLessThan(1) // sin componente este

  const arriba = enuOf(ORIGIN.lat, ORIGIN.lon, 1000)
  expect(arriba.y).toBeGreaterThan(999) // altura -> +Y
  expect(arriba.y).toBeLessThan(1001)
})

// positions es CSR sobre segmentos: seis floats por segmento (los dos
// extremos). Un buffer a mano es la unica forma de comprobar que se leen los
// DOS extremos y que el rango de la via i sale de index[i]..index[i+1] --
// leer solo el primer extremo, o desfasar el indice en uno, sigue dando un
// encuadre plausible sobre el dato real.
const positions = new Float32Array([
  // via 0: dos segmentos, de (0,0,0) a (2000,0,0)
  0, 0, 0, 1000, 0, 0,
  1000, 0, 0, 2000, 0, 0,
  // via 1: un segmento lejos, de (10000,0,10000) a (10000,0,12000)
  10000, 0, 10000, 10000, 0, 12000,
])
const index = new Uint32Array([0, 2, 3])

test('el encuadre de una via cubre sus dos extremos', () => {
  const e = idsCenterAndSpan(positions, index, [0])!
  expect(e.center.x).toBeCloseTo(1000)
  expect(e.center.z).toBeCloseTo(0)
})

test('el encuadre de varias vias cubre todas', () => {
  const e = idsCenterAndSpan(positions, index, [0, 1])!
  expect(e.center.x).toBeCloseTo(5000)
  expect(e.center.z).toBeCloseTo(6000)
  expect(e.span).toBeCloseTo(Math.hypot(10000, 12000))
})

// Una via urbana mide decenas de metros: sin piso la camara queda a ~40 m del
// suelo, por dentro del near plane (10, App.tsx) y contra un relieve
// muestreado cada 130 m que a esa distancia es un plano.
test('el span nunca baja del piso, aunque la via sea de metros', () => {
  const corta = new Float32Array([0, 0, 0, 30, 0, 0])
  const e = idsCenterAndSpan(corta, new Uint32Array([0, 1]), [0])!
  expect(e.span).toBe(1200)
  expect(e.center.x).toBeCloseTo(15)
})

test('un conjunto vacio o sin segmentos no pide encuadre', () => {
  expect(idsCenterAndSpan(positions, index, [])).toBeNull()
  // via con rango vacio (index[i] === index[i+1]): existe pero no dibuja nada
  expect(idsCenterAndSpan(positions, new Uint32Array([0, 0]), [0])).toBeNull()
})
