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
 * stateMask ya trata como pinchazos.
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
