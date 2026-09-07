import * as THREE from 'three'

/**
 * El relieve dejó de ser un ShaderMaterial propio y pasó a ser un
 * MeshStandardMaterial parcheado. El motivo es concreto: CSM (las cascadas de
 * sombra) y las luces físicas del cielo (SunLight/SkyLight de
 * @takram/three-atmosphere) están escritas contra la cadena de chunks estándar
 * de three -- lights_fragment_begin, shadowmap_pars_fragment,
 * lights_pars_begin. Con un ShaderMaterial habría que copiar a mano el muestreo
 * de las cuatro shadow maps, el PCF y el probe de irradiancia del cielo, y
 * volver a copiarlo en cada subida de versión de three. Con el estándar todo
 * eso viene puesto y lo único que ponemos nosotros es de dónde sale el color
 * base.
 *
 * Lo que NO se puede perder, y por eso está cada gancho de abajo:
 *  - el albedo: la foto satelital del nodo cuando la hay, y la hipsometría (el
 *    color por altura) cuando no,
 *  - el recorte al contorno del estado por textura de máscara,
 *  - que la elevación cruda viaje como atributo propio, no como position.y.
 *
 * Sobre lo último: position.y es el componente "up" de ENU, que incluye la
 * caída por curvatura terrestre (~750 m en las esquinas del bbox, a ~97,5 km
 * del origen). uMin/uMax son elevación cruda del DEM (terrain.json). Comparar
 * una cosa contra la otra hunde la hipsometría hacia las bandas bajas conforme
 * te alejas del centro, sin que la elevación real cambie -- un error
 * radialmente simétrico desde ORIGIN, fácil de confundir con neblina de
 * AerialPerspective.
 *
 * La normal ya no se pasa a mano: el chunk estándar la lleva a espacio de
 * cámara igual que a las direcciones de las luces, así que el sombreado sale
 * consistente al orbitar sin el cuidado que exigía el uSun fijo de antes.
 *
 * La ecuación de luz que resulta es la del modelo estándar con roughness 1 y
 * metalness 0, o sea Lambert puro:
 *
 *     albedo/PI * (irradiancia_del_sol * sombra  +  irradiancia_del_cielo)
 *
 * El albedo está aislado en albedoRelieve() a propósito: todo lo que decide
 * "de qué color es este trozo de suelo" vive ahí y en ningún otro sitio. Si
 * estás reescribiendo la iluminación, esa función no se toca.
 */

// Los puntos de la cadena de three donde entra el parche. Se exportan para que
// el test compruebe que siguen existiendo exactamente una vez -- un replace()
// que no engancha no falla, simplemente no hace nada.
export const GANCHOS = {
  vert: ['#include <common>', '#include <begin_vertex>'],
  frag: ['#include <common>', '#include <clipping_planes_fragment>', '#include <color_fragment>'],
} as const

const declVert = /* glsl */`
attribute float elevation;
attribute vec2 uvMascara;
// Dónde cae este vértice dentro de la tesela de imagen del nodo. El atributo
// es (i/32, j/32) y es el mismo en todos los nodos (nodoTerreno.ts); el trozo
// de tesela que le toca a este nodo lo pone uImgUv, porque mientras la suya
// carga dibuja la del ancestro.
attribute vec2 uvImagen;
varying float vElev;
varying vec2 vUvM;
varying vec2 vUvImg;
`

const declFrag = /* glsl */`
uniform float uMin;
uniform float uMax;
uniform sampler2D uMascara;
// --- albedo (foto satelital) -------------------------------------------
uniform sampler2D uImg;
// xy = desplazamiento, z = escala del trozo de tesela que le toca a este nodo.
uniform vec3 uImgUv;
// 0 = solo hipsometria, 1 = solo foto. Es por nodo, no global: un nodo sin
// ninguna tesela cargada (ni la suya ni la de un ancestro) lo deja en 0 y
// dibuja el color de siempre.
uniform float uImagen;
uniform float uGanancia;
// -----------------------------------------------------------------------
varying float vElev;
varying vec2 vUvM;
varying vec2 vUvImg;

vec3 hypso (float t) {
  if (t < 0.25) return mix(vec3(0.18,0.31,0.22), vec3(0.36,0.44,0.24), t / 0.25);
  if (t < 0.50) return mix(vec3(0.36,0.44,0.24), vec3(0.60,0.53,0.33), (t - 0.25) / 0.25);
  if (t < 0.75) return mix(vec3(0.60,0.53,0.33), vec3(0.62,0.47,0.40), (t - 0.50) / 0.25);
  return mix(vec3(0.62,0.47,0.40), vec3(0.90,0.90,0.92), (t - 0.75) / 0.25);
}

// EL ALBEDO, y nada más que el albedo: color de la superficie sin una sola
// gota de luz. Ni la sombra, ni el cielo, ni el recorte del estado se enteran
// de lo que pasa aquí dentro.
//
// La foto viene en sRGB y la GPU la linealiza sola al muestrear (la textura se
// sube con formato interno SRGB8_ALPHA8, ver imagenTeselas.ts), así que aquí
// llega en lineal, como el resto de la escena. La ganancia es el pomo de
// calibración de la foto contra la hipsometría, que está escrita con números
// de sRGB usados directamente como lineales y por eso "pega" más fuerte
// (TerrainLod.tsx, GANANCIA).
vec3 albedoRelieve () {
  float t = clamp((vElev - uMin) / max(1.0, uMax - uMin), 0.0, 1.0);
  vec3 color = hypso(t);
  if (uImagen > 0.0) {
    vec3 foto = texture2D(uImg, vUvImg * uImgUv.z + uImgUv.xy).rgb * uGanancia;
    color = mix(color, foto, uImagen);
  }
  return color;
}
`

// El recorte al contorno del estado: la máscara de 1024x1024 (stateMask.ts)
// como textura con filtro lineal, así que el corte cae a media celda del borde
// real (~70 m) a cualquier nivel de detalle del relieve. Por vértice no sirve:
// un nodo grueso tiene celdas de kilómetros y el borde saldría en bloques.
//
// Va lo primero del main, antes de tocar nada: descartar temprano ahorra el
// resto del fragment, que ahora es el modelo estándar completo y no tres
// líneas.
const recorte = /* glsl */`
  if (texture2D(uMascara, vUvM).r < 0.5) discard;
`

/**
 * Los uniforms propios del material, colgados de `material.userData.uniforms`
 * y compartidos POR REFERENCIA con el shader compilado. Con un material
 * estándar `shader.uniforms` no existe hasta el primer cuadro, y TerrainLod
 * escribe los tres de la foto en cada cuadro: escribir `.value` en estos
 * objetos es escribirlo en el shader, antes o después de compilar. Es el mismo
 * camino por el que Roads.tsx escribe los suyos (roadsShader.ts).
 */
export interface UniformsRelieve {
  uMin: { value: number }
  uMax: { value: number }
  uMascara: { value: THREE.Texture }
  uGanancia: { value: number }
  /** La tesela de imagen que dibuja este nodo (la suya o la de un ancestro). */
  uImg: { value: THREE.Texture | null }
  /** xy = desplazamiento, z = escala del trozo de tesela que le toca. */
  uImgUv: { value: THREE.Vector3 }
  /** 0 = hipsometría, 1 = foto. */
  uImagen: { value: number }
}

export interface OpcionesRelieve {
  /** Elevación mínima y máxima del DEM (terrain.json), en metros crudos. */
  min: number
  max: number
  /** Máscara del contorno del estado, un canal, fila 0 = norte. */
  mascara: THREE.Texture
  /** Corrección de brillo de la foto satelital antes del sombreado. 1 si no se dice. */
  ganancia?: number
  /**
   * Las cascadas de sombra, si las hay. Entran acá y no las llama quien crea
   * el material porque CSM.setupMaterial() PISA onBeforeCompile en vez de
   * encadenarlo: si corriera después del nuestro, la hipsometría y el recorte
   * del estado desaparecerían sin un solo error en consola. Metiéndolo aquí el
   * orden no puede quedar al azar. Tipado por la forma y no importando CSM
   * para que el test no tenga que armar una escena.
   */
  cascadas?: { setupMaterial: (m: THREE.Material) => void }
}

/**
 * El material de UN nodo del relieve. Es uno por nodo y no uno compartido
 * porque la tesela de imagen cambia de nodo en nodo y un uniform es por
 * material (three no vuelve a subir los uniforms cuando el material es el
 * mismo del objeto anterior). Es una copia barata: el programa de GPU se
 * compila una sola vez (three cachea por código de shader) y lo único propio
 * son los siete uniforms de arriba.
 */
export function materialRelieve (o: OpcionesRelieve): THREE.MeshStandardMaterial {
  // roughness 1 / metalness 0: tierra y vegetación, nada especular. Es también
  // lo que reduce el modelo estándar a Lambert y hace que la ecuación de luz
  // sea legible (ver el comentario de cabecera).
  const material = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
  // El relieve es una superficie abierta de grosor cero. three, por defecto,
  // mete en el shadow map las CARAS TRASERAS de un material FrontSide (truco
  // para sólidos cerrados: aleja el plano de comparación y quita acné). Acá
  // eso deja el mapa lleno de agujeros justo donde hay que proyectar: la
  // ladera que mira al sol es cara delantera y se descartaría. Las laderas de
  // espaldas al sol no hacen falta en el mapa -- ya salen negras por N·L.
  material.shadowSide = THREE.FrontSide
  const uniforms: UniformsRelieve = {
    uMin: { value: o.min }, uMax: { value: o.max }, uMascara: { value: o.mascara },
    uGanancia: { value: o.ganancia ?? 1 },
    uImg: { value: null }, uImgUv: { value: new THREE.Vector3(0, 0, 1) }, uImagen: { value: 0 },
  }
  material.userData.uniforms = uniforms
  o.cascadas?.setupMaterial(material)
  const previo = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previo(shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${declVert}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vElev = elevation;\n  vUvM = uvMascara;\n  vUvImg = uvImagen;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${declFrag}`)
      .replace('#include <clipping_planes_fragment>', `${recorte}\n  #include <clipping_planes_fragment>`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = albedoRelieve();')
  }
  return material
}
