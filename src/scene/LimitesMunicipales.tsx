import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

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
