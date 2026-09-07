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
// 8 km cubre de sobra el valle de San Cristóbal desde cualquier altura de
// trabajo; a vista de estado (la cámara a ~114 km) el tramo 10 m - 8 km del
// frustum cae en aire vacío, los shadow maps salen en blanco y no se paga casi
// nada. Que las montañas dejen de sombrearse a esa distancia no se ve: una
// ladera entera mide ahí unos pocos píxeles.
const CASCADAS = 3
const SOMBRA_MAX = 8000
const SOMBRA_PX = 2048

// Cuánto se separa del relieve el punto que se compara contra el shadow map,
// en texeles de la cascada que le toca. 1,5 texeles es el mínimo que quita el
// acné en las laderas rasantes del Táchira sin que la sombra se despegue del
// pie de la montaña (peter-panning). Se calcula por cascada, no de una vez,
// porque un texel mide 0,1 m en la primera y kilómetros en la última: un solo
// número o deja acné lejos o despega las sombras de cerca. Calibrable.
const SESGO_TEXELES = 1.5

// La cámara puede llegar a 400 km (maxDistance de OrbitControls); la luz tiene
// que quedar detrás del terreno más alto de la cascada para que su plano near
// no recorte la montaña que proyecta. El Táchira llega a ~4.000 m sobre el
// nivel del mar y el valle de la cuenca del Uribante baja a ~150 m, así que
// 6 km de margen cubre cualquier pareja emisor/receptor.
const MARGEN_LUZ = 6000

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
      lightNear: 1, lightFar: MARGEN_LUZ * 3,
      lightDirection: sol.clone().negate(),
    })
    // Sesgo por cascada, en metros, proporcional a lo que mide un texel de esa
    // cascada (ver SESGO_TEXELES). El shadow.bias global de CSM se queda en su
    // valor por defecto: normalBias trabaja en unidades de mundo y es el que
    // se puede razonar contra el tamaño de un texel.
    for (const luz of c.lights) {
      const cam = luz.shadow.camera
      luz.shadow.normalBias = SESGO_TEXELES * (cam.right - cam.left) / SOMBRA_PX
    }
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
      mesh.castShadow = true
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
  useEffect(() => { csm.updateFrustums() }, [csm, size])

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
