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
    const elevation = new Float32Array(W * H) // DEM crudo, para el shader -- ver comentario en terrainShader.ts
    for (let y = 0; y < H; y++) {
      const lat = bbox.n - (bbox.n - bbox.s) * y / (H - 1)   // fila 0 = norte
      for (let x = 0; x < W; x++) {
        const lon = bbox.w + (bbox.e - bbox.w) * x / (W - 1)
        const h = grid[y * W + x]
        const [e, n, u] = geodeticToEnu(frame, lat, lon, h)
        const i = (y * W + x) * 3
        pos[i] = e; pos[i + 1] = u; pos[i + 2] = -n      // ejes de three, igual que pack.mjs
        elevation[y * W + x] = h
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
    g.setAttribute('elevation', new THREE.BufferAttribute(elevation, 1))
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

  // name="terrain": PickingPass.tsx lo busca con scene.getObjectByName para
  // añadir el relieve (solo profundidad) al pase de picking -- sin esto una
  // vía detrás de una montaña se puede seleccionar igual (Task 16, fix round 1).
  return <mesh name="terrain" geometry={geometry} material={material} frustumCulled={false} />
}
