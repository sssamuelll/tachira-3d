import { geodeticToEnu } from './enu.mjs'
import { tileXf, tileYf, tileXToLon, tileYToLat } from './terrarium.mjs'

/**
 * Apoyo de las vías sobre la triangulación del DEM completo: la misma
 * superficie que el nivel fino del relieve dibuja en el navegador
 * (src/scene/nodoTerreno.ts). Convención de rejilla: el post (c, f) de la
 * tesela z12 (tx, ty) está en la coordenada de tesela (tx + c/256, ty + f/256),
 * esquina de píxel. `dem.tile` dice en qué tesela empieza la rejilla.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** (lon, lat) → posts fraccionarios (u, v) de la rejilla, acotados a ella. */
export function postDe (dem, lon, lat) {
  const { z, x0, y0 } = dem.tile
  return [
    clamp((tileXf(lon, z) - x0) * 256, 0, dem.width - 1),
    clamp((tileYf(lat, z) - y0) * 256, 0, dem.height - 1),
  ]
}

// Celda y posición dentro de ella. La diagonal va de arriba-derecha a
// abajo-izquierda: triángulos (a,c,b) y (b,c,d), y fx + fy <= 1 cae en el
// primero. Es la regla que src/scene/drape.ts fijó con test y la que
// nodoTerreno.ts usa para armar cada nodo; si cambia en un sitio, las vías
// se hunden en el otro.
function celda (dem, u, v) {
  const W = dem.width, H = dem.height
  u = clamp(u, 0, W - 1); v = clamp(v, 0, H - 1)
  const x = Math.min(W - 2, Math.floor(u)), y = Math.min(H - 2, Math.floor(v))
  return { x, y, fx: u - x, fy: v - y }
}

export function alturaEnPosts (dem, u, v) {
  const { x, y, fx, fy } = celda(dem, u, v)
  const W = dem.width, d = dem.data
  const ha = d[y * W + x], hb = d[y * W + x + 1], hc = d[(y + 1) * W + x], hd = d[(y + 1) * W + x + 1]
  return fx + fy <= 1
    ? ha + fx * (hb - ha) + fy * (hc - ha)
    : hd + (1 - fx) * (hc - hd) + (1 - fy) * (hb - hd)
}

export const alturaTriangulo = (dem, lon, lat) => alturaEnPosts(dem, ...postDe(dem, lon, lat))

/**
 * Normal del triángulo del DEM que contiene el punto, en ejes de three
 * (x = este, y = arriba, z = -norte), unitaria y hacia arriba. Es la del plano
 * que el relieve dibuja ahí: una calzada extruida sobre ella queda pegada a
 * la ladera en vez de enterrar la mitad de arriba y flotar la de abajo.
 */
export function normalTriangulo (dem, frame, lon, lat) {
  const [u, v] = postDe(dem, lon, lat)
  const { x, y, fx, fy } = celda(dem, u, v)
  const { z, x0, y0 } = dem.tile
  const P = (c, f) => {
    const [e, n, up] = geodeticToEnu(frame, tileYToLat(y0 + f / 256, z), tileXToLon(x0 + c / 256, z), dem.data[f * dem.width + c])
    return [e, up, -n]
  }
  const [p, q, r] = fx + fy <= 1
    ? [P(x, y), P(x, y + 1), P(x + 1, y)]          // a, c, b
    : [P(x + 1, y), P(x, y + 1), P(x + 1, y + 1)]  // b, c, d
  const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
  const e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
  const L = Math.hypot(...n) || 1
  n = n.map(c => c / L)
  return n[1] < 0 ? n.map(c => -c) : n
}
