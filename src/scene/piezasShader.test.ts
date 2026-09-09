import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import { uniformesContacto } from './buildingShadows'
import { materialPieza } from './piezasShader'

const originalChunks = {
  lights_fragment_begin: THREE.ShaderChunk.lights_fragment_begin,
  lights_pars_begin: THREE.ShaderChunk.lights_pars_begin,
}
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  Object.assign(THREE.ShaderChunk, originalChunks)
})

function setupCSM () {
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 1000)
  const csm = new CSM({ camera, parent: new THREE.Scene(), cascades: 3 })
  cleanups.push(() => { csm.dispose(); csm.remove() })
  return { csm, camera }
}

describe('materiales PBR de piezas', () => {
  it.each([
    { name: 'MeshStandardMaterial', Material: THREE.MeshStandardMaterial },
    { name: 'MeshPhysicalMaterial', Material: THREE.MeshPhysicalMaterial },
  ])('conserva el PBR importado al preparar $name para sombras', ({ Material }) => {
    const { csm } = setupCSM()
    const texture = new THREE.Texture()
    const original = new Material({
      color: new THREE.Color(0.23, 0.41, 0.67), roughness: 0.37, metalness: 0.64,
      map: texture, normalMap: texture, roughnessMap: texture, metalnessMap: texture,
      aoMap: texture, emissiveMap: texture, emissive: new THREE.Color(0.01, 0.02, 0.03),
    })
    if (original instanceof THREE.MeshPhysicalMaterial) original.clearcoat = 0.42
    const material = materialPieza(original, csm) as THREE.MeshStandardMaterial
    cleanups.push(() => { original.dispose(); material.dispose(); texture.dispose() })

    expect(material).not.toBe(original)
    expect(material).toBeInstanceOf(Material)
    expect(material.color.toArray()).toEqual([0.23, 0.41, 0.67])
    expect(material.emissive.toArray()).toEqual([0.01, 0.02, 0.03])
    expect(material.roughness).toBe(0.37)
    expect(material.metalness).toBe(0.64)
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
      expect(material[key]).toBe(texture)
    }
    if (material instanceof THREE.MeshPhysicalMaterial) expect(material.clearcoat).toBe(0.42)
    expect(material.shadowSide).toBe(THREE.DoubleSide)
    expect(original.shadowSide).toBeNull()
    expect(original.defines).not.toHaveProperty('USE_CSM')
    material.color.setScalar(1)
    expect(original.color.toArray()).toEqual([0.23, 0.41, 0.67])
  })

  it('registra y actualiza las cascadas reales conservando el receptor de contacto', () => {
    const { csm, camera } = setupCSM()
    const original = new THREE.MeshStandardMaterial()
    const material = materialPieza(original, csm) as THREE.MeshStandardMaterial
    cleanups.push(() => { original.dispose(); material.dispose() })
    const shader = {
      uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms),
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    }
    material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer)

    expect(material.defines).toMatchObject({ USE_CSM: 1, CSM_CASCADES: 3 })
    expect(csm.shaders.get(material)).toBe(shader)
    expect(csm.shaders.has(original)).toBe(false)
    expect(shader.uniforms.CSM_cascades.value).toHaveLength(3)
    expect(shader.uniforms.shadowFar.value).toBe(1000)
    camera.far = 750
    csm.updateFrustums()
    expect(shader.uniforms.shadowFar.value).toBe(750)
    expect(shader.uniforms.uContactoMapa).toBe(uniformesContacto.uContactoMapa)
    expect(shader.uniforms.uContactoMat).toBe(uniformesContacto.uContactoMat)
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse *= contacto')
    expect(shader.fragmentShader).toContain('reflectedLight.directSpecular *= contacto')
    expect(shader.fragmentShader).not.toContain('indirectDiffuse *= contacto')
    expect(shader.vertexShader).toContain('vContactoW=(modelMatrix*vec4(transformed,1.0)).xyz;')
    expect(material.customProgramCacheKey()).not.toBe(original.customProgramCacheKey())
  })
})
