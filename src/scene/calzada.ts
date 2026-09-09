import type { Way } from '../data/types'
import { NIVELES, nivelDe } from './roadStyle'

/** Ancho estimado de un canal. OSM lanes cuenta la calzada completa. */
export const ANCHO_CARRIL = 3.4

/** Lo que no es vía de vehículos. Lo consumen el ancho de calzada, las marcas
 *  y la sección transversal (seccion.ts): una acera no lleva ni brocal ni
 *  hombrillo. */
export const PEATONALES = new Set([
  'footway', 'steps', 'path', 'bridleway', 'cycleway', 'pedestrian', 'platform', 'corridor',
])

// Canales por defecto de cada nivel de la jerarquía, cuando OSM no dice
// cuántos hay -- que es el caso de 25.734 de las 26.712 vías. Salen del NIVEL
// y no de una lista de clases sueltas para que el ancho que resulte quepa en
// el ancho de referencia del nivel (NIVELES[n].metros, ver anchoCalzada).
//
// La segunda fila es sentido único. Una vía dividida en dos ways representa
// una sola calzada, así que no lleva la calzada completa; pero tampoco la
// mitad exacta: en el .cache de OSM, de las vías de sentido único que sí
// traen `lanes`, ninguna terciaria dice 1 canal y las secundarias dicen 2 en
// su mayoría. Con "la mitad" la Avenida Libertador salía de un canal.
const CANALES_POR_NIVEL = [1, 1, 2, 2, 2, 2, 4] as const
const CANALES_SENTIDO_UNICO = [1, 1, 1, 2, 2, 2, 2] as const

const carrilesValidos = (lanes: Way['lanes']): lanes is number =>
  typeof lanes === 'number' && Number.isInteger(lanes) && lanes >= 1 && lanes <= 12

/** Un false explícito prevalece sobre la implicación oneway de motorway. */
export function sentidoUnico (via: Way): boolean {
  if (typeof via.oneway === 'boolean') return via.oneway
  return via.highway === 'motorway' || via.highway === 'motorway_link'
}

export function carrilesDe (via: Way): number {
  if (carrilesValidos(via.lanes)) return via.lanes
  if (PEATONALES.has(via.highway)) return 1
  const n = nivelDe(via.highway)
  return sentidoUnico(via) ? CANALES_SENTIDO_UNICO[n] : CANALES_POR_NIVEL[n]
}

export function anchoCalzada (via: Way): number {
  // Un sendero sin lanes no implica un carril de automóvil. Un dato explícito
  // válido sí prevalece, también en las calles peatonalizadas del dataset.
  const metros = PEATONALES.has(via.highway) && !carrilesValidos(via.lanes)
    ? 2.5
    : carrilesDe(via) * ANCHO_CARRIL
  // Acotado al ancho de referencia de su nivel. Ya no sostiene el dibujo (cada
  // vía se extruye de su propio ancho, roadsShader.ts): es una cota de
  // cordura contra un `lanes` disparatado de OSM, como la residential de seis
  // canales que hay en el dataset, que saldría de 20 m.
  return Math.min(metros, NIVELES[nivelDe(via.highway)].metros)
}

const SIN_PAVIMENTAR = new Set([
  'unpaved', 'gravel', 'fine_gravel', 'compacted', 'dirt', 'earth', 'ground',
  'sand', 'mud', 'grass', 'grass_paver', 'woodchips', 'rock', 'pebblestone',
])
const PAVIMENTADO = new Set(['paved', 'asphalt', 'concrete', 'concrete:lanes', 'concrete:plates', 'paving_stones'])

/** Convención visual, no inventario de pintura existente. No inferimos marcas
 *  sobre senderos, obras, circuitos ni una pista rural de pavimento desconocido.
 *  En el resto de la red vial solo las suprime una superficie sin pavimentar
 *  explícita; surface=null no permite decidir que una calle carece de asfalto. */
export function marcasPermitidas (via: Way): boolean {
  if (PEATONALES.has(via.highway) || ['construction', 'proposed', 'raceway'].includes(via.highway)) return false
  if (via.surface && SIN_PAVIMENTAR.has(via.surface)) return false
  return via.highway !== 'track' || (via.surface !== null && PAVIMENTADO.has(via.surface))
}
