import { useEffect, useRef, type RefObject } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeEnuFrame, geodeticToEnu, enuToGeodetic } from '../data/enu'
import { ORIGIN } from '../data/constants'
import { metrosPorPixel } from './roadStyle'
import { alturaTerreno, distanciaTerreno, distanciaVista } from './distanciaVista'
import { escalaBonita, type Escala } from '../ui/escala'
import type { Mirilla } from '../ui/disco'

const frame = makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)

/** Adónde mira la cámara y cuánto tiene que abarcar. Las dos formas de pedir
 * un encuadre (un bbox geodésico, o un conjunto de vías) terminan en esta
 * misma forma, así que <FlyTo> no sabe de dónde salió. */
export interface Encuadre { center: THREE.Vector3; span: number }

// Ejes del mundo: X=este, Y=arriba, Z=-norte (igual que Terrain.tsx y
// scripts/lib/pack.mjs) -- geodeticToEnu ya devuelve [e, n, u].
export function enuOf (lat: number, lon: number, h = 0) {
  const [e, n, u] = geodeticToEnu(frame, lat, lon, h)
  return new THREE.Vector3(e, u, -n)
}

/** La vuelta de enuOf: en qué punto del mapa está algo de la escena. */
export function geoOf (p: THREE.Vector3): [number, number, number] {
  return enuToGeodetic(frame, p.x, -p.z, p.y)
}

export function bboxCenterAndSpan (bbox: { s: number; w: number; n: number; e: number }): Encuadre {
  const a = enuOf(bbox.s, bbox.w), b = enuOf(bbox.n, bbox.e)
  return { center: a.clone().add(b).multiplyScalar(0.5), span: a.distanceTo(b) }
}

// Piso del encuadre. Una sola vía urbana mide decenas de metros: sin piso, la
// cámara termina a ~40 m del suelo, por dentro del near plane (10) y contra
// un relieve muestreado cada 130 m que a esa distancia es un plano. 1.200 m
// deja la vía centrada con su entorno alrededor. Calibrable.
const SPAN_MINIMO = 1200

/**
 * Encuadre de un conjunto de vías, leído de la geometría real que se está
 * dibujando (roads-pos.bin) y no de coordenadas geodésicas: `ways` no lleva
 * puntos, solo metadatos. `index` es CSR sobre segmentos -- las vías de la
 * vía i van de index[i] a index[i+1], seis floats por segmento (los dos
 * extremos). Devuelve null si el conjunto está vacío o no tiene segmentos.
 */
export function idsCenterAndSpan (
  positions: Float32Array, index: Uint32Array, ids: number[],
): Encuadre | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const i of ids) {
    for (let s = index[i]; s < index[i + 1]; s++) {
      const o = s * 6
      // Los dos extremos del segmento, en o+0..2 y o+3..5.
      for (let k = 0; k < 6; k += 3) {
        const x = positions[o + k], y = positions[o + k + 1], z = positions[o + k + 2]
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
      }
    }
  }
  if (!Number.isFinite(minX)) return null
  const a = new THREE.Vector3(minX, minY, minZ)
  const b = new THREE.Vector3(maxX, maxY, maxZ)
  return {
    center: a.clone().add(b).multiplyScalar(0.5),
    span: Math.max(a.distanceTo(b), SPAN_MINIMO),
  }
}

/** Mueve cámara y target de OrbitControls al encuadre pedido. */
export function FlyTo ({ objetivo }: { objetivo: Encuadre | null }) {
  const { camera, controls: rawControls } = useThree()
  // controls tipa en RootState como THREE.EventDispatcher | null -- sin
  // .target/.update() del OrbitControlsImpl real de drei. any acotado solo
  // a esto; camera ya tipa bien por sí sola (Ortho|PerspectiveCamera).
  const controls = rawControls as any
  useEffect(() => {
    if (!objetivo) return
    const { center, span } = objetivo
    camera.position.set(center.x, center.y + span * 0.7, center.z + span * 0.9)
    camera.updateProjectionMatrix()
    if (controls) {
      controls.target.copy(center)
      // El límite anterior pertenece al lugar del que venimos. Vista mide
      // el suelo del encuadre nuevo antes de dibujar el siguiente cuadro.
      controls.minDistance = RADIO_MINIMO
      controls.update()
      controls.dispatchEvent({ type: 'encuadre' })
    }
    // El efecto depende de la IDENTIDAD del objeto: quien llame tiene que
    // construir un Encuadre nuevo en cada petición, incluso para volver al
    // mismo sitio. bboxCenterAndSpan e idsCenterAndSpan siempre construyen
    // uno, así que pedir dos veces el mismo encuadre funciona las dos veces.
  }, [objetivo, camera, controls])
  return null
}

// --- Zoom por botón y barra de escala ---------------------------------------

/** Lo que los botones de la esquina y el minimapa le pueden pedir a la cámara. */
export interface ApiVista {
  acercar: () => void
  alejar: () => void
  /** Lleva el punto que miras hasta acá. No toca la distancia ni el ángulo:
   *  el minimapa sirve para moverse por el mapa, no para reencuadrarlo. */
  irA: (destino: THREE.Vector3) => void
}

// Un clic duplica o parte a la mitad la distancia al punto que miras. Es el
// "nivel de zoom" de toda la vida -- Maps, OSM y Earth usan el mismo factor --
// y hace que ir de la vista del estado (108 km) a una calle (50 m) cueste once
// clics, con cada uno claramente distinto del anterior.
const PASO = 2

// Velocidad del acercamiento, en e-plegados por segundo. Con 9, un paso
// completo tarda unos 250 ms: el ojo sigue el movimiento (un salto seco pierde
// de vista dónde estabas) y el segundo clic no tiene que esperar al primero.
const LAMBDA = 9

// Deja inspeccionar a 30 m y reserva 5 m sobre el near plane (10 m).
// El freno solo entra en los últimos 45 m de holgura: a 125 m no interviene.
const ALTURA_MINIMA = 15
const FRENO = 45
// Piso propio del radio, incluso mirando al horizonte: coincide con el near
// (10 m, App.tsx) y deja trabajar a 15 m mirando hacia abajo.
const RADIO_MINIMO = 10

/**
 * Techo del radio, en alturas sobre el suelo. El pivote de la órbita es donde
 * el rayo del centro de la pantalla pega en el terreno, y a vista rasante ese
 * rayo viaja kilómetros: medido sobre San Cristóbal a 500 m de altura, el
 * radio pasaba de 624 m mirando a 40° a 8.059 m mirando al horizonte.
 *
 * Eso rompía dos cosas a la vez, porque el radio es el brazo de la órbita Y la
 * unidad del zoom. El mismo diente de rueda movía 31 m mirando abajo y 403 m
 * mirando al horizonte -- eso es lo que se siente como que el zoom no es
 * logarítmico: el paso no es una fracción de tu altura, es una fracción de lo
 * que el rayo viajó por casualidad. Y orbitar giraba alrededor de un punto a
 * ocho kilómetros, que en pantalla se lee como que el mundo entero se mueve.
 *
 * Con el techo, el pivote deja de estar sobre la superficie cuando el rayo se
 * va lejos: queda flotando sobre la misma línea de visión, a tres alturas por
 * delante. Es lo que hace Google Earth y es lo que mantiene el paso del zoom
 * acotado sin tocar cómo se ve nada.
 *
 * Calibrable: 3 deja el pivote a unos 18° de depresión, que es un encuadre
 * normal de mapa. Subirlo devuelve el tirón; bajarlo acerca el centro de giro
 * hasta que orbitar se siente como girar sobre uno mismo.
 */
export const PIVOTE_MAX = 3

/**
 * Cuánto se puede acortar el radio de un tirón aunque no quede holgura sobre
 * el suelo. Sin esto, `minDistance` quedaba EXACTAMENTE igual al radio en
 * cuanto la cámara se posaba en su altura mínima -- medido en el mapa real a
 * siete inclinaciones distintas, las siete con minDistance == radio -- y la
 * rueda no hacía absolutamente nada.
 *
 * Es seguro porque el tope vertical de más arriba corre en CADA cuadro y solo
 * sube: la rueda mete la cámara un 10 % hacia el pivote (adelante y un poco
 * abajo), el tope la devuelve a su altura, y lo que queda es haber avanzado.
 * A ras de suelo la rueda deja de ser un descenso y pasa a ser un paso al
 * frente, que es lo que uno quiere mirando una calle.
 */
const DOLLY_MINIMO = 0.1

// Ancho al que apunta la barra de escala. Google la dibuja de unos 60 px y
// tenue; ésta pide 104 y va sobre pastilla blanca, porque acá el número es
// dato de trabajo -- decidir si una vía se evalúa a 50 m o a 2 km -- y no un
// adorno de esquina.
const ESCALA_PX = 104

// A cuántos metros del destino se da por terminado un paneo. El amortiguado se
// acerca sin llegar nunca, así que el último tramo se salta de una: un metro no
// se ve ni pegado al suelo, y sin este corte la animación no cierra jamás.
const PANEO_FIN = 1

// Vectores de trabajo, reusados en cada cuadro: solo hay una <Vista> montada.
const brazo = new THREE.Vector3()
const paso = new THREE.Vector3()

/**
 * El puente entre la cámara y los controles de la esquina: publica el zoom en
 * `api` para que los botones (que viven en el DOM, fuera del Canvas) puedan
 * pedirlo, y avisa por `onEscala` cuánto terreno mide la pantalla.
 *
 * Vive dentro de <Canvas> porque las dos cosas necesitan la cámara viva de
 * cada cuadro. El acercamiento se anima acá y no en el clic por la misma
 * razón: es un movimiento, no un salto.
 */
export function Vista ({ api, onEscala, mirilla }: {
  api: RefObject<ApiVista | null>
  onEscala: (e: Escala) => void
  /** Adónde avisar, cada cuadro, qué parte del mapa se está mirando. Lo
   *  rellena el minimapa al montarse; va por ref y no por estado de React
   *  porque cambia sesenta veces por segundo mientras arrastras. */
  mirilla: RefObject<((m: Mirilla) => void) | null>
}) {
  const { camera, controls: rawControls, size, scene, invalidate } = useThree()
  const controls = rawControls as any
  // Distancia a la que va la cámara, o null si no hay acercamiento en curso.
  const destino = useRef<number | null>(null)
  // Punto al que va el centro de la vista, o null si no hay paneo en curso.
  const centro = useRef<THREE.Vector3 | null>(null)
  // Última escala avisada, para no repetirla.
  const escala = useRef<Escala | null>(null)
  const anterior = useRef<{ radio: number | null; altura: number; cota: number | null; medido: boolean }>({
    radio: null, altura: Infinity, cota: null, medido: true,
  })

  useEffect(() => {
    if (!controls) return
    const salto = (f: number) => {
      const d = (destino.current ?? camera.position.distanceTo(controls.target)) * f
      destino.current = Math.min(controls.maxDistance, Math.max(controls.minDistance, d))
    }
    api.current = {
      acercar: () => salto(1 / PASO),
      alejar: () => salto(PASO),
      irA: (p: THREE.Vector3) => { centro.current = p.clone() },
    }
    // Arrastrar o girar la rueda cancela el movimiento en curso: OrbitControls
    // emite 'start' en el gesto del usuario y no en su propio update(), así que
    // esto distingue "lo movió él" de "lo estoy moviendo yo". Sin esto, la
    // animación sigue tirando de la cámara contra la mano.
    const soltar = () => { destino.current = null; centro.current = null }
    const encuadrar = () => { soltar(); anterior.current.radio = null; anterior.current.cota = null }
    controls.addEventListener('start', soltar)
    controls.addEventListener('encuadre', encuadrar)
    return () => {
      controls.removeEventListener('start', soltar)
      controls.removeEventListener('encuadre', encuadrar)
      api.current = null
    }
  }, [api, camera, controls])

  useFrame((_, dt) => {
    if (!controls) return
    const target = controls.target as THREE.Vector3
    let movio = false

    // El paneo va PRIMERO y mueve la cámara el mismo delta que el centro: es
    // una traslación rígida, así que el brazo que el zoom mide justo después
    // sigue siendo el mismo. Al revés habría que recalcularlo dos veces.
    const meta2 = centro.current
    if (meta2) {
      paso.subVectors(meta2, target)
      if (paso.length() < PANEO_FIN) centro.current = null
      else paso.multiplyScalar(1 - Math.exp(-LAMBDA * dt))
      target.add(paso)
      camera.position.add(paso)
      movio = true
    }

    brazo.subVectors(camera.position, target)
    let d = Math.max(brazo.length(), 1e-3)
    const meta = destino.current
    // El primer cuadro establece el pivote y convierte un destino pendiente
    // al radio sobre el suelo antes de dar el primer paso de la animación.
    if (meta != null && anterior.current.radio !== null) {
      // El amortiguado va sobre el LOGARITMO de la distancia, no sobre la
      // distancia: el zoom se percibe por factores, no por metros. En lineal,
      // acercarse desde 100 km arranca de un tirón y el último kilómetro se
      // arrastra; en logarítmico el paso se ve igual de rápido a cualquier
      // altura, que es lo que hace que once clics seguidos se sientan uno.
      d = Math.exp(THREE.MathUtils.damp(Math.log(d), Math.log(meta), LAMBDA, dt))
      if (Math.abs(Math.log(d / meta)) < 1e-3) { d = meta; destino.current = null }
      camera.position.copy(target).addScaledVector(brazo.normalize(), d)
      movio = true
    }
    // OrbitControls ya hizo su update (-1). El cambio de radio identifica el
    // dolly (rueda/pinch); panear u orbitar conservan el radio. Los botones
    // pasan por aquí también. Solo se frena al acercarse, nunca al alejarse.
    const previo = anterior.current
    if (previo.radio !== null && d < previo.radio) {
      // A vista de estado la columna puede caer fuera del DEM. Hay que
      // permitir volver desde allí; solo se espera cerca del suelo desconocido.
      const freno = previo.medido || previo.altura > ALTURA_MINIMA + FRENO
        ? THREE.MathUtils.smoothstep(previo.altura - ALTURA_MINIMA, 0, FRENO) : 0
      // El freno mide la altura, pero lo que hay que frenar es el DESCENSO, y
      // acortar el radio solo hace descender en la medida en que el pivote esté
      // por debajo. `bajada` es el seno de esa depresión: 1 mirando a plomo, ~0
      // mirando al horizonte. Sin este término el freno valía 0 posado en el
      // suelo y devolvía el radio ENTERO, o sea que la rueda no hacía nada a
      // ninguna inclinación -- el segundo candado, además de minDistance.
      // Mirando abajo no cambia una coma: bajada = 1 deja el freno como estaba.
      // Solo con cota MEDIDA. Sin ella el freno es un "espera al relieve" y no
      // un "no bajes tan rápido": aflojarlo ahí dejaría a la cámara descender
      // contra un suelo que todavía no se sabe dónde está.
      const bajada = THREE.MathUtils.clamp(Math.max(0, brazo.y) / Math.max(d, 1e-6), 0, 1)
      const alivio = previo.medido ? 1 - bajada : 0
      d = THREE.MathUtils.lerp(previo.radio, d, Math.max(freno, alivio))
      camera.position.copy(target).addScaledVector(brazo.normalize(), d)
      movio = true
    }
    // No repetir controls.update(): consumiría dos veces el damping del pan.
    // El invalidate es lo que mantiene viva la animación con el bucle por
    // demanda (App.tsx): OrbitControls pide cuadro mientras el ratón está
    // apretado, pero el paneo y el zoom siguen amortiguando después de
    // soltarlo, y nadie más los empujaría hasta el final. `movio` ya es
    // exactamente "esta animación todavía se está moviendo".
    if (movio) { camera.lookAt(target); invalidate() }
  }, -0.9) // movimiento antes de que el LOD seleccione el suelo bajo la cámara

  useFrame((state) => {
    if (!controls) return
    const target = controls.target as THREE.Vector3
    const previo = anterior.current
    // La envolvente del DEM protege mientras faltan las mallas. Al llegar
    // el suelo baja el límite, no la cámara. Si se pierde cobertura después,
    // conserva la última cota y suspende el descenso hasta volver a medir;
    // sustituirla por el máximo del estado lanzaría la cámara kilómetros.
    const medida = alturaTerreno(camera.position, scene, true)
    const cota = medida ?? previo.cota ?? scene.getObjectByName('terrain')?.userData.alturaMaxima
    const altura = cota == null ? Infinity : camera.position.y - cota
    const subir = Math.max(0, ALTURA_MINIMA - altura)
    camera.position.y += subir
    target.y += subir // traslación rígida: el tope no cambia la inclinación
    // Sube contra el suelo que acaba de llegar, no contra un gesto: sin pedir
    // cuadro, el empujón se calcularía y no se vería hasta que alguien tocara
    // el ratón.
    if (subir > 0) { camera.lookAt(target); invalidate() }

    const suelo = distanciaTerreno(camera, scene, state.clock.elapsedTime)
    brazo.subVectors(target, camera.position)
    const radio = brazo.length()
    if (suelo !== null && suelo > 1e-3 && radio > 1e-3) {
      // Mismo rayo de visión, pivote en la superficie. Subir solo target.y
      // inclinaría la cámara; conservar el radio enterrado vuelve a hundirla.
      // Una ladera puede tocar el rayo antes del near: el pivote conserva
      // su piso sin mover la cámara ni cambiar la dirección de la vista.
      // El techo (PIVOTE_MAX) es lo único que lo despega de la superficie, y
      // solo cuando el rayo se va al horizonte. Sin cota medida la altura es
      // Infinity y el techo no existe: no hay contra qué acotar todavía.
      const techo = Math.max(RADIO_MINIMO, (altura + subir) * PIVOTE_MAX)
      const distancia = Math.min(techo, Math.max(RADIO_MINIMO, suelo))
      target.copy(camera.position).addScaledVector(brazo, distancia / radio)
      if (destino.current !== null) destino.current *= distancia / radio
    }
    brazo.subVectors(camera.position, target)
    const d = brazo.length()
    const holgura = Math.max(0, altura + subir - ALTURA_MINIMA)
    // Tope preventivo del dolly sobre el plano bajo la cámara; el vertical
    // por cuadro resuelve además laderas, paneo y cambios del LOD.
    // El DOLLY_MINIMO es el suelo de ese tope: sin holgura la cuenta daba
    // exactamente el radio de ahora y la rueda quedaba muerta.
    const margen = brazo.y > 0 ? holgura * d / brazo.y : d
    controls.minDistance = Math.max(RADIO_MINIMO, d - Math.max(margen, d * DOLLY_MINIMO))
    if (destino.current !== null) destino.current = Math.max(controls.minDistance, destino.current)
    previo.radio = d
    previo.altura = altura + subir
    previo.cota = cota ?? null
    previo.medido = medida !== null

    // Dónde estás mirando y desde dónde, para el minimapa. Sale de la cámara
    // viva y no de un estado de React a propósito: esto cambia en cada cuadro
    // de una órbita, y hacerlo pasar por un setState re-renderizaría toda la
    // interfaz (la lista del buscador incluida) sesenta veces por segundo.
    const avisar = mirilla.current
    if (avisar) {
      const [lat, lon] = geoOf(target)
      const [camLat, camLon] = geoOf(camera.position)
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 45
      // El fov de three es el VERTICAL; el que abre el cono sobre el mapa es
      // el horizontal, que depende de la forma de la ventana.
      const semi = Math.atan(Math.tan(fov * THREE.MathUtils.DEG2RAD / 2) * (size.width / size.height))
      avisar({ lat, lon, camLat, camLon, semi })
    }

    const mpp = metrosPorPixel(distanciaVista(camera, scene, target, state.clock.elapsedTime), (camera as THREE.PerspectiveCamera).fov ?? 45, size.height)
    const e = escalaBonita(mpp, ESCALA_PX)
    // Solo se avisa cuando cambia lo que se VE -- el texto o el ancho en
    // píxeles enteros. Sin este filtro esto sería un setState por cuadro, o
    // sea sesenta re-renders por segundo de toda la interfaz mientras orbitas.
    const ult = escala.current
    if (!ult || ult.texto !== e.texto || ult.px !== e.px) {
      escala.current = e
      onEscala(e)
    }
  }, -0.5) // después del LOD (-0.75), antes de Roads (0): comparten la medida
  return null
}
