import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { makeEnuFrame } from '../data/enu'
import { metrosPorPixel } from './roadStyle'
import { terrainVert, terrainFrag } from './terrainShader'
import { CacheTeselas } from './demTiles'
import { seleccionar, clave, type Nodo } from './quadtree'
import { geometriaNodo, raices, ventana } from './nodoTerreno'
import { stateMask } from './stateMask'
import type { TerrainMeta, Municipio } from '../data/types'

// Resolución de la máscara del estado: la misma rejilla de 1024² con la que
// el relieve se recortaba antes (y con la que el minimapa sigue), ~130 m.
const MASCARA = 1024

// Nivel más fino de esta fase: z15 es la superficie exacta del DEM (~36 m) y
// no hay imagen que justifique ir más abajo. Eso es la fase B.
const Z_MAX = 15

// Geometrías que se conservan aunque no se dibujen, para no rearmar el nodo
// al volver a él. Un nodo son ~1.200 vértices: 800 nodos, unos 50 MB.
// Calibrable.
const GEOMETRIAS_MAX = 800

/**
 * El relieve por niveles de detalle. Cada cuadro elige qué nodos del
 * quadtree dibujar (quadtree.ts), arma la malla de los que no tenía
 * (nodoTerreno.ts) a partir de las teselas del DEM (demTiles.ts), y enciende
 * o apaga las demás. El pase de ids recorre este grupo, por su nombre, para
 * usar las mallas visibles como oclusor (PickingPass.tsx).
 */
export function TerrainLod ({ meta, municipios }: { meta: TerrainMeta; municipios: Municipio[] }) {
  const { camera, size } = useThree()
  const grupo = useRef<THREE.Group>(null)
  const frame = useMemo(() => makeEnuFrame(meta.origin.lat, meta.origin.lon, meta.origin.h), [meta])
  const cache = useMemo(() => new CacheTeselas(), [])
  const errores = useRef<Record<string, number> | null>(null)
  useEffect(() => {
    fetch('/data/dem/errores.json').then(r => r.json()).then(e => { errores.current = e })
      .catch(e => console.error('dem/errores.json', e))
  }, [])

  // La máscara del estado como textura de un canal: el fragment descarta
  // fuera de ella con filtro lineal, a media celda del contorno real.
  const mascara = useMemo(() => {
    const tex = new THREE.DataTexture(
      stateMask(municipios, meta.bbox, MASCARA, MASCARA), MASCARA, MASCARA, THREE.RedFormat, THREE.UnsignedByteType,
    )
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.flipY = false                 // fila 0 = norte, igual que uvMascara
    tex.needsUpdate = true
    return tex
  }, [municipios, meta])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: terrainVert, fragmentShader: terrainFrag,
    uniforms: {
      uMin: { value: meta.min }, uMax: { value: meta.max },
      uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uMascara: { value: mascara },
    },
  }), [meta, mascara])

  // Nodo -> malla armada (visible o no), en orden de uso para la LRU.
  const mallas = useMemo(() => new Map<string, { mesh: THREE.Mesh; caja: THREE.Box3 }>(), [])
  const frustum = useMemo(() => new THREE.Frustum(), [])
  const m4 = useMemo(() => new THREE.Matrix4(), [])
  const nodosRaiz = useMemo(() => raices(meta.dem), [meta])

  // El error de errores.json manda, y también dice qué nodos existen: hasta
  // que llegue no se pide ninguna tesela (una raíz vacía no tiene archivo, y
  // el servidor de desarrollo contesta index.html en vez de 404).
  const errorDe = (n: Nodo): number | null => {
    const e = errores.current
    if (!e) return null
    if (n.z <= 14) return e[clave(n)] ?? null
    return e[clave({ z: 14, x: n.x >> 1, y: n.y >> 1 })] == null ? null : 0
  }
  const teselaDe = (n: Nodo) => { const w = ventana(n, meta.dem); return cache.get(w.zt, w.xt, w.yt) }
  const cajaDe = (n: Nodo): THREE.Box3 => {
    const k = clave(n)
    let m = mallas.get(k)
    if (!m) {
      const { geometry, caja } = geometriaNodo(n, teselaDe(n)!, meta.dem, frame, errorDe(n) ?? 0, meta.bbox)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false     // el quadtree ya recorta por su caja
      mesh.visible = false
      grupo.current!.add(mesh)
      m = { mesh, caja }
    } else {
      mallas.delete(k)               // al final del Map: recién usada
    }
    mallas.set(k, m)
    return m.caja
  }

  useFrame(() => {
    if (!grupo.current) return
    m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(m4)
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45
    const sel = seleccionar(nodosRaiz, {
      intersecta: c => frustum.intersectsBox(c),
      posicion: camera.position,
      mpp: d => metrosPorPixel(d, fov, size.height),
    }, {
      error: errorDe,
      listo: n => teselaDe(n) !== undefined,
      pedir: n => { const w = ventana(n, meta.dem); cache.pedir(w.zt, w.xt, w.yt) },
      caja: cajaDe,
    }, Z_MAX)
    const visibles = new Set(sel.map(clave))
    for (const [k, m] of mallas) m.mesh.visible = visibles.has(k)
    // LRU: las más viejas primero, nunca una visible.
    for (const [k, m] of mallas) {
      if (mallas.size <= GEOMETRIAS_MAX) break
      if (visibles.has(k)) continue
      grupo.current.remove(m.mesh)
      m.mesh.geometry.dispose()
      mallas.delete(k)
    }
  })

  return <group ref={grupo} name="terrain" />
}
