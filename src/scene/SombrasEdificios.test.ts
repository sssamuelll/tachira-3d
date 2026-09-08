import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { CONTACTO_PX, uniformesContacto } from './buildingShadows'
import { SombrasEdificios } from './SombrasEdificios'

const hooks = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  frame: undefined as (() => void) | undefined,
  state: undefined as unknown,
}))

// Ejecutamos los efectos y el frame reales, reemplazando únicamente el montaje
// React/R3F y el dispositivo WebGL que no está disponible sin navegador.
vi.mock('react', () => ({
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect()
    if (cleanup) hooks.effects.push(cleanup)
  },
}))
vi.mock('@react-three/fiber', () => ({
  useFrame: (frame: () => void) => { hooks.frame = frame },
  useThree: () => hooks.state,
}))

const fallback = uniformesContacto.uContactoMapa.value
const disposables: { dispose: () => void }[] = []
const date = new Date('2026-09-05T14:00:00Z')

function cleanup () {
  for (const effect of hooks.effects.splice(0).reverse()) effect()
}

beforeEach(() => {
  hooks.effects.length = 0
  hooks.frame = undefined
  uniformesContacto.uContactoOn.value = 0
  uniformesContacto.uContactoMapa.value = fallback
})
afterEach(() => {
  cleanup()
  for (const value of disposables.splice(0)) value.dispose()
  uniformesContacto.uContactoOn.value = 0
  uniformesContacto.uContactoMapa.value = fallback
})

function setup ({ building = true, visible = true }: { building?: boolean; visible?: boolean } = {}) {
  const scene = new THREE.Scene()
  const group = new THREE.Group()
  group.name = 'edificios'
  group.position.set(20, 0, 30)
  group.visible = visible
  scene.add(group)
  const geometry = new THREE.BoxGeometry(10, 8, 10)
  const material = new THREE.MeshStandardMaterial()
  disposables.push(geometry, material)
  const source = new THREE.Mesh(geometry, material)
  source.castShadow = true
  source.position.set(4, 4, 8)
  if (building) group.add(source)
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 10000)
  camera.position.set(20, 120, 150)
  const previous = new THREE.WebGLRenderTarget(8, 8)
  disposables.push(previous)
  let target: THREE.WebGLRenderTarget | null = previous
  let fail = false
  const captures: {
    scene: THREE.Scene; camera: THREE.Camera; target: THREE.WebGLRenderTarget | null
    autoClear: boolean; shadows: boolean; xr: boolean
  }[] = []
  const gl = {
    autoClear: false,
    shadowMap: { enabled: true },
    xr: { enabled: true },
    info: { render: { calls: 0, triangles: 0 } },
    getRenderTarget: vi.fn(() => target),
    setRenderTarget: vi.fn((value: THREE.WebGLRenderTarget | null) => { target = value }),
    render: vi.fn((passScene: THREE.Scene, passCamera: THREE.Camera) => {
      captures.push({ scene: passScene, camera: passCamera, target, autoClear: gl.autoClear, shadows: gl.shadowMap.enabled, xr: gl.xr.enabled })
      if (fail) throw new Error('GPU simulada')
      gl.info.render.calls = 0
      gl.info.render.triangles = 0
      passScene.traverseVisible(object => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        gl.info.render.calls++
        gl.info.render.triangles += mesh.geometry.index!.count / 3
      })
    }),
  }
  hooks.state = { scene, camera, gl, controls: { target: new THREE.Vector3(20, 0, 30) } }
  SombrasEdificios({ date })
  const frame = () => { expect(hooks.frame).toBeDefined(); hooks.frame!() }
  return { scene, group, source, geometry, gl, previous, captures, frame, fail: () => { fail = true } }
}

describe('pase de profundidad de edificaciones', () => {
  it('proyecta con un proxy que comparte geometría, sin añadir luz a la escena', () => {
    const app = setup()
    app.frame()
    expect(app.gl.render).toHaveBeenCalledOnce()
    const pass = app.captures[0]
    const proxy = pass.scene.children[0] as THREE.Mesh
    expect(proxy.geometry).toBe(app.geometry)
    expect(proxy.matrix.equals(app.source.matrixWorld)).toBe(true)
    expect(proxy.material).toBeInstanceOf(THREE.MeshDepthMaterial)
    expect((proxy.material as THREE.Material).colorWrite).toBe(false)
    expect(pass.camera).toBeInstanceOf(THREE.OrthographicCamera)
    expect(pass.target!.width).toBe(CONTACTO_PX)
    expect(pass.target!.height).toBe(CONTACTO_PX)
    expect(pass.autoClear).toBe(true)
    expect(pass.shadows).toBe(false)
    expect(pass.xr).toBe(false)
    expect(app.scene.children).toEqual([app.group])
    expect(uniformesContacto.uContactoOn.value).toBe(1)
    expect(uniformesContacto.uContactoMapa.value).toBe(pass.target!.depthTexture)
    expect(app.scene.userData.edificiosShadowStats).toMatchObject({ drawCalls: 1, triangles: 12, resolution: CONTACTO_PX })
    expect(app.scene.userData.edificiosShadowStats.width).toBeGreaterThan(0)
    expect(app.gl.getRenderTarget()).toBe(app.previous)
    expect(app.gl.autoClear).toBe(false)
    expect(app.gl.shadowMap.enabled).toBe(true)
    expect(app.gl.xr.enabled).toBe(true)
  })

  it('restaura target, autoClear, sombras y XR aunque el render lance un error', () => {
    const app = setup()
    app.fail()
    expect(app.frame).toThrow('GPU simulada')
    expect(app.gl.getRenderTarget()).toBe(app.previous)
    expect(app.gl.autoClear).toBe(false)
    expect(app.gl.shadowMap.enabled).toBe(true)
    expect(app.gl.xr.enabled).toBe(true)
    expect(uniformesContacto.uContactoOn.value).toBe(0)
  })

  it.each([{ building: false }, { visible: false }])('sin emisores visibles no dibuja: %j', options => {
    const app = setup(options)
    app.frame()
    expect(app.gl.render).not.toHaveBeenCalled()
    expect(uniformesContacto.uContactoOn.value).toBe(0)
    expect(app.gl.getRenderTarget()).toBe(app.previous)
  })

  it('al ocultar o retirar el edificio descarta su proxy y apaga el mapa', () => {
    const app = setup()
    app.frame()
    const passScene = app.captures[0].scene
    expect(passScene.children).toHaveLength(1)
    app.group.remove(app.source)
    app.frame()
    expect(passScene.children).toHaveLength(0)
    expect(app.gl.render).toHaveBeenCalledOnce()
    expect(uniformesContacto.uContactoOn.value).toBe(0)
    expect(app.scene.userData.edificiosShadowStats).toMatchObject({ drawCalls: 0, triangles: 0 })
  })

  it('desmontar libera recursos propios, conserva el buffer compartido y deja un sampler válido', () => {
    const app = setup()
    app.frame()
    const pass = app.captures[0]
    const ownTarget = pass.target!
    const ownMaterial = (pass.scene.children[0] as THREE.Mesh).material as THREE.Material
    const targetDisposed = vi.fn(), materialDisposed = vi.fn(), geometryDisposed = vi.fn()
    ownTarget.addEventListener('dispose', targetDisposed)
    ownMaterial.addEventListener('dispose', materialDisposed)
    app.geometry.addEventListener('dispose', geometryDisposed)
    cleanup()
    expect(targetDisposed).toHaveBeenCalledOnce()
    expect(materialDisposed).toHaveBeenCalledOnce()
    expect(geometryDisposed).not.toHaveBeenCalled()
    expect(uniformesContacto.uContactoOn.value).toBe(0)
    expect(uniformesContacto.uContactoMapa.value).not.toBe(ownTarget.depthTexture)
    expect(uniformesContacto.uContactoMapa.value).toBeInstanceOf(THREE.DepthTexture)
    expect(uniformesContacto.uContactoMapa.value.compareFunction).toBe(THREE.LessEqualCompare)
    expect(uniformesContacto.uContactoMapa.value.image.width).toBeGreaterThan(0)
    expect(uniformesContacto.uContactoMapa.value.image.height).toBeGreaterThan(0)
  })
})
