import { test, expect } from 'vitest'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  patchLineMaterial, ANCLA_VERT, ANCLA_FRAG, PCI_COLOR_GLSL, LIBERTY_GLSL, esRellenoDeVia,
  ANCLA_EXTRUSION_INICIO, ANCLA_EXTRUSION_FIN, extrusionGlsl, parcharExtrusion,
  FLECHA_M, CABEZA_M, CABEZA_ANCHO_M, TALLO_M, FLECHA_CICLO_M, ALZA_MIN_M,
} from './roadsShader'
import { ERROR_PX } from './quadtree'
import { patchPickMaterial } from './PickingPass'
import { PCI_RANGES, pciColor, LIBERTY } from '../data/constants'
import type { DataTexture } from 'three'

type Rule =
  | { op: '>' | '>='; threshold: number; color: number[] }
  | { fallback: true; color: number[] }

// Reconstruye, leyendo el texto GLSL generado (no reimplementando el
// generador), la misma cascada de if/return que ejecutaría el shader para un
// `pci` escalar. Es lo que permite comparar la salida REAL contra pciColor()
// en vez de comparar dos copias del mismo algoritmo.
function parseCascade (glsl: string): Rule[] {
  const rules: Rule[] = []
  for (const line of glsl.split('\n')) {
    const cond = line.match(/if \(pci (>=?) ([\d.]+)\) return vec3\(([^)]+)\);/)
    if (cond) {
      rules.push({ op: cond[1] as '>' | '>=', threshold: Number(cond[2]), color: cond[3].split(',').map(Number) })
      continue
    }
    const fallback = line.match(/^\s*return vec3\(([^)]+)\);/)
    if (fallback) rules.push({ fallback: true, color: fallback[1].split(',').map(Number) })
  }
  return rules
}

function pickColor (rules: Rule[], pci: number): number[] {
  for (const r of rules) {
    if ('fallback' in r) return r.color
    if (r.op === '>' ? pci > r.threshold : pci >= r.threshold) return r.color
  }
  throw new Error(`ninguna regla de la cascada cubrió pci=${pci}`)
}

test('el GLSL generado coincide con pciColor() en los 101 PCI enteros mas el centinela', () => {
  const rules = parseCascade(PCI_COLOR_GLSL)
  for (let pci = 0; pci <= 100; pci++) {
    expect(pickColor(rules, pci)).toEqual(pciColor(pci))
  }
  expect(pickColor(rules, 255)).toEqual(pciColor(255)) // 255 = centinela, ver encodeAttr
})

// El generador (roadsShader.ts) asume que PCI_RANGES viene ordenado
// descendente por `min` y que el último rango llega hasta 0 -- son los dos
// supuestos de los que depende leer la cascada como "el primero que matchea
// gana". pciRange()/pciColor() en TypeScript usan .find() sobre [min,max]
// completo y son insensibles al orden, así que nada más protege esto: si se
// reordena o se agrega un rango, TypeScript sigue correcto y el shader se
// desincroniza en silencio. Esta aserción fija el supuesto.
test('PCI_RANGES esta ordenado de mayor a menor por min, y el ultimo llega a 0', () => {
  for (let i = 1; i < PCI_RANGES.length; i++) {
    expect(PCI_RANGES[i].min).toBeLessThan(PCI_RANGES[i - 1].min)
  }
  expect(PCI_RANGES[PCI_RANGES.length - 1].min).toBe(0)
})

// Envuelve un LineMaterial REAL (no un shader inventado a mano) tal como lo
// recibiría onBeforeCompile de verdad -- así una actualización de three que
// mueva las anclas la agarra este test, no un usuario mirando un mapa mudo.
function realShader (material: LineMaterial) {
  return { uniforms: material.uniforms, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }
}

test('las anclas existen de verdad en el LineMaterial instalado', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  expect(() => (material as any).onBeforeCompile(shader)).not.toThrow()
  expect(shader.vertexShader).toContain('attribute float segId;')
  expect(shader.fragmentShader).toContain('vAttr.r')
})

// El bug que este test fija se ve solo mirando el mapa: compila, dibuja, y
// pinta las 26.712 vías del color del contorno porque three reutilizó el
// programa del primer material que compiló. Ninguna aserción sobre el GLSL
// generado lo agarra -- el GLSL de los dos es correcto; lo que colisiona es la
// clave con la que three decide si ya tiene ese programa compilado.
test('contorno, relleno y picking piden programas distintos a three', () => {
  const relleno = new LineMaterial()
  const contorno = new LineMaterial()
  const picking = new LineMaterial()
  patchLineMaterial(relleno, {} as DataTexture, 164)
  patchLineMaterial(contorno, {} as DataTexture, 164, true)
  patchPickMaterial(picking)
  const claves = [relleno, contorno, picking].map(m => m.customProgramCacheKey())
  expect(new Set(claves).size).toBe(3)
})

test('el contorno no lleva color de PCI y el relleno sí', () => {
  const contorno = new LineMaterial()
  patchLineMaterial(contorno, {} as DataTexture, 164, true)
  const shader = realShader(contorno)
  ;(contorno as any).onBeforeCompile(shader)
  expect(shader.fragmentShader).not.toContain('base = mix(pciColor(pci)')
  // …pero sí comparte foco, selección y procedencia con el relleno: es el
  // mismo trazo, dibujado dos veces.
  expect(shader.fragmentShader).toContain('float enfoque')
  expect(shader.fragmentShader).toContain('selected')
})

// La extrusión en metros reemplaza el bloque de desplazamiento en pantalla
// de three. Si three lo mueve o lo renombra, esto tiene que reventar acá y no
// en un mapa donde las vías salen de ancho cero.
test('las anclas de la extrusión existen, una vez y en orden, en el LineMaterial instalado', () => {
  const { vertexShader } = new LineMaterial()
  const a = vertexShader.indexOf(ANCLA_EXTRUSION_INICIO)
  const b = vertexShader.indexOf(ANCLA_EXTRUSION_FIN)
  expect(a).toBeGreaterThan(-1)
  expect(b).toBeGreaterThan(a)
  expect(vertexShader.lastIndexOf(ANCLA_EXTRUSION_INICIO)).toBe(a)
  expect(vertexShader.lastIndexOf(ANCLA_EXTRUSION_FIN)).toBe(b)
})

test('el vertex shader parcheado extruye en metros y ya no desplaza en píxeles', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  expect(shader.vertexShader).not.toContain(ANCLA_EXTRUSION_FIN)
  expect(shader.vertexShader).not.toContain('offset *= linewidth;')
  expect(shader.vertexShader).toContain('float mppV')
  expect(shader.vertexShader).toContain('attribute float aCalzada;')
  // Lo que el fragment necesita, calculado por vértice y no por uniform.
  for (const v of ['vCalzadaPx', 'vAnchoPx', 'vMpp']) {
    expect(shader.vertexShader).toContain(`varying float ${v};`)
    expect(shader.fragmentShader).toContain(`varying float ${v};`)
  }
  expect(shader.uniforms.uMpp).toBeUndefined()
  expect(shader.uniforms.uBandaPx).toBeUndefined()
  expect(shader.uniforms.uPisoPx).toBeDefined()
})

// El lado de la extrusión tiene que ser la DERECHA del sentido de marcha:
// position.x = +1 va a la derecha en el cuadrilátero de LineSegmentsGeometry
// y así sus triángulos salen antihorarios vistos desde arriba. Con la
// izquierda (cross(arriba, dir)) el cuadrilátero queda espejado, sus caras
// miran al suelo y el descarte de caras traseras se traga la red ENTERA sin
// error de compilación ni de enlace. Se vio en pantalla: mapa sin una sola
// vía, con 450.261 tramos dibujándose.
test('la extrusión va hacia la derecha del sentido de marcha, no hacia la izquierda', () => {
  // Sin los comentarios del GLSL: el de la extrusión cuenta justo este bug.
  const codigo = extrusionGlsl(false).replace(/\/\/.*$/gm, '')
  expect(codigo).toMatch(/cross\(\s*dirV\s*,\s*terrV\s*\)/)
  expect(codigo).not.toMatch(/cross\(\s*terrV\s*,\s*dirV\s*\)/)
})

// La calzada se extruye en el plano del terreno (normal por extremo, del
// pipeline) y se levanta la tolerancia del LOD: si el relieve dibujado se
// aparta menos de ERROR_PX de la superficie real, nunca la tapa.
test('la extrusión va en el plano del terreno y se levanta ERROR_PX píxeles, nunca menos de ALZA_MIN_M', () => {
  const g = extrusionGlsl(false).replace(/\/\/.*$/gm, '')
  expect(g).toContain('instanceNormalStart')
  expect(g).toContain('instanceNormalEnd')
  // En píxeles a lo lejos (la tolerancia del LOD), en metros de cerca (lo que
  // el pipeline deja de hundimiento al partir los tramos, scripts/lib/subdividir.mjs).
  expect(g).toContain(`max( ${ERROR_PX.toFixed(1)} * mppV, ${ALZA_MIN_M.toFixed(2)} )`)
  expect(ALZA_MIN_M).toBeGreaterThan(0.1)
  expect(ALZA_MIN_M).toBeLessThan(0.5)
  // Sin el ajuste de profundidad al eje de three: una calzada inclinada con
  // la ladera lo necesita fuera (ver el comentario en extrusionGlsl).
  expect(g).not.toContain('clipPose')
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  expect(shader.vertexShader).toContain('attribute vec3 instanceNormalStart;')
  expect(shader.vertexShader).toContain('attribute vec3 instanceNormalEnd;')
})

// El cuadrilátero de LineSegmentsGeometry tiene position.y en {-1, 0, 1, 2}:
// el cuerpo del tramo es [0,1] y las tapas redondas [-1,0] y [1,2]. Los dos
// vértices de una tapa caen del mismo lado de la prueba `position.y < 0.5` con
// que ATTR_VERT_GLSL elige d0 o d1, así que vDist sale CONSTANTE en toda la
// tapa -- media calzada de largo, 3,4 m en una avenida. Todo lo que se calcula
// sobre la coordenada a lo largo de la vía (asfalto, grietas, parches) se
// degenera ahí en una función de la transversal sola, y en pantalla son vetas
// paralelas a la calzada con el borde redondo de la tapa. Se vio en las
// capturas a 30 m antes de encontrarse la causa.
test('vDist sigue corriendo por las tapas del tramo en vez de congelarse', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  const v = shader.vertexShader.replace(/\/\/.*$/gm, '')
  expect(v).toMatch(/vDist \+= hw \* \(\s*position\.y < 0\.0 \? position\.y : \(\s*position\.y > 1\.0 \? position\.y - 1\.0 : 0\.0\s*\)\s*\)/)
  // El pase de ids no lo necesita ni lo lleva: reutiliza la extrusión sin
  // colofón y no tiene coordenada de calzada que calcular.
  expect(extrusionGlsl(false)).not.toContain('vDist')
})

// El relleno se extruye del ancho TOTAL de la sección (calzada + hombrillo o
// brocal, seccion.ts) y el contorno de eso más su borde: si el contorno se
// calculara sobre la calzada pelada quedaría por dentro del hombrillo, o sea
// una raya oscura atravesando la grava.
test('el contorno se extruye más ancho que el relleno; el relleno, de la sección entera', () => {
  expect(extrusionGlsl(false)).toContain('float anchoM = anchoTot;')
  expect(extrusionGlsl(true)).toMatch(/float anchoM = anchoTot \+ min\(/)
  // Y la calzada sigue siendo la calzada: es la referencia de las marcas.
  expect(extrusionGlsl(false)).toContain('float anchoBase = max( aCalzada, uPisoPx * mppV );')
})

test('parcharExtrusion lanza si falta cualquiera de las dos anclas', () => {
  const { vertexShader } = new LineMaterial()
  expect(() => parcharExtrusion(vertexShader.replace(ANCLA_EXTRUSION_INICIO, '//'), 'x')).toThrow(/desplazamiento/)
  expect(() => parcharExtrusion(vertexShader.replace(ANCLA_EXTRUSION_FIN, '//'), 'x')).toThrow(/desplazamiento/)
})

test('el fragment ya no recorta a una fracción de banda: la banda ES la calzada', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  expect(shader.fragmentShader).not.toContain('fraccion')
  expect(shader.fragmentShader).not.toContain('uBandaPx')
  // `t` sí se reescala, pero por la SECCIÓN (seccion.ts), no por una banda de
  // nivel: vUv.x va de -1 a +1 sobre calzada + hombrillo o brocal, y esto lo
  // devuelve a la calzada. Sin sección (vBordeM = 0) el factor vale 1 exacto.
  expect(shader.fragmentShader).toContain('float t = vUv.x * (1.0 + 2.0 * abs(vBordeM)')
})

test('la tapa de arranque no se dibuja: la junta la remata la tapa final del tramo anterior', () => {
  // Las dos tapas de un tramo tienen el mismo radio, así que en una junta con
  // cualquiera basta. Y la de arranque es la que hace daño: se dibuja DESPUÉS
  // del cuerpo del tramo anterior y encima de él, y con sección (hombrillo o
  // brocal, seccion.ts) pinta su franja girada sobre el asfalto del otro en
  // cada quiebre de una curva. La final queda debajo del cuerpo siguiente. El
  // discard va antes de cualquier cálculo: es media tapa que no se paga.
  for (const casing of [false, true]) {
    const material = new LineMaterial()
    patchLineMaterial(material, {} as DataTexture, 164, casing)
    const shader = realShader(material)
    ;(material as any).onBeforeCompile(shader)
    const f = shader.fragmentShader
    expect(f).toContain('if ( vUv.y < -1.0 ) discard;')
    expect(f.indexOf('if ( vUv.y < -1.0 ) discard;')).toBeLessThan(f.indexOf('float pci ='))
  }
})

test('los encuentros limitan la tapa y su textura, también en picking, sin alterar el shader común', () => {
  for (const casing of [false, true]) {
    const m = new LineMaterial()
    patchLineMaterial(m, {} as DataTexture, 164, casing, undefined, 'base')
    const s = realShader(m)
    ;(m as any).onBeforeCompile(s)
    expect(s.vertexShader).toContain('attribute vec2 aLimites;')
    expect(s.vertexShader).toContain('min( hw, aLimites.y )')
    expect(s.vertexShader).toContain('vDist += avanceTapa;')
    expect(s.fragmentShader).toContain('if ( vUv.y < -1.0 ) discard;')
    expect(s.fragmentShader).not.toContain('pesoJunta')
  }
  const p = new LineMaterial()
  patchPickMaterial(p, true)
  const s = realShader(p)
  ;(p as any).onBeforeCompile(s)
  expect(s.vertexShader).toContain('min( hw, aLimites.y )')
  expect(extrusionGlsl(false)).not.toContain('aLimites')
})

test('la superficie de junta cubre bordes interiores con asfalto y conserva su iluminación y lluvia', () => {
  const m = new LineMaterial()
  patchLineMaterial(m, {} as DataTexture, 164, false, undefined, 'superficie')
  const s = realShader(m)
  ;(m as any).onBeforeCompile(s)
  expect(s.vertexShader).toContain('attribute vec4 aZonaJunta;')
  expect(s.vertexShader).toContain('attribute vec3 aEstiloJunta;')
  expect(s.vertexShader).toContain('max( aCalzada, aEstiloJunta.x * mppV )')
  expect(s.fragmentShader).toContain('alpha *= vPresenciaFuente;')
  expect(s.fragmentShader).toContain('pesoJunta')
  // Descarta fuera del asfalto ANTES de sus samplers. No se recorta la
  // sección del pase base: sigue debajo, completa, incluso en las curvas.
  expect(s.fragmentShader.indexOf('if ( radioAsfalto >= 1.0 ) discard;'))
    .toBeLessThan(s.fragmentShader.indexOf('texture2D(uAlbedo'))
  expect(s.fragmentShader).not.toContain('float flecha')
  expect(s.fragmentShader).not.toContain('vec3 franja =')
  expect(s.fragmentShader).toContain('vec3 normalSeccion')
  expect(s.fragmentShader).toContain('sombraSol(vPosW, Ng)')
  expect(s.fragmentShader).toContain('uMojado')
  // La superposición sólo trabaja sobre base opaca: nunca acumula el alpha
  // de las vías fuera del foco ni de un nivel que se está desvaneciendo.
  expect(s.fragmentShader).toContain('if ( alpha < 0.999 ) discard;')
  const base = new LineMaterial()
  patchLineMaterial(base, {} as DataTexture, 164)
  expect(m.customProgramCacheKey()).not.toBe(base.customProgramCacheKey())
})

test('las flechas de sentido se pintan solo en sentido único y hacia vDist creciente', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  const f = shader.fragmentShader
  expect(f).toContain('float flecha')
  // Dentro del condicional de sentido único, y después de que `unico` existe.
  expect(f.indexOf('float unico')).toBeLessThan(f.indexOf('float flecha'))
  expect(f).toMatch(/if\s*\(\s*unico\s*>\s*0\.5\s*\)/)
  // La cabeza se estrecha hacia FLECHA_M: la punta va al final de la vía.
  expect(f).toContain(`(${FLECHA_M.toFixed(2)} - u)`)
  // El contorno no lleva flechas: es el mismo trazo, pero solo borde.
  const contorno = new LineMaterial()
  patchLineMaterial(contorno, {} as DataTexture, 164, true)
  const sc = realShader(contorno)
  ;(contorno as any).onBeforeCompile(sc)
  expect(sc.fragmentShader).not.toContain('float flecha')
})

test('la flecha tiene las proporciones de una flecha de pavimento', () => {
  // Norma: 5 m de largo en vía urbana, cabeza más ancha que el tallo, y cabe
  // en un canal de 3,4 m con margen. El ciclo deja varias por cuadra.
  expect(FLECHA_M).toBeGreaterThan(CABEZA_M)
  expect(CABEZA_ANCHO_M).toBeGreaterThan(TALLO_M * 2)
  expect(CABEZA_ANCHO_M).toBeLessThan(3.0)
  expect(FLECHA_CICLO_M).toBeGreaterThan(FLECHA_M * 4)
  expect(FLECHA_CICLO_M).toBeLessThanOrEqual(60)
})

test('lanza si el ancla del vertex shader no aparece', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  shader.vertexShader = shader.vertexShader.replace(ANCLA_VERT, '// ancla removida')
  expect(() => (material as any).onBeforeCompile(shader)).toThrow(/ancla del vertex shader/)
})

test('lanza si el ancla de void main() no aparece en el fragment shader', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  shader.fragmentShader = shader.fragmentShader.replace(ANCLA_VERT, '// ancla removida')
  expect(() => (material as any).onBeforeCompile(shader)).toThrow(/ancla de void main\(\) en el fragment/)
})

test('lanza si el ancla de diffuseColor no aparece en el fragment shader', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  shader.fragmentShader = shader.fragmentShader.replace(ANCLA_FRAG, '// ancla removida')
  expect(() => (material as any).onBeforeCompile(shader)).toThrow(/ancla del fragment shader/)
})

// --- Paleta vial de Liberty y el conmutador de modo -------------------------

// Mismo criterio que parseCascade: lee la cascada que el generador REALMENTE
// emitió y la ejecuta, en vez de reimplementarla.
function pickTier (glsl: string, fn: string, tier: number): number[] {
  const cuerpo = glsl.slice(glsl.indexOf(`vec3 ${fn} (float tier) {`))
  for (const linea of cuerpo.split('\n')) {
    const cond = linea.match(/if \(tier < ([\d.]+)\) return vec3\(([^)]+)\);/)
    if (cond) { if (tier < Number(cond[1])) return cond[2].split(',').map(Number); continue }
    const fin = linea.match(/^\s*return vec3\(([^)]+)\);/)
    if (fin) return fin[1].split(',').map(Number)
  }
  throw new Error(`no se pudo leer ${fn} del GLSL`)
}

test('el GLSL de Liberty coincide con la tabla LIBERTY en los tres tiers', () => {
  for (let t = 0; t < LIBERTY.length; t++) {
    expect(pickTier(LIBERTY_GLSL, 'libertyRelleno', t)).toEqual(LIBERTY[t].relleno)
    expect(pickTier(LIBERTY_GLSL, 'libertyContorno', t)).toEqual(LIBERTY[t].contorno)
  }
})

// El conmutador. uModoPci a 0 dibuja Liberty (el estado normal del mapa) y a 1
// vuelve la rampa ASTM con sus contornos por procedencia, sin tocar nada más:
// el modo PCI tiene que seguir siendo el mapa que ya existía.
test('el relleno lleva los dos colores y elige con uModoPci', () => {
  const m = new LineMaterial()
  patchLineMaterial(m, {} as DataTexture, 164)
  const shader = realShader(m)
  ;(m as any).onBeforeCompile(shader)
  expect(shader.fragmentShader).toContain('libertyRelleno(tier)')
  expect(shader.fragmentShader).toContain('pciColor(pci)')
  expect(shader.fragmentShader).toContain('uModoPci')
  expect(shader.uniforms.uModoPci.value).toBe(0)   // Liberty de entrada
})

test('el contorno tambien cambia de modo: Liberty es claro, el de PCI oscuro', () => {
  const m = new LineMaterial()
  patchLineMaterial(m, {} as DataTexture, 164, true)
  const shader = realShader(m)
  ;(m as any).onBeforeCompile(shader)
  expect(shader.fragmentShader).toContain('libertyContorno(tier)')
  expect(shader.fragmentShader).toContain('uModoPci')
})

// El tier viaja en el alfa de la textura de atributos (attrTexture.ts). Si el
// shader lo leyera de otro canal, las vías saldrian del color del PCI o de la
// procedencia sin que nada fallara.
test('el tier se lee del canal alfa de la textura de atributos', () => {
  const m = new LineMaterial()
  patchLineMaterial(m, {} as DataTexture, 164)
  const shader = realShader(m)
  ;(m as any).onBeforeCompile(shader)
  expect(shader.fragmentShader).toMatch(/float tier = floor\(vAttr\.a \* 255\.0 \+ 0\.5\)/)
})

// Este bug estuvo vivo desde fdf2a15 hasta que alguien volvió a mirar la foto:
// foto/escena.ts comparaba la clave por IGUALDAD contra 'vias:relleno', y la
// clave llevaba ya ':base' detrás. No casaba con ningún objeto, `vias()`
// devolvía malla nula, y la foto trazada salía SIN UNA SOLA CARRETERA. Ni un
// error, ni un test rojo. El discriminante vive ahora junto a donde se ARMA la
// clave, y se prueba contra las claves que patchLineMaterial produce de verdad.
test('el discriminante de relleno aguanta los sufijos de la clave', () => {
  const clave = (casing: boolean, enc: 'base' | 'superficie') => {
    const m = new LineMaterial()
    patchLineMaterial(m, {} as DataTexture, 164, casing, undefined, enc)
    return m.customProgramCacheKey()
  }
  expect(esRellenoDeVia(clave(false, 'base'))).toBe(true)
  expect(esRellenoDeVia(clave(false, 'superficie'))).toBe(true)
  expect(esRellenoDeVia(clave(true, 'base'))).toBe(false)
  expect(esRellenoDeVia(clave(true, 'superficie'))).toBe(false)
  expect(esRellenoDeVia(undefined)).toBe(false)
})
