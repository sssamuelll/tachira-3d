import { expect, test } from 'vitest'
import * as THREE from 'three'
import { distanciaVista } from './distanciaVista'
import { metrosPorPixel, NIVELES, presencia } from './roadStyle'

function vista () {
  const camera = new THREE.PerspectiveCamera(45, 1600 / 870, 10, 2_000_000)
  camera.position.set(0, 1800, 1600)
  const objetivo = new THREE.Vector3(0, -14_400, -20_000)
  camera.lookAt(objetivo)
  const scene = new THREE.Scene()
  const terreno = new THREE.Group()
  terreno.name = 'terrain'
  terreno.position.y = 600
  scene.add(terreno)
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(10_000, 10_000), new THREE.MeshBasicMaterial())
  suelo.rotation.x = -Math.PI / 2
  terreno.add(suelo)
  return { camera, objetivo, scene, terreno, suelo }
}

test('el mpp coincide con la proyección real y enciende las calles con el target enterrado', () => {
  const { camera, objetivo, scene } = vista()
  const d = distanciaVista(camera, scene, objetivo)
  expect(d).toBeCloseTo(2000, 6)
  const mpp = metrosPorPixel(d, camera.fov, 870)
  // Referencia independiente: proyectar 100 metros de suelo en la cámara.
  const a = new THREE.Vector3(-50, 600, 0).project(camera)
  const b = new THREE.Vector3(50, 600, 0).project(camera)
  expect(mpp).toBeCloseTo(100 / ((b.x - a.x) * 1600 / 2), 6)
  const local = NIVELES.find(n => n.clave === 'local')!
  const troncal = NIVELES.find(n => n.clave === 'troncal')!
  expect(presencia(local, mpp)).toBe(1)
  expect(presencia(troncal, mpp)).toBe(1)
  // El radio orbital sigue intacto; usarlo aquí vuelve a apagar la ciudad.
  expect(camera.position.distanceTo(objetivo)).toBeCloseTo(27_000, 6)
  expect(presencia(local, metrosPorPixel(27_000, 45, 870))).toBe(0)
})

test('mide la superficie visible más cercana, no los padres ocultos del LOD', () => {
  const { camera, objetivo, scene, terreno, suelo } = vista()
  const oculto = suelo.clone()
  oculto.position.y = 300
  oculto.visible = false
  const fondo = suelo.clone()
  fondo.position.y = -600
  terreno.clear().add(fondo, oculto, suelo)
  expect(distanciaVista(camera, scene, objetivo)).toBeCloseTo(2000, 6)
  // Tampoco debe medir vías, cielo u otras geometrías ajenas al relieve.
  const otro = oculto.clone()
  otro.visible = true
  otro.position.y = 1000
  scene.add(otro)
  expect(distanciaVista(camera, scene, objetivo)).toBeCloseTo(2000, 6)
})

test('sin superficie central conserva la referencia orbital o el origen durante la carga', () => {
  const { camera, objetivo, scene, terreno } = vista()
  terreno.visible = false
  expect(distanciaVista(camera, scene, objetivo)).toBeCloseTo(27_000, 6)
  terreno.visible = true
  camera.lookAt(0, 3000, 1600) // cielo
  expect(distanciaVista(camera, scene, objetivo)).toBeCloseTo(27_000, 6)
  scene.clear()
  expect(distanciaVista(camera, scene)).toBeCloseTo(Math.hypot(1800, 1600), 6)
})

test('el ajuste temporal de near/far del picking no cambia la distancia de la vista', () => {
  const { camera, objetivo, scene } = vista()
  camera.near = 3000
  camera.far = 3001
  camera.updateProjectionMatrix()
  expect(distanciaVista(camera, scene, objetivo)).toBeCloseTo(2000, 6)
})
