import * as THREE from 'three'

const rayo = new THREE.Raycaster()
const centro = new THREE.Vector2()
const impactos: THREE.Intersection[] = []

/** Distancia al terreno en el centro de la pantalla. El target de la órbita
 * puede quedar bajo el suelo tras un paneo: su radio sirve para navegar, pero
 * no para medir la escala ni decidir qué vías se ven. */
export function distanciaVista (
  camera: THREE.Camera, scene: THREE.Scene, objetivo?: THREE.Vector3,
): number {
  camera.updateWorldMatrix(true, false)
  rayo.setFromCamera(centro, camera)
  impactos.length = 0
  const terreno = scene.getObjectByName('terrain')
  if (terreno?.visible) {
    // Raycaster no filtra por visible. Los padres del LOD siguen en la caché
    // y medirlos daría la distancia a una superficie que ya no se dibuja.
    for (const nodo of terreno.children) {
      if (!(nodo as THREE.Mesh).isMesh || !nodo.visible) continue
      nodo.updateWorldMatrix(true, false)
      nodo.raycast(rayo, impactos)
    }
  }
  let distancia = Infinity
  for (const hit of impactos) distancia = Math.min(distancia, hit.distance)
  impactos.length = 0
  // Mientras carga el relieve, o mirando al cielo, conserva la referencia
  // de la órbita. No hay una superficie central que permita medir otra cosa.
  return Number.isFinite(distancia) ? distancia
    : objetivo ? camera.position.distanceTo(objetivo) : camera.position.length()
}
