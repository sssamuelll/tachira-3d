import type { Way } from '../data/types'
import { anchoCalzada } from './calzada'
import { bordeDe } from './seccion'
import { nivelDe } from './roadStyle'

export interface Juntas {
  /** Metros que puede sobresalir la tapa inicial/final antes del siguiente nodo. */
  limites: Float32Array
  /** Por segmento: distancia/radio hacia atrás y distancia/radio hacia adelante. */
  zonas: Float32Array
  /** Mayor jerarquía de las juntas que influyen el segmento; cero fuera. */
  niveles: Uint8Array
  nodos: number
}

const SIN_LIMITE = 1e9
const RADIO_MAXIMO = 80

/**
 * Vecindad exacta sobre el buffer existente, una vez al cargar. No cambia un
 * solo vértice ni necesita regenerar datos. Sólo los nodos con al menos tres
 * brazos generan corrección: grado dos (incluidas curvas y cambios de way)
 * sin un cruce cercano conserva ceros en zonas y SIN_LIMITE en ambas tapas.
 *
 * Se ordenan índices de extremos y se enlazan parejas de grado dos: 16 bytes
 * temporales por segmento, frente a un Map de miles de objetos XYZ. La
 * igualdad incluye altura y no hay snapping: un paso elevado o una vía que
 * OSM dejó desconectada no se convierte en cruce por estar cerca en planta.
 * Coste O(N log N) al cargar y un recorrido de los brazos locales, cero
 * trabajo por cuadro. Cambiar de way o de sentido no corta la vecindad.
 */
export function prepararJuntas (positions: Float32Array, index: Uint32Array, ways: Way[]): Juntas {
  const n = positions.length / 6
  const limites = new Float32Array(n * 2).fill(SIN_LIMITE)
  const zonas = new Float32Array(n * 4)
  const niveles = new Uint8Array(n)
  const extremos = new Uint32Array(n * 2)
  const continuacion = new Int32Array(n * 2).fill(-1)
  const mismo = (a: number, b: number): boolean =>
    positions[a] === positions[b] && positions[a + 1] === positions[b + 1] && positions[a + 2] === positions[b + 2]
  const longitud = (s: number): number => {
    const p = s * 6
    return Math.hypot(positions[p + 3] - positions[p], positions[p + 4] - positions[p + 1], positions[p + 5] - positions[p + 2])
  }
  let total = 0
  for (let s = 0; s < n; s++) {
    // Los degenerados no son brazos. Los tramos diminutos sí lo son: no se
    // usa el umbral de 1 cm del shader para reconstruir la topología.
    if (mismo(s * 6, s * 6 + 3)) continue
    extremos[total++] = s * 2
    extremos[total++] = s * 2 + 1
  }
  const ordenados = extremos.subarray(0, total)
  ordenados.sort((a, b) => {
    const p = a * 3, q = b * 3
    return positions[p] - positions[q] || positions[p + 1] - positions[q + 1] || positions[p + 2] - positions[q + 2]
  })
  const semianchos = ways.map(w => anchoCalzada(w) * 0.5 + Math.abs(bordeDe(w)))
  const nivelesVia = ways.map(w => nivelDe(w.highway))
  // Sólo se busca la way de los brazos de un cruce; no se reserva un segundo
  // array de anchos para los ~800.000 segmentos que normalmente no lo son.
  const viaDe = (e: number): number => {
    const s = e >> 1
    let lo = 0, hi = ways.length
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1
      if (index[mid] <= s) lo = mid
      else hi = mid
    }
    return lo
  }
  const semianchoDe = (e: number): number => semianchos[viaDe(e)]
  let nodos = 0
  const brazos: number[] = []
  for (let a = 0; a < total;) {
    let b = a + 1
    while (b < total && mismo(ordenados[a] * 3, ordenados[b] * 3)) b++
    if (b - a === 2) {
      // El enlace es geométrico, no depende de pertenecer a la misma way ni
      // de su orientación. OSM puede partir una vía a milímetros del cruce.
      continuacion[ordenados[a]] = ordenados[a + 1]
      continuacion[ordenados[a + 1]] = ordenados[a]
    }
    if (b - a >= 3) {
      brazos.length = 0
      for (let j = a; j < b; j++) {
        const e = ordenados[j]
        // Copias del mismo segmento no inventan un tercer brazo.
        if (!brazos.some(v => mismo((v ^ 1) * 3, (e ^ 1) * 3))) brazos.push(e)
      }
      if (brazos.length >= 3) {
        nodos++
        let radio = 0, nivel = 0
        for (let j = 0; j < brazos.length; j++) {
          const e = brazos[j], p = e * 3, q = (e ^ 1) * 3
          const h = semianchoDe(e)
          radio = Math.max(radio, h)
          const dx = positions[q] - positions[p], dy = positions[q + 1] - positions[p + 1], dz = positions[q + 2] - positions[p + 2]
          const len = Math.hypot(dx, dy, dz)
          for (let k = 0; k < j; k++) {
            const otro = brazos[k], r = (otro ^ 1) * 3
            const ox = positions[r] - positions[p], oy = positions[r + 1] - positions[p + 1], oz = positions[r + 2] - positions[p + 2]
            const cos = Math.max(-1, Math.min(1, (dx * ox + dy * oy + dz * oz) / (len * Math.hypot(ox, oy, oz))))
            // La bisectriz contiene el solape de dos brazos de semiancho h:
            // h / sin(ángulo/2). A 180° da h, por eso la continuidad de una
            // T no crea un radio infinito. Un ángulo agudo sí necesita más
            // apertura; se limita a 80 m para no borrar media carretera ante
            // datos casi paralelos. Es una cota local, no un polígono vial.
            const senoMedio = Math.sqrt((1 - cos) * 0.5)
            radio = Math.max(radio, Math.min(RADIO_MAXIMO, Math.max(h, semianchoDe(otro)) / Math.max(senoMedio, 1e-6)))
          }
        }
        radio = Math.min(RADIO_MAXIMO, radio)
        for (let j = a; j < b; j++) nivel = Math.max(nivel, nivelesVia[viaDe(ordenados[j])])
        for (let j = a; j < b; j++) {
          zonas[ordenados[j] * 2 + 1] = radio
          // -1 termina sin cruce; -2..-8 termina en junta y carga su nivel.
          // Guardarlo por extremo evita que una junta alta se transmita a
          // otra baja sólo porque ambas influyen sobre el mismo segmento.
          continuacion[ordenados[j]] = -2 - nivel
        }
      }
    }
    a = b
  }
  if (nodos === 0) return { limites, zonas, niveles, nodos }

  for (let origen = 0; origen < n * 2; origen++) {
    if (continuacion[origen] >= -1) continue
    const radio = zonas[origen * 2 + 1]
    const nivel = -continuacion[origen] - 2
    let distancia = 0, e = origen
    // Cada extremo orientado tiene una sola junta alcanzable antes de la
    // siguiente bifurcación. Ningún recorrido atraviesa otro cruce ni crea
    // juntas en las curvas; las componentes aisladas nunca se recorren.
    while (e >= 0) {
      if (distancia > radio * 1.5 + semianchoDe(e)) break
      zonas[e * 2] = distancia
      zonas[e * 2 + 1] = radio
      limites[e] = distancia
      niveles[e >> 1] = Math.max(niveles[e >> 1], nivel)
      distancia += longitud(e >> 1)
      e = continuacion[e ^ 1]
    }
  }
  return { limites, zonas, niveles, nodos }
}
