import { useMemo } from 'react'
import * as THREE from 'three'
import { makeEnuFrame, geodeticToEnu } from '../data/enu'
import { terrainVert, terrainFrag } from './terrainShader'
import type { TerrainMeta } from '../data/types'

export function Terrain ({ grid, meta }: { grid: Int16Array; meta: TerrainMeta }) {
  const geometry = useMemo(() => {
    const { width: W, height: H, bbox } = meta
    const frame = makeEnuFrame(meta.origin.lat, meta.origin.lon, meta.origin.h)
    const pos = new Float32Array(W * H * 3)
    for (let y = 0; y < H; y++) {
      const lat = bbox.n - (bbox.n - bbox.s) * y / (H - 1)   // fila 0 = norte
      for (let x = 0; x < W; x++) {
        const lon = bbox.w + (bbox.e - bbox.w) * x / (W - 1)
        const [e, n, u] = geodeticToEnu(frame, lat, lon, grid[y * W + x])
        const i = (y * W + x) * 3
        pos[i] = e; pos[i + 1] = u; pos[i + 2] = -n      // ejes de three, igual que pack.mjs
      }
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6)
    let k = 0
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const a = y * W + x, b = a + 1, c = a + W, d = c + 1
        idx[k++] = a; idx[k++] = c; idx[k++] = b
        idx[k++] = b; idx[k++] = c; idx[k++] = d
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeVertexNormals()
    return g
  }, [grid, meta])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    uniforms: {
      uMin: { value: meta.min }, uMax: { value: meta.max },
      uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    },
  }), [meta])

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
