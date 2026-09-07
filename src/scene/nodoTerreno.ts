import * as THREE from 'three'
import { geodeticToEnu, type EnuFrame } from '../data/enu'
import { lonDeTesela, latDeTesela } from '../data/mercator'
import { LADO, type Tesela } from './demTiles'
import type { Nodo } from './quadtree'
import type { TerrainMeta } from '../data/types'

// Un nodo del quadtree es una tesela (z, x, y) dibujada como rejilla de 33×33
// vértices con un faldón alrededor. Sus alturas salen de la pirámide del DEM
// (scripts/lib/dem-tiles.mjs), y la superficie que resulta a z15 es
// EXACTAMENTE la triangulación del DEM sobre la que el pipeline apoyó las
// vías (scripts/lib/drape.mjs): mismos posts, misma diagonal.

export const LADO_NODO = 33
export const VERTICES = LADO_NODO * LADO_NODO
const CELDAS = LADO_NODO - 1

type Dem = TerrainMeta['dem']

/** Qué tesela de la pirámide alimenta al nodo y dónde caen sus vértices:
 *  píxel (offI + i·paso, offJ + j·paso). z ≤ 12 lee su propia tesela cada 8
 *  píxeles; z13 a z15 leen la tesela z12 ancestro a paso 4, 2 y 1. Es la
 *  misma regla con la que errorNodo (dem-tiles.mjs) mide el error de cada
 *  nodo, así que el error mide exactamente lo que se dibuja. */
export function ventana (n: Nodo, dem: Dem) {
  const k = Math.max(0, n.z - dem.z)
  return {
    zt: Math.min(n.z, dem.z), xt: n.x >> k, yt: n.y >> k, paso: 8 >> k,
    offI: ((n.x & ((1 << k) - 1)) * 256) >> k, offJ: ((n.y & ((1 << k) - 1)) * 256) >> k,
  }
}

/** Las teselas z8 que cubren el rango z12 del DEM. */
export function raices (dem: Dem): Nodo[] {
  const k = dem.z - 8
  const out: Nodo[] = []
  for (let y = dem.y0 >> k; y <= (dem.y0 + dem.ny - 1) >> k; y++) {
    for (let x = dem.x0 >> k; x <= (dem.x0 + dem.nx - 1) >> k; x++) out.push({ z: 8, x, y })
  }
  return out
}

// Cuánto cuelga el faldón: contra la grieta entre dos niveles vecinos, que
// mide como mucho el error del nodo grueso, más un 2 % del ancho para las
// diferencias de ENU entre vértices que no son exactamente los mismos.
// Calibrable.
const FALDON_MIN = 5
const FALDON_REL = 0.02

type Bbox = TerrainMeta['bbox']

/**
 * La malla de un nodo. `bbox` es el del terreno (terrain.json): la máscara
 * del estado se muestrea como textura sobre él (uvMascara, fila 0 = norte),
 * porque el recorte al contorno no puede ir por vértice -- a z8 una celda mide
 * 4,6 km y el borde saldría en bloques -- y así vale lo mismo a todo nivel.
 */
export function geometriaNodo (n: Nodo, tesela: Tesela, dem: Dem, frame: EnuFrame, error = 0, bbox?: Bbox) {
  const { paso, offI, offJ } = ventana(n, dem)
  const total = VERTICES + 4 * LADO_NODO
  const pos = new Float32Array(total * 3)
  const elev = new Float32Array(total)
  const uvm = new Float32Array(total * 2)
  const caja = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let j = 0; j < LADO_NODO; j++) {
    const lat = latDeTesela(n.y + j / CELDAS, n.z)
    for (let i = 0; i < LADO_NODO; i++) {
      const lon = lonDeTesela(n.x + i / CELDAS, n.z)
      const p = (offJ + j * paso) * LADO + (offI + i * paso)
      const h = tesela.alturas[p]
      const [e, no, u] = geodeticToEnu(frame, lat, lon, h)
      const k = j * LADO_NODO + i
      pos[k * 3] = e; pos[k * 3 + 1] = u; pos[k * 3 + 2] = -no
      elev[k] = h
      if (bbox) {
        uvm[k * 2] = (lon - bbox.w) / (bbox.e - bbox.w)
        uvm[k * 2 + 1] = (bbox.n - lat) / (bbox.n - bbox.s)
      }
      // La caja se arma con los float32 ya guardados, no con los float64 de
      // ENU: un vértice de borde redondeado hacia afuera quedaría fuera de
      // ella y el frustum lo recortaría un cuadro antes de tiempo.
      caja.expandByPoint(v.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]))
    }
  }
  // Índices de la rejilla, con la diagonal de arriba-derecha a abajo-izquierda:
  // (a,c,b) y (b,c,d). Misma regla que alturaEnPosts en el pipeline.
  const idx: number[] = []
  for (let j = 0; j < CELDAS; j++) {
    for (let i = 0; i < CELDAS; i++) {
      const a = j * LADO_NODO + i, b = a + 1, c = a + LADO_NODO, d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  // Normales sobre la rejilla sola: el faldón no debe torcerlas.
  const interior = new THREE.BufferGeometry()
  interior.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, VERTICES * 3), 3))
  interior.setIndex(idx)
  interior.computeVertexNormals()
  const nor = new Float32Array(total * 3)
  nor.set(interior.getAttribute('normal').array as Float32Array)
  interior.dispose()

  // Faldón: los cuatro bordes copiados hacia abajo. Orden: norte (j=0), sur
  // (j=32), oeste (i=0), este (i=32); dentro de cada uno, en el sentido del
  // borde. La caja no incluye el faldón hacia los lados (no sobresale), sí
  // hacia abajo.
  const cuelga = Math.max(FALDON_MIN, error) + FALDON_REL * (caja.max.x - caja.min.x)
  const bordes: number[][] = [[], [], [], []]
  for (let t = 0; t < LADO_NODO; t++) {
    bordes[0].push(t); bordes[1].push(CELDAS * LADO_NODO + t)
    bordes[2].push(t * LADO_NODO); bordes[3].push(t * LADO_NODO + CELDAS)
  }
  let k = VERTICES
  bordes.forEach((b, q) => {
    const base = k
    for (const src of b) {
      pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - cuelga; pos[k * 3 + 2] = pos[src * 3 + 2]
      nor[k * 3] = nor[src * 3]; nor[k * 3 + 1] = nor[src * 3 + 1]; nor[k * 3 + 2] = nor[src * 3 + 2]
      elev[k] = elev[src]; uvm[k * 2] = uvm[src * 2]; uvm[k * 2 + 1] = uvm[src * 2 + 1]
      caja.expandByPoint(v.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]))
      k++
    }
    for (let t = 0; t < CELDAS; t++) {
      const s0 = b[t], s1 = b[t + 1], f0 = base + t, f1 = base + t + 1
      // El norte y el este miran hacia afuera con un orden; el sur y el oeste con el otro.
      if (q === 0 || q === 3) idx.push(s0, f0, s1, s1, f0, f1)
      else idx.push(s0, s1, f0, f0, s1, f1)
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geometry.setAttribute('elevation', new THREE.BufferAttribute(elev, 1))
  geometry.setAttribute('uvMascara', new THREE.BufferAttribute(uvm, 2))
  geometry.setIndex(idx)
  return { geometry, caja }
}
