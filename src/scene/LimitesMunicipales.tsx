import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { ERROR_PX } from './quadtree'
import { ALZA_MIN_M } from './roadsShader'

/**
 * Los límites municipales, como línea y no como efecto de borde de una
 * textura.
 *
 * Antes esto vivía en el shader del relieve, comparando el índice de un téxel
 * con el de su vecino sobre una rejilla de 2048². De ahí salían los tres
 * defectos que esto arregla: el ancho iba en metros (un téxel son ~80 m, así
 * que de lejos desaparecía y de cerca era una banda), escalonaba porque
 * NEAREST sobre una rejilla escalona, y la frontera no existía como objeto al
 * que darle color u opacidad propios.
 */

/** Ancho en PÍXELES de pantalla, que es lo que `worldUnits: false` habilita.
 *  Calibrado a ojo sobre relieve hipsométrico y sobre foto satelital -- la
 *  satelital es el caso difícil, porque ya trae textura propia. */
export const ANCHO_PX = 1.3

/** Tenue a propósito: un límite administrativo orienta, no informa del
 *  pavimento, y no puede competir con la rampa del PCI. */
export const OPACIDAD = { claro: 0.85, oscuro: 0.75 } as const

/** Gris frío, como el de Google. Ni negro (pesa demasiado sobre el relieve)
 *  ni el color de acento (ese significa "esto es lo que tocaste"). */
export const COLOR_CLARO = '#9aa0a6'
export const COLOR_OSCURO = '#7c828a'

/** Fin del bloque `camera space` del vertex shader de LineMaterial: los dos
 *  extremos del segmento ya están en espacio de cámara, y es el punto exacto
 *  -- antes de cualquier rama de WORLD_UNITS -- donde hay que subirlos por la
 *  tolerancia del LOD. Ancla propia y no una importada de roadsShader.ts: esa
 *  vive donde vive porque la consumen varios módulos de las vías; esta la usa
 *  solo este parche. Si three cambia esta línea en una versión futura, mejor
 *  que reviente acá con un mensaje claro a que la frontera se entierre en
 *  silencio. */
const ANCLA_EJES = 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );'

/**
 * Compensa, en el vertex shader de LineMaterial, el error del LOD del
 * terreno (Arreglo 2, review de rama Task 8).
 *
 * La geometría sale del pipeline con una alza fija de ALZA_MIN_M sobre el DEM
 * FINO (scripts/lib/limites.mjs), pero lo que se DIBUJA no es el DEM fino:
 * es la simplificación del quadtree, que admite hasta ERROR_PX píxeles de
 * error proyectado (quadtree.ts) y puede quedar decenas de metros por encima
 * o por debajo de la superficie real -- medido hasta 36,7 m en un nodo real.
 * Con solo la alza fija, la línea desaparece bajo el terreno de lejos y
 * reaparece al refinar.
 *
 * Mismo remedio que ya usa la calzada (roadsShader.ts:122): subir cada
 * extremo la tolerancia del LOD a SU PROPIA profundidad de cámara, nunca
 * menos que la alza mínima de cerca -- de ahí el max(). ERROR_PX y
 * ALZA_MIN_M se IMPORTAN, no se copian: si se afina el error del quadtree o
 * la alza de las vías, esto se mueve con ellos.
 *
 * La vertical del MUNDO basta -- no hace falta la normal del terreno por
 * vértice, que esta geometría no trae: el marco es ENU local y sobre los
 * ~136 km del estado la normal geodésica se inclina menos de un grado.
 */
export function parcharLimites (material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    if (!shader.vertexShader.includes(ANCLA_EJES)) {
      throw new Error('LimitesMunicipales: no se encontró el ancla de camera space en el vertex shader de LineMaterial')
    }
    shader.vertexShader = shader.vertexShader.replace(ANCLA_EJES, `${ANCLA_EJES}
      vec3 arribaV = normalize( ( modelViewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
      float mppInicio = max( -start.z, 1e-3 ) * 2.0 / ( projectionMatrix[1][1] * resolution.y );
      float mppFin = max( -end.z, 1e-3 ) * 2.0 / ( projectionMatrix[1][1] * resolution.y );
      start.xyz += arribaV * max( ${ERROR_PX.toFixed(1)} * mppInicio, ${ALZA_MIN_M.toFixed(2)} );
      end.xyz += arribaV * max( ${ERROR_PX.toFixed(1)} * mppFin, ${ALZA_MIN_M.toFixed(2)} );
    `)
  }
  material.needsUpdate = true
}

export function LimitesMunicipales ({ posiciones, oscuro = false }: {
  posiciones: Float32Array
  oscuro?: boolean
}) {
  const { size } = useThree()

  const objeto = useMemo(() => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(posiciones)
    const material = new LineMaterial({
      // En píxeles y no en metros: es la diferencia entera con la textura que
      // esto reemplaza.
      worldUnits: false,
      transparent: true,
      // Como las vías: no escribe profundidad, así que no recorta lo que
      // tiene detrás ni pelea con el relieve por un z que comparten.
      depthWrite: false,
    })
    // El LOD del relieve puede dejar la malla dibujada decenas de metros
    // lejos del DEM fino sobre el que se drapeó esta línea (Arreglo 2): sin
    // esto, de lejos la frontera queda tapada por el propio terreno.
    parcharLimites(material)
    const linea = new LineSegments2(geometry, material)
    linea.name = 'limites'
    // Por debajo de las vías: un límite administrativo nunca puede taparle una
    // calle a quien está evaluando el pavimento.
    linea.renderOrder = -1
    // El recorte por frustum de three usa la caja de la geometría, que aquí es
    // el estado entero: no descarta nada y cuesta calcularla.
    linea.frustumCulled = false
    return linea
  }, [posiciones])

  // El ancho en píxeles solo sale bien si el material sabe de qué tamaño es el
  // lienzo. Mismo patrón que Roads.tsx.
  useEffect(() => {
    (objeto.material as LineMaterial).resolution.set(size.width, size.height)
  }, [objeto, size])

  useEffect(() => {
    const m = objeto.material as LineMaterial
    m.color = new THREE.Color(oscuro ? COLOR_OSCURO : COLOR_CLARO)
    m.linewidth = ANCHO_PX
    m.opacity = oscuro ? OPACIDAD.oscuro : OPACIDAD.claro
    m.needsUpdate = true
  }, [objeto, oscuro])

  // three no libera nada solo: la geometría y el material son nuestros.
  useEffect(() => () => {
    objeto.geometry.dispose()
    ;(objeto.material as LineMaterial).dispose()
  }, [objeto])

  return <primitive object={objeto} />
}
