import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { makeEnuFrame } from '../data/enu'
import { metrosPorPixel } from './roadStyle'
import { terrainVert, terrainFrag } from './terrainShader'
import { CacheTeselas } from './demTiles'
import { CacheImagenes, Z_MAX_IMG } from './imagenTeselas'
import { seleccionar, clave, ERROR_PX, type Nodo } from './quadtree'
import { geometriaNodo, raices, ventana } from './nodoTerreno'
import { stateMask } from './stateMask'
import type { TerrainMeta, Municipio } from '../data/types'

// Resolución de la máscara del estado: la misma rejilla de 1024² con la que
// el relieve se recortaba antes (y con la que el minimapa sigue), ~130 m.
const MASCARA = 1024

// Sin imagen, z15 es la superficie exacta del DEM (~36 m) y no hay nada que
// justifique bajar más: los nodos más finos dibujarían los mismos triángulos.
// Con imagen sí lo hay -- la foto de Esri llega a 0,30 m por texel en z17 --
// y por eso el techo sube.
const Z_MAX_RELIEVE = 15

// Circunferencia de la Tierra en el ecuador (WGS84), para el ancho de una
// tesela Web Mercator: C · cos(lat) / 2^z.
const CIRCUNFERENCIA = 40075016.686

// Corrección de brillo de la foto antes del sombreado. Es el pomo de
// calibración de toda la cadena: la GPU lineariza el JPEG (SRGB8_ALPHA8, ver
// imagenTeselas.ts), el hillshade lo multiplica, la perspectiva aérea le suma
// neblina y el AgX de Sky.tsx lo mapea al final. Cuatro pasos que la pueden
// dejar lavada o apagada, y ninguno se puede predecir de cabeza.
//
// Medido en Chrome sobre San Cristóbal a 4 km (600×400 px del centro de la
// pantalla, luminancia Rec.709), contra las teselas z15 y z16 de esa misma
// zona decodificadas tal cual:
//
//     fuente (sRGB de Esri)   media 110,8   sigma 32,0
//     ganancia 1,0            media 108,1   sigma 33,8   <-- se queda
//     ganancia 1,35           media 119,6   sigma 33,1
//     ganancia 1,7            media 128,7   sigma 32,6
//
// O sea: con 1,0 lo que se ve en pantalla ya tiene el brillo y el contraste de
// la foto original -- lo que el hillshade quita, la perspectiva aérea y el AgX
// lo devuelven. Subirla no arregla nada que estuviera roto, solo lava los
// techos de zinc, que es lo primero que satura. El uniform se queda porque el
// día que cambie la iluminación (otro agente reescribe el sombreado) este
// número es lo que hay que volver a medir.
const GANANCIA = 1.0

// Geometrías que se conservan aunque no se dibujen, para no rearmar el nodo
// al volver a él. Un nodo son ~1.200 vértices: 800 nodos, unos 50 MB.
// Calibrable.
const GEOMETRIAS_MAX = 800

// Texturas de imagen vivas. Cada una son 256×256 RGBA más mipmaps, ~350 KB:
// 300 son ~105 MB de GPU, y es más de lo que llena la pantalla a cualquier
// nivel. Calibrable.
const TEXTURAS_MAX = 300

/**
 * El relieve por niveles de detalle. Cada cuadro elige qué nodos del
 * quadtree dibujar (quadtree.ts), arma la malla de los que no tenía
 * (nodoTerreno.ts) a partir de las teselas del DEM (demTiles.ts), y enciende
 * o apaga las demás. El pase de ids recorre este grupo, por su nombre, para
 * usar las mallas visibles como oclusor (PickingPass.tsx).
 *
 * Con `imagen`, cada nodo además cuelga la tesela satelital de su mismo
 * z/x/y (imagenTeselas.ts) y el shader la usa de albedo. Eso obliga a dos
 * cosas: que el quadtree baje hasta z17 (la geometría ya no pide más detalle,
 * la foto sí) y que cada nodo tenga su propio material, porque la textura
 * cambia de nodo en nodo y un uniform es por material.
 */
export function TerrainLod ({ meta, municipios, imagen = true }: {
  meta: TerrainMeta; municipios: Municipio[]
  /** Foto satelital de albedo en vez de hipsometría. */
  imagen?: boolean
}) {
  const { camera, size } = useThree()
  const grupo = useRef<THREE.Group>(null)
  const frame = useMemo(() => makeEnuFrame(meta.origin.lat, meta.origin.lon, meta.origin.h), [meta])
  const cache = useMemo(() => new CacheTeselas(), [])
  const imgs = useMemo(() => new CacheImagenes(TEXTURAS_MAX), [])
  useEffect(() => () => imgs.dispose(), [imgs])
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

  // Los uniforms que valen lo mismo en todo el relieve. Se comparten POR
  // REFERENCIA con el material de cada nodo: escribir uSun.value acá lo cambia
  // en los 800 materiales a la vez, sin recorrerlos. Por eso no se usa
  // material.clone() -- clona los uniforms, y de paso clonaría la textura de
  // la máscara, que se subiría 800 veces a la GPU.
  const comunes = useMemo(() => ({
    uMin: { value: meta.min }, uMax: { value: meta.max },
    uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uMascara: { value: mascara },
    uGanancia: { value: GANANCIA },
  }), [meta, mascara])

  // Un material por nodo. Es una copia barata: el programa de GPU se compila
  // una sola vez (three cachea por código de shader) y lo único propio son
  // tres uniforms. La alternativa -- un material compartido y cambiar la
  // textura en onBeforeRender -- no funciona: three no vuelve a subir los
  // uniforms cuando el material es el mismo del objeto anterior.
  const materialNodo = () => new THREE.ShaderMaterial({
    vertexShader: terrainVert, fragmentShader: terrainFrag,
    uniforms: {
      ...comunes,
      uImg: { value: null }, uImgUv: { value: new THREE.Vector3(0, 0, 1) }, uImagen: { value: 0 },
    },
  })

  // Nodo -> malla armada (visible o no), en orden de uso para la LRU.
  const mallas = useMemo(() => new Map<string, { mesh: THREE.Mesh; caja: THREE.Box3 }>(), [])
  const frustum = useMemo(() => new THREE.Frustum(), [])
  const m4 = useMemo(() => new THREE.Matrix4(), [])
  const nodosRaiz = useMemo(() => raices(meta.dem), [meta])

  // Ancho de una tesela de nivel z sobre el terreno. La latitud varía 1,3°
  // dentro del estado y con ella el coseno un 0,3 %: no vale la pena calcularla
  // por nodo, la del origen sirve para todos.
  const cosLat = Math.cos(meta.origin.lat * Math.PI / 180)
  const anchoTesela = (z: number) => CIRCUNFERENCIA * cosLat / 2 ** z

  // Cuánto "error" vale la borrosidad de la foto de un nodo, en las mismas
  // unidades que el error geométrico, para que el quadtree decida con un solo
  // número. La tesela tiene 256 texels, así que un texel mide ancho/256;
  // multiplicado por ERROR_PX, la condición `error / mpp > ERROR_PX` del
  // quadtree se vuelve exactamente "el texel se ve más grande que un píxel de
  // pantalla". Es lo que hace que z16 y z17 existan: su error geométrico es 0
  // -- muestrean la misma superficie que z15 -- y sin esto nunca se dibujarían.
  const errorImagen = (n: Nodo) => ERROR_PX * anchoTesela(n.z) / 256

  // El error de errores.json manda, y también dice qué nodos existen: hasta
  // que llegue no se pide ninguna tesela (una raíz vacía no tiene archivo, y
  // el servidor de desarrollo contesta index.html en vez de 404).
  const errorDe = (n: Nodo): number | null => {
    const e = errores.current
    if (!e) return null
    // errores.json llega hasta z14; de ahí para abajo el nodo existe si existe
    // su ancestro z14, y su error geométrico es 0 (superficie exacta del DEM).
    const geo = n.z <= 14
      ? e[clave(n)] ?? null
      : (e[clave({ z: 14, x: n.x >> (n.z - 14), y: n.y >> (n.z - 14) })] == null ? null : 0)
    if (geo == null) return null
    return imagen ? Math.max(geo, errorImagen(n)) : geo
  }
  const teselaDe = (n: Nodo) => { const w = ventana(n, meta.dem); return cache.get(w.zt, w.xt, w.yt) }
  const cajaDe = (n: Nodo): THREE.Box3 => {
    const k = clave(n)
    let m = mallas.get(k)
    if (!m) {
      const { geometry, caja } = geometriaNodo(n, teselaDe(n)!, meta.dem, frame, errorDe(n) ?? 0, meta.bbox)
      const mesh = new THREE.Mesh(geometry, materialNodo())
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
    }, imagen ? Z_MAX_IMG : Z_MAX_RELIEVE)
    const visibles = new Set(sel.map(clave))
    for (const [k, m] of mallas) m.mesh.visible = visibles.has(k)

    // La foto de cada nodo visible. Mientras la suya viaja usa la del ancestro
    // más cercano que ya esté, con el trozo que le toca: al refinar, el nodo
    // nuevo aparece con la foto borrosa del padre y se afina cuando llega la
    // propia, en vez de parpadear en gris.
    for (const n of sel) {
      const u = (mallas.get(clave(n))!.mesh.material as THREE.ShaderMaterial).uniforms
      if (!imagen) { u.uImagen.value = 0; continue }
      imgs.pedir(n.z, n.x, n.y)
      const mejor = imgs.mejor(n)
      if (!mejor) { u.uImagen.value = 0; continue }
      u.uImg.value = mejor.tex
      ;(u.uImgUv.value as THREE.Vector3).set(mejor.ox, mejor.oy, mejor.esc)
      u.uImagen.value = 1
    }

    // LRU: las más viejas primero, nunca una visible.
    for (const [k, m] of mallas) {
      if (mallas.size <= GEOMETRIAS_MAX) break
      if (visibles.has(k)) continue
      grupo.current.remove(m.mesh)
      m.mesh.geometry.dispose()
      ;(m.mesh.material as THREE.Material).dispose()
      mallas.delete(k)
    }
  })

  return <group ref={grupo} name="terrain" />
}
