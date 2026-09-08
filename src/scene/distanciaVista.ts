import * as THREE from 'three'

const rayo = new THREE.Raycaster()
const centro = new THREE.Vector2()
const impactos: THREE.Intersection[] = []
const caja = new THREE.Box3()
const abajo = new THREE.Vector3(0, -1, 0)
const origen = new THREE.Vector3()
const posicion = new THREE.Vector3()
const rotacion = new THREE.Quaternion()
let ultimaCamara: THREE.Camera | undefined
let ultimaEscena: THREE.Scene | undefined
let ultimoCuadro: number | undefined
let ultimaDistancia: number | null = null

function cajaMundial (nodo: THREE.Mesh) {
  nodo.updateWorldMatrix(true, false)
  if (!nodo.geometry.boundingBox) nodo.geometry.computeBoundingBox()
  return caja.copy(nodo.geometry.boundingBox!).applyMatrix4(nodo.matrixWorld)
}

/** Cota bajo la cámara, incluso si un paneo ya la dejó dentro de un cerro.
 * El rayo empieza ENCIMA de cada caja, no en la cámara: las caras del suelo
 * miran hacia arriba. Solo se consultan las hojas visibles, como en la vista. */
export function alturaTerreno (p: THREE.Vector3, scene: THREE.Scene, protegerCarga = false): number | null {
  const terreno = scene.getObjectByName('terrain')
  let altura = -Infinity
  if (terreno?.visible) {
    for (const objeto of terreno.children) {
      const nodo = objeto as THREE.Mesh
      if (!nodo.isMesh || !nodo.visible) continue
      const b = cajaMundial(nodo)
      if (p.x < b.min.x || p.x > b.max.x || p.z < b.min.z || p.z > b.max.z) continue
      rayo.set(origen.set(p.x, b.max.y + 1, p.z), abajo)
      impactos.length = 0
      nodo.raycast(rayo, impactos)
      for (const hit of impactos) {
        altura = Math.max(altura, protegerCarga ? nodo.userData.techoCarga ?? hit.point.y : hit.point.y)
      }
    }
  }
  impactos.length = 0
  return Number.isFinite(altura) ? altura : null
}

/** Consulta central compartida por Vista y Roads DESPUÉS de mover la cámara
 * y seleccionar el LOD. Sin número de cuadro (picking/tests), mide de nuevo.
 * La pose también invalida: dos consultas del mismo cuadro pueden moverse. */
export function distanciaTerreno (
  camera: THREE.Camera, scene: THREE.Scene, cuadro?: number,
): number | null {
  if (cuadro !== undefined && cuadro === ultimoCuadro && camera === ultimaCamara &&
      scene === ultimaEscena && posicion.equals(camera.position) && rotacion.equals(camera.quaternion)) {
    return ultimaDistancia
  }
  camera.updateWorldMatrix(true, false)
  rayo.setFromCamera(centro, camera)
  impactos.length = 0
  const terreno = scene.getObjectByName('terrain')
  if (terreno?.visible) {
    for (const objeto of terreno.children) {
      const nodo = objeto as THREE.Mesh
      if (!nodo.isMesh || !nodo.visible || !rayo.ray.intersectsBox(cajaMundial(nodo))) continue
      nodo.raycast(rayo, impactos)
    }
  }
  let distancia = Infinity
  for (const hit of impactos) distancia = Math.min(distancia, hit.distance)
  impactos.length = 0
  ultimaCamara = camera; ultimaEscena = scene; ultimoCuadro = cuadro
  posicion.copy(camera.position); rotacion.copy(camera.quaternion)
  ultimaDistancia = Number.isFinite(distancia) ? distancia : null
  return ultimaDistancia
}

/** Distancia al terreno en el centro de la pantalla. El target de la órbita
 * puede quedar bajo el suelo tras un paneo: su radio sirve para navegar, pero
 * no para medir la escala ni decidir qué vías se ven. */
export function distanciaVista (
  camera: THREE.Camera, scene: THREE.Scene, objetivo?: THREE.Vector3, cuadro?: number,
): number {
  const distancia = distanciaTerreno(camera, scene, cuadro)
  // Mientras carga el relieve, o mirando al cielo, conserva la referencia
  // de la órbita. No hay una superficie central que permita medir otra cosa.
  return distancia !== null ? distancia
    : objetivo ? camera.position.distanceTo(objetivo) : camera.position.length()
}
