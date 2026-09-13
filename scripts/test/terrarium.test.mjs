import { test, expect } from 'vitest'
import {
  decodeTerrarium, lonToTileX, latToTileY, tileRangeForBbox, sampleBilinear, downsample,
  tileXf, tileYf, tileXToLon, tileYToLat, limpiarAnomalias,
} from '../lib/terrarium.mjs'

/** Rejilla plana width x height a un valor base, para las pruebas de limpiarAnomalias. */
function rejilla (width, height, base = 1000) {
  return { data: new Float32Array(width * height).fill(base), width, height }
}

test('la tesela fraccionaria tiene por parte entera la tesela de siempre', () => {
  for (const [lon, lat, z] of [[-72.22, 7.77, 13], [-71.9, 8.02, 12], [-72.4878, 7.3613, 8]]) {
    expect(Math.floor(tileXf(lon, z))).toBe(lonToTileX(lon, z))
    expect(Math.floor(tileYf(lat, z))).toBe(latToTileY(lat, z))
  }
})

test('tesela fraccionaria: ida y vuelta exacta', () => {
  expect(tileXToLon(tileXf(-72.22, 12), 12)).toBeCloseTo(-72.22, 9)
  expect(tileYToLat(tileYf(7.77, 12), 12)).toBeCloseTo(7.77, 9)
})

const BBOX = { s: 7.3612911, w: -72.4878225, n: 8.6826552, e: -71.3153029 }

test('decodeTerrarium: el nivel del mar es el offset 32768', () => {
  expect(decodeTerrarium(128, 0, 0)).toBeCloseTo(0, 6)
  expect(decodeTerrarium(128, 100, 0)).toBeCloseTo(100, 6)
  expect(decodeTerrarium(127, 156, 0)).toBeCloseTo(-100, 6)
})

test('coordenadas de tile conocidas', () => {
  expect(lonToTileX(-180, 1)).toBe(0)
  expect(lonToTileX(0, 1)).toBe(1)
  expect(latToTileY(0, 1)).toBe(1)
})

test('el bbox del Tachira son 14 x 17 = 238 tiles a z12', () => {
  const r = tileRangeForBbox(BBOX, 12)
  expect(r.nx).toBe(14)
  expect(r.ny).toBe(17)
  expect(r.nx * r.ny).toBe(238)
})

test('sampleBilinear devuelve el valor exacto en un vertice del grid', () => {
  const dem = {
    data: Float32Array.from([0, 100, 200, 300]), width: 2, height: 2,
    bounds: { s: 0, w: 0, n: 1, e: 1 },
  }
  // fila 0 es el norte: (w,n)=0 (e,n)=100 / (w,s)=200 (e,s)=300
  expect(sampleBilinear(dem, 0, 1)).toBeCloseTo(0, 5)
  expect(sampleBilinear(dem, 1, 0)).toBeCloseTo(300, 5)
  expect(sampleBilinear(dem, 0.5, 0.5)).toBeCloseTo(150, 5)
})

test('downsample reduce a 1024x1024 conservando el rango', () => {
  const w = 2048, h = 2048
  const data = new Float32Array(w * h)
  for (let i = 0; i < data.length; i++) data[i] = (i % 1000)
  const out = downsample({ data, width: w, height: h }, 1024, 1024)
  expect(out).toBeInstanceOf(Int16Array)
  expect(out.length).toBe(1024 * 1024)
  expect(Math.max(...out.slice(0, 5000))).toBeGreaterThan(0)
})

// Un post que se despega de su entorno es ruido de la fuente Terrarium, no
// relieve: sale como una aguja o un pozo al triangular. limpiarAnomalias lo
// sustituye por la mediana de su ANILLO Chebyshev r=2 -- los 16 posts del borde
// del 5x5.
//
// El anillo, y no los 8 vecinos inmediatos: el ruido de Terrarium viene casi
// siempre en GRUMOS de 2x2 o 3x3, y contra los 8 vecinos cada miembro del grumo
// tiene a sus complices pegados, asi que su desvio da ~10 m y no se dispara
// nunca. Medido sobre el DEM real (2026-09-12): de 266 anomalias de mas de
// 100 m, 205 estaban en grumo -- o sea la forma dominante era justo la que el
// criterio viejo no podia ver. El anillo r=2 queda fuera de cualquier grumo de
// hasta 3x3, asi que no se deja tapar.
//
// Se repite hasta que una pasada no corrija nada: un grumo grande se erosiona
// de afuera hacia adentro y su centro solo queda a la vista cuando ya se limpio
// lo que lo rodeaba. Sobre el DEM real una sola pasada dejaba 199 posts todavia
// anomalos; iterando quedan 0, tocando el 0,0102 % de los posts.
//
// Umbral por defecto 80 m, medido contra el DEM real del Tachira: separa los
// picos/crateres reportados del ruido normal de la rejilla sin tocar relieve
// real (una ladera recta no se mueve ni un milimetro -- ver la prueba).

/** El peor desvio interior contra la mediana del anillo r=2: lo que
 *  limpiarAnomalias tiene que dejar por debajo del umbral. */
function peorDesvio (dem) {
  const { data, width, height } = dem
  let peor = 0
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const anillo = []
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) anillo.push(data[(y + dy) * width + x + dx])
        }
      }
      anillo.sort((a, b) => a - b)
      const d = Math.abs(data[y * width + x] - (anillo[7] + anillo[8]) / 2)
      if (d > peor) peor = d
    }
  }
  return peor
}

/** Pinta un bloque cuadrado de lado `lado` con la esquina en (x0,y0). */
function grumo (dem, x0, y0, lado, valor) {
  for (let y = y0; y < y0 + lado; y++) {
    for (let x = x0; x < x0 + lado; x++) dem.data[y * dem.width + x] = valor
  }
}

test('limpiarAnomalias: aguja aislada -> se sustituye por la mediana de sus vecinos', () => {
  const dem = rejilla(5, 5, 1000)
  dem.data[2 * 5 + 2] = 1200 // (x=2,y=2), rodeada de 1000
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 1 })
  expect(dem.data[2 * 5 + 2]).toBe(1000)
})

test('limpiarAnomalias: pozo aislado -> se sustituye por la mediana de sus vecinos', () => {
  const dem = rejilla(5, 5, 1000)
  dem.data[2 * 5 + 2] = 800
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 1 })
  expect(dem.data[2 * 5 + 2]).toBe(1000)
})

test('limpiarAnomalias: una ladera real (los vecinos suben con ella) queda intacta', () => {
  const w = 5, h = 5
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = 1000 + y * 10
  const dem = { data: data.slice(), width: w, height: h }
  const r = limpiarAnomalias(dem, 80)
  expect(r).toEqual({ posts: 0 })
  expect(dem.data).toEqual(data)
})

test('limpiarAnomalias: el umbral es estricto -- justo debajo no toca, justo encima si', () => {
  const bajoUmbral = rejilla(5, 5, 1000)
  bajoUmbral.data[2 * 5 + 2] = 1079 // max(vecinos) + 79 < max + 80
  expect(limpiarAnomalias(bajoUmbral, 80)).toEqual({ posts: 0 })
  expect(bajoUmbral.data[2 * 5 + 2]).toBe(1079)

  const sobreUmbral = rejilla(5, 5, 1000)
  sobreUmbral.data[2 * 5 + 2] = 1081 // max(vecinos) + 81 > max + 80
  expect(limpiarAnomalias(sobreUmbral, 80)).toEqual({ posts: 1 })
  expect(sobreUmbral.data[2 * 5 + 2]).toBe(1000)
})

test('limpiarAnomalias: un post a menos de 2 del borde no tiene anillo y se deja intacto', () => {
  const dem = rejilla(7, 7, 1000)
  dem.data[0] = 5000            // esquina (x=0,y=0)
  dem.data[1 * 7 + 1] = 4000    // (x=1,y=1): tiene los 8 vecinos, pero no el anillo r=2
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 0 })
  expect(dem.data[0]).toBe(5000)
  expect(dem.data[1 * 7 + 1]).toBe(4000)
})

test('limpiarAnomalias: dos anomalias aisladas y separadas se corrigen las dos, cada una contra su propio anillo', () => {
  const dem = rejilla(11, 11, 1000)
  dem.data[2 * 11 + 2] = 1300 // pico, esquina superior izquierda
  dem.data[8 * 11 + 8] = 700  // pozo, esquina inferior derecha, sin anillo en comun
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 2 })
  expect(dem.data[2 * 11 + 2]).toBe(1000)
  expect(dem.data[8 * 11 + 8]).toBe(1000)
})

// Las tres que siguen son el fallo reportado: los picos que se veian en el mapa
// eran grumos, y el criterio de los 8 vecinos no podia tocarlos.

test('limpiarAnomalias: un grumo de 2x2 -- que se tapa a si mismo ante los 8 vecinos -- se corrige entero', () => {
  const dem = rejilla(9, 9, 1000)
  grumo(dem, 3, 3, 2, 1300)
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 4 })
  for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]]) {
    expect(dem.data[y * 9 + x]).toBe(1000)
  }
})

test('limpiarAnomalias: un grumo de 3x3 se corrige entero, centro incluido', () => {
  const dem = rejilla(9, 9, 1000)
  grumo(dem, 3, 3, 3, 700)
  const r = limpiarAnomalias(dem)
  expect(r).toEqual({ posts: 9 })
  expect(dem.data[4 * 9 + 4]).toBe(1000) // el centro, que no ve nada sano a su lado
})

test('limpiarAnomalias: tras limpiar, ningun post interior se desvia mas del umbral', () => {
  // Un grumo de 5x5 esconde su centro hasta del anillo r=2: hace falta volver a
  // pasar cuando la orilla ya esta limpia. Esta es la postcondicion de verdad.
  const dem = rejilla(15, 15, 1000)
  grumo(dem, 5, 5, 5, 1300)
  expect(peorDesvio(dem)).toBeGreaterThan(80) // el grumo se nota antes de limpiar
  limpiarAnomalias(dem, 80)
  expect(peorDesvio(dem)).toBeLessThanOrEqual(80)
  expect(dem.data[7 * 15 + 7]).toBe(1000)    // el centro del grumo
})

test('limpiarAnomalias: el umbral es configurable', () => {
  const dem = rejilla(5, 5, 1000)
  dem.data[2 * 5 + 2] = 1050 // desvio de 50 m
  expect(limpiarAnomalias(dem, 80)).toEqual({ posts: 0 })
  expect(limpiarAnomalias(dem, 30)).toEqual({ posts: 1 })
  expect(dem.data[2 * 5 + 2]).toBe(1000)
})
