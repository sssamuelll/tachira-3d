import { describe, expect, it } from 'vitest'
import { aristasUnicas } from '../lib/limites.mjs'

// Dos cuadrados pegados por el lado x=1: esa arista pertenece a los dos y
// tiene que salir UNA vez. El de la derecha recorre su anillo al revés a
// propósito -- en OSM dos municipios vecinos no recorren su frontera común en
// el mismo sentido, y una clave que dependa del sentido no los uniría.
const muni = (anillo) => ({ osmId: 0, name: 'x', polygons: [[anillo]], orphanFragments: 0 })

describe('aristasUnicas', () => {
  it('una frontera compartida sale una sola vez, recórrase como se recorra', () => {
    const izq = muni([[0, 0], [1, 0], [1, 1], [0, 1]])
    const der = muni([[2, 1], [1, 1], [1, 0], [2, 0]])
    const aristas = aristasUnicas([izq, der])
    // 4 + 4 lados, menos la compartida contada dos veces = 7
    expect(aristas).toHaveLength(7)
    const enX1 = aristas.filter(([a, b]) => a[0] === 1 && b[0] === 1)
    expect(enX1).toHaveLength(1)
  })

  it('cierra cada anillo: el último vértice conecta con el primero', () => {
    expect(aristasUnicas([muni([[0, 0], [1, 0], [1, 1]])])).toHaveLength(3)
  })

  it('no inventa aristas de longitud cero', () => {
    const conRepetido = muni([[0, 0], [1, 0], [1, 0], [1, 1]])
    for (const [a, b] of aristasUnicas([conRepetido])) {
      expect(a[0] === b[0] && a[1] === b[1], JSON.stringify([a, b])).toBe(false)
    }
  })

  it('sobre el dato real da 81.570 aristas de 132.165 vértices', async () => {
    const { readFileSync } = await import('node:fs')
    const municipios = JSON.parse(readFileSync('public/data/municipios.json', 'utf8'))
    expect(aristasUnicas(municipios)).toHaveLength(81_570)
  })
})

// añadir al final de scripts/test/limites.test.mjs
import { limitesEnu } from '../lib/limites.mjs'

describe('limitesEnu', () => {
  // Un frame de mentira: ENU identidad sobre grados, para poder afirmar
  // números exactos sin arrastrar la geodesia entera al test.
  const frame = null
  const enuPlano = (_f, lat, lon, h) => [lon * 1000, lat * 1000, h]

  // Ningún componente vale cero a propósito: con lat 0 el -norte sale como
  // -0, y toEqual distingue -0 de 0. El mapeo de ejes se comprueba igual de
  // bien sin depender del signo del cero.
  it('devuelve 6 floats por segmento, en ejes de three', () => {
    const buf = limitesEnu([[[3, 2], [4, 2]]], {
      alturaDe: () => 100, frame, alza: 0, enu: enuPlano, pasoM: 1e9,
    })
    expect(buf).toBeInstanceOf(Float32Array)
    expect(buf).toHaveLength(6)
    // [este, arriba, -norte] = [lon*1000, h, -lat*1000]
    expect([...buf]).toEqual([3000, 100, -2000, 4000, 100, -2000])
  })

  it('alza cada vértice sobre el terreno', () => {
    const buf = limitesEnu([[[3, 2], [4, 2]]], {
      alturaDe: () => 100, frame, alza: 0.25, enu: enuPlano, pasoM: 1e9,
    })
    expect(buf[1]).toBeCloseTo(100.25, 5)
    expect(buf[4]).toBeCloseTo(100.25, 5)
  })

  // Una arista larga sobre relieve que cambia tiene que partirse: si no, la
  // cuerda recta cruza por debajo de la loma que hay en medio.
  //
  // `pasoM` enorme a propósito, para que `subdividir` no parta nada y lo único
  // que pueda meter puntos sea `apoyar` -- que es lo que este test dice
  // probar. Con pasoM: 30 la arista de [0,0] a [1,0], que mide ~111 km, se
  // partía en 3.712 puntos ella sola: el test pasaba aunque `apoyar` no se
  // llamara. Y sin el control de abajo tampoco distinguiría partir por la loma
  // de partir porque sí.
  it('parte una arista larga solo donde el relieve lo pide', () => {
    const conLoma = limitesEnu([[[0, 0], [1, 0]]], {
      alturaDe: (lon) => (lon > 0.4 && lon < 0.6 ? 500 : 0),
      frame, alza: 0, enu: enuPlano, pasoM: 1e9,
    })
    const llano = limitesEnu([[[0, 0], [1, 0]]], {
      alturaDe: () => 0, frame, alza: 0, enu: enuPlano, pasoM: 1e9,
    })
    expect(llano.length / 6, 'sin loma que esquivar no hay nada que partir').toBe(1)
    expect(conLoma.length / 6, 'la loma tiene que obligar a partir').toBeGreaterThan(1)
  })
})
