// La sección transversal de la calzada: bombeo, hombrillo y brocal.
//
// Lo que resuelve: hasta acá la vía era una cinta plana que se acababa de golpe
// contra el relieve, con la misma normal del terreno en todo su ancho. Una
// carretera real tiene sección -- cae del eje a los bordes (bombeo), y a cada
// lado lleva grava (hombrillo) o concreto (brocal).
//
// Tres cosas que hay que entender antes de tocar nada:
//
// 1. El BOMBEO no es geometría. 7 cm de flecha en 7 m de calzada, a 30 m de
//    cámara, son 2,5 px: no se modela. Lo que se ve es la luz, y para eso basta
//    inclinar la normal del marco (`normalSeccion`). Ver el spec, §5, incluida
//    la parte honesta: en difuso el bombeo no se ve; lo saca el especular.
//
// 2. El HOMBRILLO y el BROCAL sí ensanchan el cuadrilátero, y eso pasa en el
//    bloque de extrusión COMPARTIDO con el pase de ids (roadsShader.ts): el
//    clic sobre el hombrillo tiene que seleccionar la vía. Por eso el ancho
//    viaja como atributo por segmento (`aBorde`) y no como uniform: el pase de
//    ids dibuja la red entera en un solo draw call.
//
// 3. Las coordenadas son METROS al filo de la calzada, no píxeles ni unidades
//    de `t`. Un brocal mide 20 cm en la calle y 20 cm acá, a cualquier
//    acercamiento; lo que cambia con la distancia es si cabe en un píxel, y lo
//    que no cabe se APAGA (mismo criterio que `nitidez` en asfalto.ts).

import type { Way } from '../data/types'
import { nivelDe } from './roadStyle'
import { marcasPermitidas, PEATONALES } from './calzada'
import { SELECCION } from '../data/constants'
import {
  ASFALTO_DESDE_PX, ASFALTO_HASTA_PX, AMBIENTE, SOL_DIF, AMB_SUELO, NIVEL_CERCA,
} from './asfalto'

export type Seccion = 'hombrillo' | 'brocal' | 'ninguna'

// Metros de franja a CADA lado.
//
// El hombrillo de proyecto de una troncal venezolana es más ancho (1,8 a 2,4 m),
// pero cada centímetro de franja son fragmentos de más en el pase de relleno,
// que ya cuesta lo que cuesta con el asfalto encima. 1,5 m ya lee como
// hombrillo y no dobla el área. 1,0 para el resto: una terciaria rural tiene
// borde, no berma de proyecto.
export const HOMBRILLO_M = 1.0
export const HOMBRILLO_TRONCAL_M = 1.5
// Cara superior de un brocal de concreto venezolano (15 a 20 cm) más el filo.
// A 30 m de cámara son 7 px: se lee. Calibrable.
export const BROCAL_M = 0.20
// Desde qué nivel de la jerarquía (roadStyle.ts) el hombrillo es de troncal:
// 4 = secundaria. De ahí para arriba son vías de proyecto con berma.
const NIVEL_CON_BERMA = 4

// El nomenclátor. En Venezuela el nombre de una vía dice si es calle o
// carretera con más fiabilidad que su clase de OSM: la Avenida Libertador de
// San Cristóbal está tageada `secondary` -- por clase sería carretera y
// llevaría hombrillo, cuando es la avenida más urbana del estado.
//
// Cobertura: 4.351 de 26.712 vías traen nombre, pero 427 de las 1.502 de
// jerarquía alta empiezan por "Avenida" y 483 por "Carretera". O sea, el nombre
// está justo donde la clase se equivoca.
const URBANO_RE = /^(avenida|av\b|av\.|calle|carrera|vereda|transversal|pasaje|prolongaci[oó]n|redoma|bulevar|boulevard)/i
const RURAL_RE = /^(carretera|v[ií]a\b|troncal|autopista|ramal|variante|distribuidor|viaducto|puente|peaje|acceso|camino)/i

// Sin nombre decide la clase. `unclassified` NO está acá a propósito: OSM la
// define como la vía menor que conecta poblados ENTRE sí; la calle menor de
// dentro de un poblado es `residential` por definición del propio tag.
const CLASES_URBANAS = new Set(['residential', 'living_street', 'service'])

/** ¿Es calle de poblado o carretera? El nombre manda sobre la clase. */
export function urbano (via: Way): boolean {
  const n = via.name?.trim() ?? ''
  if (URBANO_RE.test(n)) return true
  if (RURAL_RE.test(n)) return false
  return CLASES_URBANAS.has(via.highway)
}

/**
 * Qué franja lleva esta vía a cada lado.
 *
 * "Con pavimento" es `marcasPermitidas()` (calzada.ts), que ya resuelve
 * exactamente esta pregunta y ya está probada: excluye superficie sin
 * pavimentar explícita, `track` sin pavimento declarado, obras y circuitos. Un
 * `service` de tierra en un caserío no lleva brocal, lleva el mismo borde de
 * tierra que una carretera.
 *
 * ponytail: una `residential` de un caserío rural sin `surface` sale con
 * brocal y no lo tiene. Corregirlo pide densidad local de la red (cuántas
 * `residential` hay en 250 m), que es un recorrido espacial de 26.712 vías al
 * cargar; el error se ve solo con la cámara metida en un caserío.
 */
export function seccionDe (via: Way): Seccion {
  if (PEATONALES.has(via.highway)) return 'ninguna'
  return urbano(via) && marcasPermitidas(via) ? 'brocal' : 'hombrillo'
}

/** Metros de franja a CADA lado, con el SIGNO diciendo qué es: positivo
 *  hombrillo, negativo brocal, cero nada. Es el mismo idioma con el que
 *  `aCanales` carga el sentido de circulación (Roads.tsx), y ahorra un segundo
 *  atributo de 1,8 MB para decir un bit. Esto es lo que viaja como `aBorde`. */
export function bordeDe (via: Way): number {
  const s = seccionDe(via)
  if (s === 'ninguna') return 0
  if (s === 'brocal') return -BROCAL_M
  return nivelDe(via.highway) >= NIVEL_CON_BERMA ? HOMBRILLO_TRONCAL_M : HOMBRILLO_M
}

// -------------------------------------------------------------------- GLSL

// Pendiente transversal de la calzada, del eje al borde. 2 % es el bombeo de
// proyecto de un pavimento asfáltico (norma venezolana y prácticamente todas
// las demás): lo justo para que el agua escurra sin que el vehículo lo sienta.
export const BOMBEO = 0.02
// Sobre cuántos metros se redondea la corona. Un vértice vivo en el eje es una
// arista de un píxel que titila al orbitar; 0,6 m son ~22 px a 30 m de cámara,
// que es como se ve la corona de una calle de verdad.
const APICE_M = 0.6
// Pendiente del hombrillo: 6 %, el triple que la calzada. Es lo que hace que la
// franja de grava se lea como un plano DISTINTO y no como calzada de otro
// color. La cara superior del brocal va plana.
const HOMBRILLO_PENDIENTE = 0.06

// Los dos materiales. Números en el mismo espacio en que trabaja el asfalto
// (ver MEDIA_LIN y NIVEL_CERCA en asfalto.ts). Calibrables: son el color de la
// tierra del Táchira y el del concreto de un brocal recién vaciado y sucio.
const GRAVA = [0.50, 0.44, 0.35] as const
const CONCRETO = [0.70, 0.69, 0.65] as const
// Celda del moteado de la grava. 9 cm no es el canto rodado del granzón (que
// son 2 o 3), es el tamaño del GRUMO que se distingue a 30 m: con la celda en
// 5 cm caía en 1,1 px a esa distancia y en pantalla no se leía como grava sino
// como tramado de un bit. Por debajo de dos píxeles por celda se desvanece
// hacia su media, que es exactamente promediarla.
const GRANO_M = 0.09
// Cuánto oscurece la sombra al pie del brocal y sobre cuántos metros cae. 12 cm
// es media altura de brocal: es la sombra que proyecta contra la calzada con el
// sol a media altura. Es lo que dice "esto tiene 20 cm de alto" sin modelar la
// cara vertical.
//
// La FUERZA no es la de una oclusión física, y la razón se midió: la calzada
// de una vía SIN EVALUAR se pinta casi blanca (0,96 en constants.ts, y son
// 20.484 de las 26.712), o sea que sale por la parte plana de la curva de
// tono. Con 0,45 el escalón de luz lineal se comprimía a dos niveles de gris
// en pantalla -- perfil medido en la Libertador cenital: 168 contra 170 -- y
// la sombra sencillamente no estaba. Con 0,70 sí se ve, y sobre una vía con
// PCI de verdad (más oscura) tampoco exagera.
const AO_M = 0.12
const AO_FUERZA = 0.70
// El filo de arriba, del lado de afuera: la arista que agarra el cielo.
const ARISTA_M = 0.05

const f2 = (n: number) => n.toFixed(2)
const vec3Lit = ([r, g, b]: readonly [number, number, number] | readonly number[]) => `vec3(${r}, ${g}, ${b})`

/**
 * El término de ancho de la sección, DENTRO del bloque de extrusión compartido
 * (roadsShader.ts, `extrusionGlsl`). Lo ejecutan el pase visible, el de
 * contorno y el de ids: los tres tienen que ensanchar igual o el clic deja de
 * caer donde se ve la vía.
 *
 * Requiere `attribute float aBorde;` declarado y `anchoBase`/`mppV` en scope.
 * Deja `bordeM` (firmado, ya fundido) y `anchoTot`.
 *
 * El `smoothstep` es el fundido, con el MISMO umbral de píxeles que el asfalto:
 * cuando vale 0, `anchoTot == anchoBase` y la geometría es exactamente la de
 * antes de que esto existiera -- a vista de estado no se ensancha nada. Y como
 * la franja nace de ancho cero y crece, no hay popping que suavizar aparte.
 */
export const SECCION_ANCHO_GLSL = `
        // Hombrillo (aBorde > 0) o brocal (aBorde < 0) a cada lado, en metros
        // (seccion.ts). El signo dice cuál de los dos; el fragment lo lee de
        // vBordeM. Se funde con el ancho de la calzada en píxeles: una vía que
        // no llega a 12 px de calzada no tiene sitio para enseñar 20 cm de
        // brocal, y dibujarlo solo la ensancharía.
        float bordeM = aBorde * smoothstep( ${ASFALTO_DESDE_PX.toFixed(1)}, ${ASFALTO_HASTA_PX.toFixed(1)}, anchoBase / mppV );
        float anchoTot = anchoBase + 2.0 * abs( bordeM );`

/**
 * La normal de la SECCIÓN: la calzada no es un plano, es una corona.
 *
 * `s` es la pendiente transversal firmada (dz/dv, con v los metros al eje hacia
 * la derecha). La normal de una superficie con esa pendiente es `Ng + s·D`,
 * porque `(Ng + s·D) · (D − s·Ng) = s − s = 0` y `D − s·Ng` es su tangente
 * transversal. No hay aproximación: es la normal exacta.
 *
 * Consecuencia útil: `cross(T, Ng + s·D) = D − s·Ng`, o sea que el marco
 * T/B/Ng del asfalto sigue siendo ortonormal solo. Por eso el cambio en
 * asfalto.ts es UNA línea y no toca la construcción de B ni la de N.
 */
export const SECCION_GLSL = `
  vec3 normalSeccion (vec3 terrW, vec3 dirW, float t, float calzadaM, float bordeM) {
    vec3 Ng = normalize(terrW);
    // La DERECHA del sentido de marcha: el mismo lado hacia el que el vertex
    // shader extruye position.x = +1 (roadsShader.ts, extrusionGlsl).
    vec3 der = normalize(cross(normalize(dirW), Ng));
    float v = t * calzadaM * 0.5;                     // metros al eje, firmados
    // Dentro de la calzada: el bombeo, con la corona redondeada sobre APICE_M.
    float s = ${f2(BOMBEO)} * clamp(v / ${f2(APICE_M)}, -1.0, 1.0);
    // Fuera: el hombrillo cae el triple; la cara de arriba del brocal va plana.
    float fuera = step(1.0, abs(t));
    s = mix(s, sign(v) * ${f2(HOMBRILLO_PENDIENTE)} * step(0.0, bordeM), fuera);
    return normalize(Ng + s * der);
  }
`

/**
 * El cuerpo: pinta la franja de afuera. Se inyecta en main() del pase de
 * relleno DESPUÉS de las marcas viales -- no hay pintura sobre el hombrillo, y
 * la sombra al pie del brocal cae también sobre la línea de borde, como en la
 * calle.
 *
 * Necesita en scope: `t` (ya remapeado, roadsShader.ts), `vBordeM`, `vCalzadaPx`,
 * `vMpp`, `uvM`, `base`, `selected`, `uSol`, y `fbm`/`hash1` del preámbulo del
 * asfalto.
 */
export const SECCION_CUERPO_GLSL = `
    // La franja de afuera. |t| <= 1 es calzada; de ahí para afuera es esto.
    // vBordeM llega del vertex con el ancho YA fundido y con su signo, así que
    // acá no hace falta recalcular el umbral ni arriesgarse a que vertex y
    // fragment no coincidan: si vale 0 (una acera, o la vía vista de lejos) el
    // cuadrilátero no se ensanchó y no hay nada que pintar.
    if (abs(vBordeM) > 0.0) {
      float bordeAbs = abs(vBordeM);
      float semi = max(vCalzadaPx * vMpp, 1e-3) * 0.5;   // media calzada, en metros
      float dm = (abs(t) - 1.0) * semi;                  // metros al filo de la calzada
      float e = max(vMpp, 1e-6);                         // un píxel, en metros
      float fuera = smoothstep(0.0, e, dm);              // el filo, con un píxel de suavizado
      // Una franja de menos de píxel y medio no se dibuja: se apaga. Dibujarla
      // sería una raya de subpíxel titilando en el borde de cada vía, que es
      // justo lo que hace que un mapa se vea barato (mismo criterio que
      // 'nitidez' en asfalto.ts).
      float apaga = smoothstep(0.0, 1.5, bordeAbs / e);

      vec3 tinte;
      float val;
      float ao = 1.0;
      if (vBordeM > 0.0) {
        // HOMBRILLO: granzón y tierra. Procedural, sin texturas nuevas: es una
        // franja de un metro, y tres samplers más por fragmento para pintar
        // tierra no se pagan.
        tinte = ${vec3Lit(GRAVA)};
        val = 0.80 + 0.40 * fbm(uvM / 0.70);
        // El moteado del canto rodado, y su desvanecimiento por Nyquist: por
        // debajo de dos píxeles por celda se va hacia su media.
        float nitG = clamp(${f2(GRANO_M)} / (2.0 * e), 0.0, 1.0);
        val *= 1.0 + (hash1(floor(uvM / ${f2(GRANO_M)})) - 0.5) * 0.5 * nitG;
        // El filo comido de la calzada: los primeros 15 cm van más oscuros,
        // que es donde se acumula la tierra que arrastra el tráfico.
        val *= mix(0.72, 1.0, smoothstep(0.0, max(0.15, e), dm));
      } else {
        // BROCAL: concreto claro, con un grano fino de encofrado.
        tinte = ${vec3Lit(CONCRETO)};
        val = 0.92 + 0.16 * fbm(uvM * 3.0);
        // El filo de arriba, del lado de afuera: la arista que agarra el cielo.
        float filo = smoothstep(bordeAbs - max(${f2(ARISTA_M)}, e), bordeAbs, dm);
        val *= mix(1.0, 1.35, filo);
        // La cara VERTICAL no se modela (serían vértices nuevos en 450.261
        // tramos). Se sugiere con su sombra: una caída exponencial hacia
        // adentro de la calzada, en metros. Es lo que dice "esto tiene 20 cm
        // de alto".
        ao = mix(1.0, ${f2(1 - AO_FUERZA)}, exp(min(dm, 0.0) / max(${f2(AO_M)}, e)) * (1.0 - fuera) * apaga);
      }
      // Lo seleccionado tiñe también la franja: es la misma vía, y una calzada
      // azul con su brocal gris se lee como dos objetos.
      tinte = mix(tinte, ${vec3Lit(SELECCION)}, selected);

      // La misma luz que el asfalto (AMBIENTE, SOL_DIF, AMB_SUELO, NIVEL_CERCA
      // salen de asfalto.ts) pero SIN especular: ni la grava ni el concreto
      // seco tienen lustre. Si los dos no promediaran el mismo brillo, la
      // franja daría un salto de exposición contra la calzada.
      vec3 Nf = normalSeccion(vTerrW, vDirW, t, vCalzadaPx * vMpp, vBordeM);
      float cielo = 0.5 + 0.5 * Nf.y;
      float luzF = (${f2(AMBIENTE)} * mix(${f2(AMB_SUELO)}, 1.0, cielo)
                  + ${f2(SOL_DIF)} * max(dot(Nf, uSol), 0.0)) * ${f2(NIVEL_CERCA)};
      vec3 franja = tinte * val * luzF;
      base = mix(base * ao, franja, fuera * apaga);
    }
`
