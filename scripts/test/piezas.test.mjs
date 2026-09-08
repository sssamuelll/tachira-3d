import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PNG } from 'pngjs'
import { PIEZAS } from '../../src/data/piezas'

afterEach(() => vi.unstubAllGlobals())

describe('assets del manifiesto de piezas', () => {
  it('resuelve cada ruta dentro del repo y conserva la procedencia del GLB', () => {
    expect(new Set(PIEZAS.map(p => p.id)).size).toBe(PIEZAS.length)
    for (const pieza of PIEZAS) {
      expect(pieza.glb.startsWith('/data/piezas/')).toBe(true)
      expect(pieza.glb).not.toContain('..')
      const file = readFileSync(new URL(`../../public${pieza.glb}`, import.meta.url))
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
