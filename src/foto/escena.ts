import * as THREE from 'three'
import { direccionSol } from '../scene/sol'
import { metrosPorPixel } from '../scene/roadStyle'
import type { UniformsRelieve } from '../scene/terrainShader'
import { pciColor, SELECCION } from '../data/constants'
import { hypso } from './hypso'
import { anchoBase, alza, cuadro, enFrustum } from './cuadros'

// La escena que come el trazador de rayos NO es la de pantalla: es una copia
// de un instante, armada a partir de lo que hay dibujado en el momento del
// clic. Tiene que ser otra porque el trazador solo entiende mallas con
// materiales estándar, y esta aplicación no dibuja ninguna:
//
//  - el relieve es un material estándar parcheado (hipsometría o foto
//    satelital de albedo, máscara del estado, cascadas de sombra) cuyos
//    uniforms viven en userData y no en el material,
//  - las vías son LineSegments2 cuyo ancho REAL lo calcula el vertex shader,
//  - el cielo es un efecto de post-proceso, no geometría.
//
// Así que acá se rehace todo en CPU: la rampa de color (foto/hypso.ts), los
// cuadriláteros de la calzada (foto/cuadros.ts) y una luz que es el sol de
// verdad a la fecha de la escena. Lo que no se rehace está documentado abajo,
// caso por caso.

/** Cuánto salió en la escena temporal. Se enseña en el panel y en el reporte:
 *  es lo que explica por qué una vista tarda el doble que otra. */
export interface Recuento {
  nodos: number
  trianguloRelieve: number
  tramos: number
}

// Tope de tramos que se reconstruyen. A vista de estado solo hay tres niveles
// encendidos y no se llega ni a la mitad; a escala de calle el frustum recorta
// casi todo. Existe por si una vista rara los deja pasar a todos: 450.261
// tramos son 1,8 millones de triángulos, y armar el BVH de eso deja el
// navegador colgado un minuto largo sin poder cancelar. Calibrable.
const MAX_TRAMOS = 250_000

// Un texel de la máscara del estado por debajo de esto es "fuera" -- el mismo
// 0.5 del discard en terrainShader.ts, en bytes.
const MASCARA_DENTRO = 128

/**
 * El relieve: una malla por nodo visible del quadtree, con la misma geometría
 * que ya está en la GPU (no una copia: position y normal se comparten) y el
 * color hipsométrico calculado por vértice.
 *
 * La máscara del estado, que en pantalla es un `discard` por fragmento, acá se
 * aplica por TRIÁNGULO: se conserva el que tenga al menos un vértice dentro.
 * Eso deja el borde del estado con hasta un triángulo de sobra en vez de con
 * un mordisco -- en una lámina, un contorno que sobresale medio nodo se lee
 * como orilla y uno que falta se lee como error. A los niveles finos del
 * quadtree el triángulo mide decenas de metros y no se distingue.
 */
function relieve (grupo: THREE.Object3D): { mallas: THREE.Mesh[]; triangulos: number } {
  const mallas: THREE.Mesh[] = []
  let triangulos = 0
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    // El monte no brilla. 1.0 exacto hace que el muestreo de importancia
    // pierda toda dirección preferente y la imagen converja más lento sin
    // verse distinta; 0,95 es difuso a efectos prácticos. Calibrable.
    roughness: 0.95,
    metalness: 0,
  })

  for (const hijo of grupo.children) {
    const mesh = hijo as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) continue
    const geo = mesh.geometry
    const pos = geo.getAttribute('position')
    const elev = geo.getAttribute('elevation')
    const uvM = geo.getAttribute('uvMascara')
    const idx = geo.getIndex()
    if (!pos || !elev || !uvM || !idx) continue

    // Los uniforms propios del relieve cuelgan de userData (terrainShader.ts):
    // con un material estándar parcheado no existen en el material hasta que
    // compila, y la foto puede pedirse antes.
    const u = (mesh.material as THREE.Material).userData.uniforms as UniformsRelieve | undefined
    if (!u) continue
    const min = u.uMin.value
    const max = u.uMax.value
    const mascara = u.uMascara.value as THREE.DataTexture
    const bytes = mascara.image.data as Uint8Array
    const lado = mascara.image.width

    // Color por vértice: la rampa pelada, SIN el hillshade falso del shader.
    // La sombra la pone el sol de verdad unas líneas más abajo; multiplicar
    // por el hillshade sombrearía dos veces y las laderas norte saldrían
    // negras.
    const color = new Float32Array(pos.count * 3)
    const rango = Math.max(1, max - min)
    for (let i = 0; i < pos.count; i++) {
      const c = hypso((elev.getX(i) - min) / rango)
      color[i * 3] = c[0]; color[i * 3 + 1] = c[1]; color[i * 3 + 2] = c[2]
    }

    // Dentro/fuera del estado, por vértice, una sola vez.
    const dentro = new Uint8Array(pos.count)
    for (let i = 0; i < pos.count; i++) {
      const x = Math.min(lado - 1, Math.max(0, Math.floor(uvM.getX(i) * lado)))
      const y = Math.min(lado - 1, Math.max(0, Math.floor(uvM.getY(i) * lado)))
      dentro[i] = bytes[y * lado + x] >= MASCARA_DENTRO ? 1 : 0
    }

    const src = idx.array
    const salida: number[] = []
    for (let t = 0; t < src.length; t += 3) {
      const a = src[t]; const b = src[t + 1]; const c = src[t + 2]
      if (dentro[a] || dentro[b] || dentro[c]) salida.push(a, b, c)
    }
    if (salida.length === 0) continue

    const nueva = new THREE.BufferGeometry()
    nueva.setAttribute('position', pos)
    const nrm = geo.getAttribute('normal')
    if (nrm) nueva.setAttribute('normal', nrm)
    nueva.setAttribute('color', new THREE.BufferAttribute(color, 3))
    nueva.setIndex(salida)
    mallas.push(new THREE.Mesh(nueva, material))
    triangulos += salida.length / 3
  }
  return { mallas, triangulos }
}

const a3 = new THREE.Vector3()
const b3 = new THREE.Vector3()
const na3 = new THREE.Vector3()
const nb3 = new THREE.Vector3()

/** La profundidad de un punto a lo largo del eje de la cámara, que es lo que
 *  el vertex shader usa como `-eje.z` para sacar los metros por píxel. */
function profundidad (e: number[] | Float32Array, x: number, y: number, z: number): number {
  return Math.max(-(e[2] * x + e[6] * y + e[10] * z + e[14]), 1e-3)
}

/**
 * Las vías: los cuadriláteros que el vertex shader produciría para los tramos
 * que la cámara ve, reconstruidos en CPU (foto/cuadros.ts).
 *
 * Solo el pase de RELLENO, no el contorno: el contorno es un trazo más ancho y
 * casi negro debajo del color, y existe para que una vía fina se lea contra el
 * relieve en un mapa plano. Bajo iluminación global la calzada ya tiene sombra
 * propia y borde; un halo negro pintado encima parecería suciedad. Los dos
 * pases comparten geometría, así que descartar el contorno no pierde ni un
 * tramo.
 *
 * Tampoco se reconstruyen las MARCAS VIALES (bordes, eje amarillo, flechas):
 * viven enteras en el fragment shader, sobre una coordenada transversal que
 * este módulo no genera. Serían una textura procedural por vía en una versión
 * futura. Ni las TAPAS redondas de los extremos: rematan la junta entre dos
 * tramos de una curva y miden medio ancho de calzada.
 */
function vias (
  vista: THREE.Object3D, camera: THREE.PerspectiveCamera, altoPx: number,
): { malla: THREE.Mesh | null; tramos: number } {
  const objetos: THREE.Object3D[] = []
  vista.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.Material | undefined
    // El relleno se distingue del contorno por la clave de caché del programa
    // que le pone patchLineMaterial (roadsShader.ts). Es el único discriminante
    // que ya existe y que no obliga a tocar Roads.tsx.
    if ((o as { isLineSegments2?: boolean }).isLineSegments2 && o.visible &&
        m?.customProgramCacheKey?.() === 'vias:relleno') objetos.push(o)
  })
  if (objetos.length === 0) return { malla: null, tramos: 0 }

  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
  const ve = camera.matrixWorldInverse.elements
  const fov = camera.fov

  // Lo que hace falta de cada objeto, leído una vez. Todo son buffers que ya
  // están en memoria: nada se vuelve a calcular ni a subir a la GPU.
  const tandas = objetos.map(o => {
    const g = (o as THREE.Mesh).geometry
    const mat = (o as THREE.Mesh).material as THREE.Material & {
      userData: { uniforms?: Record<string, { value: unknown }> }
    }
    const inicio = g.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute
    const nrm = g.getAttribute('instanceNormalStart') as THREE.InterleavedBufferAttribute
    const attr = mat.userData.uniforms?.uAttr.value as THREE.DataTexture
    return {
      n: inicio.count,
      xyz: inicio.data.array as Float32Array,
      nrm: nrm.data.array as Int8Array,
      calzada: g.getAttribute('aCalzada').array as Float32Array,
      segId: g.getAttribute('segId').array as Float32Array,
      pisoPx: (mat.userData.uniforms?.uPisoPx.value as number) ?? 1,
      attr: attr.image.data as Uint8Array,
    }
  })

  // Dos pasadas: la primera marca y cuenta, la segunda rellena buffers del
  // tamaño exacto. Con cientos de miles de tramos, ir empujando a arrays que
  // crecen solos duplica la memoria pico por gusto -- mismo criterio que
  // repartirPorNivel (roadStyle.ts).
  const marcas = tandas.map(t => new Uint8Array(t.n))
  let total = 0
  for (let k = 0; k < tandas.length && total < MAX_TRAMOS; k++) {
    const t = tandas[k]
    for (let i = 0; i < t.n && total < MAX_TRAMOS; i++) {
      const o = i * 6
      a3.set(t.xyz[o], t.xyz[o + 1], t.xyz[o + 2])
      b3.set(t.xyz[o + 3], t.xyz[o + 4], t.xyz[o + 5])
      const mpp = Math.max(
        metrosPorPixel(profundidad(ve, a3.x, a3.y, a3.z), fov, altoPx),
        metrosPorPixel(profundidad(ve, b3.x, b3.y, b3.z), fov, altoPx))
      const margen = 0.5 * anchoBase(t.calzada[i], t.pisoPx, mpp) + alza(mpp)
      if (!enFrustum(frustum, a3, b3, margen)) continue
      marcas[k][i] = 1
      total++
    }
  }
  if (total === 0) return { malla: null, tramos: 0 }

  const pos = new Float32Array(total * 12)
  const nrm = new Float32Array(total * 12)
  const col = new Float32Array(total * 12)
  const idx = new Uint32Array(total * 6)
  let q = 0
  for (let k = 0; k < tandas.length; k++) {
    const t = tandas[k]
    for (let i = 0; i < t.n; i++) {
      if (!marcas[k][i]) continue
      const o = i * 6
      a3.set(t.xyz[o], t.xyz[o + 1], t.xyz[o + 2])
      b3.set(t.xyz[o + 3], t.xyz[o + 4], t.xyz[o + 5])
      // Int8 normalizado, igual que lo lee el shader.
      na3.set(t.nrm[o] / 127, t.nrm[o + 1] / 127, t.nrm[o + 2] / 127)
      nb3.set(t.nrm[o + 3] / 127, t.nrm[o + 4] / 127, t.nrm[o + 5] / 127)
      cuadro(
        a3, b3, na3, nb3, t.calzada[i], t.pisoPx,
        metrosPorPixel(profundidad(ve, a3.x, a3.y, a3.z), fov, altoPx),
        metrosPorPixel(profundidad(ve, b3.x, b3.y, b3.z), fov, altoPx),
        pos, nrm, q * 12,
      )

      // Color: el mismo texel de atributos que lee el fragment shader. 255 es
      // el centinela de "sin evaluar" (attrTexture.ts), y el bit 1 del canal
      // azul, la selección. El foco de la búsqueda NO se replica: en pantalla
      // atenúa por opacidad, y una calzada semitransparente en una escena
      // trazada no se lee como "esto importa menos", se lee como vidrio.
      const s = t.segId[i] * 4
      const pci = t.attr[s]
      const sel = (t.attr[s + 2] >> 1) & 1
      const c = sel ? SELECCION : pciColor(pci > 100 ? null : pci)
      for (let v = 0; v < 4; v++) {
        col[q * 12 + v * 3] = c[0]
        col[q * 12 + v * 3 + 1] = c[1]
        col[q * 12 + v * 3 + 2] = c[2]
      }

      // Los dos triángulos del cuerpo, en el orden de LineSegmentsGeometry.
      const b = q * 4
      idx.set([b, b + 2, b + 1, b + 2, b + 3, b + 1], q * 6)
      q++
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  return {
    malla: new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true,
      // Asfalto: mate, sin nada de metal. Por debajo de ~0,8 la calzada
      // devuelve un reflejo especular del cielo que a mediodía la deja
      // lavada. Calibrable.
      roughness: 0.9,
      metalness: 0,
      // El cuadrilátero sale con el mismo sentido de giro que en la GPU (ver
      // el test de cuadros.test.ts), pero una calzada es una banda de espesor
      // cero: si un rayo la toca por debajo (rebote del relieve) y la cara
      // fuera de una sola vista, el trazador la vería agujereada.
      side: THREE.DoubleSide,
    })),
    tramos: total,
  }
}

// Distancia a la que se pone el sol. No cambia la luz (una direccional no
// tiene caída), pero el trazador lee su dirección de la posición contra el
// target, así que tiene que estar lejos y en el mismo orden de magnitud que la
// escena para no perder precisión en el float.
const SOL_LEJOS = 1e7

// Cuánta luz trae el sol. El trazador multiplica color × intensidad tal cual y
// la salida pasa por AgX, así que este número no es lux ni nada físico: es la
// exposición de la lámina. Calibrado a ojo contra la vista de estado y la de
// calle -- por debajo de ~2 el relieve se apaga, por encima de ~5 las calzadas
// claras se queman. Va junto con CIELO_INTENSIDAD: los dos suben y bajan la
// misma exposición, lo que reparten es cuánto contraste hay entre lo que da el
// sol y lo que da el cielo (o sea, qué tan profundas salen las sombras).
export const SOL_INTENSIDAD = 5.5
export const CIELO_INTENSIDAD = 0.55

// Luz solar directa: cálida y ligeramente desaturada, no blanco puro.
const SOL_COLOR = 0xfff2e0

/** La dirección al sol en los ejes del mundo (X este, Y arriba, Z -norte) a la
 *  fecha de la escena. Es la misma función con la que se iluminan el relieve
 *  y el asfalto en pantalla (scene/sol.ts), así que el sol de la foto cae
 *  exactamente donde lo pone el cielo. */
export function direccionDelSol (date: Date): THREE.Vector3 {
  return direccionSol(date)
}

/**
 * Arma la escena temporal a partir de lo que hay dibujado ahora mismo.
 * `altoPx` es el alto del lienzo EN PANTALLA, no el de la foto: es la
 * referencia con la que el vertex shader convierte el piso en píxeles de cada
 * nivel a metros, así que una foto a 2× tiene que salir con las mismas vías de
 * los mismos anchos, solo que con el doble de muestras por metro.
 */
export function construirEscena (
  vista: THREE.Scene, camera: THREE.PerspectiveCamera, altoPx: number, date: Date,
): { escena: THREE.Scene; recuento: Recuento } {
  const escena = new THREE.Scene()

  const grupo = vista.getObjectByName('terrain')
  const rel = grupo ? relieve(grupo) : { mallas: [], triangulos: 0 }
  for (const m of rel.mallas) escena.add(m)

  const via = vias(vista, camera, altoPx)
  if (via.malla) escena.add(via.malla)

  const sol = new THREE.DirectionalLight(SOL_COLOR, SOL_INTENSIDAD)
  sol.position.copy(direccionDelSol(date)).multiplyScalar(SOL_LEJOS)
  escena.add(sol)
  // El target por defecto de una DirectionalLight está en el origen pero NO en
  // la escena: sin añadirlo, su matrixWorld no se actualiza y el trazador lee
  // la dirección contra una matriz identidad de un frame anterior.
  escena.add(sol.target)

  escena.updateMatrixWorld(true)
  return {
    escena,
    recuento: { nodos: rel.mallas.length, trianguloRelieve: rel.triangulos, tramos: via.tramos },
  }
}

// La foto satelital del relieve todavía no entra en la lámina. El camino es
// este: leer `uImg`, `uImgUv` y `uImagen` de los uniforms del nodo
// (userData.uniforms, terrainShader.ts) y pasarle la textura como `map` a un
// MeshStandardMaterial POR NODO, con las uv de `uvImagen` corridas por
// uImgUv (xy desplazamiento, z escala); el color por vértice se queda como
// está y se multiplica con la textura, que es justo lo que hace three. Ojo:
// deja de ser un material compartido y pasa a ser uno por tesela.
