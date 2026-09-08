import * as THREE from 'three'
import { parcharContacto } from './buildingShadows'

export function materialEdificios(csm:{setupMaterial(m:THREE.Material):void}):THREE.MeshStandardMaterial {
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.9,metalness:0})
  // Misma ganancia fotométrica de la imagen del relieve. Los bytes de color
  // vienen linealizados del horneado, nunca contienen sombras inventadas.
  material.color.setScalar(2.6)
  material.shadowSide=THREE.DoubleSide
  csm.setupMaterial(material)
  const previous=material.onBeforeCompile.bind(material)
  material.onBeforeCompile=(shader,renderer)=>{previous(shader,renderer);parcharContacto(shader)}
  material.customProgramCacheKey=()=> 'edificios-pbr-contacto-v1'
  return material
}
