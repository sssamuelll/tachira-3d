import { test, expect } from 'vitest'
// @ts-ignore -- el proyecto no trae @types/node (tsconfig: types: ["vite/client"])
// y no vale la pena agregarlos por un import de test. vitest corre en Node.
import { readFileSync, statSync } from 'node:fs'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  ASFALTO_GLSL, ASFALTO_UNIFORMS_GLSL, ASFALTO_CUERPO_GLSL, ASFALTO_DESDE_PX, ASFALTO_HASTA_PX,
  MACRO_M, MICRO_M, TINTE_PCI, PCI_SIN_EVALUAR, SOL_POR_DEFECTO, TEXTURAS,
  AMBIENTE, SOL_DIF, AMB_SUELO, NIVEL_CERCA, PISO_NORMA, ANCLA_MOJADO,
} from './asfalto'
import * as THREE from 'three'
import { patchLineMaterial, extrusionGlsl, SOMBRA_VACIA } from './roadsShader'
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
  // El ambiente de cielo: la cara en sombra no puede salir negra. El reparto
  // vive en luzVia (ASFALTO_GLSL); acá se comprueba que la calzada lo llama con
  // su hemisferio y que el suelo nunca aporta cero.
  expect(c).toMatch(/luzVia\(/)
  expect(c).toMatch(/0\.5\s*\+\s*0\.5\s*\*\s*N\.y/)
  expect(AMB_SUELO).toBeGreaterThan(0)
  expect(codigo(ASFALTO_GLSL)).toMatch(/AMBIENTE \* mix\(AMB_SUELO, 1\.0, cielo\)/)
})

// La calzada no pasa por lights_fragment ni por el chunk de CSM: su única luz
// es uSol, y sin consultar el shadow map salía a pleno sol dentro de la sombra
// que la montaña de al lado proyecta sobre el relieve.
test('la calzada consulta la sombra PROYECTADA del relieve, con la cascada más cercana', () => {
  // El mapa es un sampler2DShadow: con PCFShadowMap three lo crea como
  // DepthTexture con compareFunction, y la comparación la hace el hardware.
  expect(ASFALTO_UNIFORMS_GLSL).toContain('uniform sampler2DShadow uSombraMapa;')
  expect(ASFALTO_UNIFORMS_GLSL).toContain('uniform mat4 uSombraMat;')

  const g = codigo(ASFALTO_GLSL)
  expect(g).toMatch(/float sombraSol\s*\(\s*vec3 posW\s*,\s*vec3 n\s*\)/)
  // Sin mapa todavía (el primer cuadro, antes del primer pase de sombra) la
  // calzada va iluminada, no a oscuras.
  expect(g).toMatch(/uSombraOn\s*<\s*0\.5.*return 1\.0/s)
  // El sesgo de normal desplaza el punto de comparación a lo largo de la
  // normal, y el de profundidad se SUMA -- el mismo signo con el que lo suma
  // three en shadowmap_pars_fragment, porque es el mismo número que sombrea el
  // relieve (TerrainLod.tsx).
  expect(g).toMatch(/posW\s*\+\s*n\s*\*\s*uSombraNormalBias/)
  expect(g).toMatch(/\+=\s*uSombraSesgo/)
  // Fuera de la cascada 0 no hay dato: se devuelve luz, no sombra.
  expect(g).toMatch(/return 1\.0;\s*\n\s*return texture\(uSombraMapa/)

  const c = codigo(ASFALTO_CUERPO_GLSL)
  // Se resuelve antes del ancla del mojado: el destello del charco tampoco
  // puede encender dentro de la sombra de la montaña.
  expect(c).toContain('float sombra = sombraSol(vPosW, Ng);')
  // El ancla es un comentario, así que se busca sobre el texto crudo.
  expect(ASFALTO_CUERPO_GLSL.indexOf('float sombra ='))
    .toBeLessThan(ASFALTO_CUERPO_GLSL.indexOf(ANCLA_MOJADO))
  // Y apaga las dos cosas que enciende el sol: el difuso y el especular.
  expect(c).toMatch(/float ndl = max\(dot\(N, uSol\), 0\.0\) \* somBache \* sombra;/)
  expect(c).toMatch(/step\(0\.001, ndl\) \* sombra/)
})

test('el relleno lleva los uniforms de la sombra; el contorno los tiene sin declararlos', () => {
  const r = relleno()
  for (const u of ['uSombraMapa', 'uSombraMat', 'uSombraNormalBias', 'uSombraSesgo', 'uSombraOn']) {
    expect(r.uniforms[u], u).toBeDefined()
    // Roads.tsx escribe en los dos materiales sin averiguar cuál es cuál.
    expect(contorno().uniforms[u], u).toBeDefined()
  }
  // No es null: un sampler2DShadow ligado a nada descarta la llamada de
  // dibujo entera (roadsShader.ts, SOMBRA_VACIA).
  expect(r.uniforms.uSombraMapa.value).toBe(SOMBRA_VACIA)
  expect(SOMBRA_VACIA.compareFunction).toBe(THREE.LessEqualCompare)
  expect(SOMBRA_VACIA.version).toBeGreaterThan(0)
  expect(r.uniforms.uSombraOn.value).toBe(0)
  expect(r.fragmentShader).toContain('uniform sampler2DShadow uSombraMapa;')
  // El contorno es un borde oscuro de unos píxeles: no se ilumina, y un
  // sampler de sombra por fragmento para pintar el mismo gris no se paga.
  expect(contorno().fragmentShader).not.toContain('sampler2DShadow')
})

// El reparto AMBIENTE/SOL_DIF estaba calibrado contra SOL_POR_DEFECTO, que
// Roads.tsx pisa cada cuadro con el sol real de la hora de la escena.
test('la exposición de la calzada de cerca se normaliza al sol REAL, no al de por defecto', () => {
  const g = codigo(ASFALTO_GLSL)
  expect(g).toMatch(/float luzVia\s*\(\s*float ndl\s*,\s*float cielo\s*,\s*float ao\s*\)/)
  // La norma es la irradiancia que recibe una calzada HORIZONTAL con el sol de
  // este cuadro, con piso para no amplificar sin límite de noche.
  expect(g).toMatch(/max\(AMBIENTE \+ SOL_DIF \* max\(uSol\.y, 0\.0\), PISO_NORMA\)/)
  const c = codigo(ASFALTO_CUERPO_GLSL)
  expect(c).toMatch(/luzVia\(ndl, cielo, aoBache\)/)
  // Y ya no queda el reparto suelto que dependía del sol por defecto.
  expect(c).not.toMatch(/0\.42 \* mix\(0\.55/)

  // Los números, con la misma cuenta que hace el shader sobre una calzada
  // horizontal a pleno sol (ndl = uSol.y, cielo = 1, sin oclusión).
  const viejo = (solY: number) => (AMBIENTE + SOL_DIF * Math.max(solY, 0)) * NIVEL_CERCA
  const nuevo = (solY: number) => {
    const norma = Math.max(AMBIENTE + SOL_DIF * Math.max(solY, 0), PISO_NORMA)
    return (AMBIENTE + SOL_DIF * Math.max(solY, 0)) / norma * NIVEL_CERCA
  }
  // Alturas del sol sobre San Cristóbal el 2026-09-05 (sol.ts): 8:00 → 19,1°,
  // 10:00 (la fecha de App.tsx) → 48,8°, 12:00 → 78,4°, 16:00 → 41,9°.
  for (const y of [Math.sin(19.1 * Math.PI / 180), 0.752, 0.980, 0.668]) {
    expect(nuevo(y)).toBeCloseTo(NIVEL_CERCA, 6)
  }
  // Lo que había antes: a las 8 la calzada se oscurecía a la mitad al cruzar
  // los 500 m, y a mediodía salía MÁS clara que el color plano de lejos.
  expect(viejo(Math.sin(19.1 * Math.PI / 180))).toBeLessThan(0.47)
  expect(viejo(0.980)).toBeGreaterThan(NIVEL_CERCA)
  // De noche no se normaliza hasta el nivel de día: el piso lo impide, y la
  // calzada nocturna queda más oscura, que es lo que debe pasar.
  expect(nuevo(-0.7)).toBeLessThan(NIVEL_CERCA)
  expect(nuevo(-0.7)).toBeGreaterThan(viejo(-0.7))
  // Con el sol rasante el piso también topa cuánto puede encenderse un grano
  // de árido encarado al sol.
  expect((AMBIENTE * AMB_SUELO + SOL_DIF) / PISO_NORMA * NIVEL_CERCA).toBeLessThan(1.5)
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
