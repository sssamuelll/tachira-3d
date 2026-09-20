import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { CSM } from 'three/examples/jsm/csm/CSM.js'
import { PIEZAS, type Pieza } from '../data/piezas'
import { urlVersionado } from '../data/rutas'
import { xTesela, yTesela } from '../data/mercator'
import { enuOf } from './Camera'
import { alturaTerreno, distanciaVista } from './distanciaVista'
import { edificiosActivos, HALO_EDIFICIOS, sueloEdificiosListo } from './buildingsStyle'
import { telemetria } from './telemetria'
import { metrosPorPixel } from './roadStyle'
import { materialPieza } from './piezasShader'

interface Instancia {
  root: THREE.Group
  origen: THREE.Vector3
  verticalGeo: THREE.Vector3
  dem: string[]
  modelo: THREE.Group | null
  originales: Map<THREE.Mesh, THREE.Material | THREE.Material[]>
  materiales: Map<THREE.Material, THREE.Material>
  csm: CSM | null
  cota: number | null
  proximoApoyo: number
}

/** Subir solo Y desde enuOf(lat, lon, 0) desplaza el Obelisco 6 m en XZ.
 * A lat/lon fijas, ENU es lineal con la altura geodésica. Reproyectamos sobre
 * esa recta hasta apoyar a <1 mm, con cuatro consultas como máximo por intento.
 * Solo se ejecuta al obtener/recuperar cobertura, nunca con una pieza apoyada. */
function apoyar (pieza: Instancia, scene: THREE.Scene): number | null {
  const p = pieza.root.position
  for (let i = 0; i < 4; i++) {
    const y = alturaTerreno(p, scene)
    if (y === null) return null
    const diferencia = Math.abs(y - p.y)
    const h = (y - pieza.origen.y) / pieza.verticalGeo.y
    p.copy(pieza.origen).addScaledVector(pieza.verticalGeo, h)
    if (diferencia < 0.001) return y
  }
  return null
}

function liberarMateriales (pieza: Instancia) {
  for (const material of pieza.materiales.values()) {
    pieza.csm?.shaders.delete(material)
    material.dispose()
  }
  pieza.materiales.clear()
  for (const [mesh, original] of pieza.originales) mesh.material = original
}

/** El cargador es dueño del GLB completo; los clones CSM comparten texturas.
 * Se liberan una vez, incluso con materiales/texturas usados por varias mallas. */
function liberarModelo (modelo: THREE.Group) {
  const geometrias = new Set<THREE.BufferGeometry>()
  const materiales = new Set<THREE.Material>()
  const texturas = new Set<THREE.Texture>()
  const imagenes = new Set<ImageBitmap>()
  modelo.traverse(objeto => {
    const mesh = objeto as THREE.Mesh
    if (!mesh.isMesh) return
    geometrias.add(mesh.geometry)
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materiales.add(m)
  })
  for (const m of materiales) {
    for (const value of Object.values(m)) if (value instanceof THREE.Texture) texturas.add(value)
    m.dispose()
  }
  for (const t of texturas) {
    const bitmap = t.source.data as ImageBitmap | null
    if (typeof bitmap?.close === 'function') imagenes.add(bitmap)
    t.dispose()
  }
  for (const bitmap of imagenes) bitmap.close()
  for (const g of geometrias) g.dispose()
}

export function Piezas ({ piezas = PIEZAS }: { piezas?: readonly Pieza[] } = {}) {
  const { scene, camera, controls, size, invalidate } = useThree()
  const group = useRef<THREE.Group>(null)
  const state = useRef<{ piezas: Instancia[]; dem: Set<string>; active: boolean } | null>(null)

  useEffect(() => {
    const root = group.current!
    const controller = new AbortController()
    const loader = new GLTFLoader()
    const runtime = { piezas: [] as Instancia[], dem: new Set<string>(), active: false }
    state.current = runtime
    scene.userData.piezasDem = runtime.dem
    root.visible = false
    for (const def of piezas) {
      const anchor = new THREE.Group()
      anchor.name = def.id
      anchor.userData = { ...def }
      anchor.position.copy(enuOf(def.lat, def.lon))
      anchor.rotation.y = -THREE.MathUtils.degToRad(def.rumbo ?? 0)
      anchor.visible = false
      root.add(anchor)
      const pieza: Instancia = {
        root: anchor, origen: anchor.position.clone(),
        verticalGeo: enuOf(def.lat, def.lon, 1).sub(anchor.position),
        dem: [`15/${Math.floor(xTesela(def.lon, 15))}/${Math.floor(yTesela(def.lat, 15))}`],
        modelo: null, originales: new Map(), materiales: new Map(), csm: null, cota: null, proximoApoyo: 0,
      }
      runtime.piezas.push(pieza)
      // La pieza declara su GLB relativo al raíz de datos; acá se resuelve.
      // El segundo argumento de parseAsync es la carpeta desde la que el GLB
      // resolvería recursos externos, así que se deriva de la URL ya resuelta.
      const url = urlVersionado(def.glb)
      void fetch(url, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
        const buffer = await response.arrayBuffer()
        if (controller.signal.aborted) return
        const gltf = await loader.parseAsync(buffer, url.slice(0, url.lastIndexOf('/') + 1))
        if (controller.signal.aborted) { liberarModelo(gltf.scene); return }
        pieza.modelo = gltf.scene
        gltf.scene.traverse(objeto => {
          const mesh = objeto as THREE.Mesh
          if (!mesh.isMesh) return
          mesh.castShadow = true
          mesh.receiveShadow = true
          // El renderer recorta por separado vista y cascadas, como Buildings.
          mesh.frustumCulled = true
          pieza.originales.set(mesh, mesh.material)
        })
        anchor.add(gltf.scene)
        // El GLB entra al grafo sin pasar por React: con el bucle por demanda
        // (App.tsx) la pieza no se vería hasta que alguien tocara la cámara.
        invalidate()
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return
        anchor.userData.error = String(error)
        console.warn(`No se pudo cargar la pieza ${def.id}:`, error)
      })
    }
    return () => {
      controller.abort()
      for (const pieza of runtime.piezas) {
        liberarMateriales(pieza)
        if (pieza.modelo) liberarModelo(pieza.modelo)
        root.remove(pieza.root)
      }
      runtime.dem.clear()
      if (scene.userData.piezasDem === runtime.dem) delete scene.userData.piezasDem
      if (state.current === runtime) state.current = null
    }
  }, [scene, piezas])

  useFrame(frame => telemetria.mide('piezas.ms', () => {
    const runtime = state.current
    if (!runtime || !group.current) return
    const csm = (scene.userData.csm ?? null) as CSM | null
    const target = (controls as { target?: THREE.Vector3 } | null)?.target
    const now = frame.clock.elapsedTime
    const mpp = metrosPorPixel(distanciaVista(camera, scene, target, now),
      (camera as THREE.PerspectiveCamera).fov ?? 45, size.height)
    runtime.active = edificiosActivos(mpp, runtime.active) && csm !== null
    group.current.visible = runtime.active
    runtime.dem.clear()
    const ready = scene.userData.terrainReady as Set<string> | undefined
    const dibujadas = telemetria.activa ? new Set<string>() : null
    for (const pieza of runtime.piezas) {
      if (pieza.modelo && csm !== pieza.csm) {
        liberarMateriales(pieza)
        pieza.csm = csm
        if (csm) {
          const preparar = (original: THREE.Material) => {
            let m = pieza.materiales.get(original)
            if (!m) { m = materialPieza(original, csm); pieza.materiales.set(original, m) }
            return m
          }
          for (const [mesh, original] of pieza.originales) {
            mesh.material = Array.isArray(original) ? original.map(preparar) : preparar(original)
          }
        }
      }
      const cerca = runtime.active && Math.hypot(
        camera.position.x - pieza.root.position.x, camera.position.z - pieza.root.position.z,
      ) <= HALO_EDIFICIOS
      if (cerca) for (const key of pieza.dem) runtime.dem.add(key)
      const sueloListo = cerca && sueloEdificiosListo(pieza.dem, ready)
      if (!sueloListo) { pieza.cota = null; pieza.proximoApoyo = 0 }
      // z15 ya representa el DEM definitivo; z16/17 refinan la imagen sobre
      // esa misma superficie (TerrainLod). No fijar una cota de sus padres.
      // Apoyo acotado al llegar esa cobertura, ninguno por cuadro una vez
      // apoyada. Si excepcionalmente no hay hit, reintentar a 5 Hz máximo.
      if (sueloListo && pieza.modelo && pieza.cota === null && now >= pieza.proximoApoyo) {
        pieza.cota = apoyar(pieza, scene)
        pieza.proximoApoyo = now + 0.2
      }
      pieza.root.visible = sueloListo && pieza.modelo !== null && pieza.cota !== null
      if (pieza.root.visible) dibujadas?.add(pieza.root.name)
      else if (cerca && pieza.modelo) telemetria.sube('piezas.sin_suelo')
    }
    if (dibujadas) telemetria.conjunto('piezas.dibujadas', dibujadas)
  }), -0.2) // Después de terreno/cámara; antes del pase de contacto (-0.1).

  return <group ref={group} name="piezas" visible={false} />
}
