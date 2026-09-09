import { test, expect } from 'vitest'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { encodeId, decodeId, patchPickMaterial, PICK_WIDTH } from './PickingPass'
import { ANCLA_EXTRUSION_FIN } from './roadsShader'
// Mismo patrón que roadsShader.test.ts: se parchea un LineMaterial REAL y se
// lee el GLSL que sale, no una copia del shader escrita en el test.
function shaderParcheado () {
  const material = new LineMaterial()
  patchPickMaterial(material)
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

// La regla del pase de ids: lo que se dibuja, se puede tocar. Antes este pase
// descartaba lo que el filtro escondía, porque con el filtro había vías
// dibujadas en el id buffer que NO estaban en pantalla: un clic sobre un mapa
// vacío devolvía 1 vía y un lazo 4.817, y la edición masiva les escribía PCI
// encima sin que nadie las hubiera visto. Ya no existe ese filtro -- lo que
// queda fuera del foco se sigue dibujando, más tenue (roadsShader.ts) -- así
// que descartar acá volvería a partir las dos listas en dos, ahora al revés:
// vías visibles que no se pueden seleccionar.
//
// Lo que fija este test es que el pase de ids no consulte la textura de
// atributos. Mientras no la lea, no hay ningún estado que pueda hacer que una
// vía dibujada deje de escribir su id.
test('el pase de picking no consulta la textura de atributos: dibuja todas', () => {
  const { vertexShader, fragmentShader, uniforms } = shaderParcheado()
  expect(vertexShader).toContain('attribute float segId;')
  expect(fragmentShader).toContain('varying float vSegId;')
  expect(vertexShader).not.toContain('uAttr')
  expect(fragmentShader).not.toContain('vAttr')
  expect(uniforms.uAttr).toBeUndefined()
})

// La otra mitad de "lo que se dibuja, se puede tocar". El pase visible apaga
// del todo los niveles menores al alejarse (presencia() llega a 0,
// roadStyle.ts): sin este descarte, a vista de estado el id buffer seguiría
// lleno de calles que no están en pantalla, y un lazo sobre un mapa que se ve
// vacío devolvería miles de vías invisibles a las que la edición masiva les
// escribiría el PCI encima. Es exactamente el bug que documenta el comentario
// de patchPickMaterial, ahora por el lado del acercamiento en vez del filtro.
test('el pase de picking descarta lo que el acercamiento ya apagó', () => {
  const { vertexShader, fragmentShader, uniforms } = shaderParcheado()
  expect(vertexShader).toContain('attribute float aCorte;')
  expect(fragmentShader).toContain('discard')
  // El descarte compara el acercamiento actual contra el corte de la vía, y no
  // al revés: invertir el signo escondería justo lo que sí se ve.
  expect(fragmentShader).toMatch(/if\s*\(\s*uMpp\s*>\s*vCorte\s*\)\s*discard;/)
  expect(uniforms.uMpp).toBeDefined()
})

// Lo que se dibuja se puede tocar, también a 30 m: el pase visible extruye
// cada vía a su ancho en metros, y si el de ids siguiera picando en 8 px
// fijos, una avenida de 400 px solo se seleccionaría por su eje.
test('el pase de ids extruye en metros con la misma fórmula que el visible', () => {
  const { vertexShader, uniforms } = shaderParcheado()
  expect(vertexShader).toContain('attribute float aCalzada;')
  expect(vertexShader).toContain('attribute vec3 instanceNormalStart;')
  expect(vertexShader).toContain('float anchoBase = max( aCalzada, uPisoPx * mppV );')
  expect(vertexShader).not.toContain(ANCLA_EXTRUSION_FIN)
  // El piso del pase de ids es el área de acierto generosa de siempre.
  expect(uniforms.uPisoPx?.value).toBe(PICK_WIDTH)
})

test('el descarte ocurre antes de escribir el id, no después', () => {
  // Un discard después del gl_FragColor no borra lo ya escrito en algunos
  // drivers, y de todos modos pagaría la escritura. Se comprueba el orden real
  // en el GLSL, no la mera presencia de las dos líneas.
  const { fragmentShader } = shaderParcheado()
  expect(fragmentShader.indexOf('discard')).toBeLessThan(fragmentShader.indexOf('float id = vSegId'))
})
