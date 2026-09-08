import { useEffect,useMemo } from 'react'
import { useFrame,useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { direccionSol } from './sol'
import { CONTACTO_PX,camaraContacto,uniformesContacto,liberarContacto } from './buildingShadows'

/** Un pase de profundidad SOLO de edificios; ninguna luz direccional adicional
 * (CSM supone exactamente tres). Proxies comparten buffers, sin copiar vértices. */
export function SombrasEdificios({date}:{date:Date}) {
  const {gl,scene,camera,controls}=useThree()
  const sun=useMemo(()=>direccionSol(date),[date])
  const state=useMemo(()=>{
    const depth=new THREE.DepthTexture(CONTACTO_PX,CONTACTO_PX)
    depth.compareFunction=THREE.LessEqualCompare
    depth.minFilter=depth.magFilter=THREE.NearestFilter
    const target=new THREE.WebGLRenderTarget(CONTACTO_PX,CONTACTO_PX,{depthTexture:depth})
    const material=new THREE.MeshDepthMaterial({side:THREE.DoubleSide})
    material.colorWrite=false
    return {target,material,camera:new THREE.OrthographicCamera(),scene:new THREE.Scene(),meshes:new Map<THREE.Mesh,THREE.Mesh>(),center:new THREE.Vector3(),
      stats:{drawCalls:0,triangles:0,resolution:CONTACTO_PX,width:0}}
  },[])
  useEffect(()=>()=>{
    liberarContacto()
    delete scene.userData.edificiosShadowStats
    state.target.dispose();state.material.dispose();state.meshes.clear()
  },[state,scene])
  useFrame(()=>{
    const group=scene.getObjectByName('edificios')
    const alive=new Set<THREE.Mesh>()
    group?.updateWorldMatrix(true,true)
    group?.traverseVisible(o=>{
      const source=o as THREE.Mesh
      if(!source.isMesh||!source.castShadow) return
      alive.add(source)
      let proxy=state.meshes.get(source)
      if(!proxy){proxy=new THREE.Mesh(source.geometry,state.material);proxy.matrixAutoUpdate=false;state.meshes.set(source,proxy);state.scene.add(proxy)}
      proxy.matrix.copy(source.matrixWorld)
    })
    for(const [source,proxy] of state.meshes) if(!alive.has(source)){state.scene.remove(proxy);state.meshes.delete(source)}
    uniformesContacto.uContactoOn.value=0
    state.stats.drawCalls=0;state.stats.triangles=0
    scene.userData.edificiosShadowStats=state.stats
    if(alive.size===0||sun.y<=0) return
    const target=(controls as {target?:THREE.Vector3}|null)?.target
    state.center.copy(target??camera.position)
    const width=THREE.MathUtils.clamp(camera.position.distanceTo(state.center)*1.8,160,2200)
    camaraContacto(state.camera,state.center,sun,width)
    const previous=gl.getRenderTarget(),autoClear=gl.autoClear,shadows=gl.shadowMap.enabled,xr=gl.xr.enabled
    try {
      gl.xr.enabled=false;gl.shadowMap.enabled=false;gl.autoClear=true
      gl.setRenderTarget(state.target)
      gl.render(state.scene,state.camera)
      Object.assign(scene.userData.edificiosShadowStats, {
        drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles, width,
      })
      uniformesContacto.uContactoMapa.value=state.target.depthTexture!
      uniformesContacto.uContactoOn.value=1
    } finally {gl.setRenderTarget(previous);gl.autoClear=autoClear;gl.shadowMap.enabled=shadows;gl.xr.enabled=xr}
  },-0.1)
  return null
}
