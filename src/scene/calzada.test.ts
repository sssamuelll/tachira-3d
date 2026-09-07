import { describe, it, expect } from 'vitest'
import { ANCHO_CARRIL, carrilesDe, anchoCalzada, sentidoUnico } from './calzada'
import { NIVELES, nivelDe } from './roadStyle'
import roadsJson from '../../public/data/roads-meta.json'
import type { RoadsMeta, Way } from '../data/types'

const ways = (roadsJson as RoadsMeta).ways

// Una vía de mentira con solo lo que estas funciones miran.
const via = (p: Partial<Way>): Way => ({
  osmId: 1, ref: null, name: null, highway: 'residential', surface: null,
  tipo: 'sin_definir', municipio: null, km: 1, km3d: 1,
  lanes: null, oneway: false, ...p,
} as Way)

describe('carrilesDe', () => {
  it('cree a OSM cuando OSM lo dice', () => {
    expect(carrilesDe(via({ highway: 'residential', lanes: 4 }))).toBe(4)
    expect(carrilesDe(via({ highway: 'motorway', lanes: 6 }))).toBe(6)
  })

  it('sin dato, deduce del nivel: una troncal tiene más canales que una calle', () => {
    expect(carrilesDe(via({ highway: 'motorway' })))
      .toBeGreaterThan(carrilesDe(via({ highway: 'residential' })))
    expect(carrilesDe(via({ highway: 'residential' })))
      .toBeGreaterThanOrEqual(carrilesDe(via({ highway: 'track' })))
  })

  it('nunca menos de un canal, ni fracciones de canal', () => {
    for (const h of ['footway', 'track', 'service', 'residential', 'motorway']) {
      const c = carrilesDe(via({ highway: h }))
      expect(c).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(c)).toBe(true)
    }
  })

  it('una avenida de sentido único sin dato lleva dos canales, no la mitad de la calzada', () => {
    // OSM: de las secundarias y terciarias de sentido único que sí traen
    // lanes, ninguna terciaria dice 1 y las secundarias dicen 2 en su mayoría.
    // Una vía dividida en dos ways es una calzada por way, y esa calzada tiene
    // dos canales; con "la mitad del nivel" la Avenida Libertador salía de
    // uno y se dibujaba de 3,4 m.
    for (const h of ['tertiary', 'secondary', 'primary', 'trunk', 'motorway']) {
      expect(carrilesDe(via({ highway: h, oneway: true }))).toBe(2)
    }
  })

  it('una calle o vía de servicio de sentido único lleva uno', () => {
    for (const h of ['residential', 'service', 'living_street', 'track']) {
      expect(carrilesDe(via({ highway: h, oneway: true }))).toBe(1)
    }
  })

  it('el sentido único nunca lleva más canales que la calzada completa de su nivel', () => {
    for (const h of ['footway', 'track', 'residential', 'tertiary', 'secondary', 'primary', 'motorway']) {
      expect(carrilesDe(via({ highway: h, oneway: true })))
        .toBeLessThanOrEqual(carrilesDe(via({ highway: h, oneway: false })))
    }
  })

  it('un lanes corrupto de OSM no se cuela', () => {
    // OSM es dato de terceros: hay ways con lanes="2;3", negativos y ceros.
    for (const malo of [0, -3, 99, NaN, 1.5]) {
      const c = carrilesDe(via({ highway: 'primary', lanes: malo }))
      expect(Number.isInteger(c)).toBe(true)
      expect(c).toBeGreaterThanOrEqual(1)
      expect(c).toBeLessThanOrEqual(12)
    }
  })
})

describe('anchoCalzada', () => {
  it('cada canal aporta su ancho: el doble de canales es más ancho', () => {
    const dos = anchoCalzada(via({ highway: 'primary', lanes: 2 }))
    const cuatro = anchoCalzada(via({ highway: 'primary', lanes: 4 }))
    expect(cuatro).toBeGreaterThan(dos)
    expect(cuatro - dos).toBeCloseTo(2 * ANCHO_CARRIL, 5)
  })

  it('el carril mide lo que mide un carril de verdad', () => {
    // Norma venezolana de proyecto: 3,0 a 3,6 m. Fuera de ahí, el mapa miente.
    expect(ANCHO_CARRIL).toBeGreaterThanOrEqual(3.0)
    expect(ANCHO_CARRIL).toBeLessThanOrEqual(3.6)
  })

  it('respeta la jerarquía: una troncal es más ancha que una calle', () => {
    expect(anchoCalzada(via({ highway: 'motorway' })))
      .toBeGreaterThan(anchoCalzada(via({ highway: 'residential' })))
  })

  it('ninguna vía real del Táchira sale absurda', () => {
    // 26.712 vías reales. Una calzada de 80 m o de 30 cm es un error de datos
    // que se dibujaría igual: esto lo atrapa antes de la pantalla.
    for (const w of ways) {
      const a = anchoCalzada(w)
      expect(a).toBeGreaterThanOrEqual(2)
      expect(a).toBeLessThanOrEqual(45)
    }
  })

  it('no se aleja del ancho de referencia de su nivel', () => {
    // NIVELES[n].metros sigue siendo el ancho típico del nivel, y es lo que
    // dimensiona el linewidth del material: si el ancho por vía se le escapa
    // por arriba, el shader recortaría una calzada que no cabe en su banda.
    for (const w of ways) {
      expect(anchoCalzada(w)).toBeLessThanOrEqual(NIVELES[nivelDe(w.highway)].metros)
    }
  })
})

describe('sentidoUnico', () => {
  it('lee las formas que OSM usa de verdad', () => {
    expect(sentidoUnico(via({ oneway: true }))).toBe(true)
    expect(sentidoUnico(via({ oneway: false }))).toBe(false)
    expect(sentidoUnico(via({ oneway: null }))).toBe(false)
  })

  it('una autopista es de sentido único aunque OSM no lo etiquete', () => {
    // motorway implica oneway en OSM salvo que diga lo contrario; sin esto,
    // las autopistas saldrían con eje central de doble sentido pintado.
    expect(sentidoUnico(via({ highway: 'motorway', oneway: null }))).toBe(true)
  })
})
