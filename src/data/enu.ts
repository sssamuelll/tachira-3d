// Puerto a TypeScript de scripts/lib/enu.mjs. Duplicación deliberada: el
// pipeline corre en Node y la escena en el navegador; una dependencia
// compartida entre ambos no compensa por seis funciones puras. La coherencia
// entre las dos implementaciones la garantiza enu.test.ts (comparación al
// milímetro contra scripts/lib/enu.mjs), no un import compartido.
export const A = 6378137.0
export const F = 1 / 298.257223563
export const B = A * (1 - F)
export const E2 = F * (2 - F)
const D2R = Math.PI / 180

export function geodeticToEcef (latDeg: number, lonDeg: number, h = 0): [number, number, number] {
  const lat = latDeg * D2R, lon = lonDeg * D2R
  const sLat = Math.sin(lat), cLat = Math.cos(lat)
  const N = A / Math.sqrt(1 - E2 * sLat * sLat)
  return [(N + h) * cLat * Math.cos(lon), (N + h) * cLat * Math.sin(lon), (N * (1 - E2) + h) * sLat]
}

export interface EnuFrame { origin: [number, number, number]; sLat: number; cLat: number; sLon: number; cLon: number }

export function makeEnuFrame (lat0Deg: number, lon0Deg: number, h0 = 0): EnuFrame {
  const lat0 = lat0Deg * D2R, lon0 = lon0Deg * D2R
  return {
    origin: geodeticToEcef(lat0Deg, lon0Deg, h0),
    sLat: Math.sin(lat0), cLat: Math.cos(lat0), sLon: Math.sin(lon0), cLon: Math.cos(lon0),
  }
}

export function geodeticToEnu (f: EnuFrame, latDeg: number, lonDeg: number, h = 0): [number, number, number] {
  const [X, Y, Z] = geodeticToEcef(latDeg, lonDeg, h)
  const dx = X - f.origin[0], dy = Y - f.origin[1], dz = Z - f.origin[2]
  return [
    -f.sLon * dx + f.cLon * dy,
    -f.sLat * f.cLon * dx - f.sLat * f.sLon * dy + f.cLat * dz,
     f.cLat * f.cLon * dx + f.cLat * f.sLon * dy + f.sLat * dz,
  ]
}

/**
 * Inversa de geodeticToEnu. Hace falta para volver a drapear las vías sobre la
 * malla del relieve que de verdad se dibuja (scene/drape.ts): roads-pos.bin
 * trae puntos en ENU y la rejilla del DEM se indexa por lat/lon.
 *
 * La latitud sale por Bowring en un paso, sin iterar: el error de esa fórmula
 * es de micrómetros para alturas terrestres, cinco órdenes de magnitud por
 * debajo de lo que aquí se compara (celdas de relieve de 130 m).
 */
export function enuToGeodetic (f: EnuFrame, e: number, n: number, u: number): [number, number, number] {
  // La matriz de ENU a ECEF es la transpuesta de la de geodeticToEnu.
  const X = f.origin[0] + (-f.sLon * e - f.sLat * f.cLon * n + f.cLat * f.cLon * u)
  const Y = f.origin[1] + (f.cLon * e - f.sLat * f.sLon * n + f.cLat * f.sLon * u)
  const Z = f.origin[2] + (f.cLat * n + f.sLat * u)
  const p = Math.hypot(X, Y)
  const th = Math.atan2(Z * A, p * B)
  const ep2 = (A * A - B * B) / (B * B)
  const lat = Math.atan2(Z + ep2 * B * Math.sin(th) ** 3, p - E2 * A * Math.cos(th) ** 3)
  const lon = Math.atan2(Y, X)
  const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2)
  return [lat / D2R, lon / D2R, p / Math.cos(lat) - N]
}
