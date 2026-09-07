// El asfalto de la calzada: textura PBR real de cerca, y el PCI mandando el
// desgaste. Vive aparte de roadsShader.ts porque son ~200 líneas de GLSL con
// su propia física (muestreo en metros, anti-repetición, Voronoi, Blinn-Phong)
// y roadsShader.ts ya es el sitio donde se cruzan las anclas de three, la
// paleta ASTM y las marcas viales; meterle esto adentro lo volvía ilegible.
//
// Lo que hay que entender antes de tocar nada:
//
// 1. Este bloque NO sustituye al color de PCI: lo MODULA. `base` ya trae
//    pciColor() (o el azul de selección) cuando el cuerpo corre, y lo que se
//    hace con él es multiplicarlo por el grano del asfalto. Multiplicar
//    conserva el matiz exacto de la rampa ASTM -- es la única operación que lo
//    hace -- y por eso a 300 m una vía "Deficiente" naranja sigue leyéndose
//    naranja al lado de una "Bueno" verde. El dato es el color; el asfalto es
//    la luz que le cae encima.
//
// 2. Todo va dentro de un `if` sobre el ancho de la calzada en píxeles. A
//    vista de estado (26.712 vías, calzada de 0,2 px) no se ejecuta ni una
//    muestra de textura: el mapa lejano es exactamente el de antes.
//
// 3. Las coordenadas son METROS de calzada, no UV de geometría: `u` son los
//    metros recorridos a lo largo de la vía (vDist) y `v` los metros al eje
//    (t * calzadaM / 2). Así el tamaño del grano es el mismo en una troncal de
//    24 m y en una calle de 5, y no se estira en las curvas.

import * as THREE from 'three'
import { bacheCuerpoGlsl } from './mojado'

/** Los tres mapas, en `public/texturas/asfalto/`. Fuente y licencia en el
 *  LICENSE.md de esa carpeta (ambientCG Asphalt006, CC0). */
export const TEXTURAS = {
  albedo: 'asfalto-albedo.jpg',
  normal: 'asfalto-normal.jpg',
  rough: 'asfalto-rough.jpg',
} as const

export const TEXTURAS_BASE = 'texturas/asfalto/'

/** Lo que Roads.tsx crea una vez y patchLineMaterial enchufa como uniforms.
 *  `listo` es un objeto de uniform compartido por los dos materiales: vale 0
 *  hasta que los tres JPG están en la GPU, y apaga el bloque entero mientras
 *  tanto. Sin él, los primeros cuadros muestrean una textura sin subir --
 *  WebGL devuelve negro, no un error -- y la calzada parpadea en negro. */
export interface Asfalto {
  albedo: THREE.Texture
  normal: THREE.Texture
  rough: THREE.Texture
  listo: { value: number }
}

// Desde y hasta qué ancho de calzada (píxeles) se funde el asfalto con el
// color plano de PCI. Por debajo de 12 px una calzada no tiene sitio para
// enseñar grano: lo que se ve es ruido de un píxel, que titila al orbitar y
// ensucia justo el dato. A 26 px está entero. Medido en la Libertador
// (6,8 m de calzada): 12 px son ~500 m de cámara, 26 px ~230 m.
export const ASFALTO_DESDE_PX = 12
export const ASFALTO_HASTA_PX = 26
// Por debajo de esta mezcla el bloque entero se salta: lo que aportaría no se
// ve. Ver el comentario en el cuerpo, incluida la medida que NO mejoró.
const CORTE_TEMPRANO = 0.08

// Las dos escalas de muestreo, en metros de calzada.
//
// La MACRO da el manchado grande del pavimento (zonas más claras y más
// oscuras, juntas de pavimentación) y es la que sobrevive a media distancia.
// La MICRO da el grano de la superficie y es la que se ve de cerca.
//
// Estas cifras NO son las del brief (30 y 2 m) y la diferencia se midió en
// pantalla. Un tile de 2 m sobre una textura de 1024 px son 2 mm por texel; a
// 30 m de cámara un píxel cubre 1,4 cm, o sea TRECE texels por píxel. El
// mipmap promedia esos trece y lo que sale es gris liso: la calzada se veía de
// yeso, sin un solo grano, y además rayada -- con el filtrado anisotrópico
// topado a 16, la relación de derivadas de una calzada que se va al horizonte
// se pasa de ese tope y el eje corto queda submuestreado, que en pantalla son
// vetas longitudinales dentro de cada triángulo. Las dos cosas son el mismo
// problema: pedirle a la textura una frecuencia que la pantalla no puede
// dibujar.
//
// Con 12 m el texel mide 1,2 cm y a 30 m de cámara cae en ~1 texel por píxel:
// el grano SE VE. Cuesta que el árido de la foto (que retrata ~1 m² de
// asfalto) sale ampliado seis veces, así que ya no es árido de 5 mm sino
// manchado de 5 cm -- que es, de todas formas, lo que el ojo distingue de una
// calzada a 30 m de distancia. La macro a 40 m hace el mismo papel a 125 m.
export const MACRO_M = 40
export const MICRO_M = 12
const MACRO_SESGO = 1.2

// Lado de la textura, en texels. Con él y vMpp el shader sabe cuántos texels
// caen en un píxel y puede desvanecer el detalle que no cabe, en vez de
// dejarlo aliasear. Es prefiltrado honesto: la media de la micro es 1.0, así
// que desvanecerla hacia 1.0 es exactamente promediarla.
const TEXTURA_PX = 1024
// A partir de cuántos texels por píxel se considera perdido el detalle.
const NYQUIST = 2.5
// Resolución EFECTIVA de la macro: cada unidad de sesgo de mipmap le quita la
// mitad de los texels por lado. La macro se desvanece por su cuenta con esta.
const MACRO_PX = Math.round(TEXTURA_PX / 2 ** MACRO_SESGO)

// Cuánto se realza el contraste de cada escala. La foto de asfalto es de
// contraste bajísimo (±12% en luz lineal) y decodificada desde sRGB queda casi
// plana: sin realce el grano existe pero no se ve. Calibrables -- son el pomo
// de "cuánta textura" sin tocar nada más.
const GRANO_FUERZA = 2.2
const MANCHA_FUERZA = 1.5

// Cuánto más oscura va la calzada de cerca que el color plano de lejos.
//
// El color plano ES la rampa ASTM, y la rampa está pensada para leerse sobre
// un relieve claro: "sin evaluar" es 0,96, casi blanco, y son las 26.712 vías
// al abrir la aplicación. Pintar eso a brillo completo con textura encima no
// da una carretera, da una losa de concreto. Un pavimento real refleja del
// orden de la mitad. 0,7 es el punto en el que la vía se lee como asfalto sin
// que el color del dato se apague; la transición es la misma smoothstep del
// resto, así que no hay escalón. Calibrable.
export const NIVEL_CERCA = 0.7

// Cuánto manda el color del dato sobre el gris real del asfalto. 1.0 = la
// calzada es puro color de PCI modulado por el grano; 0.0 = asfalto gris y el
// PCI no se ve. Calibrable: es el pomo que decide si esto es un mapa de datos
// con textura o una foto donde el dato se perdió.
export const TINTE_PCI = 0.85

// PCI con el que se dibuja una vía SIN EVALUAR (centinela 255). No es 100:
// una vía sin inspeccionar no es una vía nueva. 70 = "Bueno" bajo, desgaste
// moderado, alguna grieta y ninguna bache. Es la misma lectura honesta que
// hace el color sin evaluar (gris casi blanco): no sabemos, no presumimos.
export const PCI_SIN_EVALUAR = 70

// Luminancia lineal media de asfalto-albedo.jpg. Medida con ffmpeg
// (escala a 1x1 → sRGB 126,133,157 → luminancia 0,524 sRGB → 0,24 lineal).
// El shader la usa para NORMALIZAR el grano a ~1.0 antes de multiplicar el
// color de PCI: sin esto la calzada se oscurecería al pasar de lejos a cerca,
// porque el albedo real del asfalto es mucho más oscuro que la rampa ASTM.
// Recalibrar si se cambia la textura.
const MEDIA_LIN = 0.24

/** Dirección unitaria HACIA el sol, en ejes del mundo (X este, Y arriba,
 *  Z -norte). Es solo el valor por defecto: el agente de luz lo alimenta por
 *  cuadro desde Roads.tsx vía `userData.uniforms.uSol`. Tiene que ser unitario
 *  y venir de arriba, porque el asfalto se ilumina con él aunque nadie lo
 *  toque. */
export const SOL_POR_DEFECTO: readonly [number, number, number] = (() => {
  const v = new THREE.Vector3(0.4, 0.8, 0.3).normalize()
  return [v.x, v.y, v.z] as const
})()

// Reparto de la luz. El asfalto de cerca tiene que promediar el MISMO brillo
// que el color plano de lejos, o la calzada da un salto de exposición al
// acercarse. Con el sol por defecto sobre una calzada horizontal N·L = 0,848,
// así que AMBIENTE + 0,848 · SOL = 0,42 + 0,58 = 1,0. Si se cambia uno hay que
// cambiar el otro.
// Exportadas porque la franja de hombrillo o brocal (seccion.ts) se ilumina
// con el mismo reparto: si los dos no promediaran el mismo brillo, la franja
// daría un salto de exposición contra la calzada.
export const AMBIENTE = 0.42
export const SOL_DIF = 0.684
// Cuánto se oscurece el ambiente en una cara que mira al suelo en vez de al
// cielo. Nunca 0: una ladera en sombra tiene que enseñar su PCI igual.
export const AMB_SUELO = 0.55
const ESPECULAR = 0.35

// Deterioro. Todas las medidas en METROS de calzada.
//
// Huellas de rodadura: la trocha de un vehículo son ~1,8 m entre ejes de
// neumático, o sea 0,9 m a cada lado del centro del canal, y la huella mide
// unos 0,38 m de sigma. Se dibuja como una gaussiana sobre la distancia al
// centro del canal, que por ser |distancia| pinta las DOS bandas de un canal
// con una sola evaluación.
const HUELLA_SEMI_M = 0.90
const HUELLA_SIGMA_M = 0.38
const HUELLA_OSCURO = 0.72
// Los neumáticos pulen: la huella es más lisa que el resto, con PCI o sin él.
const HUELLA_PULIDO = 0.55

// Celda del Voronoi de las grietas. 1,6 m es el tamaño de la piel de cocodrilo
// de un pavimento fatigado; también es el tamaño de la celda de la que sale un
// bache, que es lo mismo mirado de otra manera (un bache empieza donde la piel
// de cocodrilo se desprende).
// Exportada porque el relieve del bache (mojado.ts) necesita pasar de celdas a
// metros y no puede importarla -- sería un ciclo -- ni copiarla.
export const GRIETA_M = 1.1
// Ancho máximo de grieta, en fracción de celda, cuando el desgaste es total.
// Va al CUADRADO del desgaste a propósito: una vía "Bueno" (PCI 80, desgaste
// 0,2) tiene 0,04 de esto, casi nada; una "Fallado" (PCI 10) tiene 0,81.
// La curva del deterioro de un pavimento real es así, no lineal.
const GRIETA_MAX = 0.13
const GRIETA_OSCURO = 0.38

// Parches de bacheo: fBm a 9 m, con el umbral bajando con el desgaste. Un
// parche es más oscuro (asfalto nuevo sin oxidar) y menos rugoso que el
// pavimento viejo que lo rodea.
const PARCHE_M = 9
const PARCHE_OSCURO = 0.62
const PARCHE_RUG = 0.45

// Qué fracción de las celdas del Voronoi son un bache, con desgaste total.
// El relieve (cuenco, paredes, labio, sombra propia) lo pone mojado.ts sobre
// esta misma celda: acá quedan la tasa y lo oscuro que va el interior.
export const BACHE_TASA = 0.30
const BACHE_OSCURO = 0.30

/** El punto donde se inyecta el mojado (mojado.ts). Va después de que `asf`,
 *  `rug` y `N` están calculados y antes de que se iluminen: el mojado cambia
 *  los tres. Lo sustituye patchLineMaterial (roadsShader.ts), y solo en el pase
 *  de relleno. */
export const ANCLA_MOJADO = '// ANCLA_MOJADO'

// Cuánto se come el desgaste la pintura de las marcas viales. 0,75 deja
// visible una cuarta parte de la demarcación en una vía colapsada: menos que
// eso y las marcas desaparecen justo donde el mapa quiere enseñar que la vía
// está mala, que es cuando más se la mira.
export const PINTURA_GASTE = 0.75

const f1 = (n: number) => n.toFixed(1)
const f2 = (n: number) => n.toFixed(2)

/**
 * Las funciones. Se inyectan en el preámbulo del fragment shader del pase de
 * relleno (nunca en el contorno ni en el de ids: allá no hay calzada que
 * texturizar y serían tres samplers y un Voronoi de balde).
 *
 * El hash NO es el clásico `fract(sin(dot(p, k)) * 43758.5)`. Con vDist
 * llegando a los 10 km y la celda micro en 1,6 m, el argumento del seno pasa
 * de 10^6 y un float32 se queda sin dígitos para su parte fraccionaria: el
 * ruido degenera en bandas. El de Hoskins (2014) trabaja con fract() sobre
 * multiplicaciones pequeñas y no tiene ese acantilado.
 */
export const ASFALTO_GLSL = `
  const vec3 LUMA = vec3(0.299, 0.587, 0.114);
  const float MEDIA_LIN = ${f2(MEDIA_LIN)};

  float hash1 (vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  vec2 hash2 (vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yzx + 33.33);
    return fract((q.xx + q.yz) * q.zy);
  }

  // Ruido de valor con interpolación suavizada. Es el ladrillo del fBm de los
  // parches y del manchado con que se come la pintura.
  float ruido (vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash1(i), hash1(i + vec2(1.0, 0.0)), f.x),
               mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // Tres octavas: más no se distinguen a 12 px de calzada y cada una son
  // cuatro hashes. Los desplazamientos rompen la correlación entre octavas.
  float fbm (vec2 p) {
    return 0.60 * ruido(p) + 0.30 * ruido(p * 2.17 + 11.3) + 0.10 * ruido(p * 4.41 + 3.7);
  }

  // Voronoi de una pasada sobre 3x3. Devuelve:
  //   .x  distancia al BORDE de la celda, aproximada por F2 - F1
  //   .y  distancia al punto de la celda (F1)
  //   .z  hash de la celda, en [0,1)
  //
  // y por el parámetro de salida, el vector que va del CENTRO de la celda al
  // punto muestreado, en unidades de celda. Su longitud es .y; hace falta su
  // dirección, y solo la necesita el relieve del bache (mojado.ts), que sin
  // saber en qué parte del cuenco cae este fragmento no puede trazar nada.
  // Sale gratis: es una asignación dentro de una rama que ya existía.
  //
  // F2-F1 no es la distancia exacta al borde (la exacta necesita una segunda
  // pasada proyectando sobre las mediatrices, Quílez 2012), pero para una
  // grieta la diferencia es un ensanchamiento leve en los vértices triples,
  // que es justo donde una grieta real se ensancha. La mitad del costo.
  vec3 voronoi (vec2 p, out vec2 desdeF1) {
    vec2 n = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    vec2 celda = n;
    desdeF1 = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 r = f - g - hash2(n + g);
        float d = length(r);
        if (d < d1) { d2 = d1; d1 = d; celda = n + g; desdeF1 = r; }
        else if (d < d2) { d2 = d; }
      }
    }
    return vec3(d2 - d1, d1, hash1(celda + 0.5));
  }

  // Rejilla triangular de Heitz y Neyret 2018, "High-Performance By-Example
  // Noise using a Histogram-Preserving Blending Operator". 3.464 = 2*raíz(3)
  // es la densidad con que la rejilla cuadrada sesgada da triángulos
  // equiláteros; la matriz es la que hace ese sesgo. Devuelve los tres
  // vértices del triángulo que contiene a uv y sus coordenadas baricéntricas.
  void rejillaTriangular (vec2 uv, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
    uv *= 3.464;
    vec2 sesgada = mat2(1.0, 0.0, -0.57735027, 1.15470054) * uv;
    vec2 base = floor(sesgada);
    vec3 tmp = vec3(fract(sesgada), 0.0);
    tmp.z = 1.0 - tmp.x - tmp.y;
    if (tmp.z > 0.0) {
      w = vec3(tmp.z, tmp.y, tmp.x);
      v1 = base; v2 = base + vec2(0.0, 1.0); v3 = base + vec2(1.0, 0.0);
    } else {
      w = vec3(-tmp.z, 1.0 - tmp.y, 1.0 - tmp.x);
      v1 = base + vec2(1.0, 1.0); v2 = base + vec2(1.0, 0.0); v3 = base + vec2(0.0, 1.0);
    }
  }

  // Muestreo estocástico: tres muestras de la MISMA textura, desplazadas por
  // el hash de cada vértice de la rejilla, mezcladas de forma que la varianza
  // se conserve. Con 26.712 vías y un tile de 24 m, la repetición del tile se
  // ve a simple vista al orbitar; esto la borra.
  //
  // DIFERENCIA con el paper: la versión completa gaussianiza la textura fuera
  // de línea y deshace la gaussianización con una LUT, y así preserva el
  // HISTOGRAMA entero. Acá se preserva solo la VARIANZA (restar la media,
  // ponderar, dividir por la norma de los pesos). Para asfalto -- una textura
  // de histograma casi gaussiano y contraste bajo -- la diferencia no se ve, y
  // ahorra una textura extra de LUT y su precisión. Si algún día entra una
  // textura de adoquín o de grava gruesa, la diferencia SÍ se vería (los picos
  // del histograma se aplanan) y habría que traer la LUT.
  //
  // El sesgo de mipmap se pasa por parámetro y no se calcula con derivadas:
  // en los bordes de triángulo las derivadas dan un salto y con textureGrad
  // (que WebGL1 no tiene) habría que corregirlo. Con la macro tan desenfocada
  // el salto queda por debajo de un texel.
  vec3 estocastica (sampler2D tex, vec2 uv, float sesgo) {
    vec3 w; vec2 v1, v2, v3;
    rejillaTriangular(uv, w, v1, v2, v3);
    vec3 c1 = texture2D(tex, uv + hash2(v1), sesgo).rgb;
    vec3 c2 = texture2D(tex, uv + hash2(v2), sesgo).rgb;
    vec3 c3 = texture2D(tex, uv + hash2(v3), sesgo).rgb;
    vec3 media = vec3(MEDIA_LIN);
    vec3 g = w.x * (c1 - media) + w.y * (c2 - media) + w.z * (c3 - media);
    return media + g * inversesqrt(dot(w, w));
  }
`

/** Las declaraciones que el fragment del pase de relleno necesita además de
 *  las funciones. Separadas para que el contorno pueda quedarse sin ninguna. */
export const ASFALTO_UNIFORMS_GLSL = `
  uniform sampler2D uAlbedo;
  uniform sampler2D uNormalMap;
  uniform sampler2D uRough;
  uniform float uAsfaltoOn;
  uniform vec3 uSol;
`

/**
 * El cuerpo, inyectado en main() del pase de relleno justo después de que
 * `base` tiene su color de PCI (o el azul de selección) y ANTES de las marcas
 * viales: la pintura va encima del asfalto, como en la calle.
 *
 * Deja en scope `uvM` y `desgaste`, que las marcas usan para gastarse.
 */
export const ASFALTO_CUERPO_GLSL = `
    // Coordenadas de calzada, en metros: a lo largo los metros recorridos, a
    // lo ancho los metros al eje. La calzada en metros llega como varying
    // propio (roadsShader.ts): vCalzadaPx * vMpp daría lo mismo en los
    // vértices, pero no entre ellos -- uno es ∝ 1/z y el otro ∝ z, y el
    // producto de dos varyings no se interpola con corrección de perspectiva.
    float calzadaM = vCalzadaM;
    vec2 uvM = vec2(vDist, t * calzadaM * 0.5);

    // 255 es el centinela de "sin evaluar" (encodeAttr): se dibuja con
    // ${PCI_SIN_EVALUAR}, desgaste moderado. No es 100 -- una vía que nadie
    // inspeccionó no es una vía nueva -- ni 0, que sería inventar una ruina.
    float pciEf = pci > 100.5 ? ${f1(PCI_SIN_EVALUAR)} : pci;
    float desgaste = clamp(1.0 - pciEf * 0.01, 0.0, 1.0);

    // El reflejo de la lámina de agua (mojado.ts). Se declara ACÁ, fuera del
    // if, y no donde se calcula: la lámina es la capa de más arriba de todas y
    // se suma después de las marcas viales, que se pintan fuera de este
    // bloque. En seco vale cero y el compilador se lo come entero.
    vec3 espMojado = vec3(0.0);

    // El corte de detalle. Fuera del if no se muestrea NADA: a vista de estado
    // las 26.712 vías salen con el mismo coste que antes de existir esto.
    float cerca = smoothstep(${f1(ASFALTO_DESDE_PX)}, ${f1(ASFALTO_HASTA_PX)}, vCalzadaPx) * uAsfaltoOn;

    // El corte temprano no es cero: por debajo de CORTE_TEMPRANO el bloque
    // entero -- tres muestras estocásticas, tres texturas, un Voronoi y un
    // fBm -- aportaría menos del 8% de un color que a esa distancia ya es
    // prácticamente el plano. El escalón que deja es el 8% de una diferencia
    // que promedia cero, así que no se ve.
    //
    // Honestidad sobre la medida: subirlo de 0,002 a 0,08 NO movió los fps a
    // 500 m (44,5 antes, 45,6 después, con las muestras yendo de 20 a 68 entre
    // repeticiones). A esa distancia el cuello es el relieve rellenando
    // teselas, no este shader. Se deja porque es una constante y quita trabajo
    // cuyo resultado no se ve; no porque se haya medido una ganancia.
    //
    // Y tampoco corre en la franja de hombrillo o brocal (|t| > 1, seccion.ts),
    // que la pinta encima entera: era un tercio de los fragmentos de una
    // troncal pagando seis samplers, un Voronoi y el cuenco del bache para un
    // color que se tiraba. Queda el margen de 2 px (un píxel son 2/vCalzadaPx
    // en unidades de t) que el antialiasing del filo sí necesita. \`cerca\` no
    // se toca: también pesa la mezcla final y la lámina del mojado, y fundirlo
    // dejaría un píxel de color plano en el filo.
    if (cerca > ${f2(CORTE_TEMPRANO)} && abs(t) < 1.0 + 4.0 / max(vCalzadaPx, 1.0)) {
      // Sin dato de canales (una trocha) se supone uno: la huella de rodadura
      // existe igual, por el medio.
      float canalesA = max(abs(vCanales), 1.0);

      // Huellas de rodadura: dos bandas gaussianas por canal. Como la
      // distancia al centro del canal va en valor absoluto, una sola gaussiana
      // centrada en HUELLA_SEMI_M pinta las dos.
      float huellas = 0.0;
      for (int k = 0; k < 8; k++) {
        if (float(k) >= canalesA) break;
        float ck = -1.0 + (2.0 * float(k) + 1.0) / canalesA;
        float dm = abs(t - ck) * calzadaM * 0.5;
        float z = (dm - ${f2(HUELLA_SEMI_M)}) / ${f2(HUELLA_SIGMA_M)};
        huellas = max(huellas, exp(-z * z));
      }
      // La huella se ve siempre (el pulido es del tráfico), pero solo OSCURECE
      // cuando la vía está gastada.
      float rodada = huellas * desgaste;

      // El marco de la calzada, en ejes del mundo: a lo largo el sentido de la
      // vía, a lo ancho su derecha, y arriba la normal del terreno. Es el
      // mismo marco en que se definió uvM, así que el normal map cae orientado
      // con el grano que se ve. Se calcula ACÁ, antes de muestrear, porque el
      // ángulo de incidencia decide cuánta textura se puede dibujar.
      //
      // Ng NO es la normal del terreno pelada: es la de la SECCIÓN
      // (seccion.ts). La calzada no es un plano, es una corona que cae ~2 % del
      // eje a cada borde, y eso es lo único que hace que la luz caiga distinto
      // en cada mitad. Como cross(T, Ng + s·B) = B − s·Ng, el marco sigue
      // siendo ortonormal solo y las dos líneas de abajo no cambian.
      vec3 T = normalize(vDirW);
      vec3 Ng = normalSeccion(vTerrW, vDirW, t, calzadaM, vBordeM);
      vec3 B = cross(T, Ng);
      vec3 V = normalize(cameraPosition - vPosW);

      // Cuánto detalle micro cabe de verdad en un píxel.
      //
      // La huella de un píxel sobre la calzada NO es vMpp: vMpp mide
      // perpendicular al rayo de vista, y una calzada mirada de refilón la
      // estira por 1/cos(incidencia). Peor: la estira en UN eje solo, el de la
      // marcha, y el filtrado anisotrópico está topado en 8 -- pasada esa
      // relación el eje corto se queda sin promediar y salen vetas a lo largo
      // de la vía, con el borde exacto de cada tramo (cada cuadrilátero tiene
      // su propia derivada). Se probaron dos aproximaciones antes de esta:
      // vMpp a secas (rayaba en casi toda la calzada) y vMpp / cos(incidencia)
      // (rayaba en bandas, donde el tramo era largo).
      //
      // fwidth() da la derivada REAL en pantalla de la coordenada, que es lo
      // único que no hay que aproximar. Se toma el eje peor: por encima de
      // NYQUIST texels por píxel la textura ya no se puede dibujar, solo
      // aliasear, y se desvanece hacia su media (1.0 para el grano, plano para
      // la normal), que es exactamente promediarla.
      float huellaM = max(fwidth(uvM.x), fwidth(uvM.y));
      float texelsPx = ${f1(TEXTURA_PX)} * huellaM / ${f1(MICRO_M)};
      float nitidez = clamp(${f1(NYQUIST)} / max(texelsPx, 1e-4), 0.0, 1.0);

      // Las dos escalas. La macro va con sesgo de mipmap y muestreo
      // estocástico: manchado sin repetición. La micro va lisa, con el
      // desvanecimiento de arriba.
      vec3 macro = estocastica(uAlbedo, uvM / ${f1(MACRO_M)}, ${f1(MACRO_SESGO)});
      // La macro necesita su propio desvanecimiento, con su propia resolución
      // efectiva (el sesgo de mipmap le quita la mitad de los texels por cada
      // unidad). Sin él, en el primer metro de calzada delante de la cámara
      // -- donde la superficie pasa casi de canto y la huella del píxel mide
      // metros -- salían arcos concéntricos de mipmap abanicándose desde el
      // punto de fuga. Es el mismo artefacto que las vetas, un orden de
      // magnitud más grande.
      float nitidezMacro = clamp(${f1(NYQUIST)} * ${f1(MACRO_M)} / max(${f1(MACRO_PX)} * huellaM, 1e-4), 0.0, 1.0);
      macro = MEDIA_LIN + (macro - MEDIA_LIN) * ${f1(MANCHA_FUERZA)} * nitidezMacro;
      float micro = dot(texture2D(uAlbedo, uvM / ${f1(MICRO_M)}).rgb, LUMA) / MEDIA_LIN;
      micro = 1.0 + (micro - 1.0) * ${f1(GRANO_FUERZA)} * nitidez;
      vec3 muestra = macro * micro;
      float rug = texture2D(uRough, uvM / ${f1(MICRO_M)}).r;
      vec3 nT = texture2D(uNormalMap, uvM / ${f1(MICRO_M)}).xyz * 2.0 - 1.0;
      nT.xy *= nitidez;
      // Y donde el relieve se pierde, la superficie se vuelve mate: es lo que
      // evita que el especular centellee sobre una normal que ya no existe
      // (mismo criterio que Toksvig, sin su mapa extra).
      rug = mix(1.0, rug, nitidez);

      // Dónde está el daño. Un pavimento no se agrieta parejo: falla por
      // zonas, donde la base cedió. Este fBm es a la vez el mapa de esas zonas
      // y el de los parches de bacheo, que es lo mismo visto en dos momentos
      // (primero se agrieta, después alguien lo parcha).
      float zona = fbm(uvM / ${f1(PARCHE_M)});

      // Grietas: distancia al borde de un Voronoi en metros. El ancho va al
      // cuadrado del desgaste, y crece dentro de la huella, que es donde el
      // pavimento fatiga primero.
      vec2 desdeF1;
      vec3 vor = voronoi(uvM / ${f1(GRIETA_M)}, desdeF1);
      float anchoGr = ${f2(GRIETA_MAX)} * desgaste * desgaste * mix(1.0, 1.7, huellas);
      // Una grieta más fina que un píxel titila al orbitar: se desvanece en
      // vez de dibujarse con escalera. El PCI sigue diciéndolo por el color.
      float visGr = smoothstep(0.3, 1.0, anchoGr * ${f1(GRIETA_M)} / max(vMpp, 1e-6));
      // El desgaste manda dos veces: en el ANCHO (arriba) y en lo MARCADA que
      // está. Solo con el ancho, una vía "Bueno" a PCI 70 salía con la piel de
      // cocodrilo entera dibujada a pleno contraste, fina pero completa, y se
      // leía como un enlosado. Una grieta incipiente es una raya tenue.
      // ...y por zonas, no por toda la calzada: una red de Voronoi completa y
      // uniforme se lee como enlosado, no como fatiga.
      float grieta = (1.0 - smoothstep(0.0, anchoGr + 1e-4, vor.x)) * visGr * desgaste
                   * smoothstep(0.30, 0.62, zona + desgaste * 0.35);

      // Parches de bacheo: el mismo fBm, con el umbral bajando con el desgaste.
      float umbralP = mix(0.80, 0.42, desgaste);
      float parche = smoothstep(umbralP, umbralP + 0.06, zona);

${bacheCuerpoGlsl(BACHE_TASA, GRIETA_M)}

      // El tinte. 'grano' es la luminancia de la muestra normalizada a ~1.0:
      // multiplicar por ella modula el VALOR del color de PCI y le deja el
      // matiz intacto. Los topes evitan que una chispa de árido claro sature
      // el color a blanco y le borre el dato.
      float grano = clamp(dot(muestra, LUMA) / MEDIA_LIN, 0.45, 1.7);
      vec3 asf = mix(muestra, base * grano, ${f2(TINTE_PCI)});
      asf *= mix(1.0, ${f2(HUELLA_OSCURO)}, rodada);
      asf *= mix(1.0, ${f2(PARCHE_OSCURO)}, parche);
      asf *= mix(1.0, ${f2(GRIETA_OSCURO)}, grieta);
      asf *= mix(1.0, ${f2(BACHE_OSCURO)}, bache);

      rug = clamp(rug * mix(1.0, ${f2(HUELLA_PULIDO)}, huellas), 0.05, 1.0);
      rug = mix(rug, ${f2(PARCHE_RUG)}, parche);
      rug = mix(rug, 1.0, max(grieta, bache));
      rug = clamp(mix(rug, 1.0, desgaste * 0.35), 0.05, 1.0);

      // La normal perturbada, sobre el marco T/B/Ng de arriba. La huella de
      // rodadura aplana el relieve: los neumáticos pulen.
      float relieve = 0.9 * (1.0 - 0.5 * rodada);
      vec3 N = normalize(T * nT.x * relieve + B * nT.y * relieve + Ng * max(nT.z, 0.1));

      ${ANCLA_MOJADO}

      // somBache: la pared del cuenco que le da la espalda al sol se tapa a sí
      // misma. aoBache: al fondo del cuenco le llega menos cielo. Los dos
      // valen 1.0 fuera de un bache (mojado.ts), así que en el resto de la
      // calzada esta línea es la de siempre.
      float ndl = max(dot(N, uSol), 0.0) * somBache;
      vec3 H = normalize(uSol + V);
      float dureza = exp2(mix(9.0, 2.0, rug));
      float esp = pow(max(dot(N, H), 0.0), dureza) * ${f2(ESPECULAR)} * (1.0 - rug) * step(0.001, ndl);
      // Ambiente de hemisferio: la cara que mira al cielo recibe todo, la que
      // mira al suelo una parte. Nunca cero -- una calzada en sombra tiene que
      // seguir enseñando su PCI.
      float cielo = 0.5 + 0.5 * N.y;
      float ambiente = ${f2(AMBIENTE)} * mix(${f2(AMB_SUELO)}, 1.0, cielo) * aoBache;
      vec3 luz = asf * (ambiente + ${f2(SOL_DIF)} * ndl) * ${f2(NIVEL_CERCA)} + esp;

      base = mix(base, luz, cerca);
    }
`
