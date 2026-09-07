export const ORIGIN = { lat: 8.021973, lon: -71.901563, h: 0 }
export const BBOX = { s: 7.3612911, w: -72.4878225, n: 8.6826552, e: -71.3153029 }
export const GRID = 1024
export const ATTR_SIZE = 164          // 164² = 26.896 ≥ 26.712 vías

// Rangos ASTM D6433
export const PCI_RANGES = [
  { min: 86, max: 100, label: 'Bueno',        color: [0.13, 0.62, 0.31] },
  { min: 71, max: 85,  label: 'Satisfactorio', color: [0.49, 0.75, 0.27] },
  { min: 56, max: 70,  label: 'Regular',      color: [0.95, 0.83, 0.25] },
  { min: 41, max: 55,  label: 'Deficiente',   color: [0.95, 0.60, 0.20] },
  { min: 26, max: 40,  label: 'Muy deficiente', color: [0.89, 0.36, 0.16] },
  { min: 11, max: 25,  label: 'Grave',        color: [0.78, 0.16, 0.16] },
  { min: 0,  max: 10,  label: 'Colapsado',    color: [0.45, 0.08, 0.12] },
] as const

// Casi blanco, no gris: es el color por defecto de una vía en cualquier mapa
// vial, y quien lo lee entiende "vía" antes que "dato faltante". El gris medio
// que había acá antes salía además al 45% de opacidad (la procedencia 'sin' de
// roadsShader.ts) sobre relieve claro, así que el estado inicial de la
// aplicación -- las 26.712 sin evaluar -- era prácticamente invisible, y eran
// justo las que hay que ir a buscar. Lo que hace visible una vía blanca es su
// contorno oscuro (CASING), no su relleno.
export const SIN_EVALUAR: [number, number, number] = [0.96, 0.96, 0.96]

// Contorno oscuro de cada vía. Es lo que hace legible un trazo fino sobre un
// relieve texturado: sin él, una vía verde "Bueno" sobre monte verde no tiene
// borde contra el que leerse, por muy saturada que sea. Se dibuja debajo del
// relleno, un poco más ancho (roadStyle.ts).
export const CASING: [number, number, number] = [0.05, 0.06, 0.08]

// Contorno de una vía cuyo PCI no está medido. La procedencia del dato se
// leía antes en la opacidad de la vía entera, y eso obligaba a dibujar la red
// semitransparente: una carretera translúcida no se lee como carretera, se lee
// como una mancha, y encima las juntas entre tramos se acumulaban más oscuras.
// El relleno ahora va opaco siempre y la confianza en el dato se dice acá, en
// lo cerrado que sea el negro del borde.
//
// Los dos extremos son oscuros, y eso es deliberado: el contorno es lo que le
// da forma a la vía contra el relieve, así que ni el más flojo puede
// desaparecer. La primera versión de esto puso "sin dato" en un gris claro y
// el mapa recién abierto -- donde las 26.712 están sin dato -- volvió a
// quedarse sin bordes: el mismo error que la opacidad por procedencia ya
// había cometido, cometido otra vez en el canal de al lado.
export const CASING_SUAVE: [number, number, number] = [0.18, 0.20, 0.24]

// Color de lo seleccionado en el mapa. Deliberadamente fuera de la rampa
// ASTM: sobre un relieve claro, "seleccionado" no puede parecerse a ningún
// estado de pavimento. Más vivo que el azul de la interfaz (ui/theme.ts)
// porque este pasa por el tonemapping AgX de la escena (Sky.tsx), que
// desatura; el de la interfaz se dibuja en el DOM y no pasa por nada.
export const SELECCION: [number, number, number] = [0.09, 0.55, 0.95]

export const FUENTES = ['sin', 'heredado', 'estimado', 'medido'] as const
export const TIPOS = ['sin_definir', 'asfalto', 'concreto', 'granzon', 'tierra', 'empedrado'] as const

export function pciRange (pci: number | null): typeof PCI_RANGES[number] | null {
  if (pci == null) return null
  return PCI_RANGES.find(x => pci >= x.min && pci <= x.max) ?? null
}

export function pciColor (pci: number | null): [number, number, number] {
  const r = pciRange(pci)
  return r ? [...r.color] as [number, number, number] : [...SIN_EVALUAR] as [number, number, number]
}
