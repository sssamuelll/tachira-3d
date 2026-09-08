import * as THREE from 'three'
import { parcharContacto } from './buildingShadows'

/** Conserva el PBR del GLB: solamente añade las mismas sombras de Buildings. */
export function materialPieza(original: THREE.Material, csm: { setupMaterial(m: THREE.Material): void }): THREE.Material {
  const material = original.clone()
  material.shadowSide = THREE.DoubleSide
  csm.setupMaterial(material)
  const previous = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer)
    parcharContacto(shader)
  }
  material.customProgramCacheKey = () => 'piezas-pbr-contacto-v1'
  return material
}
