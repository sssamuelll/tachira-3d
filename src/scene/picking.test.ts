import { test, expect } from 'vitest'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { encodeId, decodeId, patchPickMaterial } from './PickingPass'
import type { DataTexture } from 'three'

// Mismo patrón que roadsShader.test.ts: se parchea un LineMaterial REAL y se
// lee el GLSL que sale, no una copia del shader escrita en el test.
function shaderParcheado () {
  const material = new LineMaterial()
  const attr = { needsUpdate: false } as unknown as DataTexture
  patchPickMaterial(material, attr, 164)
  const shader = {
    uniforms: material.uniforms,
    vertexShader: material.vertexShader,
    fragmentShader: material.fragmentShader,
  }
  ;(material as any).onBeforeCompile(shader)
  return shader
}

test('round-trip de ids en todo el rango util', () => {
  for (const i of [0, 1, 255, 256, 26712, 65535, 65536, 16777215]) {
    const [r, g, b] = encodeId(i)
    expect(decodeId(r, g, b)).toBe(i)
  }
})

test('los componentes se mantienen dentro de un byte', () => {
  const [r, g, b] = encodeId(26712)
  for (const c of [r, g, b]) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(256) }
})

test('el id 0 esta reservado para nada', () => {
  expect(decodeId(0, 0, 0)).toBe(0)
})

// La codificación vive DOS veces: en encodeId/decodeId (TypeScript, lo que
// lee pickAt/pickRegion) y en GLSL dentro del fragment shader (lo que escribe
// la GPU). Nada las obliga a coincidir salvo este test, que evalúa el GLSL
// REAL extraído del shader parcheado -- no una copia de la fórmula. Si las
// dos se desincronizan, cada clic devuelve la vía equivocada, en silencio.
test('la codificacion GLSL del id buffer coincide con encodeId', () => {
  const { fragmentShader } = shaderParcheado()
  // se captura también el `/ 255.0`: es parte de la codificación (el shader
  // escribe 0..1, el framebuffer guarda el byte), no un detalle de formato.
  const canales = [...fragmentShader.matchAll(/^\s*(floor\(mod\(.+\)\) \/ 255\.0),$/gm)].map(m => m[1])
  expect(canales).toHaveLength(3)   // r, g, b -- el alfa del id buffer es constante 1.0

  const mod = (a: number, b: number) => a - b * Math.floor(a / b)
  const evaluar = (expr: string, id: number) =>
    new Function('id', 'floor', 'mod', `return ${expr}`)(id, Math.floor, mod) as number

  for (const i of [0, 1, 255, 256, 26711, 65535, 65536]) {
    // el shader suma 1 al índice (0 queda reservado para "nada"), así que la
    // lectura le resta 1 -- se compara contra ese mismo id ya desplazado.
    const bytes = canales.map(c => Math.round(evaluar(c, i + 1) * 255))
    expect(bytes).toEqual(encodeId(i + 1))
    expect(decodeId(bytes[0], bytes[1], bytes[2]) - 1).toBe(i)
  }
})

// El fallo que este test cubre no es visual: el pase de picking dibujaba las
// 26.712 vías siempre, filtradas o no. Con un filtro que dejaba 0 vías (mapa
// vacío) un clic devolvía 1 seleccionada y un lazo 4.817, y el panel de
// edición les escribía PCI con marca de procedencia encima -- sobre vías que
// nunca estuvieron en pantalla.
test('el pase de picking descarta lo que el filtro oculta, igual que el visible', () => {
  const { vertexShader, fragmentShader, uniforms } = shaderParcheado()
  expect(vertexShader).toContain('uniform sampler2D uAttr;')
  expect(vertexShader).toContain('texture2D(uAttr')
  expect(fragmentShader).toContain('varying vec4 vAttr;')
  expect(fragmentShader).toContain('if (visible < 0.5) discard;')
  // sin los uniforms conectados el discard leería una textura vacía y
  // descartaría TODO -- el fallo opuesto, igual de silencioso.
  expect(uniforms.uAttr.value).toBeDefined()
  expect(uniforms.uAttrSize.value).toBe(164)
})
