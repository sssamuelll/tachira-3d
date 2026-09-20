import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { CSM } from 'three/examples/jsm/csm/CSM.js'
import {
  BUILDINGS_BASE, BUILDINGS_INDEX, BuildingDownloads, decodeBuildingChunk, validateBuildingManifest,
  type BuildingBuffer, type BuildingChunkMeta,
} from '../data/buildings'
import { cajasSustituidas, vaciarSustituidos } from '../data/piezas'
import { materialEdificios } from './buildingsShader'
import { distanciaVista } from './distanciaVista'
import { metrosPorPixel } from './roadStyle'
import { telemetria } from './telemetria'
import {
  edificiosActivos, candidatosEdificios, sueloEdificiosListo,
  CHUNKS_EDIFICIOS_CACHE, BYTES_EDIFICIOS_CACHE,
} from './buildingsStyle'

interface SpatialChunk extends BuildingChunkMeta { caja: THREE.Box3 }
interface CachedChunk {
  meta: SpatialChunk
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  bytes: number
  used: number
}
interface BuildingRuntime {
  alive: boolean
  active: boolean
  chunks: SpatialChunk[]
  candidates: SpatialChunk[]
  wanted: Set<string>
  dem: Set<string>
  downloads: BuildingDownloads<SpatialChunk>
  meshes: Map<string, CachedChunk>
  bytes: number
  nextSelection: number
  csm: CSM | null
  material: THREE.MeshStandardMaterial | null
}

const INTERVALO_SELECCION = 0.2

/** La malla fusionada de una tesela, ya sin los bloques que una pieza GLB
 * sustituye. Un chunk sin sustitución no paga copia ni recorrido extra. */
export function geometriaChunk (data: BuildingBuffer, bounds: readonly number[]): THREE.BufferGeometry {
  const indices = vaciarSustituidos(data.positions, data.indices, cajasSustituidas(bounds))
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3, true))
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3, true))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  return geometry
}

function bytesChunk (meta: BuildingChunkMeta): number {
  return Math.ceil((16 + meta.vertices * 18) / 4) * 4 + meta.triangles * 12
}

function liberarMaterial (runtime: BuildingRuntime) {
  if (!runtime.material) return
  runtime.csm?.shaders.delete(runtime.material)
  runtime.material.dispose()
  runtime.material = null
}

function liberarChunk (runtime: BuildingRuntime, group: THREE.Group, key: string) {
  const chunk = runtime.meshes.get(key)
  if (!chunk) return
  group.remove(chunk.mesh)
  chunk.mesh.geometry.dispose()
  runtime.bytes -= chunk.bytes
  runtime.meshes.delete(key)
}

/** Recorta por presupuesto ANTES de pedir DEM/geometría: si una zona futura
 * excede 96 MiB activos, conserva los chunks más cercanos sin recargar en bucle. */
function seleccionarChunks (runtime: BuildingRuntime, camera: THREE.Camera) {
  let bytes = 0
  runtime.candidates = candidatosEdificios(runtime.chunks, camera.position).filter(meta => {
    if (runtime.downloads.failed.has(meta.key)) return false
    const size = bytesChunk(meta)
    if (bytes + size > BYTES_EDIFICIOS_CACHE) return false
    bytes += size
    return true
  })
  runtime.wanted = new Set(runtime.candidates.map(chunk => chunk.key))
  runtime.dem.clear()
  for (const meta of runtime.candidates) for (const key of meta.demNodes) runtime.dem.add(key)
  runtime.downloads.select(runtime.wanted)
}

/** Una malla fusionada por tesela; ni React ni el scene graph ven un objeto
 * por edificio. El JSON editable queda junto al binario y se carga a demanda
 * cuando exista la herramienta de edición. */
export function Buildings () {
  const { camera, controls, scene, size, invalidate } = useThree()
  const group = useRef<THREE.Group>(null)
  const state = useRef<BuildingRuntime | null>(null)

  useEffect(() => {
    const root = group.current!
    const runtime: BuildingRuntime = {
      alive: true, active: false, chunks: [], candidates: [], wanted: new Set(), dem: new Set(),
      downloads: new BuildingDownloads<SpatialChunk>(), meshes: new Map(),
      bytes: 0, nextSelection: 0, csm: null, material: null,
    }
    state.current = runtime
    scene.userData.edificiosDem = runtime.dem
    const stats = { activos: 0, candidatos: 0, cargados: 0, pendientes: 0, triangulos: 0, bytes: 0, fallos: 0, mpp: Infinity }
    scene.userData.edificiosStats = stats
    root.userData.stats = stats
    const controller = new AbortController()
    void fetch(BUILDINGS_INDEX, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`${BUILDINGS_INDEX}: HTTP ${response.status}`)
      const manifest = validateBuildingManifest(await response.json())
      if (!runtime.alive) return
      runtime.chunks = manifest.chunks.map(meta => ({
        ...meta,
        caja: new THREE.Box3(
          new THREE.Vector3(...meta.bounds.slice(0, 3)),
          new THREE.Vector3(...meta.bounds.slice(3, 6)),
        ),
      }))
      runtime.nextSelection = 0
      root.userData.manifest = manifest
      // El índice llega a un ref, sin re-render: con el bucle por demanda
      // (App.tsx) nadie pediría el cuadro que lo convierte en geometría.
      invalidate()
    }).catch((error: unknown) => {
      if (controller.signal.aborted || !runtime.alive) return
      root.userData.error = String(error)
      console.warn('No se pudo cargar el índice de edificaciones:', error)
    })
    return () => {
      runtime.alive = false
      controller.abort()
      runtime.downloads.dispose()
      for (const key of runtime.meshes.keys()) liberarChunk(runtime, root, key)
      liberarMaterial(runtime)
      runtime.dem.clear()
      if (scene.userData.edificiosDem === runtime.dem) delete scene.userData.edificiosDem
      if (scene.userData.edificiosStats === stats) delete scene.userData.edificiosStats
      delete root.userData.stats
      delete root.userData.manifest
      if (state.current === runtime) state.current = null
    }
  }, [scene])

  useFrame(frame => telemetria.mide('edificios.ms', () => {
    const runtime = state.current
    const root = group.current
    if (!runtime || !root) return
    const csm = (scene.userData.csm ?? null) as CSM | null
    if (csm !== runtime.csm) {
      liberarMaterial(runtime)
      runtime.csm = csm
      if (csm) {
        const material = materialEdificios(csm)
        runtime.material = material
        for (const chunk of runtime.meshes.values()) chunk.mesh.material = material
      }
    }
    const target = (controls as { target?: THREE.Vector3 } | null)?.target
    const mpp = metrosPorPixel(
      distanciaVista(camera, scene, target, frame.clock.elapsedTime),
      (camera as THREE.PerspectiveCamera).fov ?? 45, size.height,
    )
    const active = edificiosActivos(mpp, runtime.active) && csm !== null
    root.visible = active
    if (active !== runtime.active) {
      runtime.active = active
      runtime.nextSelection = 0
    }
    if (!active) {
      runtime.dem.clear()
      runtime.candidates = []
      runtime.wanted.clear()
      runtime.downloads.select(runtime.wanted)
      Object.assign(root.userData.stats, { activos: 0, candidatos: 0, triangulos: 0, pendientes: runtime.downloads.pending.size, mpp })
      return
    }
    const now = frame.clock.elapsedTime
    if (now >= runtime.nextSelection) {
      seleccionarChunks(runtime, camera)
      runtime.nextSelection = now + INTERVALO_SELECCION
    }
    const ready = scene.userData.terrainReady as Set<string> | undefined
    let activeChunks = 0
    let triangles = 0
    // Las manzanas que se están dibujando, para medir cuántas entran y salen
    // por cuadro: una que se apaga porque su suelo dejó de estar cubierto es
    // un parpadeo, no un cambio de vista (telemetria.ts).
    const dibujados = telemetria.activa ? new Set<string>() : null
    for (const chunk of runtime.meshes.values()) {
      const wanted = runtime.wanted.has(chunk.meta.key)
      chunk.mesh.visible = wanted && sueloEdificiosListo(chunk.meta.demNodes, ready)
      if (wanted) chunk.used = now
      if (chunk.mesh.visible) { activeChunks++; triangles += chunk.meta.triangles; dibujados?.add(chunk.meta.key) }
      else if (wanted) telemetria.sube('edificios.sin_suelo')
    }
    if (dibujados) telemetria.conjunto('edificios.chunks', dibujados)

    // Una validación/construcción por cuadro, sin setState. Dos buffers como
    // máximo entre vuelo y cola evitan una ráfaga de parseo al terminar fetch.
    const next = runtime.downloads.ready.entries().next().value
    if (next && runtime.material) {
      const [key, { meta, buffer }] = next
      runtime.downloads.ready.delete(key)
      if (runtime.wanted.has(key)) {
        try {
          const data = decodeBuildingChunk(buffer, meta)
          const old = [...runtime.meshes.values()].filter(chunk => !runtime.wanted.has(chunk.meta.key))
            .sort((a, b) => a.used - b.used)
          for (const chunk of old) {
            if (runtime.meshes.size < CHUNKS_EDIFICIOS_CACHE && runtime.bytes + data.byteLength <= BYTES_EDIFICIOS_CACHE) break
            liberarChunk(runtime, root, chunk.meta.key)
          }
          const geometry = geometriaChunk(data, meta.bounds)
          geometry.boundingBox = meta.caja.clone()
          geometry.boundingSphere = meta.caja.getBoundingSphere(new THREE.Sphere())
          const mesh = new THREE.Mesh(geometry, runtime.material)
          mesh.name = `edificios-${key}`
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.visible = sueloEdificiosListo(meta.demNodes, ready)
          // Mantener frustumCulled=true: WebGLRenderer y WebGLShadowMap
          // evalúan por separado, incluyendo emisores fuera de la imagen.
          mesh.matrixAutoUpdate = false
          mesh.userData.metadataUrl = BUILDINGS_BASE + meta.metadataUrl
          root.add(mesh)
          runtime.meshes.set(key, { meta, mesh, bytes: data.byteLength, used: now })
          runtime.bytes += data.byteLength
          if (mesh.visible) { activeChunks++; triangles += meta.triangles }
        } catch (error) {
          runtime.downloads.failed.add(key)
          console.warn(`Geometría de edificios inválida (${key}):`, error)
        }
      }
    }
    for (const meta of runtime.candidates) {
      if (runtime.downloads.pending.size + runtime.downloads.ready.size >= 2) break
      if (!runtime.meshes.has(meta.key)) runtime.downloads.request(meta)
    }
    // Diagnóstico accesible al inspeccionar el grupo, sin interfaz nueva.
    Object.assign(root.userData.stats, {
      activos: activeChunks, candidatos: runtime.candidates.length, cargados: runtime.meshes.size,
      pendientes: runtime.downloads.pending.size, triangulos: triangles, bytes: runtime.bytes,
      fallos: runtime.downloads.failed.size, mpp,
    })

    // Queda trabajo: hay una descarga en vuelo, o un buffer esperando su
    // turno de convertirse en malla (se arma UNA por cuadro, arriba). Con el
    // bucle por demanda hay que pedir el cuadro siguiente o la tanda se
    // detiene a medio bajar. Se sostiene sola: el primer cuadro lo pide quien
    // movió la cámara, y de ahí en adelante esta línea, hasta que no queda
    // nada pendiente.
    if (runtime.downloads.pending.size > 0 || runtime.downloads.ready.size > 0) invalidate()
  }), -0.2) // Terrain (-0.75) → cámara (-0.5) → masa → contacto (-0.1) → vías (0).

  return <group ref={group} name="edificios" />
}
