import { test, expect } from 'vitest'
import { terrainFrag } from '../scene/terrainShader'
import { hypso, PARADAS } from './hypso'

// Mismo método que roadsShader.test.ts usa con la paleta ASTM: no se compara
// una copia contra otra copia, se LEE el GLSL real y se ejecuta su cascada en
// TypeScript. Lo que se comprueba es que la rampa de la foto y la de la
// pantalla den el mismo color, no que dos listas de números se parezcan.

interface Tramo { hasta: number; a: number[]; b: number[]; div: number }

/** Reconstruye los mix() de hypso() leyendo el texto del fragment shader. */
function parseHypso (glsl: string): Tramo[] {
  const cuerpo = glsl.slice(glsl.indexOf('vec3 hypso'), glsl.indexOf('void main'))
  const tramos: Tramo[] = []
  for (const linea of cuerpo.split('\n')) {
    const m = linea.match(
      /(?:if \(t < ([\d.]+)\) )?return mix\(vec3\(([^)]+)\), vec3\(([^)]+)\), \(?[^,]*?\)? *\/ ([\d.]+)\);/)
    if (!m) continue
    tramos.push({
      hasta: m[1] ? Number(m[1]) : Infinity,
      a: m[2].split(',').map(Number),
      b: m[3].split(',').map(Number),
      div: Number(m[4]),
    })
  }
  return tramos
}

/** Lo que devolvería la GPU para un `t` escalar, según los tramos leídos. */
function hypsoGlsl (tramos: Tramo[], t: number): number[] {
  let base = 0
  for (const tr of tramos) {
    if (t < tr.hasta) {
      const f = (t - base) / tr.div
      return tr.a.map((v, i) => v + (tr.b[i] - v) * f)
    }
    base = tr.hasta
  }
  throw new Error(`ningún tramo cubrió t=${t}`)
}

const TRAMOS = parseHypso(terrainFrag)

test('el shader sigue teniendo los cuatro tramos que esta copia asume', () => {
  expect(TRAMOS).toHaveLength(PARADAS.length - 1)
  // Equiespaciados: cada tramo divide por el mismo paso, y el paso es 1/n.
  for (const tr of TRAMOS) expect(tr.div).toBeCloseTo(1 / (PARADAS.length - 1), 12)
  // Cada tramo arranca donde termina el anterior: si no, la cascada tiene un
  // salto de color y esta copia (que interpola una tabla continua) no puede
  // reproducirla por mucho que los extremos coincidan.
  for (let i = 0; i < TRAMOS.length - 1; i++) expect(TRAMOS[i].b).toEqual(TRAMOS[i + 1].a)
})

test('la rampa de la foto da el mismo color que la del shader', () => {
  // 401 puntos, incluidos los tres bordes exactos donde la cascada cambia de
  // rama (0,25 / 0,50 / 0,75): ahí es donde un off-by-one se ve.
  for (let k = 0; k <= 400; k++) {
    const t = k / 400
    const esperado = hypsoGlsl(TRAMOS, t)
    const obtenido = hypso(t)
    for (let c = 0; c < 3; c++) expect(obtenido[c]).toBeCloseTo(esperado[c], 6)
  }
})

test('fuera de [0,1] se recorta a los extremos de la rampa', () => {
  expect(hypso(-3)).toEqual([...PARADAS[0]])
  expect(hypso(7)).toEqual([...PARADAS[PARADAS.length - 1]])
})
