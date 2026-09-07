// Lo que le falta al asfalto de asfalto.ts para dejar de ser una superficie
// seca y pintada: que el bache sea un HUECO y que la calzada pueda estar
// MOJADA.
//
// Son dos cosas y viven juntas por una razón física, no por comodidad: el agua
// se embalsa exactamente donde la superficie se hunde, así que el mismo campo
// de alturas que hace el relieve del bache decide dónde hay charco. Separarlas
// obligaba a calcular la hondura dos veces.
//
// Lo que hay que entender antes de tocar nada:
//
// 1. El bache se traza ANALÍTICAMENTE, no con POM. Un bache ya es una celda de
//    Voronoi con su centro conocido; el cuenco es un paraboloide y la
//    intersección de un rayo con un paraboloide es una cuadrática. Sale en
//    cerrado: una raíz cuadrada, cero muestras de textura, cero bucles. Un POM
//    de 16 pasos costaría 16 accesos de textura por fragmento de bache para
//    aproximar lo mismo peor.
//
// 2. El relieve se paga SOLO en fragmentos de bache (`esBache`), y solo cuando
//    la boca del cuenco mide más de unos píxeles. Un bache de 60 cm a 125 m
//    son 6 px: el paralaje ahí es sub-píxel y lo único que aporta es centelleo
//    al orbitar. Mismo criterio que `nitidez` en asfalto.ts: lo que no cabe en
//    un píxel se apaga, no se aliasea.
//
// 3. El mojado es el modelo de Lagarde ("Water drop 2b/3b — Dynamic rain and
//    its effects" / "Physically based wet surfaces", 2012-2013): el agua entra
//    en el poro, el índice de refracción del hueco pasa de 1,0 a 1,33, la luz
//    que antes rebotaba en el árido se queda dentro y el albedo se oscurece
//    como una POTENCIA (no como un factor). Encima, la película llena la
//    micro-rugosidad y la superficie se va hacia lo especular.
//
// 4. El charco es otra cosa que la superficie mojada: es una lámina de agua
//    plana. Su normal es la GEOMÉTRICA (el agua no copia el grano, lo tapa),
//    su rugosidad es de espejo y su Fresnel es el del agua (F0 = 0,02).
//
// 5. El PCI tiene que leerse MEJOR mojado, no peor. Sale solo del modelo: la
//    hondura de la rodada y la del bache van con el desgaste, así que una vía
//    mala mojada es un rosario de charcos y una buena es un espejo parejo.

const f2 = (n: number) => n.toFixed(2)
const f3 = (n: number) => n.toFixed(3)

// ------------------------------------------------------------------ el bache

// Radio de la boca del cuenco, en metros. 0,30 son 60 cm de bache: el de una
// avenida urbana rota, no un socavón. Es también, a propósito, el radio con el
// que asfalto.ts venía pintando la mancha (0,26 celdas × 1,1 m/celda ≈ 0,29 m):
// el bache no cambia de tamaño al ganar relieve, cambia de naturaleza.
export const BACHE_R_M = 0.30
// Hondura máxima, en metros, con desgaste total. Un bache de 6,5 cm ya se
// tuerce un tobillo. NO puede acercarse al radio: el paralaje de un cuenco tan
// hondo como ancho se sale de la boca en cuanto la cámara baja, y la silueta
// se rompe. Calibrable, es el pomo de "cuánto hueco".
export const BACHE_HONDO_M = 0.065
// Dónde arranca la pared, en fracción del radio. Por dentro, fondo plano; de
// acá al borde, la pared. 0,62 deja 11 cm de pared para 6,5 cm de caída:
// ~41° de pendiente máxima, que es una pared y no una rampa.
export const BACHE_PARED = 0.62
// El labio: el asfalto que se levantó al romperse. 1 cm de alto sobre una
// campana de 0,12 radios (3,6 cm). NO se traza como geometría -- a 30 m eso es
// medio píxel de silueta y dibujarlo sería aliasearlo -- solo inclina la
// normal, que es de donde sale el filo brillante del borde roto.
export const BACHE_LABIO_M = 0.010
const BACHE_LABIO_ANCHO = 0.12
// Hasta dónde llega el labio por fuera de la boca. Más allá, calzada normal.
const BACHE_LIMITE = 1.28
// Cuánto ambiente le llega al fondo del cuenco. Nunca cero: el fondo de un
// bache en sombra tiene que seguir enseñando el color de su PCI.
const BACHE_AO = 0.40
// Cuánto sol queda en la parte del cuenco que la propia pared tapa.
const BACHE_SOMBRA = 0.18
// Entre qué anchos de boca (en PÍXELES) se desvanece el relieve. Por debajo de
// 3 px un cuenco no tiene sitio para enseñar paralaje: lo que se ve es un
// píxel que salta al orbitar, peor que la mancha plana de antes. A 9 px está
// entero. Medido: la boca mide 24 px a 30 m de cámara y 6 px a 125 m.
const BACHE_VIS_DESDE = 3.0
const BACHE_VIS_HASTA = 9.0

// ------------------------------------------------------------------ el agua

// Porosidad del asfalto para el oscurecimiento de Lagarde: el albedo mojado es
// el seco elevado a (1 + porosidad·mojado). El asfalto es de los materiales
// más porosos que se pisan (la mezcla abierta absorbe agua de verdad), así que
// va alto. 0,45 sobre un albedo de 0,40 lo deja en 0,28: un 30% más oscuro,
// que es lo que se ve cuando empieza a llover. Calibrable.
export const POROSIDAD = 0.45
// A cuánto se queda la rugosidad de la superficie mojada (sin charco): la
// película llena el poro. 0,35 la lleva de mate a semi-brillante.
export const RUG_MOJADA = 0.35
// Rugosidad de la lámina de charco. Casi un espejo, pero no un espejo: el
// viento y la lluvia rizan el agua, y una rugosidad exactamente 0 da un
// destello de un píxel que centellea.
export const CHARCO_RUG = 0.03
// Fresnel del agua a incidencia normal: ((1,33 - 1) / (1,33 + 1))² = 0,020.
// No es calibrable: es el índice de refracción del agua.
export const FRESNEL0 = 0.020
// Cuánto del fondo se sigue viendo bajo el charco. El agua absorbe y el
// rebote múltiple se pierde; nunca 0, o el charco sería un agujero negro
// cuando el reflejo no le toca.
const AGUA_FONDO = 0.50
// Reflejo especular de la superficie mojada SIN charco, en fracción del de un
// charco. Es lo que convierte una vía buena mojada en un espejo parejo en vez
// de en una vía seca más oscura. Calibrable: el pomo de "cuánto brilla lo
// mojado que no es charco".
const BRILLO_HUMEDO = 0.15
// Cuánta radiancia trae el sol para el destello del charco, en la misma escala
// que uCielo. Calibrable: es el pomo de "cuánto ciega el charco cuando la
// cámara cae justo en el ángulo del espejo".
const SOL_CHARCO = 2.4
// 1/(8π): la normalización de Blinn-Phong, (n+8)/(8π).
const NORM_BLINN = 1 / (8 * Math.PI)

// El campo de alturas de la calzada, en METROS, relativo a la rasante ideal.
// Es lo que decide dónde se embalsa.
//
// Bombeo: 2 % del eje a los bordes, la norma. Pero NO entra entero, y el peso
// es la decisión menos obvia de este archivo: un bombeo real DRENA, no embalsa
// -- decide dónde se seca antes, no dónde se hace la poza. Con peso 1 la
// calzada se convertía en una bañera con el eje como isla y dos ríos en los
// bordes, que es lo contrario de lo que se ve después de un aguacero. Con 0,35
// el bombeo pesa lo mismo que la rodada (2,4 cm contra 3,5), y lo que manda es
// la huella, que es donde el agua se queda de verdad.
//
// El agente de sección transversal (hr/seccion) tiene el bombeo de verdad en
// su geometría; cuando se integre, BOMBEO sale de allá y esta constante muere.
export const BOMBEO = 0.02
export const BOMBEO_PESO = 0.35
// Cuánto hunde la rodada, en metros, con desgaste total.
const RODADA_M = 0.035
// Irregularidad de baja frecuencia: las ondulaciones de una calzada vieja.
const IRREG_M = 0.022
const CHARCO_M = 6

// Nivel del agua, en metros de cota. Seco = por debajo del fondo del bache más
// hondo (nada embalsa). Lleno = un pelo por encima de la cota del borde: se
// llenan las huellas, los baches y la orilla, y el eje bombeado se queda seco.
// Es lo que se ve en una avenida después del aguacero.
export const NIVEL_SECO = -0.09
export const NIVEL_LLENO = 0.004

// Radiancia del cielo para el reflejo del charco, en la misma escala en que
// asfalto.ts deja la calzada (que promedia ~0,35). Un cielo real es del orden
// de cincuenta veces más brillante que el asfalto que ilumina; acá va en ~15,
// que con el 2 % de Fresnel a 45° deja el charco a la mitad del brillo de la
// calzada y azul: exactamente el aspecto de un charco visto desde arriba.
//
// Es solo el valor por defecto, igual que SOL_POR_DEFECTO en asfalto.ts: el
// agente de luz (hr/luz) puede alimentarlo por cuadro desde el SkyLight con el
// color real del cielo a esa hora, y entonces el charco refleja el atardecer.
export const CIELO_POR_DEFECTO: readonly [number, number, number] = [2.6, 3.6, 5.6]
// Cuánto se destiñe el cielo hacia el horizonte. Un cielo real pierde
// saturación y gana brillo al bajar la vista: sin esto el charco refleja un
// azul plano que se lee como pintura, no como agua.
const HORIZONTE = 0.70

// Cuántos segundos tarda la calzada en mojarse (y en secarse) al pulsar el
// botón. 1,5 s es lo que separa "llovió" de "alguien cambió una variable": por
// debajo de ~0,8 s el cambio se lee como un salto de material.
export const MOJADO_SEG = 1.5
// Tope del paso de tiempo. requestAnimationFrame se para en una pestaña de
// fondo: al volver, el dt de ese cuadro puede ser de minutos y la transición
// se saltaría entera.
const DT_MAX = 0.25

/**
 * Un paso de la transición de `uMojado` hacia su objetivo (0 seco, 1 tras el
 * aguacero). Rampa lineal, no suavizado exponencial: una exponencial nunca
 * llega y deja el uniform temblando en 0,999 para siempre, y con 26.712 vías
 * eso es escribir un uniform por cuadro sin que cambie nada en pantalla.
 */
export function avanzarMojado (actual: number, objetivo: number, dt: number, seg = MOJADO_SEG): number {
  const paso = Math.min(Math.max(dt, 0), DT_MAX) / Math.max(seg, 1e-3)
  const d = objetivo - actual
  if (Math.abs(d) <= paso) return objetivo
  return actual + Math.sign(d) * paso
}

/** Lo que el fragment del pase de relleno declara además de lo del asfalto. */
export const MOJADO_UNIFORMS_GLSL = `
  uniform float uMojado;
  uniform vec3 uCielo;
`

/**
 * Las funciones. Van en el preámbulo del fragment del pase de relleno, después
 * de las del asfalto (usan su marco y sus constantes de escala, no sus
 * funciones).
 */
export const MOJADO_GLSL = `
  // El cuenco que se TRAZA es un paraboloide de radio R y hondura H:
  //
  //     hondura(r) = H (1 - r²/R²)
  //
  // El rayo de vista entra por el fragmento y baja. A hondura z, el punto que
  // de verdad se ve está corrido k·z sobre el plano de la calzada, con
  // k = -(V·T, V·B)/(V·Ng) -- metros de corrimiento por metro de hondura.
  // Igualar z con la hondura del punto corrido:
  //
  //     z = H (1 - |a + k z|² / R²)
  //
  // es una cuadrática en z:  A z² + B z + C = 0, con
  //     A = H|k|²/R²      B = 1 + 2H(a·k)/R²      C = H(|a|²/R² - 1)
  //
  // Dentro de la boca (|a| < R) es C < 0, así que hay exactamente una raíz
  // positiva. Y esa raíz cumple z > 0 ⟹ |a + k z| < R: el punto trazado cae
  // siempre DENTRO del cuenco, sin comprobarlo.
  //
  // La forma que se usa NO es (-B + sqrt(disc)) / 2A. Esa se cancela
  // catastróficamente cuando A → 0, que es justo la vista cenital (k → 0), y
  // ahí es donde más se mira este mapa. Multiplicando arriba y abajo por
  // (B + sqrt(disc)) sale la equivalente estable, que además degenera sola al
  // caso lineal z = -C/B.
  float trazarCuenco (vec2 a, vec2 k, float H, float R2) {
    float A = H * dot(k, k) / R2;
    float B = 1.0 + 2.0 * H * dot(a, k) / R2;
    float C = H * (dot(a, a) / R2 - 1.0);
    return -2.0 * C / max(B + sqrt(max(B * B - 4.0 * A * C, 0.0)), 1e-5);
  }

  // La sombra propia del cuenco, de la MISMA cuadrática y sin raíz.
  //
  // Desde el punto trazado (ap, hondura z) se sube hacia el sol. Tras subir s,
  // se está en ap + m·s a hondura z - s, con m = (sol·T, sol·B)/(sol·Ng). La
  // diferencia entre esa altura y la del cuenco es un polinomio de segundo
  // grado en s que vale CERO en s = 0 (se arranca sobre la superficie), así
  // que sus dos raíces son 0 y una sola más:
  //
  //     s* = (1 - 2H(ap·m)/R²) / (H|m|²/R²)
  //
  // El rayo sale del cuenco si s* > z y queda tapado por la pared si s* < z.
  // s* < 0 es la pared que da la espalda al sol -- lo que el N·L ya dice --
  // y cae del lado tapado, que es lo correcto.
  float sombraCuenco (vec2 ap, vec2 m, float z, float H, float R2) {
    float q = max(H * dot(m, m) / R2, 1e-5);
    float sEstrella = (1.0 - 2.0 * H * dot(ap, m) / R2) / q;
    // Suavizado en fracción de hondura: el filo de una sombra propia no es de
    // un texel, y con un step a secas centellearía en el borde al orbitar.
    return smoothstep(-0.25, 0.25, (sEstrella - z) / max(H, 1e-4));
  }

  // El perfil de SOMBREADO no es el paraboloide que se traza.
  //
  // Un bache real no es un cuenco suave: tiene fondo plano, pared corta y
  // empinada, y el borde roto levantado. El paraboloide se queda para el
  // trazado porque es lo que da la cuadrática cerrada; ésta es la superficie
  // que se ilumina. La diferencia no se ve -- el paralaje desplaza casi lo
  // mismo (la hondura máxima es la misma) y lo que dibuja la pared es la
  // NORMAL, que sale de acá.
  //
  // Devuelve la hondura en metros (positiva hacia abajo, NEGATIVA sobre el
  // labio) y dy/dr, la pendiente de la superficie hacia afuera.
  void perfilCuenco (float u, float H, float R, out float hondura, out float pend) {
    float x = clamp((u - ${f2(BACHE_PARED)}) / ${f2(1 - BACHE_PARED)}, 0.0, 1.0);
    hondura = H * (1.0 - x * x * (3.0 - 2.0 * x));
    pend = H * 6.0 * x * (1.0 - x) / (${f2(1 - BACHE_PARED)} * R);
    // El labio, como campana sobre el filo. Levanta la superficie (hondura
    // negativa) y le da a la pendiente el signo contrario al de la pared: por
    // eso el borde de un bache se lee como una arruga y no como un escalón.
    float xl = (u - 1.0) / ${f2(BACHE_LABIO_ANCHO)};
    float campana = exp(-xl * xl);
    hondura -= ${f3(BACHE_LABIO_M)} * campana;
    pend -= 2.0 * ${f3(BACHE_LABIO_M)} * xl * campana / (${f2(BACHE_LABIO_ANCHO)} * R);
  }
`

/**
 * El bache, sustituyendo las dos líneas de mancha que tenía asfalto.ts. Se
 * interpola dentro de ASFALTO_CUERPO_GLSL, justo donde estaban, porque el
 * `bache` que sale de acá lo consumen el albedo y la rugosidad unas líneas más
 * abajo -- y porque necesita `vor`, `desdeF1`, el marco T/B/Ng y `huellaM`,
 * que ahí ya existen y en el ancla de mojado también, pero tarde.
 *
 * Es una función y no una constante para no duplicar acá la tasa de baches ni
 * el tamaño de celda del Voronoi, que son de asfalto.ts: importarlos sería un
 * ciclo (asfalto.ts importa esto), y copiarlos es exactamente el duplicado que
 * este repo ya vio desincronizarse en silencio dos veces.
 *
 * Deja en scope, además de `bache`: `hondura` (metros de hueco, que es lo que
 * el agua necesita), `aoBache`, `somBache` y `pendB`.
 */
export const bacheCuerpoGlsl = (tasa: number, celdaM: number) => `
      // Baches: celdas sueltas del MISMO Voronoi (un bache es piel de
      // cocodrilo que se desprendió). Al CUBO del desgaste: un bache no es una
      // grieta más grande, es otra etapa. A PCI 70 son el 1% de las celdas; a
      // PCI 10, el 22%.
      float esBache = step(1.0 - ${f2(tasa)} * desgaste * desgaste * desgaste, vor.z);

      // ...y desde acá deja de ser una mancha y pasa a ser un HUECO (mojado.ts).
      float bache = 0.0;
      float hondura = 0.0;      // metros por debajo de la calzada; el agua los usa
      float aoBache = 1.0;      // cuánto ambiente le llega al fondo del cuenco
      float somBache = 1.0;     // sombra propia de la pared contra el sol
      vec2 pendB = vec2(0.0);   // pendiente del cuenco, en el marco T/B
      // Todo el relieve del bache vive dentro de este if: en una calzada sana
      // no se ejecuta una sola instrucción de las de abajo, y en una colapsada
      // se ejecuta en el 22% de sus fragmentos de cerca.
      if (esBache > 0.5) {
        // Cuánto de la boca cabe en pantalla, en píxeles. huellaM es la
        // derivada REAL de la coordenada de calzada (asfalto.ts), o sea los
        // metros que cubre un píxel sobre esta superficie, ya con la
        // inclinación de la vista dentro.
        float vis = smoothstep(${f2(BACHE_VIS_DESDE)}, ${f2(BACHE_VIS_HASTA)},
                               2.0 * ${f2(BACHE_R_M)} / max(huellaM, 1e-5));
        vec2 a = desdeF1 * ${f2(celdaM)};              // metros del centro al fragmento
        float u0 = length(a) / ${f2(BACHE_R_M)};
        if (u0 < ${f2(BACHE_LIMITE)}) {
          float H = ${f3(BACHE_HONDO_M)} * mix(0.45, 1.0, desgaste);
          float R2 = ${f2(BACHE_R_M)} * ${f2(BACHE_R_M)};
          // Corrimiento del punto visto por metro de hondura. El clamp de la
          // incidencia es el tope del paralaje: de canto, k se iría a infinito.
          vec2 k = -vec2(dot(V, T), dot(V, B)) / max(dot(V, Ng), 0.06);
          // El paralaje entra escalado por vis: a lo lejos vale cero y el
          // bache vuelve a ser exactamente la mancha plana de antes, que a esa
          // distancia es lo único que la pantalla puede dibujar sin centellear.
          float z = u0 < 1.0 ? trazarCuenco(a, k * vis, H, R2) : 0.0;
          vec2 ap = a + k * vis * z;
          float u = length(ap) / ${f2(BACHE_R_M)};
          float pend;
          perfilCuenco(u, H, ${f2(BACHE_R_M)}, hondura, pend);
          // La normal del cuenco, en el marco T/B/Ng: (-dy/dx, -dy/dy, 1).
          pendB = pend * vis * (u > 1e-4 ? ap / length(ap) : vec2(0.0));
          // Oclusión: al fondo le llega menos cielo. Lineal con la hondura --
          // el factor de forma exacto de un cuenco no se distingue de esto a
          // 24 px de boca y cuesta un acos.
          aoBache = mix(1.0, ${f2(BACHE_AO)}, clamp(hondura / max(H, 1e-4), 0.0, 1.0));
          vec2 m = vec2(dot(uSol, T), dot(uSol, B)) / max(dot(uSol, Ng), 0.05);
          somBache = mix(1.0, mix(${f2(BACHE_SOMBRA)}, 1.0, sombraCuenco(ap, m, z, H, R2)), vis);
          // Y el interior del hueco es asfalto arrancado: se ve la base, más
          // oscura. El filo se afila con vis -- de lejos vuelve a ser la mancha
          // difusa de antes, que es lo que no aliasea.
          bache = 1.0 - smoothstep(mix(0.25, 0.88, vis), 1.0, u);
        }
      }`

/**
 * El mojado. Se inyecta en el ancla ANCLA_MOJADO de asfalto.ts: después de que
 * `asf`, `rug` y `N` están calculados, y antes de que se iluminen. Ese punto no
 * es negociable en ninguna de las dos direcciones -- el mojado CAMBIA los tres,
 * y la luz tiene que ver los valores cambiados.
 *
 * Deja el reflejo en `espMojado` en vez de sumarlo acá: la lámina de agua es la
 * capa de más arriba de todas, también por encima de la pintura, y la pintura
 * se compone después (roadsShader.ts, MARCAS_CUERPO_GLSL). Una raya de
 * demarcación mate en medio de una calzada que refleja el cielo se lee como una
 * calcomanía pegada sobre un espejo.
 */
export const MOJADO_CUERPO_GLSL = `
      // El cuenco del bache inclina la normal del asfalto. Se compone en el
      // mismo marco T/B/Ng en que está definido el normal map, así que las dos
      // perturbaciones (grano y hueco) se suman sin pelearse.
      N = normalize(N - T * pendB.x - B * pendB.y);

      if (uMojado > 0.002) {
        // Primero se moja la superficie y después se llenan los charcos: es el
        // orden en que pasa, y hace que el botón se lea como que empieza a
        // llover en vez de como un cambio de material.
        float humedo = smoothstep(0.0, 0.55, uMojado);

        // 1. La superficie mojada (Lagarde). El agua entra en el poro; la luz
        // que antes salía rebotada del árido ahora se queda dentro. Eso es un
        // EXPONENTE sobre el albedo, no un factor: un asfalto ya oscuro se
        // oscurece poco y uno claro mucho, que es lo que se ve en la calle.
        asf = pow(max(asf, vec3(0.0)), vec3(1.0 + ${f2(POROSIDAD)} * humedo));
        // ...y la película llena la micro-rugosidad: la superficie se va hacia
        // lo especular, nunca hacia lo mate.
        rug = clamp(mix(rug, rug * ${f2(RUG_MOJADA)}, humedo), 0.02, 1.0);

        // 2. Dónde se embalsa. \`cota\` es la altura local de la calzada en
        // metros, relativa a la rasante ideal: el bombeo levanta el eje, la
        // huella de rodadura hunde, el bache hunde mucho más, y un fBm de 6 m
        // pone las ondulaciones de una calzada vieja. Las tres hondonadas van
        // con el desgaste, y de ahí sale solo que una vía mala mojada sea un
        // rosario de charcos y una buena un espejo parejo.
        float cota = ${f2(BOMBEO)} * ${f2(BOMBEO_PESO)} * (1.0 - abs(t)) * calzadaM * 0.5
                   - ${f3(RODADA_M)} * huellas * mix(0.4, 1.0, desgaste)
                   - hondura
                   + ${f3(IRREG_M)} * (fbm(uvM / ${f2(CHARCO_M)} + 37.0) - 0.5) * mix(0.3, 1.0, desgaste);
        float nivel = mix(${f2(NIVEL_SECO)}, ${f3(NIVEL_LLENO)}, uMojado);
        // El filo del charco se antialiasea con la derivada REAL de la cota en
        // pantalla. Es lo mismo que hace \`nitidez\` con el grano, aplicado a un
        // campo procedural: un charco visto de refilón tiene el borde estirado
        // en un eje y no en el otro, y una constante en metros no lo sabe.
        float filo = max(fwidth(cota), 1e-4);
        float charco = (1.0 - smoothstep(nivel - filo, nivel + filo, cota)) * humedo * nitidez;

        // 3. La lámina. Fresnel de Schlick con el F0 del agua sobre la normal
        // GEOMÉTRICA: el agua no copia el grano del asfalto, lo tapa.
        float fres = ${f3(FRESNEL0)} + ${f3(1 - FRESNEL0)} * pow(1.0 - max(dot(Ng, V), 0.0), 5.0);
        vec3 Rv = reflect(-V, Ng);
        // El cielo, desteñido hacia el horizonte: un cielo real pierde
        // saturación y gana brillo al bajar la vista, y sin eso el charco
        // refleja un azul plano que se lee como pintura.
        vec3 palido = vec3(dot(uCielo, LUMA) * 1.25);
        vec3 cieloRef = mix(mix(uCielo, palido, ${f2(HORIZONTE)}), uCielo, sqrt(clamp(Rv.y, 0.0, 1.0)));
        // El destello del sol. La normal va de la del asfalto a la geométrica
        // según cuánta agua hay encima: una película fina sigue el grano, un
        // charco no.
        vec3 Nm = normalize(mix(N, Ng, charco));
        vec3 Hm = normalize(uSol + V);
        float rugM = mix(rug, ${f2(CHARCO_RUG)}, charco);
        float duro = 2.0 / max(rugM * rugM, 1e-4) - 2.0;
        // Normalización de Blinn-Phong, (n+8)/8π: sin ella un lóbulo de
        // exponente 2.000 tiene la misma energía que uno de 20 y el destello
        // del charco se pierde. Con ella el charco enciende de verdad cuando
        // la cámara cae en el ángulo del espejo, que es como se ve la calle.
        float esp = pow(max(dot(Nm, Hm), 0.0), duro) * (duro + 8.0) * ${f3(NORM_BLINN)}
                  * step(0.001, dot(Ng, uSol));

        // El agua tapa el fondo, y el fondo que queda va más oscuro.
        asf *= mix(1.0, ${f2(AGUA_FONDO)}, charco);
        rug = rugM;
        // Reflejo especular donde hay charco, y una fracción de él en toda la
        // superficie mojada: es lo que hace que una vía buena mojada sea un
        // espejo parejo y no una vía seca más oscura.
        float espejo = max(charco, humedo * ${f2(BRILLO_HUMEDO)} * nitidez);
        // El tope no es cosmético: el destello normalizado a incidencia
        // rasante se va a decenas, y el mapeado de tonos AGX que corre después
        // (Sky.tsx) devuelve una mancha blanca sin forma en vez de un brillo.
        espMojado = min((cieloRef + ${f2(SOL_CHARCO)} * esp) * fres * espejo * cerca, vec3(6.0));
      }`

/**
 * La lámina de agua, sumada al final de todo: por encima del asfalto Y de la
 * demarcación. Va aparte de MOJADO_CUERPO_GLSL porque el sitio donde tiene que
 * sumarse está después de las marcas viales, y ese sitio no es el ancla.
 */
export const MOJADO_LAMINA_GLSL = `
    // El agua es la capa de más arriba: también tapa la pintura. Una raya de
    // demarcación mate en medio de una calzada que refleja el cielo se lee como
    // una calcomanía sobre un espejo -- y una raya mojada, en la calle, es la
    // parte que más brilla.
    base += espMojado;`
