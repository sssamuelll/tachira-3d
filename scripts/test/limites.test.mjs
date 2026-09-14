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

  it('sobre el dato real da 81.599 aristas de 132.165 vértices', async () => {
    const { readFileSync } = await import('node:fs')
    const municipios = JSON.parse(readFileSync('public/data/municipios.json', 'utf8'))
    expect(aristasUnicas(municipios)).toHaveLength(81_599)
  })
})
