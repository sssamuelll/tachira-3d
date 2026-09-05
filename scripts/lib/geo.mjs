import { geodeticToEcef } from './enu.mjs'

// Distancia cuerda en ECEF. Para tramos de decenas o cientos de metros la
// diferencia contra el arco sobre el elipsoide es ~2e-6 % a 1 km — despreciable,
// y más exacta que haversine, que asume esfera y yerra ~0,5 %.
function chord (lon1, lat1, h1, lon2, lat2, h2) {
  const a = geodeticToEcef(lat1, lon1, h1)
  const b = geodeticToEcef(lat2, lon2, h2)
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

export function lineLengthMeters (coords) {
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += chord(coords[i - 1][0], coords[i - 1][1], 0, coords[i][0], coords[i][1], 0)
  }
  return total
}

export function lineLength3dMeters (coords, heights) {
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    total += chord(
      coords[i - 1][0], coords[i - 1][1], heights[i - 1],
      coords[i][0], coords[i][1], heights[i],
    )
  }
  return total
}

export function midpointIndex (coords) {
  if (coords.length < 3) return 0
  const half = lineLengthMeters(coords) / 2
  // vértice más cercano a la mitad, no "primer cruce": un cruce por umbral
  // (acc >= half) es frágil cuando acc queda un ULP por debajo de half en el
  // vértice exacto de la mitad (caso real con pasos uniformes, ver test).
  let acc = 0
  let best = 0
  let bestDiff = half
  for (let i = 1; i < coords.length; i++) {
    acc += chord(coords[i - 1][0], coords[i - 1][1], 0, coords[i][0], coords[i][1], 0)
    const diff = Math.abs(acc - half)
    if (diff < bestDiff) { bestDiff = diff; best = i }
  }
  return best
}

export function pointInRing (lon, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) &&
        lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function pointInPolygon (lon, lat, polygon) {
  if (!pointInRing(lon, lat, polygon[0])) return false
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lon, lat, polygon[i])) return false   // cayó en un hueco
  }
  return true
}
