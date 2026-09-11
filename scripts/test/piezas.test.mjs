import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PNG } from 'pngjs'
import { PIEZAS } from '../../src/data/piezas'

afterEach(() => vi.unstubAllGlobals())

async function cargarPieza (path) {
  vi.stubGlobal('self', globalThis)
  const file = readFileSync(new URL(path, import.meta.url))
  return new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '')
}

function tableros (scene) {
  const result = []
  scene.updateMatrixWorld(true)
  scene.traverse(object => {
    if (object.isMesh && /^tablero-\d+$/.test(object.name)) result.push(object)
  })
  return result
}

function cruzaPlanoZ (mesh, z = 0) {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.index
  const point = i => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
  const count = index?.count ?? position.count
  for (let i = 0; i < count; i += 3) {
    const zs = [0, 1, 2].map(k => point(index ? index.getX(i + k) : i + k).z)
    if (Math.min(...zs) <= z && Math.max(...zs) >= z) return true
  }
  return false
}

function componentesGeometricos (mesh) {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.index
  const count = index?.count ?? position.count
  const faces = count / 3
  const parent = Array.from({ length: faces }, (_, i) => i)
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]))
  const join = (a, b) => {
    a = find(a); b = find(b)
    if (a !== b) parent[b] = a
  }
  const firstFaceAt = new Map()
  const point = i => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
  for (let face = 0; face < faces; face++) for (let k = 0; k < 3; k++) {
    const i = index ? index.getX(face * 3 + k) : face * 3 + k
    const p = point(i)
    // Blender duplica vértices para normales planas; unir por posición prueba
    // la conectividad física del sólido y no la reutilización de sus índices.
    const key = [p.x, p.y, p.z].map(v => Math.round(v * 1e4)).join('/')
    const other = firstFaceAt.get(key)
    if (other === undefined) firstFaceAt.set(key, face)
    else join(face, other)
  }
  return new Set(parent.map((_, i) => find(i))).size
}

function contieneEstacion (mesh, [x, z], y) {
  const position = mesh.geometry.getAttribute('position')
  const unique = new Map()
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
    if (Math.abs(p.y - y) > 1e-4 || Math.hypot(p.x - x, p.z - z) > 6) continue
    unique.set([p.x, p.y, p.z].map(v => Math.round(v * 1e4)).join('/'), p)
  }
  const points = [...unique.values()]
  return points.some((a, i) => points.slice(i + 1).some(b =>
    Math.hypot((a.x + b.x) / 2 - x, (a.z + b.z) / 2 - z) < 0.02))
}

function marcoEnEstacion (pts, estacion) {
  let recorrida = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[i + 1]
    const largo = Math.hypot(bx - ax, bz - az)
    if (recorrida + largo >= estacion) {
      const t = (estacion - recorrida) / largo
      const tangente = new THREE.Vector2((bx - ax) / largo, (bz - az) / largo)
      return {
        centro: new THREE.Vector2(ax + (bx - ax) * t, az + (bz - az) * t),
        normal: new THREE.Vector2(-tangente.y, tangente.x)
      }
    }
    recorrida += largo
  }
  throw new Error(`estación ${estacion} fuera de una cinta de ${recorrida} m`)
}

function largoEnPlanta (pts) {
  return pts.slice(1).reduce((total, [x, z], i) =>
    total + Math.hypot(x - pts[i][0], z - pts[i][1]), 0)
}

function alturaEn (meshes, marco, lateral) {
  const ray = new THREE.Raycaster(
    new THREE.Vector3(
      marco.centro.x + marco.normal.x * lateral,
      50,
      marco.centro.y + marco.normal.y * lateral
    ),
    new THREE.Vector3(0, -1, 0),
    0,
    100
  )
  const hits = ray.intersectObjects(meshes, false)
  return hits[0]?.point.y
}

function meshesConPrefijo (scene, prefijo) {
  const result = []
  scene.updateMatrixWorld(true)
  scene.traverse(object => {
    if (object.isMesh && object.name.startsWith(prefijo)) result.push(object)
  })
  return result
}

function areasDeTriangulos (mesh) {
  const position = mesh.geometry.getAttribute('position')
  const index = mesh.geometry.index
  const count = index?.count ?? position.count
  const point = i => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const cross = new THREE.Vector3()
  const areas = []
  for (let i = 0; i < count; i += 3) {
    const a = point(index ? index.getX(i) : i)
    const b = point(index ? index.getX(i + 1) : i + 1)
    const c = point(index ? index.getX(i + 2) : i + 2)
    areas.push(cross.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).length() / 2)
  }
  return areas
}

describe('assets del manifiesto de piezas', () => {
  it('resuelve cada ruta dentro del repo y conserva la procedencia del GLB', () => {
    expect(new Set(PIEZAS.map(p => p.id)).size).toBe(PIEZAS.length)
    for (const pieza of PIEZAS) {
      expect(pieza.glb.startsWith('piezas/')).toBe(true)
      expect(pieza.glb).not.toContain('..')
      const file = readFileSync(new URL(`../../public/data/${pieza.glb}`, import.meta.url))
      expect(file.toString('ascii', 0, 4)).toBe('glTF')
      const gltf = JSON.parse(file.toString('utf8', 20, 20 + file.readUInt32LE(12)))
      expect(gltf.asset.extras['representación']).toBe(pieza.representación)
      expect(gltf.asset.extras.units).toBe('metres')
      expect(gltf.asset.extras.axes).toEqual({ X: 'east', Y: 'up', Z: '-north' })
    }
  })

  it('el Obelisco conserva los bytes entregados, incluidos materiales y procedencia', () => {
    const file = readFileSync(new URL('../../public/data/piezas/obelisco-italianos.glb', import.meta.url))
    expect(createHash('sha256').update(file).digest('hex')).toBe('cf2a71ac3e0f4fe2907cc8de1fc57bc65deef429851093b651433010054be67c')
  })

  it('el Viaducto Nuevo tiene dos tableros continuos que cruzan el centro de extremo a extremo', async () => {
    const source = JSON.parse(readFileSync(new URL('../viaducto-nuevo.json', import.meta.url), 'utf8'))
      ['Avenida Viaducto Nuevo']
    const gltf = await cargarPieza('../../public/data/piezas/viaducto-nuevo.glb')
    const decks = tableros(gltf.scene)
    expect(gltf.parser.json.asset.extras.nota).toBe(source.nota)
    expect(source.cintas).toHaveLength(2)
    expect(decks).toHaveLength(2)
    for (const [i, deck] of decks.entries()) {
      const bounds = new THREE.Box3().setFromObject(deck)
      expect(bounds.min.z).toBeLessThan(-150)
      expect(bounds.max.z).toBeGreaterThan(150)
      expect(cruzaPlanoZ(deck)).toBe(true)
      expect(componentesGeometricos(deck)).toBe(1)
      for (let j = 0; j < source.cintas[i].pts.length; j++) {
        expect(contieneEstacion(deck, source.cintas[i].pts[j], source.cintas[i].alturas[j])).toBe(true)
      }
    }
  })

  it('el tablero del Viaducto Nuevo sigue la rasante descendente hacia el sur', async () => {
    const gltf = await cargarPieza('../../public/data/piezas/viaducto-nuevo.glb')
    const decks = tableros(gltf.scene)
    expect(decks).toHaveLength(2)
    for (const deck of decks) {
      const position = deck.geometry.getAttribute('position')
      const points = Array.from({ length: position.count }, (_, i) =>
        new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(deck.matrixWorld))
      const north = Math.max(...points.filter(p => p.z < -150).map(p => p.y))
      const south = Math.max(...points.filter(p => p.z > 150).map(p => p.y))
      expect(north - south).toBeGreaterThan(14)
      expect(north - south).toBeLessThan(18)
    }
  })

  it('el Viaducto Nuevo abre ambos pretiles y ensancha la rodadura en Calle 4 y Fortunato Gómez', async () => {
    const source = JSON.parse(readFileSync(new URL('../viaducto-nuevo.json', import.meta.url), 'utf8'))
      ['Avenida Viaducto Nuevo']
    const gltf = await cargarPieza('../../public/data/piezas/viaducto-nuevo.glb')
    const cruces = [
      { cinta: 0, estacionFuente: 118.85134, largoFuente: 360.04064 },
      { cinta: 1, estacionFuente: 121.70237, largoFuente: 364.19890 }
    ]

    for (const { cinta, estacionFuente, largoFuente } of cruces) {
      const estacion = largoEnPlanta(source.cintas[cinta].pts) * estacionFuente / largoFuente
      const pretiles = meshesConPrefijo(gltf.scene, `pretil-${cinta}-`)
      const rodadura = meshesConPrefijo(gltf.scene, `rodadura-${cinta}`)
      expect(pretiles.length).toBeGreaterThan(0)
      expect(rodadura).toHaveLength(1)

      // La abertura libre mide 8 m: no hay concreto hasta casi cada borde.
      for (const desplazamiento of [-3.9, 0, 3.9]) {
        const marco = marcoEnEstacion(source.cintas[cinta].pts, estacion + desplazamiento)
        for (const lateral of [-4.325, 4.325]) {
          expect(alturaEn(pretiles, marco, lateral)).toBeUndefined()
        }
      }

      // Cada extremo recupera su altura mediante una cuña de exactamente 2 m.
      for (const desplazamiento of [-5, 5]) {
        const marco = marcoEnEstacion(source.cintas[cinta].pts, estacion + desplazamiento)
        for (const lateral of [-4.325, 4.325]) {
          const altura = alturaEn(pretiles, marco, lateral)
          expect(altura).toBeDefined()
          expect(altura - alturaEn(rodadura, marco, 0)).toBeCloseTo(0.525 - 0.06, 2)
        }
      }

      // En el corazón del cruce, el asfalto cubre el tablero hasta casi su borde.
      for (const desplazamiento of [-1.9, 0, 1.9]) {
        const marco = marcoEnEstacion(source.cintas[cinta].pts, estacion + desplazamiento)
        for (const lateral of [-4.45, 4.45]) {
          expect(alturaEn(rodadura, marco, lateral)).toBeDefined()
        }
      }

      for (const pretil of pretiles) {
        expect(Math.min(...areasDeTriangulos(pretil))).toBeGreaterThan(1e-7)
      }
    }
  })

  it('three carga la pieza real con apoyo Y=0, escala métrica y los tres mapas PBR embebidos', async () => {
    // Solo el decodificador de imagen del navegador se sustituye por PNG real
    // en Node; GLTFLoader, buffers, geometría y materiales son los de producción.
    vi.stubGlobal('self', globalThis)
    vi.stubGlobal('createImageBitmap', async blob => {
      const { width, height } = PNG.sync.read(Buffer.from(await blob.arrayBuffer()))
      return { width, height, close () {} }
    })
    const file = readFileSync(new URL('../../public/data/piezas/obelisco-italianos.glb', import.meta.url))
    const gltf = await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength), '')
    const bounds = new THREE.Box3().setFromObject(gltf.scene)
    expect(bounds.min.y).toBe(0)
    expect(bounds.max.y).toBe(28)
    let triangles = 0
    const textures = new Set()
    gltf.scene.traverse(object => {
      const mesh = object
      if (!mesh.isMesh) return
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3
      expect(mesh.scale.toArray()).toEqual([1, 1, 1])
      expect(mesh.material).toBeInstanceOf(THREE.MeshStandardMaterial)
      expect(mesh.material.vertexColors).toBe(true)
      expect(mesh.material.userData['representación']).toBe('generada')
      expect(mesh.material.map?.colorSpace).toBe(THREE.SRGBColorSpace)
      expect(mesh.material.normalMap?.colorSpace).toBe(THREE.NoColorSpace)
      expect(mesh.material.roughnessMap).toBe(mesh.material.metalnessMap)
      for (const texture of [mesh.material.map, mesh.material.normalMap, mesh.material.roughnessMap]) {
        expect(texture).toBeInstanceOf(THREE.Texture)
        expect(texture.image).toMatchObject({ width: 256, height: 256 })
        textures.add(texture)
      }
      mesh.geometry.dispose()
      mesh.material.dispose()
    })
    expect(triangles).toBe(324)
    textures.forEach(texture => texture.dispose())
  })
})
