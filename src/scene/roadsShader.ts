import * as THREE from 'three'
import { PCI_RANGES, SIN_EVALUAR, SELECCION, CASING, CASING_SUAVE, FUENTES } from '../data/constants'
import { ERROR_PX } from './quadtree'
import {
  ASFALTO_GLSL, ASFALTO_UNIFORMS_GLSL, ASFALTO_CUERPO_GLSL, SOL_POR_DEFECTO,
  PINTURA_GASTE, type Asfalto,
} from './asfalto'
import { SECCION_ANCHO_GLSL, SECCION_GLSL, SECCION_CUERPO_GLSL } from './seccion'

// Las anclas del LineMaterial de three viven SOLO acá: las consumen este
// módulo, PickingPass.tsx (el pase de ids parchea el mismo material) y
// roadsShader.test.ts, que las comprueba contra el LineMaterial real
// instalado. Estaban duplicadas en PickingPass.tsx, con test en un solo lado:
// cuando three moviera el shader, la suite se ponía roja por acá, alguien
// actualizaba esta constante, todo volvía a verde -- y el picking seguía roto
// hasta el primer clic. Misma clase de desincronización silenciosa que este
// archivo ya evita para la paleta.
export const ANCLA_VERT = 'void main() {'

// El brief de esta tarea asumía 'vec4 diffuseColor = vec4( diffuse, opacity );'
// (la forma de versiones viejas de three). En three@0.185.1 ese main() abre
// con `float alpha = opacity;` y arma diffuseColor con esa variable local, no
// con el uniform directo -- confirmado leyendo
// node_modules/three/examples/jsm/lines/LineMaterial.js. El string viejo no
// aparece en esta versión; el ancla real es esta:
export const ANCLA_FRAG = 'vec4 diffuseColor = vec4( diffuse, alpha );'

/** Principio y fin del bloque del vertex shader de LineMaterial que desplaza
 *  el vértice en PÍXELES de pantalla (su modo worldUnits: false). Se
 *  sustituye entero por la extrusión en metros de abajo. El modo worldUnits
 *  de three no sirve para esto: orienta la cinta hacia la cámara y mide la
 *  distancia en 3D, como un tubo; una carretera es una banda plana sobre el
 *  terreno. */
export const ANCLA_EXTRUSION_INICIO = 'vec2 offset = vec2( dir.y, - dir.x );'
export const ANCLA_EXTRUSION_FIN = 'clip.xy += offset;'

// Cuánto sobresale el contorno oscuro, en píxeles de ancho total. El tope
// constante es lo que hace que a escala de calle el borde sea una orilla fina
// y no un marco; la parte proporcional evita que a lo lejos, con la vía en su
// piso de menos de 1 px, el contorno la envuelva y la convierta en una raya
// oscura sin color adentro. Medido en pantalla: a partir de ~5 px por lado la
// vía deja de parecer un brochazo; con 10 de tope, una troncal de 50 px no se
// queda sin color.
const CASING_MAX = 10
const CASING_REL = 0.6

// Alza mínima de la calzada sobre el relieve, en metros. A lo lejos manda la
// tolerancia del LOD en píxeles (ERROR_PX, quadtree.ts); de cerca, esto: es
// lo que el pipeline deja de hundimiento al partir los tramos contra el DEM
// (apoyar, scripts/lib/subdividir.mjs), y lo que un terraplén real levanta la
// vía sobre el terreno. A 30 m de vista son 8 px de paralaje. Calibrable,
// junto con el umbral del pipeline.
export const ALZA_MIN_M = 0.25

/**
 * Extrusión de cada tramo a su ancho REAL en metros, sobre el plano horizontal
 * del mundo, con el piso en píxeles del nivel calculado a la profundidad de
 * cada vértice. Es lo que hace que a 30 m de vista el tramo cercano salga más
 * ancho que el lejano, y que dos calzadas de una avenida queden separadas.
 *
 * Trabaja en espacio de cámara con `start` y `end`, que el código de three
 * que queda arriba ya recortó al near plane. `projectionMatrix[1][1]` es
 * 1 / tan(fov/2), así que `mppV` es metrosPorPixel() (roadStyle.ts) evaluado
 * donde está el vértice y no en el punto que mira la cámara.
 *
 * El cuadrilátero que sale mide `anchoM` de ancho y se alarga `anchoM / 2` en
 * cada extremo: en coordenadas `vUv` es exactamente la forma que el test de
 * tapa redonda del fragment shader de three espera, así que las tapas quedan
 * del ancho de la vía por construcción. Con la banda por nivel de antes, la
 * tapa tenía el radio de la banda y el cuerpo el de la calzada, y en cada
 * junta sobresalía un pico.
 *
 * La última línea es el mismo ajuste de profundidad del modo worldUnits de
 * three: todos los vértices del cuadrilátero toman la z del eje, para que los
 * tramos solapen limpio en las juntas y el borde exterior no se hunda en una
 * ladera.
 *
 * Deja en scope `mppV`, `anchoBase` (la calzada), `bordeM` (el hombrillo o el
 * brocal a cada lado, firmado y ya fundido -- seccion.ts) y `anchoM` (lo que se
 * extruye) para que `colofon` rellene los varyings que necesite. Requiere
 * declarados `attribute float aCalzada;`, `attribute float aBorde;`,
 * `attribute vec3 instanceNormalStart;`, `attribute vec3 instanceNormalEnd;` y
 * `uniform float uPisoPx;`.
 */
export function extrusionGlsl (casing: boolean, colofon = ''): string {
  return `
        vec4 eje = ( position.y < 0.5 ) ? start : end;
        vec3 largo = end.xyz - start.xyz;
        vec3 dirV = dot( largo, largo ) > 0.0 ? normalize( largo ) : vec3( 1.0, 0.0, 0.0 );
        vec3 arribaV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
        // Normal del terreno en este extremo (pipeline, scripts/lib/drape.mjs):
        // la calzada se extruye en el plano de la ladera y no en el horizontal,
        // así que ni la mitad de arriba se entierra ni la de abajo flota. Sin
        // dato (normal nula) se cae al arriba del mundo.
        vec3 nEje = ( position.y < 0.5 ) ? instanceNormalStart : instanceNormalEnd;
        vec3 terrV = dot( nEje, nEje ) > 0.25 ? normalize( ( viewMatrix * vec4( nEje, 0.0 ) ).xyz ) : arribaV;
        // cross( dirV, terrV ) es la DERECHA del sentido de marcha, y tiene
        // que serlo: el cuadrilátero de LineSegmentsGeometry pone position.x
        // = +1 a la derecha del trazo, y con eso sus triángulos salen en
        // sentido antihorario mirados desde arriba. Con cross( terrV, dirV )
        // -- la izquierda -- el cuadrilátero queda espejado, sus caras miran
        // al suelo y el descarte de caras traseras se traga la red entera sin
        // un solo error: medido, no supuesto.
        vec3 ladoV = normalize( cross( dirV, terrV ) );
        float mppV = max( -eje.z, 1e-3 ) * 2.0 / ( projectionMatrix[1][1] * resolution.y );
        float anchoBase = max( aCalzada, uPisoPx * mppV );${SECCION_ANCHO_GLSL}
        float anchoM = ${casing
          ? `anchoTot + min( ${CASING_MAX.toFixed(1)}, ${CASING_REL.toFixed(1)} * anchoTot / mppV ) * mppV;`
          : 'anchoTot;'}
        float hw = 0.5 * anchoM;
        // Alza: la tolerancia del LOD en metros a esta profundidad, nunca menos
        // de ALZA_MIN_M. El relieve dibujado se aparta menos que eso de la
        // superficie real a cualquier distancia (quadtree.ts), así que nunca
        // tapa la calzada; cubre de sobra la precisión del depth buffer
        // (d²·6e-9 m: a 108 km son 70 m contra 216 m de alza); y de cerca
        // cubre el hundimiento que el pipeline deja entre dos puntos apoyados.
        eje.xyz += terrV * max( ${ERROR_PX.toFixed(1)} * mppV, ${ALZA_MIN_M.toFixed(2)} ) + ladoV * ( hw * position.x );
        if ( position.y < 0.0 ) eje.xyz -= dirV * hw;
        else if ( position.y > 1.0 ) eje.xyz += dirV * hw;
        // Cada vértice con SU profundidad, sin el ajuste al eje que three hace
        // en su modo worldUnits ( clip.z = ndc.z * clip.w ). Ese ajuste es para
        // una cinta que mira a la cámara; en una calzada inclinada con la
        // ladera deja el borde cuesta arriba con una profundidad más honda que
        // el relieve que tiene debajo y el test lo esconde: medido en cenital,
        // media calzada desaparecía y las tapas asomaban como orejas. Los
        // tramos no compiten entre sí en profundidad porque no la escriben
        // (depthWrite: false, Roads.tsx).
        vec4 clip = projectionMatrix * eje;
        ${colofon}
  `
}

/** Sustituye el bloque de pantalla de three (entre las dos anclas, ambas
 *  incluidas) por `glsl`. Lo usan el pase visible y el de ids. */
export function parcharExtrusion (vertexShader: string, glsl: string): string {
  const a = vertexShader.indexOf(ANCLA_EXTRUSION_INICIO)
  const b = vertexShader.indexOf(ANCLA_EXTRUSION_FIN)
  if (a < 0 || b < a) {
    throw new Error('roadsShader: no se encontró el bloque de desplazamiento en pantalla del vertex shader de LineMaterial')
  }
  return vertexShader.slice(0, a) + glsl + vertexShader.slice(b + ANCLA_EXTRUSION_FIN.length)
}

const vec3Lit = ([r, g, b]: readonly [number, number, number]) => `vec3(${r}, ${g}, ${b})`

// La paleta ASTM D6433 tiene una sola fuente de verdad: PCI_RANGES en
// constants.ts. Este bloque genera el GLSL de pciColor() a partir de esa
// tabla en tiempo de módulo -- escribirla a mano una segunda vez dentro del
// shader es justo el tipo de duplicado que este proyecto ya vio
// desincronizarse en silencio dos veces.
export const PCI_COLOR_GLSL = `
  vec3 pciColor (float pci) {
    // 255 (vía encodeAttr) es el centinela de "sin evaluar" -- un PCI real
    // va de 0 a 100, así que 0 (pavimento colapsado) nunca cae acá.
    if (pci > 100.5) return ${vec3Lit(SIN_EVALUAR)};
    ${PCI_RANGES.map((r, i) => (
      i === PCI_RANGES.length - 1
        ? `return ${vec3Lit(r.color)}; // ${r.label} (${r.min}-${r.max})`
        : `if (pci >= ${r.min.toFixed(1)}) return ${vec3Lit(r.color)}; // ${r.label} (${r.min}-${r.max})`
    )).join('\n    ')}
  }
`

/** Reemplazo de ANCLA_VERT que declara segId y deja en `vAttr` el texel de
 * atributos de esa vía (AttrTexture, Task 14). Deja main() ABIERTO -- es un
 * reemplazo de `void main() {`, no un bloque suelto.
 *
 * Solo lo usa el pase visible. El de picking ya no lee esta textura: nada
 * esconde una vía del mapa, así que dibuja las 26.712 y no tiene nada que
 * consultar (ver el comentario de patchPickMaterial en PickingPass.tsx). */
export const ATTR_VERT_GLSL = `
      attribute float segId;
      attribute float aCalzada;
      attribute float aBorde;
      attribute float aCanales;
      attribute float instanceDistanceStart;
      attribute float instanceDistanceEnd;
      attribute vec3 instanceNormalStart;
      attribute vec3 instanceNormalEnd;
      uniform sampler2D uAttr;
      uniform float uAttrSize;
      uniform float uPisoPx;
      varying vec4 vAttr;
      varying float vCalzadaPx;
      varying float vAnchoPx;
      varying float vMpp;
      varying float vCanales;
      varying float vDist;
      // El hombrillo o el brocal a cada lado, en metros, firmado (positivo
      // hombrillo, negativo brocal) y con el fundido por distancia YA aplicado.
      // Con él el fragment sabe exactamente qué cuadrilátero le llegó, sin
      // recalcular el smoothstep del vertex y sin arriesgarse a que los dos no
      // coincidan (seccion.ts).
      varying float vBordeM;
      // El marco de la calzada en ejes del MUNDO, para iluminar el asfalto
      // (asfalto.ts). Se declaran acá porque el bloque de extrusión se
      // comparte con el pase de ids y allá no existen; los rellena el colofón
      // de patchLineMaterial, que sí es solo del pase visible.
      varying vec3 vDirW;
      varying vec3 vTerrW;
      varying vec3 vPosW;
      void main() {
        vAttr = texture2D(uAttr, (vec2(
          mod(segId, uAttrSize), floor(segId / uAttrSize)) + 0.5) / uAttrSize);
        vCanales = aCanales;
        // Distancia recorrida a lo largo de la vía, en metros, para la fase de
        // las rayas discontinuas y las flechas. Dentro de una vía los
        // segmentos van consecutivos, así que es continua a lo largo del trazo.
        vDist = (position.y < 0.5) ? instanceDistanceStart : instanceDistanceEnd;
`

/** Canal B, bit 0: el foco. 1 = la vía coincide con lo que se está mirando
 * (un resultado de búsqueda elegido, o todo si no hay ninguno); 0 = está
 * fuera del foco.
 *
 * Atenúa, NO descarta. La versión anterior de este bloque hacía `discard`
 * porque el panel de filtros de entonces ocultaba de verdad lo que no
 * pasaba el filtro, y el pase de picking tenía que descartar igual o la
 * selección devolvía vías que no estaban en pantalla. Ya no hay filtro que
 * oculte nada: lo que queda fuera del foco se sigue dibujando, más tenue, y
 * por eso se puede seguir seleccionando con honestidad. La regla que
 * sustituye a aquel descarte es más simple y vale para los dos pases: lo que
 * se dibuja, se puede tocar. */
export const ENFOQUE_GLSL = `
        float enfoque = mod(floor(vAttr.b * 255.0 + 0.5), 2.0);
`

// Cuánto baja la opacidad de lo que queda fuera del foco. Por debajo de ~0.4
// una vía sin evaluar (que ya arranca en 0.45 por procedencia) se pierde del
// todo y deja de ser honesto que se pueda seleccionar. Calibrable.
const FUERA_DE_FOCO = 0.45

// Demarcación real: 12 cm de ancho de pintura, raya de 4 m cada 10 en las
// discontinuas. Son las medidas de norma; lo que las hace visibles a
// cualquier escala es el piso en píxeles de MARCA_MIN_PX, porque 12 cm sobre
// el terreno son una fracción de píxel en casi todo el rango útil del mapa.
const MARCA_M = 0.12
const MARCA_MIN_PX = 1.4
const RAYA_M = 4.0
const CICLO_M = 10.0

// Entre qué anchos de calzada (en píxeles) aparecen las marcas. Por debajo de
// 14 px una calzada no tiene sitio físico para dos bordes, un eje y sus
// canales sin que se toquen entre ellos: pintarlos ahí no dibuja una vía,
// ensucia una línea. Por encima de 28 van completas. La transición es
// continua a propósito -- este mapa no tiene niveles de zoom discretos.
const DETALLE_DESDE = 14.0
const DETALLE_HASTA = 28.0

// Flecha de sentido, medidas de pavimento urbano: 5 m de largo, cabeza de
// 2 m por 1,20 de ancho, tallo de 30 cm. Una por canal, y cada 40 m -- unas
// dos o tres por cuadra, como en la calle. Solo en sentido único: en doble
// sentido el eje amarillo ya dice lo que hay que decir, y la calle real no
// las lleva. Calibrables.
export const FLECHA_M = 5
export const CABEZA_M = 2
export const CABEZA_ANCHO_M = 1.2
export const TALLO_M = 0.3
export const FLECHA_CICLO_M = 40
// A cuántos metros del arranque de cada vía cae la primera: un ramal de 50 m
// se lleva una flecha en vez de ninguna.
const FLECHA_DESDE_M = 10

// Literales GLSL: siempre con punto decimal, o `5` es un int y no compila
// contra un float.
const f2 = (n: number) => n.toFixed(2)

// Blanco de borde y amarillo de eje. El amarillo es el de la señalización
// venezolana (doble línea continua = prohibido invadir el contraflujo), y es
// lo que dice de un vistazo que esa calzada tiene ida y vuelta.
//
// La blanca tiene un problema que solo se ve en pantalla: la calzada de una
// vía SIN EVALUAR es casi blanca (0,96 en constants.ts, y son las 26.712 al
// abrir la aplicación), así que pintarle encima marcas blancas no dibuja
// nada. Por eso hay dos y se elige por contraste con el asfalto que hay
// debajo -- sobre calzada clara la demarcación va en gris, que es como se
// lee en un plano de vialidad, y sobre un pavimento colapsado (0,45 0,08
// 0,12) vuelve a ser blanca. El amarillo NO se elige: es semántico, dice
// "doble sentido", y tiene contraste suficiente contra toda la rampa ASTM.
const PINTURA_CLARA = 'vec3(0.97, 0.97, 0.95)'
const PINTURA_OSCURA = 'vec3(0.42, 0.44, 0.46)'
const PINTURA_AMARILLA = 'vec3(0.90, 0.68, 0.10)'

/**
 * Las marcas viales, pintadas sobre el color de PCI.
 *
 * Todo ocurre en la coordenada TRANSVERSAL de la calzada: `vUv.x` va de -1 a
 * +1 a lo ancho de la banda que dibuja el nivel, y la calzada real de esta vía
 * ocupa solo una fracción de esa banda (un nivel dibuja un único ancho porque
 * `linewidth` es un uniform, pero los canales varían vía por vía). Dividir por
 * esa fracción da `t`, que vuelve a ir de -1 a +1 pero sobre la calzada de
 * verdad, y es sobre `t` donde caen los bordes, el eje y los canales.
 *
 * El antialiasing no usa derivadas: se sabe exactamente cuánto mide un píxel
 * en unidades de `t` (la calzada mide `vCalzadaPx` píxeles y dos unidades de
 * `t`), así que cada marca se dibuja con un smoothstep de ancho conocido. Con
 * un `step` a secas las marcas salen con escalera y parpadean al mover la
 * cámara, que es justo lo que hace que un mapa se vea barato.
 */
export const MARCAS_GLSL = `
  // Una franja longitudinal centrada en 'c', de media anchura 'w', suavizada
  // sobre 'aa' (medio píxel a cada lado).
  float franja (float t, float c, float w, float aa) {
    return 1.0 - smoothstep(w - aa, w + aa, abs(t - c));
  }
`

/** El cuerpo que calcula y compone las marcas. Se inyecta dentro de main(),
 *  después de que el color base ya está resuelto. */
export const MARCAS_CUERPO_GLSL = `
    float canales = abs(vCanales);
    // Las tapas redondeadas que LineSegments2 pone en cada extremo de tramo
    // (|vUv.y| > 1) no son calzada: son el remate que tapa el hueco entre dos
    // tramos en una curva. Pintarles canales dibuja marcas atravesadas en cada
    // junta de la red.
    float cuerpo = 1.0 - step(1.0, abs(vUv.y));
    float detalle = smoothstep(${DETALLE_DESDE.toFixed(1)}, ${DETALLE_HASTA.toFixed(1)}, vCalzadaPx) * cuerpo;

    if (canales > 0.5 && detalle > 0.001) {
      float aa = 1.0 / max(vCalzadaPx, 1.0);              // medio píxel, en unidades de t
      float w = max(${MARCA_M} / max(vMpp, 1e-6), ${MARCA_MIN_PX}) / max(vCalzadaPx, 1.0);
      float unico = step(vCanales, -0.5);                  // 1 = sentido único

      // Pintura gastada. En una vía mala la demarcación está comida, y se come
      // por manchas: uniforme se leería como una capa más clara y no como
      // pintura vieja. 'desgaste' y 'ruido()' los deja el bloque de asfalto,
      // que corre justo antes (asfalto.ts). El piso de 0,2 es lo que queda:
      // una vía colapsada todavía enseña por dónde iban sus canales.
      float viva = clamp(1.0 - ${PINTURA_GASTE.toFixed(2)} * desgaste * (0.35 + 0.65 * ruido(uvM * 0.4)), 0.2, 1.0);

      // Rayas: 4 m de pintura por cada 10 m de vía.
      float fase = mod(vDist, ${CICLO_M.toFixed(1)});
      float e = max(vMpp, 1e-6);
      float rayada = smoothstep(0.0, e, fase) * (1.0 - smoothstep(${RAYA_M.toFixed(1)} - e, ${RAYA_M.toFixed(1)}, fase));

      // Líneas de borde, hacia adentro del filo de la calzada.
      float marca = franja(t, 1.0 - w * 1.6, w, aa) + franja(t, -1.0 + w * 1.6, w, aa);
      // Luminancia percibida del asfalto, para que la demarcación se vea tanto
      // sobre una vía sin evaluar (casi blanca) como sobre una colapsada.
      float lum = dot(base, vec3(0.299, 0.587, 0.114));
      vec3 pintura = mix(${PINTURA_CLARA}, ${PINTURA_OSCURA}, smoothstep(0.45, 0.62, lum));

      // Separación entre canales. El del medio de una calzada de doble sentido
      // no es una separación de canales: es el eje, y lleva otra pintura.
      for (int k = 1; k < 8; k++) {
        if (float(k) >= canales) break;
        float c = -1.0 + 2.0 * float(k) / canales;
        float central = 1.0 - step(0.001, abs(c));        // 1 si cae en el centro
        float esEje = central * (1.0 - unico);
        marca += franja(t, c, w, aa) * rayada * (1.0 - esEje);
      }

      // El eje: doble línea amarilla continua, separada un ancho de pintura.
      // En sentido único no se pinta -- no hay contraflujo que separar, y
      // pintarlo diría de la vía algo que no es cierto.
      float eje = (franja(t, w * 1.6, w, aa) + franja(t, -w * 1.6, w, aa)) * (1.0 - unico);
      float m = clamp(marca, 0.0, 1.0) * detalle * viva;
      float me = clamp(eje, 0.0, 1.0) * detalle * viva;
      base = mix(base, pintura, m * (1.0 - me));
      base = mix(base, ${PINTURA_AMARILLA}, me);

      // Flechas de sentido, hacia vDist creciente: el orden de nodos de OSM,
      // que el pipeline deja en el sentido de circulación (orientar,
      // scripts/lib/road-meta.mjs). Se dibujan en METROS sobre la calzada
      // real, con el mismo piso de píxeles que el resto de la pintura.
      if (unico > 0.5) {
        float calzadaM = vCalzadaPx * vMpp;
        float u = mod(vDist - ${f2(FLECHA_DESDE_M)}, ${f2(FLECHA_CICLO_M)});   // metros desde el arranque de la flecha
        float tallo = max(${f2(TALLO_M)}, ${f2(MARCA_MIN_PX)} * vMpp) * 0.5;
        float cuello = ${f2(FLECHA_M - CABEZA_M)};
        float flecha = 0.0;
        for (int k = 0; k < 8; k++) {
          if (float(k) >= canales) break;
          float ck = -1.0 + (2.0 * float(k) + 1.0) / canales;      // centro del canal k
          float dm = abs(t - ck) * calzadaM * 0.5;                  // metros al centro del canal
          float enTallo = smoothstep(-e, 0.0, u) * (1.0 - smoothstep(cuello - e, cuello, u))
                        * (1.0 - smoothstep(tallo - e, tallo + e, dm));
          float semi = ${f2(CABEZA_ANCHO_M / 2)} * clamp((${f2(FLECHA_M)} - u) / ${f2(CABEZA_M)}, 0.0, 1.0);
          float enCabeza = smoothstep(cuello - e, cuello, u) * (1.0 - smoothstep(${f2(FLECHA_M)} - e, ${f2(FLECHA_M)}, u))
                         * (1.0 - smoothstep(semi - e, semi + e, dm));
          flecha = max(flecha, max(enTallo, enCabeza));
        }
        base = mix(base, pintura, flecha * detalle * viva);
      }
    }
`

// FUENTES (constants.ts) también es fuente única: se resuelve el índice acá
// en vez de repetir 2.0/3.0 sueltos y sin nombre dentro del shader.
const F_ESTIMADO = FUENTES.indexOf('estimado').toFixed(1)
const F_MEDIDO = FUENTES.indexOf('medido').toFixed(1)

// Contorno de lo seleccionado: el mismo azul, hundido. Un contorno neutro
// alrededor de una vía azul le quita el borde justo a lo que más falta le
// hace que se distinga del resto.
const SELECCION_CASING: [number, number, number] =
  SELECCION.map(v => Number((v * 0.4).toFixed(4))) as [number, number, number]

/**
 * Inyecta en el shader de LineMaterial la lectura de la data texture de
 * atributos (Task 14) y el color por PCI/procedencia. Se ancla al inicio de
 * void main() (vertex) y a la línea donde LineMaterial arma diffuseColor
 * (fragment) -- ambos strings se verifican antes de reemplazar: si three
 * cambia ese shader en una versión futura, esto debe reventar ruidosamente
 * en vez de dejar un render mudo sin error.
 *
 * `casing` cambia una sola línea: el color de salida. Cada nivel de la
 * jerarquía se dibuja dos veces sobre la misma geometría (roadStyle.ts) -- un
 * trazo oscuro y más ancho debajo, el color encima -- y las dos pasadas tienen
 * que compartir foco, selección y opacidad por procedencia al pie de la letra.
 * Un segundo shader para el contorno sería el sitio perfecto para que esas
 * tres cosas se desincronizaran en silencio y las vías salieran con un halo
 * que no corresponde a lo que se está mirando.
 */
export function patchLineMaterial (
  material: THREE.Material, attrTexture: THREE.DataTexture, attrSize: number,
  casing = false, asfalto?: Asfalto,
) {
  // three cachea los programas compilados por una clave que NO mira lo que
  // hace onBeforeCompile: dos materiales con los mismos parámetros comparten
  // programa aunque inyecten GLSL distinto. Contorno y relleno se construyen
  // exactamente iguales (Roads.tsx) salvo por este parche, así que sin esto el
  // segundo hereda el shader del primero -- y como el contorno se crea antes,
  // las 26.712 vías salían pintadas de gris oscuro, sin color de PCI en
  // ninguna. Falla en silencio: compila, dibuja, y solo se ve mirando el mapa.
  material.customProgramCacheKey = () => (casing ? 'vias:contorno' : 'vias:relleno')

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAttr = { value: attrTexture }
    shader.uniforms.uAttrSize = { value: attrSize }
    // El piso en píxeles del nivel. Se deja a mano en userData porque
    // shader.uniforms solo existe dentro de esta llamada, y Roads.tsx lo
    // escribe por cuadro sin recompilar el programa. Lo que cambia con la
    // cámara (m/px, anchos) ya no viaja como uniform: lo calcula el vertex
    // shader por vértice (extrusionGlsl).
    shader.uniforms.uPisoPx = { value: 1 }

    // Los tres mapas del asfalto (asfalto.ts). Van con `value: null` si nadie
    // los pasó: WebGL muestrea negro sobre un sampler sin textura, no da
    // error, y por eso existe uAsfaltoOn -- vale 0 hasta que los tres JPG
    // están en la GPU y apaga el bloque entero mientras tanto. Los declara
    // también el contorno, aunque no los use: el GLSL sin uso lo descarta el
    // compilador, y así quien alimente estos uniforms no tiene que averiguar
    // cuál de los dos materiales es cuál.
    shader.uniforms.uAlbedo = { value: asfalto?.albedo ?? null }
    shader.uniforms.uNormalMap = { value: asfalto?.normal ?? null }
    shader.uniforms.uRough = { value: asfalto?.rough ?? null }
    shader.uniforms.uAsfaltoOn = asfalto?.listo ?? { value: 0 }
    // Dirección unitaria HACIA el sol, en ejes del mundo. El default sirve
    // sola: el agente de luz la reescribe por cuadro vía userData.uniforms.
    shader.uniforms.uSol = { value: new THREE.Vector3(...SOL_POR_DEFECTO) }

    material.userData.uniforms = shader.uniforms

    if (!shader.vertexShader.includes(ANCLA_VERT)) {
      throw new Error('roadsShader: no se encontró el ancla del vertex shader de LineMaterial')
    }
    shader.vertexShader = parcharExtrusion(
      shader.vertexShader.replace(ANCLA_VERT, ATTR_VERT_GLSL),
      extrusionGlsl(casing, `
        // Lo que el fragment necesita en píxeles, a la profundidad de ESTE
        // vértice. La calzada es siempre la del relleno, también cuando se
        // está dibujando el contorno: es la referencia de las marcas.
        vCalzadaPx = anchoBase / mppV;
        vAnchoPx = anchoM / mppV;
        vMpp = mppV;
        vBordeM = bordeM;
        // La distancia recorrida tiene que seguir CORRIENDO por las tapas.
        //
        // ATTR_VERT_GLSL la resuelve con la misma prueba que el eje
        // (position.y < 0.5 ? d0 : d1), y para el cuerpo del tramo está bien.
        // Pero el cuadrilátero de LineSegmentsGeometry tiene position.y en
        // {-1, 0, 1, 2}: las tapas son los tramos [-1,0] y [1,2], y sus DOS
        // vértices caen del mismo lado de esa prueba. O sea vDist constante en
        // toda la tapa -- y una tapa mide medio ancho de calzada, que a 30 m de
        // cámara son 3,4 m de superficie.
        //
        // Con vDist congelada, TODO lo que se calcula sobre la coordenada de
        // calzada (el asfalto, el Voronoi de las grietas, el fBm de los
        // parches) deja de depender de la coordenada a lo largo y se convierte
        // en una función de la transversal sola: en pantalla, vetas paralelas
        // a la vía con el borde redondo de la tapa. Se veía en las capturas
        // como bandas rayadas cada 130 m de avenida, y se persiguió primero
        // como un problema de filtrado de textura, que no era.
        //
        // La tapa se alarga hw metros sobre dirV (más abajo), así que la
        // distancia crece exactamente hw a lo largo de ella.
        vDist += hw * ( position.y < 0.0 ? position.y : ( position.y > 1.0 ? position.y - 1.0 : 0.0 ) );
        // De cámara a MUNDO. dirV, ladoV y terrV están en espacio de cámara;
        // en GLSL \`v * M\` es \`M^T * v\`, y para una cámara sin escala la
        // traspuesta de la rotación de viewMatrix ES su inversa. La posición
        // además hay que destrasladarla: view = R·mundo + t, luego
        // mundo = (view - t) · R. Sale una resta y tres productos punto por
        // vértice, contra una inverse(mat4) que costaría veinte veces más.
        vDirW = dirV * mat3( viewMatrix );
        vTerrW = terrV * mat3( viewMatrix );
        vPosW = ( eje.xyz - viewMatrix[3].xyz ) * mat3( viewMatrix );`),
    )

    // Mismo patrón que el vertex shader arriba: cada ancla se comprueba antes
    // de usarse, incluida esta reutilización de ANCLA_VERT sobre el fragment
    // shader (string idéntico, pero es un shader.fragmentShader distinto del
    // shader.vertexShader ya comprobado -- nada garantiza que ambos cambien
    // juntos en una versión futura de three).
    if (!shader.fragmentShader.includes(ANCLA_VERT)) {
      throw new Error('roadsShader: no se encontró el ancla de void main() en el fragment shader de LineMaterial')
    }
    if (!shader.fragmentShader.includes(ANCLA_FRAG)) {
      throw new Error('roadsShader: no se encontró el ancla del fragment shader de LineMaterial')
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(ANCLA_VERT, `
        varying vec4 vAttr;
        varying float vCalzadaPx;
        varying float vAnchoPx;
        varying float vMpp;
        varying float vCanales;
        varying float vDist;
        varying float vBordeM;
        varying vec3 vDirW;
        varying vec3 vTerrW;
        varying vec3 vPosW;
        ${PCI_COLOR_GLSL}
        ${MARCAS_GLSL}
        ${casing ? '' : ASFALTO_UNIFORMS_GLSL + ASFALTO_GLSL + SECCION_GLSL}
        void main() {
      `)
      .replace(ANCLA_FRAG, `
        ${ENFOQUE_GLSL}
        float pci = vAttr.r * 255.0;
        float fuente = floor(vAttr.g * 255.0 + 0.5);
        float selected = floor(mod(floor(vAttr.b * 255.0 + 0.5), 4.0) / 2.0);
        // La calzada va OPACA. La procedencia modulaba esta opacidad antes
        // (1.0/0.75/0.45) y obligaba a dibujar la red entera translúcida: una
        // vía semitransparente no se lee como vía sino como mancha, se le
        // borran los bordes contra el relieve, y las juntas entre tramos
        // -- donde los cuadros que LineSegments2 dibuja por segmento se
        // solapan -- acumulan alpha y salen más oscuras que el resto. La
        // confianza en el dato se dice ahora en lo definido que sea el
        // contorno (más abajo, y CASING_SUAVE en constants.ts).
        //
        // Lo que sí queda en la opacidad son las dos cosas que de verdad son
        // "esto importa menos ahora mismo": estar fuera del foco de una
        // búsqueda, y ser una calle de barrio vista desde 100 km (la opacidad
        // base del material, que pone Roads.tsx por nivel de jerarquía).
        //
        // Ojo: three@0.185.1 saca el alpha de salida de la variable local
        // alpha (ver gl_FragColor más abajo en este mismo shader), no de
        // diffuseColor.a -- hay que reasignarla a ella, no solo construir
        // diffuseColor con otro valor, o la modulación compila pero no se ve.
        //
        // Lo seleccionado sale del sistema de opacidades: va sólido pase lo
        // que pase, incluso fuera de foco. Es lo que estás a punto de editar.
        alpha *= mix(mix(${FUERA_DE_FOCO}, 1.0, enfoque), 1.0, selected);

        // Coordenada transversal de la CALZADA: -1 a +1 sobre el asfalto real,
        // sea cual sea el ancho que se extruyó. Ya no hay banda de nivel que
        // recortar (cada vía se dibuja de su ancho, extrusionGlsl), pero sí hay
        // sección: vUv.x va de -1 a +1 sobre calzada MÁS hombrillo o brocal,
        // así que hay que reescalarlo o el eje amarillo se pintaría en el
        // centro de "calzada + hombrillos" en vez de en el centro de la
        // calzada. El asfalto y las marcas están escritas sobre [-1, 1] y no se
        // tocan; |t| > 1 es la franja de seccion.ts.
        float t = vUv.x * (1.0 + 2.0 * abs(vBordeM) / max(vCalzadaPx * vMpp, 1e-6));
        // Antialiasing del filo, también en las tapas redondas: three descarta
        // fuera del círculo a secas, y a 400 px de ancho el escalón se nota en
        // cada final de vía.
        float aaBorde = 2.0 / max(vAnchoPx, 1.0);
        float r = abs(vUv.y) > 1.0 ? length(vec2(vUv.x, abs(vUv.y) - 1.0)) : abs(vUv.x);
        alpha *= 1.0 - smoothstep(1.0 - aaBorde, 1.0, r);

        // El blanco de antes venía de una interfaz oscura. Sobre relieve
        // claro, blanco es el color del fondo: la selección desaparecía.
        ${casing
          ? `float confianza = fuente >= ${F_MEDIDO} ? 1.0 : (fuente >= ${F_ESTIMADO} ? 0.6 : 0.25);
        vec3 base = mix(mix(${vec3Lit(CASING_SUAVE)}, ${vec3Lit(CASING)}, confianza), ${vec3Lit(SELECCION_CASING)}, selected);`
          : `vec3 base = mix(pciColor(pci), ${vec3Lit(SELECCION)}, selected);
        ${ASFALTO_CUERPO_GLSL}
        ${MARCAS_CUERPO_GLSL}
        ${SECCION_CUERPO_GLSL}`}
        vec4 diffuseColor = vec4( base, alpha );
      `)
  }
  material.needsUpdate = true
}
