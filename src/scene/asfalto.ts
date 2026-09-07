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

// Las dos escalas de muestreo, en metros de calzada.
//
// La MACRO da el manchado grande del pavimento (zonas más claras y más
// oscuras, juntas de pavimentación). Se muestrea con sesgo de mipmap para que
// aporte SOLO baja frecuencia: sin el sesgo, la textura de 1K estirada a 24 m
// deja el árido en manchas de 10 cm y la calzada parece grava.
//
// La MICRO da el árido de verdad: 1024 px sobre 2 m son 2 mm por texel, que es
// el tamaño real del grano de una mezcla asfáltica.
//
// 30 m de macro (la cifra del brief) se probó primero: sobre una calzada de
// 6,8 m el tile cubre 0,23 de su ancho y el manchado se lee como vetas
// longitudinales, no como manchas. 24 m cubre 0,28 y ya no se nota.
export const MACRO_M = 24
export const MICRO_M = 2
const MACRO_SESGO = 2.5

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
const AMBIENTE = 0.42
const SOL_DIF = 0.684
// Cuánto se oscurece el ambiente en una cara que mira al suelo en vez de al
// cielo. Nunca 0: una ladera en sombra tiene que enseñar su PCI igual.
const AMB_SUELO = 0.55
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
const GRIETA_M = 1.6
// Ancho máximo de grieta, en fracción de celda, cuando el desgaste es total.
// Va al CUADRADO del desgaste a propósito: una vía "Bueno" (PCI 80, desgaste
// 0,2) tiene 0,04 de esto, casi nada; una "Fallado" (PCI 10) tiene 0,81.
// La curva del deterioro de un pavimento real es así, no lineal.
const GRIETA_MAX = 0.16
const GRIETA_OSCURO = 0.38

// Parches de bacheo: fBm a 9 m, con el umbral bajando con el desgaste. Un
// parche es más oscuro (asfalto nuevo sin oxidar) y menos rugoso que el
// pavimento viejo que lo rodea.
const PARCHE_M = 9
const PARCHE_OSCURO = 0.62
const PARCHE_RUG = 0.45

// Qué fracción de las celdas del Voronoi son un bache, con desgaste total.
// SOLO mancha de albedo y rugosidad: el relieve por parallax es de otro
// agente, y un bache pintado sin relieve pero con sombra propia se lee peor
// que una mancha honesta.
const BACHE_TASA = 0.30
const BACHE_OSCURO = 0.30

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
  // F2-F1 no es la distancia exacta al borde (la exacta necesita una segunda
  // pasada proyectando sobre las mediatrices, Quílez 2012), pero para una
  // grieta la diferencia es un ensanchamiento leve en los vértices triples,
  // que es justo donde una grieta real se ensancha. La mitad del costo.
  vec3 voronoi (vec2 p) {
    vec2 n = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    vec2 celda = n;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        float d = length(g + hash2(n + g) - f);
        if (d < d1) { d2 = d1; d1 = d; celda = n + g; }
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
    // lo ancho los metros al eje. vCalzadaPx * vMpp es la calzada en metros.
    float calzadaM = vCalzadaPx * vMpp;
    vec2 uvM = vec2(vDist, t * calzadaM * 0.5);

    // 255 es el centinela de "sin evaluar" (encodeAttr): se dibuja con
    // ${PCI_SIN_EVALUAR}, desgaste moderado. No es 100 -- una vía que nadie
    // inspeccionó no es una vía nueva -- ni 0, que sería inventar una ruina.
    float pciEf = pci > 100.5 ? ${f1(PCI_SIN_EVALUAR)} : pci;
    float desgaste = clamp(1.0 - pciEf * 0.01, 0.0, 1.0);

    // El corte de detalle. Fuera del if no se muestrea NADA: a vista de estado
    // las 26.712 vías salen con el mismo coste que antes de existir esto.
    float cerca = smoothstep(${f1(ASFALTO_DESDE_PX)}, ${f1(ASFALTO_HASTA_PX)}, vCalzadaPx) * uAsfaltoOn;

    if (cerca > 0.002) {
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

      // Las dos escalas. La macro va con sesgo de mipmap: aporta manchado,
      // no árido.
      vec3 macro = estocastica(uAlbedo, uvM / ${f1(MACRO_M)}, ${f1(MACRO_SESGO)});
      float micro = dot(texture2D(uAlbedo, uvM / ${f1(MICRO_M)}).rgb, LUMA) / MEDIA_LIN;
      vec3 muestra = macro * mix(1.0, micro, 0.75);
      float rug = texture2D(uRough, uvM / ${f1(MICRO_M)}).r;
      vec3 nT = texture2D(uNormalMap, uvM / ${f1(MICRO_M)}).xyz * 2.0 - 1.0;

      // Grietas: distancia al borde de un Voronoi en metros. El ancho va al
      // cuadrado del desgaste, y crece dentro de la huella, que es donde el
      // pavimento fatiga primero.
      vec3 vor = voronoi(uvM / ${f1(GRIETA_M)});
      float anchoGr = ${f2(GRIETA_MAX)} * desgaste * desgaste * mix(1.0, 1.7, huellas);
      // Una grieta más fina que un píxel titila al orbitar: se desvanece en
      // vez de dibujarse con escalera. El PCI sigue diciéndolo por el color.
      float visGr = smoothstep(0.3, 1.0, anchoGr * ${f1(GRIETA_M)} / max(vMpp, 1e-6));
      float grieta = (1.0 - smoothstep(0.0, anchoGr + 1e-4, vor.x)) * visGr;

      // Parches de bacheo: fBm con el umbral bajando con el desgaste.
      float umbralP = mix(0.80, 0.42, desgaste);
      float parche = smoothstep(umbralP, umbralP + 0.06, fbm(uvM / ${f1(PARCHE_M)}));

      // Baches: celdas sueltas del MISMO Voronoi (un bache es piel de
      // cocodrilo que se desprendió). Solo mancha, sin relieve.
      float esBache = step(1.0 - ${f2(BACHE_TASA)} * desgaste * desgaste, vor.z);
      float bache = esBache * (1.0 - smoothstep(0.10, 0.34, vor.y));

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

      // Marco tangente de la calzada, en ejes del mundo: a lo largo el sentido
      // de la vía, a lo ancho su derecha, y arriba la normal del terreno. Es
      // el mismo marco en que se definió uvM, así que el normal map cae
      // orientado con el grano que se ve.
      vec3 T = normalize(vDirW);
      vec3 Ng = normalize(vTerrW);
      vec3 B = cross(T, Ng);
      float relieve = 0.9 * (1.0 - 0.5 * rodada);
      vec3 N = normalize(T * nT.x * relieve + B * nT.y * relieve + Ng * max(nT.z, 0.1));

      float ndl = max(dot(N, uSol), 0.0);
      vec3 V = normalize(cameraPosition - vPosW);
      vec3 H = normalize(uSol + V);
      float dureza = exp2(mix(9.0, 2.0, rug));
      float esp = pow(max(dot(N, H), 0.0), dureza) * ${f2(ESPECULAR)} * (1.0 - rug) * step(0.001, ndl);
      // Ambiente de hemisferio: la cara que mira al cielo recibe todo, la que
      // mira al suelo una parte. Nunca cero -- una calzada en sombra tiene que
      // seguir enseñando su PCI.
      float cielo = 0.5 + 0.5 * N.y;
      float ambiente = ${f2(AMBIENTE)} * mix(${f2(AMB_SUELO)}, 1.0, cielo);
      vec3 luz = asf * (ambiente + ${f2(SOL_DIF)} * ndl) + esp;

      base = mix(base, luz, cerca);
    }
`
