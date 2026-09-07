import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { GANCHOS, materialRelieve } from './terrainShader'

// Compila el material a mano: three llama a onBeforeCompile con el shader ya
// ensamblado, así que acá se le pasa el de ShaderLib.standard tal cual, que es
// exactamente el que verá en el navegador.
function compilar (material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  }
  material.onBeforeCompile(shader as never, null as never)
  return shader
}

function mat () {
  return materialRelieve({ min: 0, max: 4000, mascara: new THREE.Texture() })
}

describe('materialRelieve', () => {
  // Este es el test que de verdad importa al subir de versión de three: si un
  // #include desaparece o se duplica, el replace deja de enganchar y el parche
  // se pierde EN SILENCIO (el terreno saldría gris, sin hipsometría ni
  // recorte). Preferimos enterarnos acá.
  it('cada gancho aparece exactamente una vez en el shader de three', () => {
    const { vertexShader, fragmentShader } = THREE.ShaderLib.standard
    for (const g of GANCHOS.vert) expect(vertexShader.split(g).length - 1, g).toBe(1)
    for (const g of GANCHOS.frag) expect(fragmentShader.split(g).length - 1, g).toBe(1)
  })

  it('el vertex shader declara los atributos y los pasa como varying', () => {
    const s = compilar(mat())
    expect(s.vertexShader).toContain('attribute float elevation')
    expect(s.vertexShader).toContain('attribute vec2 uvMascara')
    expect(s.vertexShader).toContain('vElev = elevation')
    expect(s.vertexShader).toContain('vUvM = uvMascara')
  })

  it('el fragment descarta fuera de la máscara del estado', () => {
    const s = compilar(mat())
    expect(s.fragmentShader).toMatch(/texture2D\(\s*uMascara,\s*vUvM\s*\)\.r < 0\.5\) discard/)
  })

  it('el albedo queda aislado en su propia función y se aplica sobre diffuseColor', () => {
    const s = compilar(mat())
    expect(s.fragmentShader).toContain('vec3 albedoRelieve ()')
    expect(s.fragmentShader).toContain('diffuseColor.rgb = albedoRelieve();')
  })

  it('lleva sus uniforms al shader', () => {
    const s = compilar(mat())
    expect(s.uniforms.uMin.value).toBe(0)
    expect(s.uniforms.uMax.value).toBe(4000)
    expect(s.uniforms.uMascara.value).toBeInstanceOf(THREE.Texture)
  })

  // CSM.setupMaterial() PISA onBeforeCompile en vez de encadenarlo. Si el
  // material se parchea antes que él, la hipsometría y el recorte del estado
  // se pierden sin un solo error. Los dos parches tienen que sobrevivir.
  it('las cascadas se instalan primero y el parche del relieve encima', () => {
    const orden: string[] = []
    const cascadas = {
      // Imitación fiel de CSM.setupMaterial: asigna onBeforeCompile, no lo encadena.
      setupMaterial (m: THREE.Material) {
        m.defines = { ...m.defines, USE_CSM: 1, CSM_CASCADES: 3 }
        m.onBeforeCompile = shader => {
          orden.push('csm')
          ;(shader.uniforms as Record<string, unknown>).CSM_cascades = { value: [] }
        }
      },
    }
    const m = materialRelieve({ min: 0, max: 4000, mascara: new THREE.Texture(), cascadas })
    const s = compilar(m)
    expect(orden).toEqual(['csm'])
    expect(m.defines!.USE_CSM).toBe(1)
    expect(s.uniforms.CSM_cascades).toBeDefined()
    expect(s.uniforms.uMascara).toBeDefined()
    expect(s.fragmentShader).toContain('vec3 albedoRelieve ()')
  })

  it('es un MeshStandardMaterial mate, sin metal, y proyecta con sus caras delanteras', () => {
    const m = mat()
    expect(m).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(m.roughness).toBe(1)
    expect(m.metalness).toBe(0)
    // Sin esto three mete las caras TRASERAS en el shadow map y el relieve,
    // que es una superficie abierta, proyecta al revés.
    expect(m.shadowSide).toBe(THREE.FrontSide)
  })
})
