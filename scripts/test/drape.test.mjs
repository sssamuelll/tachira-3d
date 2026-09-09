import { describe, expect, it } from 'vitest'
import { alturaEnPosts, alturaTriangulo, normalTriangulo, postDe } from '../lib/drape.mjs'
import { makeEnuFrame, geodeticToEnu } from '../lib/enu.mjs'
import { tileXToLon, tileYToLat } from '../lib/terrarium.mjs'

// DEM de juguete: una rejilla de 3x3 posts que empieza en la tesela z12
// (1223, 1948); dem.tile dice dónde está.
const dem = {
  width: 3, height: 3,
  data: new Float32Array([0, 10, 20, 30, 40, 50, 60, 70, 100]),
  tile: { z: 12, x0: 1223, y0: 1948, nx: 1, ny: 1 },
}
// lon/lat del post (c, f) con la convención de esquina de píxel, 256 posts
// por tesela: coordenada de tesela x0 + c/256.
const lonDe = c => tileXToLon(1223 + c / 256, 12)
const latDe = f => tileYToLat(1948 + f / 256, 12)

describe('alturaEnPosts', () => {
  it('devuelve el post exacto en cada vértice', () => {
    for (let f = 0; f < 3; f++) {
      for (let c = 0; c < 3; c++) expect(alturaEnPosts(dem, c, f)).toBeCloseTo(dem.data[f * 3 + c], 9)
    }
  })

  it('la diagonal va de arriba-derecha a abajo-izquierda', () => {
    // Celda (1,1): a=40 b=50 c=70 d=100, torcida a propósito. En el centro
    // manda la media de b y c; si alguien cambia la diagonal, sale la de a y d.
    expect(alturaEnPosts(dem, 1.5, 1.5)).toBeCloseTo(60, 9)
    expect(alturaEnPosts(dem, 1.5, 1.5)).not.toBeCloseTo(70, 1)
  })

  it('acota a la rejilla en vez de salirse', () => {
    expect(alturaEnPosts(dem, -1, -1)).toBeCloseTo(0, 9)
    expect(alturaEnPosts(dem, 9, 9)).toBeCloseTo(100, 9)
  })
})

describe('postDe y alturaTriangulo', () => {
  it('convierte lon/lat al post con la convención de esquina', () => {
    const [u, v] = postDe(dem, lonDe(2), latDe(1))
    expect(u).toBeCloseTo(2, 6)
    expect(v).toBeCloseTo(1, 6)
    expect(alturaTriangulo(dem, lonDe(2), latDe(1))).toBeCloseTo(50, 6)
  })
})

describe('normalTriangulo', () => {
  const frame = makeEnuFrame(latDe(1), lonDe(1), 0)

  it('es unitaria, apunta arriba, y es la del triángulo que contiene el punto', () => {
    const n = normalTriangulo(dem, frame, lonDe(1.2), latDe(1.2))   // celda (1,1), triángulo (a,c,b)
    expect(Math.hypot(...n)).toBeCloseTo(1, 9)
    expect(n[1]).toBeGreaterThan(0)
    const P = (c, f) => {
      const [e, nn, u] = geodeticToEnu(frame, latDe(f), lonDe(c), dem.data[f * 3 + c])
      return [e, u, -nn]
    }
    const a = P(1, 1), b = P(2, 1), c = P(1, 2)
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
    expect(dot(n, [b[0] - a[0], b[1] - a[1], b[2] - a[2]])).toBeCloseTo(0, 6)
    expect(dot(n, [c[0] - a[0], c[1] - a[1], c[2] - a[2]])).toBeCloseTo(0, 6)
  })

  it('un terreno plano da la vertical', () => {
    const plano = { ...dem, data: new Float32Array(9).fill(500) }
    const n = normalTriangulo(plano, frame, lonDe(1.5), latDe(1.5))
    expect(n[1]).toBeCloseTo(1, 6)
  })
})
