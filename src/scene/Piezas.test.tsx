import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import { Piezas } from './Piezas'
import { PIEZAS, type Pieza } from '../data/piezas'
import { enuOf, geoOf } from './Camera'

const hooks = vi.hoisted(() => ({
  effects: [] as (() => (() => void) | undefined)[],
  frame: undefined as ((state: { clock: { elapsedTime: number } }) => void) | undefined,
  state: undefined as unknown,
}))
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useEffect: (effect: () => (() => void) | undefined) => { hooks.effects.push(effect) },
}))
vi.mock('@react-three/fiber', () => ({
  useThree: () => hooks.state,
  useFrame: (frame: typeof hooks.frame) => { hooks.frame = frame },
}))

const cleanups: (() => void)[] = []
beforeEach(() => { hooks.effects.length = 0; hooks.frame = undefined })
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function modelo () {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ roughness: 0.73, metalness: 0.1 })
  material.map = new THREE.Texture()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(8, 28, 6), material)
  mesh.position.y = 14 // base apoyada en Y=0, como el GLB.
  group.add(mesh)
  return { group, mesh, material }
}

async function setup (piezas: readonly Pieza[] = PIEZAS, pending = false) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 100000)
  // El suelo del fixture se expresa como una COTA (600 m) proyectada por enuOf,
  // no como un Y literal: en ENU la vertical incluye la curvatura, asi que un
  // 600 fijo deja de caer sobre el terreno en cuanto la pieza cambia de sitio.
  const target = enuOf(piezas[0].lat, piezas[0].lon, 600)
  const cota = target.y
  camera.position.copy(target).add(new THREE.Vector3(0, 400, 400))
  camera.lookAt(target)
  const csm = new CSM({ camera, parent: scene, cascades: 3 })
  scene.userData.csm = csm
  cleanups.push(() => { csm.remove(); csm.dispose() })
  const terrain = new THREE.Group()
  terrain.name = 'terrain'
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshBasicMaterial())
  ground.rotation.x = -Math.PI / 2
  ground.position.copy(target)
  terrain.add(ground)
  scene.add(terrain)
  cleanups.push(() => { ground.geometry.dispose(); ground.material.dispose() })
  const models = piezas.map(modelo)
  let next = 0
  let resolveParse!: (value: { scene: THREE.Group }) => void
  // Solo sustituimos red/parseo (cubierto por piezas.test.mjs), no los objetos
  // THREE, el raycast, CSM ni el ciclo de vida que se está verificando.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(4))))
  vi.spyOn(GLTFLoader.prototype, 'parseAsync').mockImplementation(() => pending
    ? new Promise(resolve => { resolveParse = resolve as typeof resolveParse })
    : Promise.resolve({ scene: models[next++].group } as any))
  hooks.state = { scene, camera, controls: { target }, size: { height: 1000 } }
  const element = Piezas({ piezas })
  const root = new THREE.Group()
  root.name = 'piezas'
  element.props.ref.current = root
  scene.add(root)
  for (const effect of hooks.effects.splice(0)) {
    const cleanup = effect()
    if (cleanup) cleanups.push(cleanup)
  }
  await vi.waitFor(() => expect(GLTFLoader.prototype.parseAsync).toHaveBeenCalledTimes(piezas.length))
  const frame = (time = 1) => { hooks.frame!({ clock: { elapsedTime: time } }) }
  // La tesela se deriva de lo que el componente pide, no de una clave escrita a
  // mano: mover una pieza en el manifiesto no debe romper estos tests. Hace
  // falta un cuadro previo, porque la peticion no existe hasta que corre uno.
  const ready = () => {
    if (!scene.userData.piezasDem?.size) frame(-1)
    scene.userData.terrainReady = new Set(scene.userData.piezasDem ?? [])
  }
  return { scene, camera, target, cota, csm, terrain, ground, root, models, frame, ready,
    resolveParse: async () => { resolveParse({ scene: models[0].group }); await new Promise(resolve => setTimeout(resolve, 0)) } }
}

describe('piezas GLB sobre el mapa', () => {
  it('espera el DEM exacto aun si el raycast ya encuentra un padre provisional', async () => {
    const app = await setup()
    app.frame()
    const piece = app.root.children[0]
    expect(piece.visible).toBe(false)
    // Cada pieza pide su tesela; las que caen en la misma la comparten, así que
    // el total va entre una y una por pieza. Fijarlo en 1 lo rompía al añadir
    // piezas en otro sitio.
    expect(app.scene.userData.piezasDem.size).toBeGreaterThanOrEqual(1)
    expect(app.scene.userData.piezasDem.size).toBeLessThanOrEqual(PIEZAS.length)
    app.ready()
    app.frame(2)
    expect(piece.visible).toBe(true)
    const [lat, lon] = geoOf(piece.position)
    expect(lat).toBeCloseTo(PIEZAS[0].lat, 9)
    expect(lon).toBeCloseTo(PIEZAS[0].lon, 9)
    expect(piece.position.y).toBeCloseTo(app.cota, 6)
    expect(piece.scale.toArray()).toEqual([1, 1, 1])
    expect(piece.userData['representación']).toBe('generada')
    expect(app.models[0].mesh.castShadow).toBe(true)
    expect(app.models[0].mesh.receiveShadow).toBe(true)
    expect(app.models[0].mesh.frustumCulled).toBe(true)
  })

  it('conserva lat/lon y apoyo al corregir XZ sobre terreno inclinado', async () => {
    const app = await setup()
    app.ground.geometry.rotateX(-Math.PI / 2)
    app.ground.rotation.set(0, 0, 0.25)
    app.ready(); app.frame()
    const piece = app.root.children[0]
    expect(piece.visible).toBe(true)
    const [lat, lon] = geoOf(piece.position)
    expect(lat).toBeCloseTo(PIEZAS[0].lat, 9)
    expect(lon).toBeCloseTo(PIEZAS[0].lon, 9)
    const y = app.cota + (piece.position.x - app.target.x) * Math.tan(0.25)
    expect(piece.position.y).toBeCloseTo(y, 3)
  })

  it('ignora padres ocultos y oculta de nuevo al perder la cobertura', async () => {
    const app = await setup()
    const parent = app.ground.clone()
    parent.position.y = 1000
    parent.visible = false
    app.terrain.add(parent)
    app.ready(); app.frame()
    const piece = app.root.children[0]
    expect(piece.position.y).toBeCloseTo(app.cota)
    app.scene.userData.terrainReady.clear()
    app.frame(2)
    expect(piece.visible).toBe(false)
    app.ground.position.y = app.cota + 50
    app.ready(); app.frame(3)
    expect(piece.visible).toBe(true)
    expect(piece.position.y).toBeCloseTo(app.cota + 50)
  })

  it('no repite el raycast vertical en cuadros estables', async () => {
    const app = await setup()
    app.ready()
    const raycast = vi.spyOn(app.ground, 'raycast')
    app.frame()
    // Un rayo central compartido para mpp y dos de apoyo para conservar lat/lon.
    const first = raycast.mock.calls.length
    expect(first).toBe(1 + 2 * PIEZAS.length)
    for (let i = 1; i <= 60; i++) app.frame(1 + i / 60)
    expect(raycast.mock.calls.length - first).toBe(60)
  })

  it('si no hay impacto no aparece y limita los reintentos a cinco por segundo', async () => {
    const app = await setup()
    app.ready()
    app.ground.raycast = vi.fn()
    for (let i = 0; i < 60; i++) app.frame(i / 60)
    expect(app.root.children[0].visible).toBe(false)
    // 60 rayos centrales para mpp y como máximo 5 verticales fallidos por pieza.
    expect(app.ground.raycast).toHaveBeenCalledTimes(60 + 5 * PIEZAS.length)
  })

  it('usa el corte mpp de edificios y deja de pedir DEM lejos de la pieza', async () => {
    const app = await setup()
    app.ready(); app.frame()
    expect(app.root.children[0].visible).toBe(true)
    app.camera.position.copy(app.target).add(new THREE.Vector3(0, 30000, 30000))
    app.camera.lookAt(app.target)
    app.frame(2)
    expect(app.root.visible).toBe(false)
    expect(app.scene.userData.piezasDem.size).toBe(0)
    app.camera.position.copy(app.target).add(new THREE.Vector3(6000, 400, 400))
    app.camera.lookAt(app.target.clone().add(new THREE.Vector3(6000, 0, 0)))
    app.frame(3)
    expect(app.root.children[0].visible).toBe(false)
    expect(app.scene.userData.piezasDem.size).toBe(0)
  })

  it('mantiene emisores cercanos fuera del encuadre principal', async () => {
    const app = await setup()
    app.camera.lookAt(app.target.clone().add(new THREE.Vector3(1500, 0, 0)))
    app.ready(); app.frame()
    expect(app.root.children[0].visible).toBe(true)
    expect(app.scene.userData.piezasDem.size).toBeGreaterThanOrEqual(1)
  })

  it('admite otra entrada y aplica rumbos horarios sobre -Z sin cambiar el GLB', async () => {
    const app = await setup([PIEZAS[0], { ...PIEZAS[0], id: 'node/2', rumbo: 90 }])
    app.ready(); app.frame()
    expect(app.root.children).toHaveLength(2)
    const [first, second] = app.root.children
    expect(first.rotation.y).toBeCloseTo(-PIEZAS[0].rumbo! * Math.PI / 180)
    expect(new THREE.Vector3(0, 0, -1).applyEuler(second.rotation).x).toBeCloseTo(1)
    expect(app.models[1].mesh.position.y).toBe(14)
    expect(app.models[1].mesh.scale.toArray()).toEqual([1, 1, 1])
  })

  it('recrea los materiales al cambiar CSM y libera los registros anteriores', async () => {
    const app = await setup()
    app.ready(); app.frame()
    const mesh = app.models[0].mesh
    const oldMaterial = mesh.material
    const disposed = vi.fn()
    oldMaterial.addEventListener('dispose', disposed)
    const nextCSM = new CSM({ camera: app.camera, parent: app.scene, cascades: 3 })
    cleanups.unshift(() => { nextCSM.remove(); nextCSM.dispose() })
    app.csm.dispose()
    app.scene.userData.csm = nextCSM
    app.frame(2)
    expect(disposed).toHaveBeenCalledOnce()
    expect(app.csm.shaders.has(oldMaterial)).toBe(false)
    expect(mesh.material).not.toBe(oldMaterial)
    expect(mesh.material.map).toBe(app.models[0].material.map)
    expect(nextCSM.shaders.has(mesh.material)).toBe(true)
    expect(app.root.children[0].visible).toBe(true)
  })

  it('desmontar aborta cargas y libera geometría, materiales, texturas y demanda', async () => {
    const app = await setup()
    app.ready(); app.frame()
    const { mesh, material } = app.models[0]
    const resources = [mesh.geometry, material, material.map!, mesh.material]
    const disposed = resources.map(resource => {
      const spy = vi.fn(); resource.addEventListener('dispose', spy); return spy
    })
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!
    cleanups.pop()!()
    expect(signal.aborted).toBe(true)
    expect(app.root.children).toHaveLength(0)
    expect(app.scene.userData.piezasDem).toBeUndefined()
    expect(app.csm.shaders.size).toBe(0)
    disposed.forEach(spy => expect(spy).toHaveBeenCalledOnce())
  })

  it('libera un GLB cuyo parseo termina después del desmontaje', async () => {
    const app = await setup(PIEZAS, true)
    const disposed = vi.fn()
    app.models[0].mesh.geometry.addEventListener('dispose', disposed)
    cleanups.pop()!()
    await app.resolveParse()
    expect(app.root.children).toHaveLength(0)
    expect(disposed).toHaveBeenCalledOnce()
  })
})
