import * as THREE from 'three'
import { PCI_RANGES, SIN_EVALUAR, FUENTES } from '../data/constants'

// Exportadas para que roadsShader.test.ts las use contra el LineMaterial real
// instalado, en vez de duplicar los strings en el test (la misma clase de
// desincronización silenciosa que este archivo ya evita para la paleta).
export const ANCLA_VERT = 'void main() {'

// El brief de esta tarea asumía 'vec4 diffuseColor = vec4( diffuse, opacity );'
// (la forma de versiones viejas de three). En three@0.185.1 ese main() abre
// con `float alpha = opacity;` y arma diffuseColor con esa variable local, no
// con el uniform directo -- confirmado leyendo
// node_modules/three/examples/jsm/lines/LineMaterial.js. El string viejo no
// aparece en esta versión; el ancla real es esta:
export const ANCLA_FRAG = 'vec4 diffuseColor = vec4( diffuse, alpha );'

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

// FUENTES (constants.ts) también es fuente única: se resuelve el índice acá
// en vez de repetir 2.0/3.0 sueltos y sin nombre dentro del shader.
const F_ESTIMADO = FUENTES.indexOf('estimado').toFixed(1)
const F_MEDIDO = FUENTES.indexOf('medido').toFixed(1)

/**
 * Inyecta en el shader de LineMaterial la lectura de la data texture de
 * atributos (Task 14) y el color por PCI/procedencia. Se ancla al inicio de
 * void main() (vertex) y a la línea donde LineMaterial arma diffuseColor
 * (fragment) -- ambos strings se verifican antes de reemplazar: si three
 * cambia ese shader en una versión futura, esto debe reventar ruidosamente
 * en vez de dejar un render mudo sin error.
 */
export function patchLineMaterial (
  material: THREE.Material, attrTexture: THREE.DataTexture, attrSize: number,
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAttr = { value: attrTexture }
    shader.uniforms.uAttrSize = { value: attrSize }

    if (!shader.vertexShader.includes(ANCLA_VERT)) {
      throw new Error('roadsShader: no se encontró el ancla del vertex shader de LineMaterial')
    }
    shader.vertexShader = shader.vertexShader.replace(ANCLA_VERT, `
      attribute float segId;
      uniform sampler2D uAttr;
      uniform float uAttrSize;
      varying vec4 vAttr;
      void main() {
        vAttr = texture2D(uAttr, (vec2(
          mod(segId, uAttrSize), floor(segId / uAttrSize)) + 0.5) / uAttrSize);
    `)

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
        ${PCI_COLOR_GLSL}
        void main() {
      `)
      .replace(ANCLA_FRAG, `
        float pci = vAttr.r * 255.0;
        float fuente = floor(vAttr.g * 255.0 + 0.5);
        float visible = mod(floor(vAttr.b * 255.0 + 0.5), 2.0);
        float selected = floor(mod(floor(vAttr.b * 255.0 + 0.5), 4.0) / 2.0);
        if (visible < 0.5) discard;
        // la procedencia modula la opacidad final: medido sólido, estimado
        // semitransparente, heredado (y sin dato) tenue. Ojo: three@0.185.1
        // saca el alpha de salida de la variable local alpha (ver
        // gl_FragColor más abajo en este mismo shader), no de diffuseColor.a
        // -- hay que reasignarla a ella, no solo construir diffuseColor con
        // otro valor, o la modulación compila pero no se ve.
        alpha *= fuente >= ${F_MEDIDO} ? 1.0 : (fuente >= ${F_ESTIMADO} ? 0.75 : 0.45);
        vec3 base = mix(pciColor(pci), vec3(1.0), selected * 0.6);
        vec4 diffuseColor = vec4( base, alpha );
      `)
  }
  material.needsUpdate = true
}
