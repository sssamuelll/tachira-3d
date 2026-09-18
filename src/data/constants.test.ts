import { test, expect } from 'vitest'
import {
  PCI_RANGES, pciColor, pciRange, SIN_EVALUAR, CASING, CASING_SUAVE, ATTR_SIZE,
  LIBERTY, tierLiberty,
} from './constants'
import roadsJson from '../../public/data/roads-meta.json'
import type { RoadsMeta } from './types'

test('los 7 rangos ASTM cubren 0-100 sin huecos ni solapes', () => {
  const ordenados = [...PCI_RANGES].sort((a, b) => a.min - b.min)
  expect(ordenados[0].min).toBe(0)
  expect(ordenados[ordenados.length - 1].max).toBe(100)
  for (let i = 1; i < ordenados.length; i++) {
    expect(ordenados[i].min).toBe(ordenados[i - 1].max + 1)
  }
  expect(PCI_RANGES).toHaveLength(7)
})

test('pciColor devuelve gris para sin evaluar y color para los extremos', () => {
  const sinEvaluar = pciColor(null)
  expect(sinEvaluar[0]).toBe(sinEvaluar[1])
  expect(sinEvaluar[1]).toBe(sinEvaluar[2])
  expect(sinEvaluar).not.toBe(SIN_EVALUAR) // copia, no la instancia compartida
  expect(pciColor(100)).not.toEqual(pciColor(0))
  // Ningún escalón de la rampa ASTM puede parecerse a "sin evaluar": en el
  // mapa son la misma clase de marca (el color de una vía) y quien lo mira no
  // tiene forma de desempatar. La rampa es cromática y esto es un gris claro,
  // así que la distancia mínima real es amplia -- el umbral solo atrapa que
  // alguien meta un gris o un blanco en PCI_RANGES.
  for (const r of PCI_RANGES) {
    const d = Math.hypot(...r.color.map((c, i) => c - SIN_EVALUAR[i]))
    expect(d).toBeGreaterThan(0.3)
  }
})

// Este test existe por un error que se cometió dos veces seguidas, en dos
// canales distintos: dejar el aspecto de una vía SIN EVALUAR como el peor caso
// visual. Primero fue la opacidad (procedencia 'sin' al 45%), después el
// contorno (procedencia 'sin' en gris claro). Las 26.712 arrancan sin evaluar,
// así que el peor caso de esa escala no es un caso raro: es la aplicación
// recién abierta.
test('el contorno se ve contra una via sin evaluar, incluso en su extremo mas flojo', () => {
  const lum = (c: readonly number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  for (const borde of [CASING, CASING_SUAVE]) {
    expect(lum(SIN_EVALUAR) - lum(borde)).toBeGreaterThan(0.55)
  }
  // …y los dos extremos tienen que distinguirse entre sí, o la procedencia no
  // se está diciendo en ningún lado del mapa.
  expect(lum(CASING_SUAVE) - lum(CASING)).toBeGreaterThan(0.08)
})

test('la data texture cabe para 26.712 vias', () => {
  expect(ATTR_SIZE * ATTR_SIZE).toBeGreaterThanOrEqual(26712)
})

test('pciRange encuentra el tramo correcto en los bordes de cada lado', () => {
  expect(pciRange(86)?.label).toBe('Bueno')
  expect(pciRange(85)?.label).toBe('Satisfactorio')
  expect(pciRange(11)?.label).toBe('Grave')
  expect(pciRange(10)?.label).toBe('Colapsado')
  expect(pciRange(null)).toBeNull()
})

// --- Paleta vial de OpenFreeMap Liberty ------------------------------------
// Es el basemap por defecto de GeoLibre. Lo de abajo no sale de mirar una
// captura: sale del JSON del estilo servido en tiles.openfreemap.org.

test('la paleta Liberty tiene los tres tiers con sus dos contornos', () => {
  expect(LIBERTY).toHaveLength(3)
  const hx = (c: readonly number[]) =>
    '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
  expect(hx(LIBERTY[0].relleno)).toBe('#ffcc88')   // road_motorway
  expect(hx(LIBERTY[1].relleno)).toBe('#ffeeaa')   // road_trunk_primary / secondary_tertiary
  expect(hx(LIBERTY[2].relleno)).toBe('#ffffff')   // road_minor / service_track
  expect(hx(LIBERTY[0].contorno)).toBe('#e9ac77')
  expect(hx(LIBERTY[1].contorno)).toBe('#e9ac77')
  expect(hx(LIBERTY[2].contorno)).toBe('#cfcdca')
})

// Las 26 clases que trae de verdad la red del Táchira, cada una con el tier
// que le da Liberty según sus filtros de capa. Escritas una por una a
// propósito: es la tabla que se está portando, no un resumen de ella.
test('tierLiberty reparte las 26 clases del dataset como lo hace Liberty', () => {
  const esperado: Record<string, number> = {
    motorway: 0, motorway_link: 0,
    trunk: 1, trunk_link: 1, primary: 1, primary_link: 1,
    secondary: 1, secondary_link: 1, tertiary: 1, tertiary_link: 1,
    residential: 2, service: 2, unclassified: 2, track: 2, living_street: 2,
    footway: 2, steps: 2, bridleway: 2, path: 2, cycleway: 2, pedestrian: 2,
    construction: 2, platform: 2, proposed: 2, raceway: 2, rest_area: 2,
  }
  for (const [clase, tier] of Object.entries(esperado)) {
    expect(tierLiberty(clase)).toBe(tier)
  }
  // Y ninguna clase real del dataset puede quedarse fuera de la tabla de
  // arriba: si OSM trae una nueva al regenerar los datos, este test la caza.
  const clases = new Set((roadsJson as RoadsMeta).ways.map(w => w.highway))
  for (const c of clases) expect(Object.keys(esperado)).toContain(c)
})

// Un `motorway_link` es ámbar como la autopista, pero un `trunk_link` es
// amarillo como la arteria: Liberty tiene road_motorway_link separado de
// road_link. Es el par que más fácil se colapsa al portar la tabla.
test('los enlaces siguen a su clase, no todos al mismo tier', () => {
  expect(tierLiberty('motorway_link')).toBe(tierLiberty('motorway'))
  expect(tierLiberty('trunk_link')).toBe(tierLiberty('trunk'))
  expect(tierLiberty('motorway_link')).not.toBe(tierLiberty('trunk_link'))
})

test('una clase que OSM invente cae en el tier menor, no se pierde', () => {
  expect(tierLiberty('rocket_road')).toBe(2)
})
