import { test, expect } from 'vitest'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  avanzarMojado, MOJADO_SEG, MOJADO_GLSL, bacheCuerpoGlsl,
  MOJADO_CUERPO_GLSL, MOJADO_LAMINA_GLSL, CIELO_POR_DEFECTO,
  BACHE_R_M, BACHE_HONDO_M, BACHE_PARED, CHARCO_RUG, FRESNEL0, POROSIDAD,
  RUG_MOJADA, BOMBEO, BOMBEO_PESO, NIVEL_SECO, NIVEL_LLENO,
} from './mojado'
import { ASFALTO_CUERPO_GLSL, ANCLA_MOJADO, BACHE_TASA, GRIETA_M } from './asfalto'

// Con los MISMOS números que asfalto.ts le pasa: si alguien cambia la tasa de
// baches o el tamaño de celda, este test sigue mirando el GLSL de verdad.
const BACHE_CUERPO_GLSL = bacheCuerpoGlsl(BACHE_TASA, GRIETA_M)
import { patchLineMaterial } from './roadsShader'
import { BOMBEO as BOMBEO_SECCION } from './seccion'
import type { DataTexture } from 'three'

// Mismo patrón que asfalto.test.ts: se parchea un LineMaterial REAL y se lee
// el GLSL que sale, no un shader inventado a mano.
function realShader (material: LineMaterial) {
  return { uniforms: material.uniforms, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }
}
function pase (casing: boolean) {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164, casing)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  return shader
}
const relleno = () => pase(false)
const contorno = () => pase(true)

// Sin comentarios: la prosa de este GLSL nombra justo las palabras que estos
// tests buscan (charco, Fresnel, cuenco), así que una aserción sobre el texto
// crudo pasaría leyendo un comentario en vez de código.
const codigo = (glsl: string) => glsl.replace(/\/\/.*$/gm, '')

// ---------------------------------------------------------------- transición

test('uMojado sube de seco a mojado en MOJADO_SEG segundos, y baja igual', () => {
  let v = 0
  for (let i = 0; i < 100; i++) v = avanzarMojado(v, 1, MOJADO_SEG / 100)
  expect(v).toBeCloseTo(1, 6)
  // A mitad de camino va por la mitad: la rampa es lineal, no un salto.
  let m = 0
  for (let i = 0; i < 50; i++) m = avanzarMojado(m, 1, MOJADO_SEG / 100)
  expect(m).toBeCloseTo(0.5, 3)
  for (let i = 0; i < 100; i++) v = avanzarMojado(v, 0, MOJADO_SEG / 100)
  expect(v).toBeCloseTo(0, 6)
})

test('avanzarMojado llega EXACTO al objetivo y no lo pasa de largo', () => {
  // Sin el corte, un dt que no divide al intervalo deja el uniform temblando
  // alrededor de 1 para siempre.
  expect(avanzarMojado(0.99, 1, 1)).toBe(1)
  expect(avanzarMojado(0.01, 0, 1)).toBe(0)
  expect(avanzarMojado(1, 1, 0.016)).toBe(1)
})

test('un dt enorme (volver de otra pestaña) no salta el mojado de golpe', () => {
  // requestAnimationFrame se para en una pestaña de fondo: al volver, dt puede
  // ser de minutos. Sin tope, la lluvia aparece de un cuadro al otro.
  const v = avanzarMojado(0, 1, 600)
  expect(v).toBeGreaterThan(0)
  expect(v).toBeLessThan(0.3)
})

// ------------------------------------------------------------------- números

test('las constantes del agua son las del modelo, no números sueltos', () => {
  // Fresnel del agua a incidencia normal: ((1.33-1)/(1.33+1))² = 0,020.
  expect(FRESNEL0).toBeCloseTo(0.02, 3)
  // Una lámina de agua es casi un espejo, pero no un espejo perfecto.
  expect(CHARCO_RUG).toBeGreaterThan(0)
  expect(CHARCO_RUG).toBeLessThan(0.06)
  // El asfalto es de los materiales más porosos que hay: se oscurece fuerte.
  expect(POROSIDAD).toBeGreaterThan(0.25)
  expect(POROSIDAD).toBeLessThan(1)
  // Mojada, la superficie va HACIA lo especular, nunca hacia lo mate.
  expect(RUG_MOJADA).toBeLessThan(1)
  expect(RUG_MOJADA).toBeGreaterThan(0)
  // Bombeo de norma: 2 % del eje al borde, y EL MISMO con el que seccion.ts
  // inclina la normal de la calzada: si el agua embalsara con una pendiente y
  // la luz cayera con otra, el charco se leería en el sitio equivocado. No se
  // importa de allá por el ciclo asfalto -> mojado -> seccion -> asfalto.
  expect(BOMBEO).toBeCloseTo(0.02, 4)
  expect(BOMBEO).toBe(BOMBEO_SECCION)
  // ...pero no entra entero: un bombeo real drena, no embalsa.
  expect(BOMBEO_PESO).toBeGreaterThan(0)
  expect(BOMBEO_PESO).toBeLessThan(1)
  // El nivel del agua sube con la lluvia: seco por debajo de todo hueco.
  expect(NIVEL_SECO).toBeLessThan(-BACHE_HONDO_M)
  expect(NIVEL_LLENO).toBeGreaterThan(NIVEL_SECO)
  // El cielo por defecto es más brillante que la calzada (que promedia ~0,35
  // en esta escala) o el charco no reflejaría nada, y es azul.
  expect(Math.min(...CIELO_POR_DEFECTO)).toBeGreaterThan(1)
  expect(CIELO_POR_DEFECTO[2]).toBeGreaterThan(CIELO_POR_DEFECTO[0])
})

test('el bache es un hueco con proporciones de bache, no un cráter', () => {
  // 60 cm de boca: el bache de una avenida urbana, no un socavón.
  expect(BACHE_R_M).toBeGreaterThan(0.15)
  expect(BACHE_R_M).toBeLessThan(0.5)
  // Y hondo de verdad, pero mucho menos que ancho: si la hondura se acerca al
  // radio, el paralaje se sale del cuenco y la silueta se rompe.
  expect(BACHE_HONDO_M).toBeGreaterThan(0.02)
  expect(BACHE_HONDO_M).toBeLessThan(BACHE_R_M * 0.4)
  // La pared arranca pasada la mitad: fondo plano, pared corta y empinada.
  expect(BACHE_PARED).toBeGreaterThan(0.5)
  expect(BACHE_PARED).toBeLessThan(0.9)
  // La pendiente máxima de esa pared, en grados: una pared, no una rampa.
  const pendMax = BACHE_HONDO_M * 1.5 / ((1 - BACHE_PARED) * BACHE_R_M)
  expect(Math.atan(pendMax) * 180 / Math.PI).toBeGreaterThan(25)
})

// ----------------------------------------------------------------- el cuenco

test('el bache se traza analíticamente contra el cuenco: una cuadrática, un sqrt, cero pasos', () => {
  const c = codigo(MOJADO_GLSL)
  // La forma ESTABLE de la raíz positiva: -2C / (B + sqrt(B²-4AC)). La otra
  // ((-B+sqrt)/2A) se cancela cuando A -> 0, que es justo la vista cenital.
  expect(c).toMatch(/-2\.0\s*\*\s*C\s*\/\s*max\(\s*B\s*\+\s*sqrt\(/)
  // Un solo sqrt en todo el trazado, y ni un bucle de pasos de textura.
  expect((c.match(/sqrt\(/g) ?? []).length).toBe(1)
  expect(c).not.toMatch(/for\s*\(/)
  // La sombra propia sale de la MISMA cuadrática y ni siquiera necesita raíz:
  // la segunda intersección del rayo al sol es un cociente.
  expect(c).toMatch(/sombraCuenco/)
})

test('el relieve del bache solo se paga en fragmentos de bache y se apaga cuando no cabe en un píxel', () => {
  const c = codigo(BACHE_CUERPO_GLSL)
  // El if es la frontera del presupuesto: fuera de una celda de bache no se
  // traza nada.
  expect(c).toMatch(/if\s*\(\s*esBache\s*>\s*0\.5/)
  // Y el paralaje se desvanece con el tamaño del cuenco en píxeles, medido con
  // la misma huella (fwidth) que usa el asfalto para su `nitidez`.
  expect(c).toMatch(/huellaM/)
  expect(c).toMatch(/vis\s*=\s*smoothstep\(/)
  // El desplazamiento del punto visto va escalado por esa visibilidad: a lo
  // lejos el paralaje es cero y el bache vuelve a ser la mancha de antes.
  expect(c).toMatch(/k\s*\*\s*vis/)
})

test('el cuenco deja en scope lo que la iluminación necesita: hondura, oclusión, sombra y pendiente', () => {
  const c = codigo(BACHE_CUERPO_GLSL)
  for (const v of ['float hondura', 'float aoBache', 'float somBache', 'vec2 pendB']) {
    expect(c, v).toContain(v)
  }
  // Y el bache sigue siendo el float que el asfalto ya oscurecía.
  expect(c).toMatch(/bache\s*=/)
})

// ------------------------------------------------------------------- mojado

test('el mojado es el modelo de Lagarde: albedo a una potencia por porosidad, rugosidad hacia lo especular', () => {
  const c = codigo(MOJADO_CUERPO_GLSL)
  // El oscurecimiento NO es un factor: es un exponente. Es lo que hace que un
  // asfalto oscuro se oscurezca poco y uno claro mucho, que es la física del
  // poro lleno de agua.
  expect(c).toMatch(/asf\s*=\s*pow\(/)
  expect(c).toContain(POROSIDAD.toFixed(2))
  // La rugosidad baja, nunca sube.
  expect(c).toMatch(/rug\s*=\s*clamp\(\s*mix\(\s*rug\s*,\s*rug\s*\*/)
  expect(c).toContain(RUG_MOJADA.toFixed(2))
})

test('el charco es una lámina plana con Fresnel de Schlick sobre la normal GEOMÉTRICA', () => {
  const c = codigo(MOJADO_CUERPO_GLSL)
  // Schlick: F0 + (1-F0)(1-cos)^5.
  expect(c).toMatch(/pow\(\s*1\.0\s*-\s*max\(\s*dot\(\s*Ng\s*,\s*V\s*\)[^;]*5\.0\s*\)/)
  expect(c).toContain(FRESNEL0.toFixed(3))
  // El agua no copia el grano del asfalto: la lámina es plana, y por eso
  // refleja con Ng y no con la normal perturbada N.
  expect(c).toMatch(/reflect\(\s*-\s*V\s*,\s*Ng\s*\)/)
  expect(c).not.toMatch(/reflect\(\s*-\s*V\s*,\s*N\s*\)/)
  // Y el destello del sol va con la dureza que corresponde a esa rugosidad.
  expect(c).toContain(CHARCO_RUG.toFixed(2))
  expect(c).toMatch(/uCielo/)
})

// Un charco dentro de la sombra de una montaña refleja el cielo, no el sol: es
// lo más visible del hallazgo, porque el destello es un lóbulo de exponente
// 2.000 y encendido dentro de la sombra se lee como una lámpara.
test('el destello del sol en el charco no enciende dentro de la sombra proyectada', () => {
  const c = codigo(MOJADO_CUERPO_GLSL)
  expect(c).toMatch(/step\(0\.001, dot\(Ng, uSol\)\)\s*\*\s*sombra/)
  // El reflejo del CIELO sí se queda: una superficie en sombra sigue mojada.
  const espejo = c.slice(c.indexOf('cieloRef'))
  expect(espejo).not.toMatch(/cieloRef[^;]*\*\s*sombra/)
})

test('el agua se embalsa donde una calzada se embalsa: huellas, baches y zonas bajas, con el nivel subiendo con uMojado', () => {
  const c = codigo(MOJADO_CUERPO_GLSL)
  expect(c).toMatch(/cota\s*=/)
  expect(c).toMatch(/huellas/)      // las rodadas
  expect(c).toMatch(/hondura/)      // el fondo del bache
  expect(c).toMatch(/1\.0\s*-\s*t\s*\*\s*t/)   // el bombeo, parabólico
  // Las zonas bajas salen del fBm que asfalto.ts YA calcula para grietas y
  // parches, no de uno propio (un fBm nuevo costaba doce hashes por fragmento
  // y 20 fps a 125 m). Y entra MULTIPLICANDO la hondura de la huella, no
  // sumándose aparte: es lo que ROMPE la banda. Con la huella y el bombeo
  // solos, `cota` es función de la transversal sola y el charco sale en
  // franjas rectas de kilómetros paralelas al eje -- medido en pantalla. Un
  // primer intento con `zona` en los dos sitios a la vez, modulando y
  // desplazando, se cancelaba consigo mismo y dejaba la banda igual.
  expect(c).toMatch(/poza\s*=\s*smoothstep\([^;]*zona\s*\)/)
  expect(c).toMatch(/huellas[^;]*\*\s*poza/)
  expect(c).not.toMatch(/fbm\(/)
  expect(c).toMatch(/nivel\s*=\s*mix\([^;]*uMojado\s*\)/)
  // El charco es el agua por encima de la cota: por debajo del nivel, agua.
  expect(c).toMatch(/charco\s*=\s*\(\s*1\.0\s*-\s*smoothstep\(\s*nivel/)
})

test('nada del charco se dibuja si no cabe en un píxel: filo por fwidth y desvanecido por nitidez', () => {
  const c = codigo(MOJADO_CUERPO_GLSL)
  // El borde del charco se antialiasea con la derivada REAL de la cota en
  // pantalla, no con una constante en metros: un charco visto de refilón tiene
  // el filo estirado en un eje y no en el otro.
  expect(c).toMatch(/fwidth\(\s*cota\s*\)/)
  // Y un charco más chico que un píxel se apaga entero, con el mismo criterio
  // (y la misma variable) con que el asfalto apaga su grano.
  expect(c).toMatch(/nitidez/)
})

test('el mojado no cuesta nada en seco', () => {
  const c = codigo(MOJADO_CUERPO_GLSL)
  // El pow del albedo, el reflect, el pow del Fresnel y el pow del destello
  // viven todos dentro de este if: con el botón apagado el pase de relleno
  // vuelve a costar lo que costaba.
  expect(c).toMatch(/if\s*\(\s*uMojado\s*>\s*0\.\d+\s*\)/)
  const dentro = c.slice(c.indexOf('if (uMojado'))
  for (const cosa of ['reflect(', 'uCielo', 'pow(']) expect(dentro).toContain(cosa)
})

// -------------------------------------------------------------- la inyección

test('el ancla del mojado existe una sola vez en el asfalto, entre la normal y la iluminación', () => {
  const a = ASFALTO_CUERPO_GLSL
  expect((a.match(new RegExp(ANCLA_MOJADO, 'g')) ?? []).length).toBe(1)
  // Después de que asf, rug y N están calculados...
  expect(a.indexOf(ANCLA_MOJADO)).toBeGreaterThan(a.indexOf('vec3 N = normalize('))
  expect(a.indexOf(ANCLA_MOJADO)).toBeGreaterThan(a.indexOf('vec3 asf = mix('))
  // ...y antes de que se ilumine: el mojado cambia asf, rug y N, y la luz
  // tiene que ver los valores ya cambiados.
  expect(a.indexOf(ANCLA_MOJADO)).toBeLessThan(a.indexOf('float ndl ='))
})

test('el pase de relleno lleva el mojado inyectado en el ancla, y el contorno no lleva nada', () => {
  const r = relleno().fragmentShader
  expect(r).toContain('uniform float uMojado;')
  expect(r).toContain('uniform vec3 uCielo;')
  expect(r).not.toContain(ANCLA_MOJADO)          // el ancla se consumió
  expect(r).toContain('float charco')            // ...y en su lugar está el cuerpo
  // El orden real en el shader compilado, no el de los strings sueltos.
  expect(r.indexOf('float charco')).toBeGreaterThan(r.indexOf('vec3 N = normalize('))
  expect(r.indexOf('float charco')).toBeLessThan(r.indexOf('float ndl ='))

  const c = contorno().fragmentShader
  expect(c).not.toContain('float charco')
  expect(c).not.toContain('sombraCuenco')
  // Los uniforms sí van en los dos, como uSol: Roads.tsx escribe en los dos
  // materiales sin averiguar cuál es cuál.
  expect(contorno().uniforms.uMojado).toBeDefined()
  expect(relleno().uniforms.uMojado).toBeDefined()
  expect(relleno().uniforms.uCielo).toBeDefined()
})

test('la lámina de agua se suma DESPUÉS de la pintura: el agua tapa la raya, no al revés', () => {
  const r = relleno().fragmentShader
  expect(r).toContain(codigo(MOJADO_LAMINA_GLSL).trim().split('\n').pop()!.trim())
  // espMojado se declara FUERA del if del asfalto -- si no, no existe donde se
  // pinta la demarcación.
  expect(r).toMatch(/vec3 espMojado = vec3\(0\.0\);/)
  expect(r.indexOf('vec3 espMojado')).toBeLessThan(r.indexOf('if (cerca >'))
  expect(r.lastIndexOf('espMojado')).toBeGreaterThan(r.indexOf('float canales'))
})

test('el Voronoi devuelve además hacia dónde queda el centro de la celda: sin eso no hay cuenco que trazar', () => {
  const r = relleno().fragmentShader
  // La firma cambió en asfalto.ts (out vec2): es el único dato que faltaba
  // para saber en qué parte del bache cae este fragmento.
  expect(r).toMatch(/vec3 voronoi\s*\(\s*vec2 p\s*,\s*out vec2 desdeF1\s*\)/)
  expect(r).toMatch(/voronoi\(\s*uvM\s*\/\s*[\d.]+\s*,\s*desdeF1\s*\)/)
})
