import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { CSM } from 'three/examples/jsm/csm/CSM.js'
import { useFrame, useThree } from '@react-three/fiber'
import { makeEnuFrame } from '../data/enu'
import { urlGenerado } from '../data/rutas'
import { metrosPorPixel } from './roadStyle'
import { materialRelieve, type UniformsRelieve } from './terrainShader'
import { direccionSol, CASCADA_CERCA } from './sol'
import { CacheTeselas } from './demTiles'
import { CacheImagenes, Z_MAX_IMG } from './imagenTeselas'
import { seleccionar, clave, ERROR_PX, type Nodo } from './quadtree'
import { geometriaNodo, raices, ventana } from './nodoTerreno'
import { stateMask } from './stateMask'
import { ancestrosEdificios, coberturaEdificios, errorMallaEdificios } from './buildingTerrain'
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
// imagenTeselas.ts), la luz del sol y del cielo lo multiplican, la perspectiva
// aérea le suma neblina y el AgX de Sky.tsx lo mapea al final. Cuatro pasos
// que la pueden dejar lavada o apagada, y ninguno se puede predecir de cabeza.
//
// Medido en Chrome sobre San Cristóbal a 4 km (600×400 px del centro de la
// pantalla, luminancia Rec.709), contra las teselas z15 y z16 de esa misma
// zona decodificadas tal cual, con el sombreado ANTERIOR (hillshade fijo):
//
//     fuente (sRGB de Esri)   media 110,8   sigma 32,0
//     ganancia 1,0            media 108,1   sigma 33,8   <-- se queda
//     ganancia 1,35           media 119,6   sigma 33,1
//     ganancia 1,7            media 128,7   sigma 32,6
//
// O sea: con 1,0 lo que se veía en pantalla tenía el brillo y el contraste de
// la foto original. Ese es el criterio: la foto se ve como la foto.
//
// Con la luz física (Lambert albedo/PI por la irradiancia del sol y del cielo
// de takram, sombras, oclusión) el mismo albedo sale MUCHO más oscuro, porque
// el hillshade de antes era un factor inventado cerca de 1 y esto es una
// ecuación de verdad. Vuelto a medir el 2026-09-07 sobre las mismas dos vistas
// (estado: 600×400 del centro; Libertador a 50 m de barra: 900×700), contra
// las capturas de antes de la luz como referencia:
//
//     ganancia 1,0    estado 69,4 (antes 84,9)   calle 73,6 (antes 104,8)
//     ganancia 1,4    estado 73,9                calle 83,3
//     ganancia 2,2    estado 81,5                calle 97,9
//     ganancia 2,6    estado 84,7                calle 103,7  <-- se queda
//
// La curva aplana porque el AgX comprime arriba. 2,6 deja la foto en el
// mismo nivel y con la misma sigma (39 contra 40) que tenía calibrada contra
// la fuente. Si cambia la iluminación, esta tabla es lo que hay que rehacer.
const GANANCIA = 2.6

// Geometrías que se conservan aunque no se dibujen, para no rearmar el nodo
// al volver a él. Un nodo son ~1.200 vértices: 800 nodos, unos 50 MB.
// Calibrable.
const GEOMETRIAS_MAX = 800

// Texturas de imagen vivas. Cada una son 256×256 RGBA más mipmaps, ~350 KB:
// 300 son ~105 MB de GPU, y es más de lo que llena la pantalla a cualquier
// nivel. Calibrable.
const TEXTURAS_MAX = 300

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
 * Con `imagen`, cada nodo además cuelga la tesela satelital de su mismo
 * z/x/y (imagenTeselas.ts) y el shader la usa de albedo. Eso obliga a dos
 * cosas: que el quadtree baje hasta z17 (la geometría ya no pide más detalle,
 * la foto sí) y que cada nodo tenga su propio material, porque la textura
 * cambia de nodo en nodo y un uniform es por material.
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
export function TerrainLod ({ meta, municipios, date, imagen = true }: {
  meta: TerrainMeta; municipios: Municipio[]
  /** Fecha de la escena: de ella sale la dirección del sol (sol.ts). */
  date: Date
  /** Foto satelital de albedo en vez de hipsometría. */
  imagen?: boolean
}) {
  const { camera, size, scene } = useThree()
  const grupo = useRef<THREE.Group>(null)
  const frame = useMemo(() => makeEnuFrame(meta.origin.lat, meta.origin.lon, meta.origin.h), [meta])
  const cache = useMemo(() => new CacheTeselas(), [])
  const imgs = useMemo(() => new CacheImagenes(TEXTURAS_MAX), [])
  useEffect(() => () => imgs.dispose(), [imgs])
  const errores = useRef<Record<string, number> | null>(null)
  useEffect(() => {
    fetch(urlGenerado('dem/errores.json')).then(r => r.json()).then(e => { errores.current = e })
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

  // Nodo -> malla armada (visible o no), en orden de uso para la LRU.
  const mallas = useMemo(() => new Map<string, { mesh: THREE.Mesh; caja: THREE.Box3 }>(), [])
  const nodosPorCaja = useMemo(() => new WeakMap<THREE.Box3, Nodo>(), [])
  const demandaEdificios = useRef(new Set<string>())

  // Las cascadas. Nacen y mueren en el MISMO efecto, y con ellas todas las
  // mallas armadas: CSM.dispose() le borra onBeforeCompile a cada material
  // que le instalaron, y como materialRelieve monta su propio parche ENCIMA
  // de ese, un material que sobreviva a su CSM recompila como
  // MeshStandardMaterial pelado (sin foto, sin hipsometría, sin recorte del
  // estado, y sumando las tres luces de cascada sin sombra). Hoy las
  // dependencias no cambian en producción, pero sí en Fast Refresh, y el día
  // que la fecha tenga un control cambiarían con ella.
  //
  // `lightDirection` es hacia dónde VIAJA la luz, o sea el sol negado. El
  // color de las luces lo pone el efecto de más abajo copiándolo del
  // <SunLight> de takram; el blanco del constructor solo se ve el primer
  // cuadro, antes de que la atmósfera termine de calcularlo.
  const csm = useRef<CSM | null>(null)
  useEffect(() => {
    const c = new CSM({
      camera, parent: scene, cascades: CASCADAS, maxFar: SOMBRA_MAX,
      shadowMapSize: SOMBRA_PX, lightMargin: MARGEN_LUZ,
      // lightFar tiene que cubrir el margen más el desnivel que quepa en la
      // cascada más grande; el shadow map es ortográfico, así que su
      // profundidad es lineal y estirarlo no cuesta precisión.
      lightNear: 1, lightFar: MARGEN_LUZ * 3, shadowBias: SESGO_PROFUNDIDAD,
      lightDirection: sol.clone().negate(),
    })
    c.updateFrustums()
    sesgar(c)
    // La calzada no pasa por el chunk de CSM (es un LineMaterial parcheado a
    // mano) y necesita muestrear este mismo shadow map para no salir a pleno
    // sol dentro de la sombra del relieve. Se le pone nombre a la cascada más
    // cercana y Roads.tsx la busca con scene.getObjectByName -- el mismo patrón
    // con el que este archivo busca el <SunLight> de takram, y sin acoplar los
    // dos componentes.
    c.lights[0].name = CASCADA_CERCA
    csm.current = c
    scene.userData.csm = c
    return () => {
      csm.current = null
      if (scene.userData.csm === c) delete scene.userData.csm
      delete scene.userData.terrainReady
      for (const m of mallas.values()) {
        grupo.current?.remove(m.mesh)
        m.mesh.geometry.dispose()
        ;(m.mesh.material as THREE.Material).dispose()
      }
      mallas.clear()
      c.remove()
      c.dispose()
    }
  }, [camera, scene, sol, mallas])

  // Un material por nodo (ver el comentario de arriba). El programa de GPU se
  // compila una sola vez; lo propio de cada uno son los siete uniforms que
  // materialRelieve cuelga de userData.uniforms. Las cascadas se instalan
  // dentro, porque CSM.setupMaterial pisa onBeforeCompile y el orden importa.
  // Solo se llama desde el cuadro, que no corre sin cascadas.
  const materialNodo = () => materialRelieve({
    min: meta.min, max: meta.max, mascara,
    ganancia: GANANCIA, cascadas: csm.current ?? undefined,
  })

  // El <SunLight> de takram, buscado por nombre igual que PickingPass busca a
  // este grupo por el suyo. Solo lo queremos por su color: lo tiene calculado
  // contra la transmitancia de la atmósfera para la posición y la fecha, que
  // es lo que hace que la luz del relieve y el cielo dibujado sean la misma
  // luz. Se busca cada cuadro hasta encontrarlo (Sky.tsx monta dentro de un
  // <Suspense> y puede llegar tarde), después nunca más.
  const luzSol = useRef<THREE.DirectionalLight | null>(null)

  const frustum = useMemo(() => new THREE.Frustum(), [])
  const m4 = useMemo(() => new THREE.Matrix4(), [])
  const nodosRaiz = useMemo(() => raices(meta.dem), [meta])
  // terrain.json viene de la rejilla reducida: el pico del DEM fino supera
  // su max unos 3 m. Estos 10 m solo reservan altura durante la carga.
  const techoInicial = meta.max + 10

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
    const demanda = demandaEdificios.current
    if (n.z < 15 && demanda.has(clave(n))) return Infinity
    // Emisores fuera del encuadre necesitan suelo exacto, pero no foto fina.
    if (n.z >= 15 && demanda.has(clave({ z: 15, x: n.x >> (n.z - 15), y: n.y >> (n.z - 15) }))) {
      const caja = mallas.get(clave(n))?.caja
      if (!caja || !frustum.intersectsBox(caja)) return 0
    }
    return imagen ? Math.max(geo, errorImagen(n)) : geo
  }
  const teselaDe = (n: Nodo) => { const w = ventana(n, meta.dem); return cache.get(w.zt, w.xt, w.yt) }
  const cajaDe = (n: Nodo): THREE.Box3 => {
    const k = clave(n)
    let m = mallas.get(k)
    if (!m) {
      // Infinity es una orden de refinamiento, nunca un error de la malla:
      // usarlo para el faldón produciría vértices con Y=-Infinity.
      const errorMalla = errorMallaEdificios(n, errores.current)
      const { geometry, caja } = geometriaNodo(n, teselaDe(n)!, meta.dem, frame, errorMalla, meta.bbox)
      const mesh = new THREE.Mesh(geometry, materialNodo())
      const errorGeo = n.z <= 14 ? errores.current?.[k] ?? 0 : 0
      if (errorGeo > 0) {
        const padre = mallas.get(clave({ z: n.z - 1, x: n.x >> 1, y: n.y >> 1 }))
        // Un padre provisional puede estar cientos de metros bajo su hijo.
        // Reserva la cota máxima + error hasta recibir geometría exacta.
        // El techo nunca crece al refinar, así que cargar no levanta la cámara.
        mesh.userData.techoCarga = Math.min(
          padre?.mesh.userData.techoCarga ?? techoInicial, caja.max.y + errorGeo,
        )
      }
      mesh.frustumCulled = false     // el quadtree ya recorta por su caja
      // Relieve y edificios proyectan y reciben sombra.
      // Las vías no proyectan: son líneas pegadas al terreno, su sombra sería
      // la del propio asfalto sobre sí mismo, y meterlas en tres pases más de
      // sombra costaría cientos de miles de segmentos por cuadro.
      // castShadow lo decide cada cuadro el bucle de visibilidad, por
      // distancia. receiveShadow se deja fijo: en three r185 es un uniform por
      // objeto (no entra en la clave de programa, alternarlo no recompila),
      // pero gatearlo no ahorra nada -- sin `fade`, el chunk de CSM ni evalúa
      // la sombra en un fragmento más allá de maxFar -- y apagarlo por malla
      // daría un salto de luz visible al cruzar el corte.
      mesh.receiveShadow = true
      mesh.visible = false
      grupo.current!.add(mesh)
      m = { mesh, caja }
      nodosPorCaja.set(caja, n)
    } else {
      mallas.delete(k)               // al final del Map: recién usada
    }
    mallas.set(k, m)
    return m.caja
  }

  // Las cascadas se reparten sobre el frustum de la cámara: si cambia la
  // relación de aspecto (redimensionar la ventana) hay que rehacerlas, o los
  // shadow maps quedan encuadrando el frustum viejo. Va después del efecto
  // que las crea, para que al montar corra en ese orden.
  useEffect(() => { const c = csm.current; if (c) { c.updateFrustums(); sesgar(c) } }, [size])

  useFrame(() => {
    const c = csm.current
    if (!grupo.current || !c) return
    // El color del sol de la atmósfera, copiado a las cascadas. Es luminancia,
    // no un color en [0,1]: la magnitud entera del sol vive en el color y la
    // intensity de la luz se queda en 1 (SunDirectionalLight.update() nunca la
    // toca). Copiarlo tal cual es lo que deja el relieve en la misma escala
    // que el cielo, antes del AgX del EffectComposer.
    if (!luzSol.current) luzSol.current = scene.getObjectByName('sol') as THREE.DirectionalLight | null
    if (luzSol.current) {
      for (const luz of c.lights) {
        luz.color.copy(luzSol.current.color)
        luz.intensity = luzSol.current.intensity
      }
    }
    c.update()
    m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(m4)
    demandaEdificios.current = ancestrosEdificios(new Set([
      ...(scene.userData.edificiosDem ?? []), ...(scene.userData.piezasDem ?? []),
    ]))
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45
    const sel = seleccionar(nodosRaiz, {
      // A vista oblicua el suelo bajo la cámara cae fuera del frustum, pero
      // Vista necesita esa hoja para el límite vertical, incluso paneando.
      intersecta: c => {
        const n = nodosPorCaja.get(c)
        const paraEdificio = n && demandaEdificios.current.has(clave(n.z <= 15 ? n : {
          z: 15, x: n.x >> (n.z - 15), y: n.y >> (n.z - 15),
        }))
        return !!paraEdificio || frustum.intersectsBox(c) || (
          camera.position.x >= c.min.x && camera.position.x <= c.max.x &&
          camera.position.z >= c.min.z && camera.position.z <= c.max.z
        )
      },
      posicion: camera.position,
      mpp: d => metrosPorPixel(d, fov, size.height),
    }, {
      error: errorDe,
      listo: n => teselaDe(n) !== undefined,
      pedir: n => { const w = ventana(n, meta.dem); cache.pedir(w.zt, w.xt, w.yt) },
      caja: cajaDe,
    }, imagen ? Z_MAX_IMG : Z_MAX_RELIEVE)
    const visibles = new Set(sel.map(clave))
    scene.userData.terrainReady = coberturaEdificios(sel)
    for (const [k, m] of mallas) {
      const v = visibles.has(k)
      m.mesh.visible = v
      // Las hojas solicitadas solo como suelo de emisores fuera de pantalla
      // se recortan también por cada cámara de render/sombra.
      m.mesh.frustumCulled = !frustum.intersectsBox(m.caja)
      // Solo proyecta sombra lo que cae dentro del alcance de las cascadas.
      // Sin este corte las mallas entran en los tres shadow maps AUNQUE queden
      // fuera de su cámara ortográfica: frustumCulled está en false (el
      // quadtree ya recorta por su caja) y three no tiene con qué descartarlas.
      // Medido en Chrome orbitando a vista de estado: los ~200 nodos visibles
      // se volvían 600 draw calls de sombra que no pintaban un solo texel.
      m.mesh.castShadow = v && m.caja.distanceToPoint(camera.position) < SOMBRA_MAX
    }

    // La foto de cada nodo visible. Mientras la suya viaja usa la del ancestro
    // más cercano que ya esté, con el trozo que le toca: al refinar, el nodo
    // nuevo aparece con la foto borrosa del padre y se afina cuando llega la
    // propia, en vez de parpadear en gris.
    for (const n of sel) {
      const u = (mallas.get(clave(n))!.mesh.material as THREE.Material).userData.uniforms as UniformsRelieve
      if (!imagen) { u.uImagen.value = 0; continue }
      if (frustum.intersectsBox(mallas.get(clave(n))!.caja)) imgs.pedir(n.z, n.x, n.y)
      const mejor = imgs.mejor(n)
      if (!mejor) { u.uImagen.value = 0; continue }
      u.uImg.value = mejor.tex
      u.uImgUv.value.set(mejor.ox, mejor.oy, mejor.esc)
      u.uImagen.value = 1
    }

    // LRU: las más viejas primero, nunca una visible. CSM guarda cada material
    // que le instalaron en un Map propio: hay que sacarlo de ahí también, o el
    // Map crece con cada nodo desechado.
    for (const [k, m] of mallas) {
      if (mallas.size <= GEOMETRIAS_MAX) break
      if (visibles.has(k)) continue
      grupo.current.remove(m.mesh)
      m.mesh.geometry.dispose()
      c.shaders.delete(m.mesh.material)
      ;(m.mesh.material as THREE.Material).dispose()
      mallas.delete(k)
    }
  }, -0.75) // controles (-1) → animación (-0.9) → LOD → tope (-0.5) → vías (0)

  return <group ref={grupo} name="terrain" userData={{ alturaMaxima: techoInicial }} />
}
