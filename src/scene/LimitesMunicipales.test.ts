import { describe, it, expect } from 'vitest'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { ANCHO_PX, OPACIDAD, COLOR_CLARO, COLOR_OSCURO, parcharLimites } from './LimitesMunicipales'
import { ERROR_PX } from './quadtree'
import { ALZA_MIN_M } from './roadsShader'

describe('el estilo de la línea de límite', () => {
  // Google dibuja los límites administrativos finos y tenues, en un gris
  // frío -- nunca en negro ni en el color de acento. Estos valores son el
  // punto de partida y se calibran mirando el mapa; el test solo impide que
  // alguien los suba a un grosor que tape la calle que hay debajo.
  it('la línea es fina: ningún valor de calibración puede pasar de 3 px', () => {
    expect(ANCHO_PX).toBeGreaterThan(0.5)
    expect(ANCHO_PX).toBeLessThanOrEqual(3)
  })

  it('la línea es tenue, nunca opaca del todo', () => {
    expect(OPACIDAD.claro).toBeLessThan(1)
    expect(OPACIDAD.oscuro).toBeLessThan(1)
  })

  it('el color es un gris frío, no un negro ni un color saturado', () => {
    for (const hex of [COLOR_CLARO, COLOR_OSCURO]) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      expect(max - min, `${hex} está demasiado saturado`).toBeLessThan(40)
      expect(max, `${hex} es casi negro`).toBeGreaterThan(60)
    }
  })
})

// Arreglo 2 (review de rama, Task 8): la geometría sale del pipeline con una
// alza fija de 0,25 m (ALZA_MIN_M) sobre el DEM FINO
// (scripts/lib/limites.mjs), pero lo que se DIBUJA no es el DEM fino: es la
// simplificación del quadtree, que admite hasta ERROR_PX píxeles de error
// proyectado (quadtree.ts) y puede quedar decenas de metros por encima o por
// debajo de la superficie real -- el revisor midió 36,7 m en un nodo real.
// Con solo la alza fija, el límite se entierra en cuanto el quadtree
// simplifica. Mismo remedio que ya usa la calzada (roadsShader.ts:122):
// compensar en el vertex shader, a la profundidad de CADA extremo.
//
// Envuelve un LineMaterial REAL (no un shader inventado a mano), como ya hace
// roadsShader.test.ts para el mismo tipo de material: así una actualización
// de three que mueva el ancla la agarra este test, no alguien mirando el mapa
// con la frontera hundida.
function realShader (material: LineMaterial) {
  return { uniforms: material.uniforms, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }
}

describe('la compensación del LOD en el vertex shader de los límites', () => {
  it('compila contra el LineMaterial real sin reventar', () => {
    const material = new LineMaterial()
    parcharLimites(material)
    const shader = realShader(material)
    expect(() => (material as unknown as { onBeforeCompile: (s: unknown) => void }).onBeforeCompile(shader)).not.toThrow()
  })

  it('conserva el ancla de camera space intacta (los dos extremos siguen ahí para subirlos)', () => {
    const material = new LineMaterial()
    parcharLimites(material)
    const shader = realShader(material)
    ;(material as unknown as { onBeforeCompile: (s: unknown) => void }).onBeforeCompile(shader)
    expect(shader.vertexShader).toContain('vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );')
    expect(shader.vertexShader).toContain('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );')
  })

  it('declara mpp(z) antes de void main() -- misma fórmula que mppV de roadsShader.ts', () => {
    const material = new LineMaterial()
    parcharLimites(material)
    const shader = realShader(material)
    ;(material as unknown as { onBeforeCompile: (s: unknown) => void }).onBeforeCompile(shader)
    expect(shader.vertexShader).toContain('float mpp (float z)')
    expect(shader.vertexShader.indexOf('float mpp (float z)'))
      .toBeLessThan(shader.vertexShader.indexOf('void main() {'))
  })

  // El corazón del arreglo: NO alcanza con que aparezca "0.25" en alguna
  // parte -- eso ya pasaba con el defecto (el alza fija sola). Lo que prueba
  // que el arreglo es el de verdad es el max(...) con el término
  // ERROR_PX * mpp delante, y con los NÚMEROS que salen de las constantes
  // IMPORTADAS (no literales sueltos que alguien podría desincronizar). Si
  // alguien cambia este max(...) por la alza fija -- o sea, revierte el
  // arreglo -- las dos cadenas de abajo dejan de aparecer y esto se pone
  // rojo (demostrado mutando LimitesMunicipales.tsx a mano: ver informe).
  it('sube cada extremo con max(ERROR_PX * mpp(z), ALZA_MIN_M), con los valores importados', () => {
    const material = new LineMaterial()
    parcharLimites(material)
    const shader = realShader(material)
    ;(material as unknown as { onBeforeCompile: (s: unknown) => void }).onBeforeCompile(shader)

    const errorPx = ERROR_PX.toFixed(1)
    const alzaMin = ALZA_MIN_M.toFixed(2)
    expect(shader.vertexShader).toContain(`max( ${errorPx} * mpp( start.z ), ${alzaMin} )`)
    expect(shader.vertexShader).toContain(`max( ${errorPx} * mpp( end.z ), ${alzaMin} )`)
  })

  it('sube cada extremo por la vertical del MUNDO, no por una normal por vértice', () => {
    const material = new LineMaterial()
    parcharLimites(material)
    const shader = realShader(material)
    ;(material as unknown as { onBeforeCompile: (s: unknown) => void }).onBeforeCompile(shader)
    expect(shader.vertexShader).toContain('normalize( ( modelViewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz )')
  })
})
