import { A, B, E2, EP2 } from './wgs84.mjs'

const D2R = Math.PI / 180, R2D = 180 / Math.PI

export function geodeticToEcef (latDeg, lonDeg, h = 0) {
  const lat = latDeg * D2R, lon = lonDeg * D2R
  const sLat = Math.sin(lat), cLat = Math.cos(lat)
  const N = A / Math.sqrt(1 - E2 * sLat * sLat)
  return [
    (N + h) * cLat * Math.cos(lon),
    (N + h) * cLat * Math.sin(lon),
    (N * (1 - E2) + h) * sLat,
  ]
}

export function ecefToGeodetic (X, Y, Z) {
  const p = Math.hypot(X, Y)
  const theta = Math.atan2(Z * A, p * B)
  const sT = Math.sin(theta), cT = Math.cos(theta)
  const lat = Math.atan2(Z + EP2 * B * sT * sT * sT, p - E2 * A * cT * cT * cT)
  const lon = Math.atan2(Y, X)
  const sLat = Math.sin(lat)
  const N = A / Math.sqrt(1 - E2 * sLat * sLat)
  // cerca de los polos p→0 y la fórmula de h se degrada; el Táchira está a 8°N
  const h = p / Math.cos(lat) - N
  return [lat * R2D, lon * R2D, h]
}

export function makeEnuFrame (lat0Deg, lon0Deg, h0 = 0) {
  const lat0 = lat0Deg * D2R, lon0 = lon0Deg * D2R
  return {
    origin: geodeticToEcef(lat0Deg, lon0Deg, h0),
    sLat: Math.sin(lat0), cLat: Math.cos(lat0),
    sLon: Math.sin(lon0), cLon: Math.cos(lon0),
  }
}

export function ecefToEnu (f, X, Y, Z) {
  const dx = X - f.origin[0], dy = Y - f.origin[1], dz = Z - f.origin[2]
  return [
    -f.sLon * dx + f.cLon * dy,
    -f.sLat * f.cLon * dx - f.sLat * f.sLon * dy + f.cLat * dz,
     f.cLat * f.cLon * dx + f.cLat * f.sLon * dy + f.sLat * dz,
  ]
}

export function enuToEcef (f, e, n, u) {
  return [
    f.origin[0] + (-f.sLon * e - f.sLat * f.cLon * n + f.cLat * f.cLon * u),
    f.origin[1] + ( f.cLon * e - f.sLat * f.sLon * n + f.cLat * f.sLon * u),
    f.origin[2] + (                        f.cLat * n +          f.sLat * u),
  ]
}

export function geodeticToEnu (f, latDeg, lonDeg, h = 0) {
  const [X, Y, Z] = geodeticToEcef(latDeg, lonDeg, h)
  return ecefToEnu(f, X, Y, Z)
}

export function enuToGeodetic (f, e, n, u) {
  const [X, Y, Z] = enuToEcef(f, e, n, u)
  return ecefToGeodetic(X, Y, Z)
}
