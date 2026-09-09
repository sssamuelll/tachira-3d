import { lineLengthMeters } from './geo.mjs'

/**
 * Inserta puntos interpolados en lon/lat para que ningún tramo pase de
 * `pasoM`. Corre antes del drapeado: cada punto nuevo se apoya en el relieve
 * por su cuenta, y un tramo de 30 m no cruza por debajo de una loma de la
 * malla de 36 m. Sin esto, 16.582 tramos medían más de 100 m y 262 se
 * hundían más de 8 m bajo el relieve dibujado (el peor, 188 m).
 *
 * Los puntos originales se conservan por referencia, en su orden.
 */
/**
 * Parte por bisección los tramos cuya cuerda se aparta del relieve más de
 * `umbral` metros (en el medio o en los cuartos), hasta que ninguno se aparte
 * o mida menos de `minM`. Un tramo recto de 30 m entre dos puntos apoyados
 * cruza por debajo de una arista convexa del DEM; con esto ningún tramo se
 * hunde más de `umbral`, que es lo que la calzada se levanta como mínimo en
 * el navegador (ALZA_MIN_M, roadsShader.ts). Medido antes de esto: 124.875 de
 * 664.531 tramos se apartaban más de 20 cm. Los puntos originales se
 * conservan por referencia.
 */
export function apoyar (coords, alturaDe, umbral = 0.2, minM = 4) {
  const out = [coords[0]]
  const hs = coords.map(([lon, lat]) => alturaDe(lon, lat))
  const bisecar = (a, ha, b, hb) => {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const hm = alturaDe(m[0], m[1])
    let aparta = Math.abs(hm - (ha + hb) / 2) > umbral
    for (const t of [0.25, 0.75]) {
      if (aparta) break
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      aparta = Math.abs(alturaDe(p[0], p[1]) - (ha + (hb - ha) * t)) > umbral
    }
    if (aparta && lineLengthMeters([a, b]) > minM) {
      bisecar(a, ha, m, hm)
      bisecar(m, hm, b, hb)
    } else {
      out.push(b)
    }
  }
  for (let i = 1; i < coords.length; i++) bisecar(coords[i - 1], hs[i - 1], coords[i], hs[i])
  return out
}

export function subdividir (coords, pasoM = 30) {
  const out = [coords[0]]
  for (let i = 1; i < coords.length; i++) {
    const [lon0, lat0] = coords[i - 1], [lon1, lat1] = coords[i]
    const n = Math.max(1, Math.ceil(lineLengthMeters([coords[i - 1], coords[i]]) / pasoM))
    for (let k = 1; k < n; k++) out.push([lon0 + (lon1 - lon0) * k / n, lat0 + (lat1 - lat0) * k / n])
    out.push(coords[i])
  }
  return out
}
