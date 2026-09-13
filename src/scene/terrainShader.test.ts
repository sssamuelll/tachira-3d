import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import { GANCHOS, materialRelieve, UniformsRelieve } from './terrainShader'

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
  return materialRelieve({
    min: 0, max: 4000, mascara: new THREE.Texture(),
    indices: new THREE.Texture(), texelIndices: 1 / 2048,
  })
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

  it('el albedo mezcla la foto satelital del nodo sobre la hipsometría', () => {
    const s = compilar(mat())
    // La foto se muestrea con el trozo de tesela que le toca al nodo (uImgUv),
    // multiplicada por la ganancia, y solo pesa lo que diga uImagen.
    expect(s.vertexShader).toContain('attribute vec2 uvImagen')
    expect(s.vertexShader).toContain('vUvImg = uvImagen')
    expect(s.fragmentShader).toMatch(/texture2D\(uImg, vUvImg \* uImgUv\.z \+ uImgUv\.xy\)\.rgb \* uGanancia/)
    expect(s.fragmentShader).toContain('mix(color, foto, uImagen)')
    expect(s.uniforms.uGanancia.value).toBe(1)
    expect(s.uniforms.uImagen.value).toBe(0)
  })

  it('los uniforms por nodo cuelgan de userData y son los mismos objetos que ve el shader', () => {
    // TerrainLod escribe uImg/uImgUv/uImagen cada cuadro, y con un material
    // estándar shader.uniforms no existe hasta el primer cuadro. Si userData
    // y el shader tuvieran objetos distintos, la foto se escribiría en el
    // vacío y el relieve saldría siempre con hipsometría.
    const m = materialRelieve({
      min: 0, max: 4000, mascara: new THREE.Texture(), ganancia: 1.35,
      indices: new THREE.Texture(), texelIndices: 1 / 2048,
    })
    const u = m.userData.uniforms
    u.uImagen.value = 1
    const s = compilar(m)
    expect(s.uniforms.uImagen).toBe(u.uImagen)
    expect(s.uniforms.uImg).toBe(u.uImg)
    expect(s.uniforms.uImgUv).toBe(u.uImgUv)
    expect(s.uniforms.uMin).toBe(u.uMin)
    expect(s.uniforms.uGanancia.value).toBe(1.35)
    expect(s.uniforms.uImagen.value).toBe(1)
  })

  // CSM.setupMaterial() PISA onBeforeCompile en vez de encadenarlo. Si el
  // material se parchea antes que él, la hipsometría y el recorte del estado
  // se pierden sin un solo error. Los dos parches tienen que sobrevivir.
  //
  // Con el CSM REAL de three y no una imitación: si en una subida de three
  // setupMaterial cambia de forma (encadena en vez de pisar, cambia la clave
  // de su Map de shaders), este test tiene que enterarse, porque TerrainLod
  // depende de esa forma para sacar de ese Map los materiales que desecha.
  it('las cascadas reales se instalan primero y el parche del relieve encima', () => {
    const csm = new CSM({
      camera: new THREE.PerspectiveCamera(45, 1.5, 10, 2e6), parent: new THREE.Scene(),
      cascades: 3, maxFar: 5000, shadowMapSize: 1024, lightDirection: new THREE.Vector3(0, -1, 0),
    })
    const m = materialRelieve({
      min: 0, max: 4000, mascara: new THREE.Texture(), cascadas: csm,
      indices: new THREE.Texture(), texelIndices: 1 / 2048,
    })
    expect(m.defines!.USE_CSM).toBe(1)
    expect(m.defines!.CSM_CASCADES).toBe(3)
    expect(csm.shaders.get(m)).toBeNull()        // registrado, todavía sin compilar
    const s = compilar(m)
    expect(csm.shaders.get(m)).toBe(s)           // el Map va por material: es lo que la LRU borra
    expect(s.uniforms.CSM_cascades).toBeDefined()
    expect(s.uniforms.uMascara).toBeDefined()
    expect(s.fragmentShader).toContain('vec3 albedoRelieve ()')
    expect(csm.shaders.delete(m)).toBe(true)
    csm.remove()
    csm.dispose()
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

  describe('límites municipales', () => {
    it('el material expone los uniforms de los límites, apagados de fábrica', () => {
      const u = mat().userData.uniforms as UniformsRelieve
      expect(u.uLimites.value).toBe(0)
      expect(u.uIndices.value).not.toBeNull()
      expect(u.uTexelIdx.value.x).toBeCloseTo(1 / 2048)
      expect(u.uTexelIdx.value.y).toBeCloseTo(1 / 2048)
    })

    it('el fragment declara el muestreador de índices y el interruptor', () => {
      const s = compilar(mat())
      expect(s.fragmentShader).toContain('uniform sampler2D uIndices')
      expect(s.fragmentShader).toContain('uniform float uLimites')
      expect(s.fragmentShader).toContain('uniform vec2 uTexelIdx')
    })

    // Lo que hace que sea un límite y no ruido: se compara el texel con sus
    // cuatro vecinos a un texel de distancia, sobre la misma uv que la máscara.
    it('el fragment compara el índice con sus cuatro vecinos', () => {
      const s = compilar(mat())
      // Los cuatro desplazamientos, cada uno una vez. Contar llamadas a difiere()
      // dependería de si la declaración lleva espacio antes del paréntesis; esto
      // comprueba lo que de verdad importa, que se mire a los cuatro lados.
      for (const offset of [
        'vec2(uTexelIdx.x, 0.0)',
        'vec2(0.0, uTexelIdx.y)',
      ]) {
        expect(s.fragmentShader.split(offset).length - 1, offset).toBe(2)
      }
      expect(s.fragmentShader).toContain('vUvM + vec2(uTexelIdx.x, 0.0)')
      expect(s.fragmentShader).toContain('vUvM - vec2(uTexelIdx.x, 0.0)')
      expect(s.fragmentShader).toContain('vUvM + vec2(0.0, uTexelIdx.y)')
      expect(s.fragmentShader).toContain('vUvM - vec2(0.0, uTexelIdx.y)')
    })

    // Dentro del albedo, no después: la línea tiene que recibir la luz del
    // terreno. Si alguien la sacara del albedo, esto lo dice.
    it('la línea se mezcla dentro del albedo, antes de la iluminación', () => {
      const s = compilar(mat())
      const albedo = s.fragmentShader.slice(s.fragmentShader.indexOf('vec3 albedoRelieve'))
      expect(albedo.slice(0, albedo.indexOf('\n}'))).toContain('uLimites')
    })

    it('los uniforms del material y los del shader son el mismo objeto', () => {
      const m = mat()
      const s = compilar(m)
      const u = m.userData.uniforms as UniformsRelieve
      u.uLimites.value = 1
      expect((s.uniforms.uLimites as { value: number }).value).toBe(1)
    })
  })
})
