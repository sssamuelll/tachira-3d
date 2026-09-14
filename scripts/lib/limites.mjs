import { subdividir, apoyar } from './subdividir.mjs'
import { geodeticToEnu } from './enu.mjs'

/**
 * Las aristas de los anillos municipales, cada una una sola vez.
 *
 * El 62 % de ellas pertenece a dos municipios (son las fronteras interiores) y
 * aparece una vez en el anillo de cada vecino. Sin deduplicar se dibujarían
 * dos veces superpuestas: con transparencia eso acumula, así que toda frontera
 * interior saldría más marcada que el contorno exterior del estado -- que solo
 * tiene un dueño -- y al revés de como se debe leer un mapa.
 *
 * La clave ordena los dos extremos entre sí para no depender del sentido en
 * que cada municipio recorra su anillo, que en OSM es opuesto entre vecinos.
 * Siete decimales son ~1 cm: los nodos compartidos son el mismo nodo de OSM y
 * coinciden exactos, y esa tolerancia absorbe el ruido de pasar por JSON sin
 * llegar a fundir dos nodos distintos. Los nodos que OSM NO comparte no se
 * funden y su arista sale dos veces; eso es ruido del dato, el mismo que
 * stateMask ya trata como pinchazos. Los 29 anillos de OSM repiten su primer
 * vértice al final, así que la arista de cierre de cada uno mide cero: por eso
 * salen 81.570 y no 81.599.
 */
export function aristasUnicas (municipios) {
  const vistas = new Set()
  const out = []
  const clave = p => `${p[0].toFixed(7)},${p[1].toFixed(7)}`
  for (const m of municipios) {
    for (const poly of m.polygons) {
      for (const anillo of poly) {
        for (let i = 0; i < anillo.length; i++) {
          const a = anillo[i], b = anillo[(i + 1) % anillo.length]
          const ka = clave(a), kb = clave(b)
          if (ka === kb) continue          // vértice repetido: no es una arista
          const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
          if (vistas.has(k)) continue
          vistas.add(k)
          out.push([a, b])
        }
      }
    }
  }
  return out
}

/**
 * Las aristas, drapeadas sobre el DEM y en coordenadas de three, listas para
 * LineSegmentsGeometry.setPositions: 6 floats por segmento.
 *
 * Mismo tratamiento que las vías y por la misma razón: `subdividir` mete
 * puntos para que ningún tramo pase de `pasoM`, y `apoyar` parte por bisección
 * los que aun así se aparten del relieve más que el umbral. El dato de OSM ya
 * viene denso (arista mediana 15,7 m), así que esto solo trabaja de verdad en
 * las 1.659 aristas de más de 100 m.
 *
 * `enu` es inyectable solo para poder afirmar números exactos en el test sin
 * arrastrar la geodesia; en producción siempre es geodeticToEnu.
 */
export function limitesEnu (aristas, {
  alturaDe, frame, alza = 0.25, enu = geodeticToEnu, pasoM = 30,
}) {
  const partes = []
  for (const [a, b] of aristas) {
    const coords = apoyar(subdividir([a, b], pasoM), alturaDe)
    for (let i = 1; i < coords.length; i++) partes.push([coords[i - 1], coords[i]])
  }
  const out = new Float32Array(partes.length * 6)
  let k = 0
  for (const [p, q] of partes) {
    for (const [lon, lat] of [p, q]) {
      const [este, norte, arriba] = enu(frame, lat, lon, alturaDe(lon, lat) + alza)
      out[k++] = este; out[k++] = arriba; out[k++] = -norte
    }
  }
  return out
}
