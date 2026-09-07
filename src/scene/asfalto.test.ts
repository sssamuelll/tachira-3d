import { test, expect } from 'vitest'
// @ts-ignore -- el proyecto no trae @types/node (tsconfig: types: ["vite/client"])
// y no vale la pena agregarlos por un import de test. vitest corre en Node.
import { readFileSync, statSync } from 'node:fs'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  ASFALTO_GLSL, ASFALTO_CUERPO_GLSL, ASFALTO_DESDE_PX, ASFALTO_HASTA_PX,
  MACRO_M, MICRO_M, TINTE_PCI, PCI_SIN_EVALUAR, SOL_POR_DEFECTO, TEXTURAS,
} from './asfalto'
import { patchLineMaterial, extrusionGlsl } from './roadsShader'
import { patchPickMaterial } from './PickingPass'
import type { DataTexture } from 'three'

// Mismo patrón que roadsShader.test.ts: se parchea un LineMaterial REAL y se
// lee el GLSL que sale, no un shader inventado a mano.
function realShader (material: LineMaterial) {
  return { uniforms: material.uniforms, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }
}

function relleno () {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  return shader
}

function contorno () {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164, true)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  return shader
}

// Sin comentarios: el GLSL de este módulo explica en prosa justo las palabras
// que estos tests buscan (Heitz, Voronoi, huellas), así que una aserción sobre
// el texto crudo pasaría leyendo un comentario en vez de código.
const codigo = (glsl: string) => glsl.replace(/\/\/.*$/gm, '')

test('el muestreo va en coordenadas de calzada, en metros: u a lo largo, v a lo ancho', () => {
  const c = codigo(ASFALTO_CUERPO_GLSL)
  // u = vDist (metros recorridos), v = t * calzadaM / 2 (metros al eje).
  expect(c).toMatch(/vec2\s+uvM\s*=\s*vec2\(\s*vDist\s*,\s*t\s*\*\s*calzadaM\s*\*\s*0\.5\s*\)/)
  // La calzada en metros llega como varying propio (afín en z, se interpola
  // exacto), no como vCalzadaPx * vMpp, que en la mitad de un tramo vale de
  // más (seccion.test.ts).
  expect(c).toContain('float calzadaM = vCalzadaM;')
})

test('el bloque caro no corre en la franja de hombrillo o brocal, que seccion.ts pinta encima', () => {
  const c = codigo(ASFALTO_CUERPO_GLSL)
  // |t| > 1 es la franja: seis samplers, un Voronoi y el cuenco del bache para
  // un color que seccion.ts sobrescribe entero. Queda el margen de 2 px
  // (un píxel son 2/vCalzadaPx en unidades de t) que el antialiasing del filo
  // sí necesita. `cerca` no se toca: también pesa la mezcla final y la lámina
  // del mojado, y fundirlo dejaría un píxel de color plano en el filo.
  expect(c).toMatch(/if \(cerca > 0\.08 && abs\(t\) < 1\.0 \+ 4\.0 \/ max\(vCalzadaPx, 1\.0\)\)/)
})

// El tamaño de tile no es gusto: es lo que la pantalla puede dibujar. La
// textura tiene 1024 texels de lado; a 30 m de cámara (fov 45, 1000 px de
// alto) un píxel cubre 1,4 cm de calzada en el campo cercano. Si el tile es
// tan chico que caen más de dos o tres texels por píxel, el mipmap promedia
// el grano hasta dejarlo liso y el filtrado anisotrópico se topa y raya la
// calzada a lo largo: los 2 m del brief daban TRECE texels por píxel. Este
// test fija la cuenta, no la cifra.
test('la escala micro se resuelve de verdad a 30 m de cámara, y la macro es otra escala', () => {
  const MPP_30M = 2 * 30 * Math.tan(Math.PI / 8) / 1000
  expect(1024 * MPP_30M / MICRO_M).toBeLessThan(3)
  // ...pero tampoco tan grande que el grano se vuelva manchado de metro.
  expect(MICRO_M).toBeLessThan(20)
  // Dos escalas de verdad, no la misma dos veces.
  expect(MACRO_M / MICRO_M).toBeGreaterThanOrEqual(3)
  const c = codigo(ASFALTO_CUERPO_GLSL)
  expect(c).toContain(`uvM / ${MACRO_M.toFixed(1)}`)
  expect(c).toContain(`uvM / ${MICRO_M.toFixed(1)}`)
})

test('la anti-repetición es la de Heitz y Neyret: rejilla triangular, tres muestras, mezcla que preserva la varianza', () => {
  const c = codigo(ASFALTO_GLSL)
  // 2*sqrt(3): la densidad de la rejilla triangular del paper.
  expect(c).toContain('3.464')
  // La matriz que lleva la rejilla cuadrada a la sesgada (equilátera).
  expect(c).toContain('1.15470054')
  // Tres muestras de la MISMA textura, desplazadas por el hash de cada vértice.
  const muestras = c.match(/texture2D\(\s*tex\s*,/g) ?? []
  expect(muestras.length).toBe(3)
  // La mezcla que preserva la varianza: se resta la media, se pondera y se
  // divide por la norma de los pesos. Sin esa división el promedio de tres
  // muestras baja el contraste y el asfalto sale liso.
  expect(c).toMatch(/inversesqrt\(\s*dot\(\s*w\s*,\s*w\s*\)\s*\)/)
})

test('el PCI gobierna el desgaste, y 255 (sin evaluar) se trata como PCI moderado', () => {
  const c = codigo(ASFALTO_CUERPO_GLSL)
  expect(c).toContain(`float pciEf = pci > 100.5 ? ${PCI_SIN_EVALUAR.toFixed(1)} : pci;`)
  expect(c).toContain('float desgaste = clamp(1.0 - pciEf * 0.01, 0.0, 1.0);')
  expect(PCI_SIN_EVALUAR).toBeGreaterThan(50)
  expect(PCI_SIN_EVALUAR).toBeLessThan(90)
  // Los cuatro deterioros existen y los cuatro miran el desgaste.
  for (const cosa of ['grieta', 'parche', 'bache', 'huella']) {
    expect(c).toContain(cosa)
  }
  expect(c).toMatch(/anchoGr\s*=[^;]*desgaste/)
  expect(c).toMatch(/umbralP\s*=\s*mix\([^;]*desgaste\)/)
  expect(c).toMatch(/esBache\s*=[^;]*desgaste/)
  expect(c).toMatch(/rodada\s*=\s*huellas\s*\*\s*desgaste/)
})

test('el tinte del PCI entra multiplicando, que es lo único que conserva el matiz de la rampa ASTM', () => {
  expect(TINTE_PCI).toBeGreaterThan(0.5)
  expect(TINTE_PCI).toBeLessThanOrEqual(1)
  const c = codigo(ASFALTO_CUERPO_GLSL)
  // `base` ya trae pciColor() (o el azul de selección) cuando este bloque
  // corre: se modula por el grano, no se sustituye.
  expect(c).toMatch(/vec3 asf = mix\(\s*muestra\s*,\s*base\s*\*\s*grano\s*,\s*[\d.]+\s*\)/)
  expect(c).toContain(TINTE_PCI.toFixed(2))
  expect(c).not.toMatch(/asf\s*=\s*muestra\s*;/)
})

test('todo el asfalto vive por encima de un umbral de píxeles, con transición continua al color plano', () => {
  expect(ASFALTO_DESDE_PX).toBeGreaterThanOrEqual(12)
  expect(ASFALTO_HASTA_PX).toBeGreaterThan(ASFALTO_DESDE_PX)
  const c = codigo(ASFALTO_CUERPO_GLSL)
  expect(c).toContain(`smoothstep(${ASFALTO_DESDE_PX.toFixed(1)}, ${ASFALTO_HASTA_PX.toFixed(1)}, vCalzadaPx)`)
  // El bloque entero va dentro de un if: a vista de estado no se ejecuta ni
  // una muestra de textura de las 26.712 vías.
  expect(c).toMatch(/if\s*\(\s*cerca\s*>\s*0\.\d+\s*&&/)
  // Y lo que sale se mezcla contra el color plano de hoy, no lo reemplaza.
  expect(c).toMatch(/base\s*=\s*mix\(\s*base\s*,\s*luz\s*,\s*cerca\s*\)/)
})

test('el relleno declara los uniforms de las texturas y el sol; el contorno no lleva asfalto pero sí uSol', () => {
  const r = relleno()
  for (const u of ['uAlbedo', 'uNormalMap', 'uRough', 'uSol', 'uAsfaltoOn']) {
    expect(r.uniforms[u], u).toBeDefined()
  }
  expect(r.fragmentShader).toContain('uniform sampler2D uAlbedo;')
  expect(r.fragmentShader).toContain('uniform vec3 uSol;')
  expect(r.fragmentShader).toContain('float desgaste')

  // El sol por defecto es unitario y viene de arriba: otro agente lo alimenta
  // por cuadro, pero sin él el asfalto tiene que verse igual de iluminado.
  const sol = r.uniforms.uSol.value as { x: number; y: number; z: number }
  expect(Math.hypot(sol.x, sol.y, sol.z)).toBeCloseTo(1, 5)
  expect(sol.y).toBeGreaterThan(0.5)

  const c = contorno()
  // El contorno es un borde oscuro: no se texturiza. Pero el uniform existe
  // igual, para que quien alimente uSol pueda escribir en los dos materiales
  // sin comprobar cuál es cuál.
  expect(c.uniforms.uSol).toBeDefined()
  expect(c.fragmentShader).not.toContain('float desgaste')
  expect(c.fragmentShader).not.toContain('voronoi')
})

test('el marco tangente de la calzada viaja en ejes del MUNDO, y solo en el pase visible', () => {
  const r = relleno()
  for (const v of ['vDirW', 'vTerrW', 'vPosW']) {
    expect(r.vertexShader, v).toContain(`varying vec3 ${v};`)
    expect(r.fragmentShader, v).toContain(`varying vec3 ${v};`)
  }
  // De cámara a mundo con la traspuesta de la rotación de viewMatrix: v * M en
  // GLSL es M^T * v, y para una cámara sin escala la traspuesta ES la inversa.
  expect(r.vertexShader).toMatch(/vDirW\s*=\s*dirV\s*\*\s*mat3\(\s*viewMatrix\s*\)/)
  expect(r.vertexShader).toMatch(/vPosW\s*=\s*\(\s*eje\.xyz\s*-\s*viewMatrix\[3\]\.xyz\s*\)\s*\*\s*mat3\(\s*viewMatrix\s*\)/)

  // El bloque compartido con el pase de ids NO puede traerlos: PickingPass
  // reutiliza extrusionGlsl sin colofón y sin declararlos.
  const compartido = extrusionGlsl(false)
  for (const v of ['vDirW', 'vTerrW', 'vPosW']) expect(compartido).not.toContain(v)
  const pick = new LineMaterial()
  patchPickMaterial(pick)
  const ps = realShader(pick)
  ;(pick as any).onBeforeCompile(ps)
  expect(ps.vertexShader).not.toContain('vDirW')
  expect(ps.fragmentShader).not.toContain('uAlbedo')
})

test('la iluminación usa la normal perturbada, un especular con la rugosidad y un ambiente que no es negro', () => {
  const c = codigo(ASFALTO_CUERPO_GLSL)
  expect(c).toMatch(/dot\(\s*N\s*,\s*uSol\s*\)/)          // difuso N·L
  expect(c).toMatch(/normalize\(\s*cameraPosition\s*-\s*vPosW\s*\)/)  // vista, para el especular
  expect(c).toMatch(/pow\(\s*max\(\s*dot\(\s*N\s*,\s*H\s*\)/)         // Blinn-Phong
  expect(c).toContain('rug')                                           // con la rugosidad del mapa
  // El ambiente de cielo: la cara en sombra no puede salir negra.
  expect(c).toMatch(/AMBIENTE|ambiente/)
  expect(c).toMatch(/0\.5\s*\+\s*0\.5\s*\*\s*N\.y/)
})

test('las marcas viales van ENCIMA del asfalto y se gastan con el PCI', () => {
  const f = relleno().fragmentShader
  // El asfalto se resuelve antes: las marcas se pintan sobre él.
  expect(f.indexOf('float desgaste')).toBeLessThan(f.indexOf('float canales'))
  expect(f.indexOf('float desgaste')).toBeGreaterThan(f.indexOf('vec3 base = mix(pciColor(pci)'))
  // Y la pintura se come con el desgaste, por manchas y no de forma uniforme.
  expect(f).toMatch(/float viva\s*=[^;]*desgaste/)
  expect(f).toMatch(/ruido\(/)
})

test('las texturas de asfalto están en el repo, comprimidas y con su licencia CC0', () => {
  const dir = new URL('../../public/texturas/asfalto/', import.meta.url)
  for (const nombre of Object.values(TEXTURAS)) {
    const bytes = statSync(new URL(nombre, dir)).size
    expect(bytes, nombre).toBeGreaterThan(1000)
    expect(bytes, nombre).toBeLessThan(2 * 1024 * 1024)
  }
  const licencia = readFileSync(new URL('LICENSE.md', dir), 'utf8')
  expect(licencia).toContain('CC0')
  expect(licencia).toContain('ambientCG')
  expect(licencia).toContain('Asphalt006')
})

test('SOL_POR_DEFECTO es unitario', () => {
  expect(Math.hypot(...SOL_POR_DEFECTO)).toBeCloseTo(1, 6)
})
