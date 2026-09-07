import { useEffect, useRef, type RefObject } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { makeEnuFrame, geodeticToEnu, enuToGeodetic } from '../data/enu'
import { ORIGIN } from '../data/constants'
import { metrosPorPixel } from './roadStyle'
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
    if (controls) { controls.target.copy(center); controls.update() }
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
  const { camera, controls: rawControls, size } = useThree()
  const controls = rawControls as any
  // Distancia a la que va la cámara, o null si no hay acercamiento en curso.
  const destino = useRef<number | null>(null)
  // Punto al que va el centro de la vista, o null si no hay paneo en curso.
  const centro = useRef<THREE.Vector3 | null>(null)
  // Última escala avisada, para no repetirla.
  const escala = useRef<Escala | null>(null)

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
    controls.addEventListener('start', soltar)
    return () => {
      controls.removeEventListener('start', soltar)
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
    if (meta != null) {
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
    if (movio) controls.update()

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

    const mpp = metrosPorPixel(d, (camera as THREE.PerspectiveCamera).fov ?? 45, size.height)
    const e = escalaBonita(mpp, ESCALA_PX)
    // Solo se avisa cuando cambia lo que se VE -- el texto o el ancho en
    // píxeles enteros. Sin este filtro esto sería un setState por cuadro, o
    // sea sesenta re-renders por segundo de toda la interfaz mientras orbitas.
    const ult = escala.current
    if (!ult || ult.texto !== e.texto || ult.px !== e.px) {
      escala.current = e
      onEscala(e)
    }
  })
  return null
}
