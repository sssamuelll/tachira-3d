import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { materialEdificios } from './buildingsShader'
import { uniformesContacto, parcharContacto, camaraContacto } from './buildingShadows'
import { ASFALTO_CUERPO_GLSL } from './asfalto'

describe('luz y contacto de edificios', () => {
  it('conserva CSM antes del parche y usa material opaco PBR', () => {
    const m=materialEdificios({setupMaterial(mat:THREE.Material){mat.onBeforeCompile=s=>{s.uniforms.CSM_cascades={value:[]}}}})
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}
    m.onBeforeCompile(shader as any,{} as any)
    expect(shader.uniforms).toHaveProperty('CSM_cascades')
    expect(m.vertexColors).toBe(true)
    expect(m.transparent).toBe(false)
    expect(m.depthWrite).toBe(true)
    expect(m.metalness).toBe(0)
  })
  it('oscurece solamente luz directa, dejando AO y ambiente intactos', () => {
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader}
    parcharContacto(shader as any)
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse *= contacto')
    expect(shader.fragmentShader).toContain('reflectedLight.directSpecular *= contacto')
    expect(shader.fragmentShader).not.toContain('indirectDiffuse *= contacto')
    expect(uniformesContacto.uContactoMapa.value.compareFunction).toBe(THREE.LessEqualCompare)
    expect(uniformesContacto.uContactoOn.value).toBe(0)
    expect(ASFALTO_CUERPO_GLSL).toContain('sombra *= sombraEdificios(vPosW);')
  })
  it('proyecta la sombra hacia el lado contrario al sol y estabiliza el texel', () => {
    const c=new THREE.OrthographicCamera()
    camaraContacto(c,new THREE.Vector3(0,500,0),new THREE.Vector3(1,1,0).normalize(),200)
    const p=new THREE.Vector3(0,508,0).project(c)
    const ground=new THREE.Vector3(-8,500,0).project(c)
    expect(p.x).toBeCloseTo(ground.x,5)
    expect(p.y).toBeCloseTo(ground.y,5)
    expect(p.z).toBeLessThan(ground.z)
  })
})
