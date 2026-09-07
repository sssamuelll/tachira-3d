import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import { useFrame, useThree } from '@react-three/fiber'
import { makeEnuFrame } from '../data/enu'
import { metrosPorPixel } from './roadStyle'
import { materialRelieve } from './terrainShader'
import { direccionSol } from './sol'
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

// Las cascadas de sombra. Tres y no cuatro: con maxFar de 8 km la tercera ya
// cubre kilómetros por texel, y una cuarta cuesta un pase entero de sombra por
// cuadro para ganar detalle donde el relieve ya mide menos de un píxel.
//
// SOMBRA_MAX es hasta dónde hay sombras proyectadas, medido desde la cámara.
// 5 km cubre el valle de San Cristóbal entero con sus montañas desde cualquier
// altura de trabajo; a vista de estado (la cámara a ~114 km) ese tramo del
// frustum cae en aire vacío, los shadow maps salen en blanco y no se paga casi
// nada. Que las montañas dejen de sombrearse más allá no se ve: una ladera
// entera mide ahí unos pocos píxeles.
//
// 1024 y no 2048 por medida, no por gusto: a 125 m la primera cascada abarca
// unos 200 m, o sea 20 cm por téxel, y la sombra de una loma no tiene ese
// detalle. Bajar de 2048 devolvió unos 4 fps a 125 m sin diferencia visible.
const CASCADAS = 3
const SOMBRA_MAX = 5000
const SOMBRA_PX = 1024

// Cuánto se separa del relieve, a lo largo de su normal, el punto que se
// compara contra el shadow map. Va en TÉXELES de la cascada que le toca, no en
// metros, y esa es la parte que importa: un téxel mide un par de metros en la
// primera cascada y 7,6 km / 1024 = 7,4 m en la última, así que un sesgo en
// téxeles se traduce en aproximadamente el mismo error EN PANTALLA a cualquier
// distancia. Un número fijo en metros deja acné lejos o despega la sombra de
// cerca; no hay valor que sirva para las dos.
//
// 12 téxeles salió de barrer 0, 1,5, 4, 8, 12, 24 y 40 sobre la Carretera La
// Grita - Pregonero (Uribante, laderas de 40°) mirando a rasante, con el sol
// real de la escena y también con el sol bajado a mano a 15° de altura para que
// hubiera sombras proyectadas de verdad que juzgar:
//   0    acné a rayas por toda la ladera, más bandas negras anchas en las
//        crestas (ahí la superficie queda casi de canto contra el sol y
//        cualquier error de profundidad se traduce en sombra).
//   1,5  las rayas se van, la banda negra de las crestas se queda.
//   4    queda una línea negra fina pegada a cada cresta.
//   12   limpio. A 15° de sol, las sombras de las lomas siguen naciendo al pie
//        de la cresta, sin despegarse.
//   40   también limpio, pero son 300 m de sesgo en la última cascada y no
//        compra nada que 12 no dé.
//
// El sesgo de profundidad constante acompaña al de normal: en las crestas la
// normal apunta casi perpendicular a la luz y desplazarse a lo largo de ella no
// aleja nada del plano de comparación. Es lo que remata la línea de la cresta.
// Los dos son calibrables.
const SESGO_TEXELES = 12
const SESGO_PROFUNDIDAD = -0.0008

// La cámara puede llegar a 400 km (maxDistance de OrbitControls); la luz tiene
// que quedar detrás del terreno más alto de la cascada para que su plano near
// no recorte la montaña que proyecta. El Táchira llega a ~4.000 m sobre el
// nivel del mar y el valle de la cuenca del Uribante baja a ~150 m, así que
// 6 km de margen cubre cualquier pareja emisor/receptor.
const MARGEN_LUZ = 6000

/**
 * normalBias por cascada, en metros, sacado del tamaño del téxel de SU cámara
 * ortográfica (ver SESGO_TEXELES). CSM no tiene un parámetro para esto -- solo
 * shadowBias, que es común a las tres y va en el constructor -- así que se
 * escribe a mano, y hay que rehacerlo cada vez que updateFrustums() mueve los
 * planos, porque el téxel cambia de tamaño con ellos.
 */
function sesgar (csm: CSM) {
  for (const luz of csm.lights) {
    const cam = luz.shadow.camera
    luz.shadow.normalBias = SESGO_TEXELES * (cam.right - cam.left) / SOMBRA_PX
  }
}

/**
 * El relieve por niveles de detalle. Cada cuadro elige qué nodos del
 * quadtree dibujar (quadtree.ts), arma la malla de los que no tenía
 * (nodoTerreno.ts) a partir de las teselas del DEM (demTiles.ts), y enciende
 * o apaga las demás. El pase de ids recorre este grupo, por su nombre, para
 * usar las mallas visibles como oclusor (PickingPass.tsx).
 *
 * También es dueño de la luz direccional de la escena, porque es dueño de las
 * cascadas de sombra y en CSM las dos cosas son la misma: CSM fabrica una luz
 * direccional POR cascada y el fragment estándar solo deja contribuir a la que
 * corresponde a la profundidad del píxel. Meter además el <SunLight> de takram
 * sumaría un cuarto sol sin sombra. Por eso Sky.tsx lo deja montado pero
 * invisible: sigue calculando el color del sol contra la transmitancia de la
 * atmósfera cada cuadro (ver el comentario de allá) y acá se copia a las
 * cascadas.
 */
export function TerrainLod ({ meta, municipios, date }: { meta: TerrainMeta; municipios: Municipio[]; date: Date }) {
  const { camera, size, scene } = useThree()
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

  // Dirección HACIA el sol para la fecha de la escena, en ejes del mundo. La
  // fecha no cambia mientras la app corre, así que esto se calcula una vez.
  const sol = useMemo(() => direccionSol(date), [date])

  // Las cascadas. `lightDirection` es hacia dónde VIAJA la luz, o sea el sol
  // negado. El color de las luces lo pone el efecto de más abajo copiándolo
  // del <SunLight> de takram; el blanco del constructor solo se ve el primer
  // cuadro, antes de que la atmósfera termine de calcularlo.
  const csm = useMemo(() => {
    const c = new CSM({
      camera, parent: scene, cascades: CASCADAS, maxFar: SOMBRA_MAX,
      shadowMapSize: SOMBRA_PX, lightMargin: MARGEN_LUZ,
      // lightFar tiene que cubrir el margen más el desnivel que quepa en la
      // cascada más grande; el shadow map es ortográfico, así que su
      // profundidad es lineal y estirarlo no cuesta precisión.
      lightNear: 1, lightFar: MARGEN_LUZ * 3, shadowBias: SESGO_PROFUNDIDAD,
      lightDirection: sol.clone().negate(),
    })
    sesgar(c)
    return c
  }, [camera, scene, sol])
  useEffect(() => () => { csm.remove(); csm.dispose() }, [csm])

  const material = useMemo(
    () => materialRelieve({ min: meta.min, max: meta.max, mascara, cascadas: csm }),
    [meta, mascara, csm],
  )

  // El <SunLight> de takram, buscado por nombre igual que PickingPass busca a
  // este grupo por el suyo. Solo lo queremos por su color: lo tiene calculado
  // contra la transmitancia de la atmósfera para la posición y la fecha, que
  // es lo que hace que la luz del relieve y el cielo dibujado sean la misma
  // luz. Se busca cada cuadro hasta encontrarlo (Sky.tsx monta dentro de un
  // <Suspense> y puede llegar tarde), después nunca más.
  const luzSol = useRef<THREE.DirectionalLight | null>(null)

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
      // El relieve es lo único que proyecta sombra y lo único que la recibe.
      // Las vías no proyectan: son líneas pegadas al terreno, su sombra sería
      // la del propio asfalto sobre sí mismo, y meterlas en tres pases más de
      // sombra costaría cientos de miles de segmentos por cuadro.
      // castShadow lo decide cada cuadro el bucle de visibilidad, por
      // distancia. receiveShadow no: es parte de la clave de programa de
      // three, y alternarlo entre mallas que comparten material compilaría dos
      // shaders y las haría parpadear al cruzar el corte.
      mesh.receiveShadow = true
      mesh.visible = false
      grupo.current!.add(mesh)
      m = { mesh, caja }
    } else {
      mallas.delete(k)               // al final del Map: recién usada
    }
    mallas.set(k, m)
    return m.caja
  }

  // Las cascadas se reparten sobre el frustum de la cámara: si cambia la
  // relación de aspecto (redimensionar la ventana) hay que rehacerlas, o los
  // shadow maps quedan encuadrando el frustum viejo.
  useEffect(() => { csm.updateFrustums(); sesgar(csm) }, [csm, size])

  useFrame(() => {
    if (!grupo.current) return
    // El color del sol de la atmósfera, copiado a las cascadas. Es luminancia,
    // no un color en [0,1]: la magnitud entera del sol vive en el color y la
    // intensity de la luz se queda en 1 (SunDirectionalLight.update() nunca la
    // toca). Copiarlo tal cual es lo que deja el relieve en la misma escala
    // que el cielo, antes del AgX del EffectComposer.
    if (!luzSol.current) luzSol.current = scene.getObjectByName('sol') as THREE.DirectionalLight | null
    if (luzSol.current) {
      for (const luz of csm.lights) {
        luz.color.copy(luzSol.current.color)
        luz.intensity = luzSol.current.intensity
      }
    }
    csm.update()
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
    for (const [k, m] of mallas) {
      const v = visibles.has(k)
      m.mesh.visible = v
      // Solo proyecta sombra lo que cae dentro del alcance de las cascadas.
      // Sin este corte las mallas entran en los tres shadow maps AUNQUE queden
      // fuera de su cámara ortográfica: frustumCulled está en false (el
      // quadtree ya recorta por su caja) y three no tiene con qué descartarlas.
      // Medido en Chrome orbitando a vista de estado: los ~200 nodos visibles
      // se volvían 600 draw calls de sombra que no pintaban un solo texel.
      m.mesh.castShadow = v && m.caja.distanceToPoint(camera.position) < SOMBRA_MAX
    }
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
