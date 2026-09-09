import { test, expect } from 'vitest'
import { PCI_RANGES, pciColor, pciRange, SIN_EVALUAR, CASING, CASING_SUAVE, ATTR_SIZE } from './constants'

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
