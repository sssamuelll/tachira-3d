/**
 * Rasteriza la unión de los municipios sobre una rejilla arbitraria: 255
 * dentro, 0 fuera, un byte por post, fila 0 = norte.
 *
 * Es src/scene/stateMask.ts con la rejilla abstraída: `colOf(lon)` y
 * `rowOf(lat)` dan columna y fila fraccionarias, `latDeFila(y)` la latitud de
 * la fila entera. Hace falta porque la rejilla del DEM es uniforme en Mercator
 * y no en latitud, y el pipeline es JS plano sin acceso al TypeScript del
 * navegador. Se mantienen a mano en los dos sitios; state-mask.test.mjs fija
 * la semántica contra pointInPolygon igual que stateMask.test.ts.
 *
 * Cada municipio se rasteriza por separado (par-impar entre sus propios
 * anillos) y se funde con OR: dos vecinos que no comparten sus nodos exactos
 * en OSM no pueden abrir una grieta. Al final se tapan los pinchazos de un
 * post con los cuatro vecinos encendidos.
 */
export function stateMask (municipios, { W, H, colOf, rowOf, latDeFila }) {
  const mask = new Uint8Array(W * H)
  const cruces = Array.from({ length: H }, () => [])
  for (const m of municipios) {
    for (const poly of m.polygons) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const [lon0, lat0] = ring[i]
          const [lon1, lat1] = ring[(i + 1) % ring.length]
          const r0 = rowOf(lat0), r1 = rowOf(lat1)
          // Regla semiabierta [min, max): un cruce por fila atravesada, las
          // horizontales ninguno (y sin dividir entre lat1 - lat0 == 0).
          const yIni = Math.max(0, Math.ceil(Math.min(r0, r1)))
          const yFin = Math.min(H - 1, Math.ceil(Math.max(r0, r1)) - 1)
          for (let y = yIni; y <= yFin; y++) {
            const lat = latDeFila(y)
            cruces[y].push(colOf(lon0 + (lon1 - lon0) * (lat - lat0) / (lat1 - lat0)))
          }
        }
      }
    }
    for (let y = 0; y < H; y++) {
      const xs = cruces[y]
      if (xs.length > 1) {
        xs.sort((a, b) => a - b)
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const x0 = Math.max(0, Math.ceil(xs[i]))
          const x1 = Math.min(W - 1, Math.ceil(xs[i + 1]) - 1)
          if (x1 >= x0) mask.fill(255, y * W + x0, y * W + x1 + 1)
        }
      }
      xs.length = 0
    }
  }
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      if (!mask[i] && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W]) mask[i] = 255
    }
  }
  return mask
}
