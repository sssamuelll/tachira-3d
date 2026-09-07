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
 *  - la hipsometría (el color por altura),
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
 * cámara igual que a las direcciones de las luces, así que el hillshade sale
 * consistente al orbitar sin el cuidado que exigía el uSun fijo de antes.
 *
 * La ecuación de luz que resulta es la del modelo estándar con roughness 1 y
 * metalness 0, o sea Lambert puro:
 *
 *     albedo/PI * (irradiancia_del_sol * sombra  +  irradiancia_del_cielo)
 *
 * El albedo está aislado en albedoRelieve() a propósito: sustituir la
 * hipsometría por una foto satelital es cambiar el cuerpo de esa función (y
 * añadir su sampler a los uniforms), nada más.
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
varying float vElev;
varying vec2 vUvM;
`

const declFrag = /* glsl */`
uniform float uMin;
uniform float uMax;
uniform sampler2D uMascara;
varying float vElev;
varying vec2 vUvM;

vec3 hypso (float t) {
  if (t < 0.25) return mix(vec3(0.18,0.31,0.22), vec3(0.36,0.44,0.24), t / 0.25);
  if (t < 0.50) return mix(vec3(0.36,0.44,0.24), vec3(0.60,0.53,0.33), (t - 0.25) / 0.25);
  if (t < 0.75) return mix(vec3(0.60,0.53,0.33), vec3(0.62,0.47,0.40), (t - 0.50) / 0.25);
  return mix(vec3(0.62,0.47,0.40), vec3(0.90,0.90,0.92), (t - 0.75) / 0.25);
}

// EL ALBEDO, y nada más que el albedo: color de la superficie sin una sola
// gota de luz. Acá entra la foto satelital cuando la haya -- basta con
// sustituir el cuerpo y declarar su sampler arriba; ni la sombra, ni el
// cielo, ni el recorte del estado se enteran.
vec3 albedoRelieve () {
  float t = clamp((vElev - uMin) / max(1.0, uMax - uMin), 0.0, 1.0);
  return hypso(t);
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

export interface OpcionesRelieve {
  /** Elevación mínima y máxima del DEM (terrain.json), en metros crudos. */
  min: number
  max: number
  /** Máscara del contorno del estado, un canal, fila 0 = norte. */
  mascara: THREE.Texture
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
 * El material del relieve. Un solo material para todos los nodos del quadtree
 * (comparten programa y uniforms), así que esto se llama una vez por carga.
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
  o.cascadas?.setupMaterial(material)
  const previo = material.onBeforeCompile.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previo(shader, renderer)
    shader.uniforms.uMin = { value: o.min }
    shader.uniforms.uMax = { value: o.max }
    shader.uniforms.uMascara = { value: o.mascara }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${declVert}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vElev = elevation;\n  vUvM = uvMascara;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${declFrag}`)
      .replace('#include <clipping_planes_fragment>', `${recorte}\n  #include <clipping_planes_fragment>`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb = albedoRelieve();')
  }
  return material
}
