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

// --- Paleta vial de OpenFreeMap Liberty ------------------------------------
//
// Liberty es el basemap por DEFECTO de GeoLibre: sus presets de Protomaps
// quedan ocultos si no hay VITE_PROTOMAPS_API_KEY (basemap-presets.ts), así
// que lo que ve alguien al abrir GeoLibre es esto
// (tiles.openfreemap.org/styles/liberty, vía plugins/osm-basemap.ts).
//
// Los valores salen del JSON del estilo servido, no de mirar una captura a
// ojo: #f8f4f0 de fondo, #cfcdca de contorno menor y #ffeeaa de arteria
// aparecen EXACTOS, píxel a píxel, en una captura de San Cristóbal.
//
// Liberty dice la CLASE con el tono. PCI_RANGES dice el ESTADO con el tono.
// No caben los dos en el mismo canal, y por eso no conviven: el mapa dibuja
// Liberty, y el estado del pavimento es una capa que se enciende ('pci' en
// capas.ts). Con la capa encendida vuelve todo lo de arriba -- rampa ASTM,
// SIN_EVALUAR y los contornos oscuros -- sin cambiar en nada.

/** #rrggbb a [0..1]³. Las paletas de un estilo de mapa se publican en hex, y
 *  poder compararlas con el original de un vistazo vale más que ahorrarse
 *  esta línea. */
const hex = (v: number): [number, number, number] =>
  [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]

export interface TierLiberty {
  relleno: [number, number, number]
  contorno: [number, number, number]
}

/**
 * Los tres tiers de Liberty. No son siete como los niveles de ancho
 * (roadStyle.ts): Liberty resuelve la red entera con tres rellenos y DOS
 * contornos, y el ancho lo lleva por su lado. Son dos clasificaciones
 * distintas de la misma vía y por eso esta tabla no se indexa por nivel.
 *
 * Ojo con los contornos: son CLAROS, porque Liberty dibuja sobre un fondo
 * plano #f8f4f0 -- sobre un fondo casi blanco, un contorno gris claro es lo
 * más oscuro del cuadro y basta para dar borde. Acá van sobre relieve
 * texturado, y eso cambia el cálculo. Medido:
 *
 *   contraste relleno-contorno    Liberty menor      0,20
 *                                 Liberty arteria    0,22
 *                                 Liberty autopista  0,11
 *                                 modo PCI           0,76 - 0,90
 *
 * O sea que el borde de Liberty es unas cuatro veces más flojo que el de la
 * rampa ASTM. Sobre el relieve oscuro (vegetación, suelo: luminancia ~0,15 a
 * ~0,45) la vía se lee igual, porque lo que la separa del fondo es su propio
 * brillo y no el contorno. Donde se pierde es sobre terreno CLARO -- roca
 * desnuda, nube, concreto urbano, la parte alta de la hipsometría --, en el
 * rango de luminancia 0,61 a 0,90: ahí relleno y contorno caen los dos dentro
 * del fondo.
 *
 * Se deja fiel a propósito: lo que se pidió es que la red se vea como
 * GeoLibre. Si el lavado sobre terreno claro resulta molesto, el cambio es
 * bajarle la luminancia a estos dos contornos conservando su tono cálido --
 * pero entonces esto ya no es la paleta de Liberty y el test que fija los seis
 * valores tiene que cambiar con ello, a propósito y no de pasada.
 */
export const LIBERTY: readonly TierLiberty[] = [
  { relleno: hex(0xffcc88), contorno: hex(0xe9ac77) },  // 0 autopista: road_motorway
  { relleno: hex(0xffeeaa), contorno: hex(0xe9ac77) },  // 1 arteria:   road_trunk_primary, road_secondary_tertiary, road_link
  { relleno: hex(0xffffff), contorno: hex(0xcfcdca) },  // 2 menor:     road_minor, road_service_track, road_path_pedestrian
] as const

// Los enlaces NO van todos juntos: Liberty tiene road_motorway_link (#fc8)
// aparte de road_link (#fea), así que un motorway_link es ámbar y un
// trunk_link es amarillo. Colapsarlos es el error fácil de esta tabla.
const TIER_DE: Record<string, number> = {
  motorway: 0, motorway_link: 0,
  trunk: 1, trunk_link: 1, primary: 1, primary_link: 1,
  secondary: 1, secondary_link: 1, tertiary: 1, tertiary_link: 1,
}

/** Todo lo que Liberty no nombra cae en road_minor: blanco con contorno gris.
 *  Mismo criterio que NIVEL_POR_DEFECTO en roadStyle.ts -- una clase nueva se
 *  dibuja con peso de calle, pero se dibuja. */
export const TIER_MENOR = 2

export const tierLiberty = (highway: string): number => TIER_DE[highway] ?? TIER_MENOR
