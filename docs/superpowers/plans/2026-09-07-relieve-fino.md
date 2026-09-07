# Relieve fino por teselas (fase A) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relieve por quadtree de teselas al DEM completo (~36 m), con las vías partidas a 30 m, apoyadas sobre la misma triangulación e inclinadas con la ladera. Cierra el hueco de la Vía a Los Llanos.

**Architecture:** El pipeline hornea una pirámide de teselas Web Mercator del DEM (z8 a z12, 257×257 con el "dentro del estado" en alpha) más el error geométrico por nodo, y escribe las vías ya apoyadas con la normal del terreno en cada vértice. El navegador selecciona nodos por error en pantalla, arma una malla de 33×33 con faldón por nodo, y las vías se extruyen en el plano del terreno con una alza de `ERROR_PX` píxeles.

**Tech Stack:** Node (pipeline, pngjs) · three@0.185 · @react-three/fiber · vitest · Playwright ad hoc.

**Spec:** `docs/superpowers/specs/2026-09-07-relieve-fino-design.md`

## Global Constraints

- Convención de rejilla única: post `(c, f)` de la tesela z12 `(tx, ty)` = coordenada de tesela `(tx + c/256, ty + f/256)` (esquina de píxel). Teselas de 257×257 para compartir el borde con la vecina.
- Diagonal de cada celda de arriba-derecha a abajo-izquierda: triángulos `(a,c,b)` y `(b,c,d)`; `fx + fy <= 1` cae en `(a,c,b)`. Igual en pipeline y navegador.
- Alpha de la tesela: 255 dentro del estado, 254 fuera (nunca 0: el canvas premultiplica y destruye el RGB).
- `ERROR_PX` vive en `src/scene/quadtree.ts` y lo importa `roadsShader.ts`. Una sola cifra.
- Nada se commitea sin que Samuel lo pida.
- Comandos: `npm test -- <archivo>`, `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run data`, `npm run verify`.

---

### Task 1: Mercator fraccionario y máscara del estado en el pipeline

**Files:**
- Modify: `scripts/lib/terrarium.mjs` (exportar `tileXf`, `tileYf`)
- Create: `scripts/lib/state-mask.mjs`
- Test: `scripts/test/terrarium.test.mjs`, `scripts/test/state-mask.test.mjs`

**Interfaces:**
- `tileXf(lon, z)`, `tileYf(lat, z)`: coordenada de tesela fraccionaria (sin `floor`). `lonToTileX === Math.floor(tileXf)`.
- `stateMask(municipios, { W, H, colOf, rowOf, latDeFila })` → `Uint8Array(W*H)`, 255 dentro. `colOf(lon)`, `rowOf(lat)` dan columna/fila fraccionarias; `latDeFila(y)` la latitud de la fila entera `y`.

- [x] **Step 1: Tests que fallan**

`scripts/test/terrarium.test.mjs`, añadir:

```js
import { tileXf, tileYf, lonToTileX, latToTileY, tileXToLon, tileYToLat } from '../lib/terrarium.mjs'

describe('tesela fraccionaria', () => {
  it('su parte entera es la tesela de siempre', () => {
    for (const [lon, lat, z] of [[-72.22, 7.77, 13], [-71.9, 8.02, 12], [-72.4878, 7.3613, 8]]) {
      expect(Math.floor(tileXf(lon, z))).toBe(lonToTileX(lon, z))
      expect(Math.floor(tileYf(lat, z))).toBe(latToTileY(lat, z))
    }
  })
  it('ida y vuelta exacta', () => {
    expect(tileXToLon(tileXf(-72.22, 12), 12)).toBeCloseTo(-72.22, 9)
    expect(tileYToLat(tileYf(7.77, 12), 12)).toBeCloseTo(7.77, 9)
  })
})
```

`scripts/test/state-mask.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stateMask } from '../lib/state-mask.mjs'
import { pointInPolygon } from '../lib/geo.mjs'
import { tileXf, tileYf, tileYToLat } from '../lib/terrarium.mjs'

const muni = (polygons) => ({ osmId: 0, name: 'x', polygons, orphanFragments: 0 })
const cuadrado = (w, e, s, n) => [[[[w, s], [e, s], [e, n], [w, n]]]]
// Rejilla uniforme en lat/lon sobre [-1, 1]²
const uniforme = (W, H) => ({
  W, H,
  colOf: lon => (lon + 1) * (W - 1) / 2,
  rowOf: lat => (1 - lat) * (H - 1) / 2,
  latDeFila: y => 1 - 2 * y / (H - 1),
})

describe('stateMask (pipeline)', () => {
  it('rellena un polígono simple y deja fuera el resto', () => {
    const m = stateMask([muni(cuadrado(-0.5, 0.5, -0.5, 0.5))], uniforme(21, 21))
    expect(m[10 * 21 + 10]).toBe(255)
    expect(m[0]).toBe(0)
    expect(m[20 * 21 + 20]).toBe(0)
  })

  it('no deja costura entre dos polígonos que comparten borde', () => {
    const W = 64, H = 64
    const m = stateMask([muni(cuadrado(-0.5, 0, -0.5, 0.5)), muni(cuadrado(0, 0.5, -0.5, 0.5))], uniforme(W, H))
    for (let y = 0; y < H; y++) {
      const fila = [...m.subarray(y * W, y * W + W)]
      const ini = fila.indexOf(255)
      if (ini < 0) continue
      expect(fila.slice(ini, fila.lastIndexOf(255) + 1).every(v => v === 255)).toBe(true)
    }
  })

  it('coincide con pointInPolygon sobre una rejilla Mercator de posts del Táchira', () => {
    const municipios = JSON.parse(readFileSync('public/data/municipios.json', 'utf8'))
    const z = 12, x0 = 1223, y0 = 1948, W = 14 * 64, H = 17 * 64   // un post de cada 4
    const rej = {
      W, H,
      colOf: lon => (tileXf(lon, z) - x0) * 64,
      rowOf: lat => (tileYf(lat, z) - y0) * 64,
      latDeFila: y => tileYToLat(y0 + y / 64, z),
    }
    const m = stateMask(municipios, rej)
    let semilla = 12345, dentro = 0, discrepan = 0
    const rnd = () => (semilla = (semilla * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let k = 0; k < 400; k++) {
      const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H)
      const lon = (x0 + x / 64) / 2 ** z * 360 - 180
      const lat = tileYToLat(y0 + y / 64, z)
      const real = municipios.some(mu => mu.polygons.some(p => pointInPolygon(lon, lat, p)))
      if (real) dentro++
      if (real !== (m[y * W + x] === 255)) discrepan++
    }
    expect(discrepan).toBe(0)
    expect(dentro).toBeGreaterThan(100)
  })
})
```

- [x] **Step 2: Verlos fallar** — `npm test -- scripts/test/terrarium.test.mjs scripts/test/state-mask.test.mjs`. Esperado: `tileXf` no exportado; módulo `state-mask.mjs` inexistente.

- [x] **Step 3: Implementar**

`terrarium.mjs`:

```js
export const tileXf = (lon, z) => (lon + 180) / 360 * 2 ** z
export const tileYf = (lat, z) => {
  const r = lat * Math.PI / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z
}
export const lonToTileX = (lon, z) => Math.floor(tileXf(lon, z))
export const latToTileY = (lat, z) => Math.floor(tileYf(lat, z))
```

`scripts/lib/state-mask.mjs`: el mismo algoritmo de `src/scene/stateMask.ts` (barrido por filas con tabla de aristas, regla semiabierta, OR entre municipios, tapado de pinchazos), con la rejilla abstracta:

```js
/** Rasteriza la unión de los municipios sobre una rejilla arbitraria: 255
 *  dentro, 0 fuera. Es src/scene/stateMask.ts con la rejilla abstraída,
 *  porque la del DEM es uniforme en Mercator y no en latitud. Se mantiene a
 *  mano en los dos sitios; el test contra pointInPolygon fija la semántica. */
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
```

- [x] **Step 4: Verlos pasar.**

---

### Task 2: Partir tramos y apoyarlos sobre la triangulación del DEM, con normal

**Files:**
- Create: `scripts/lib/subdividir.mjs`, `scripts/lib/drape.mjs`
- Test: `scripts/test/subdividir.test.mjs`, `scripts/test/drape.test.mjs`

**Interfaces:**
- `subdividir(coords, pasoM = 30)` → coords con puntos intermedios; extremos originales idénticos por referencia.
- `dem` del pipeline gana `tile: { z, x0, y0, nx, ny }` (Task 3 lo pone). `postDe(dem, lon, lat)` → `[u, v]` en posts fraccionarios, acotados a la rejilla.
- `alturaEnPosts(dem, u, v)` → altura de la triangulación. `alturaTriangulo(dem, lon, lat)`.
- `normalTriangulo(dem, frame, lon, lat)` → `[nx, ny, nz]` unitaria en ejes de three (x=este, y=arriba, z=-norte), `ny > 0`.

- [x] **Step 1: Tests que fallan**

`scripts/test/subdividir.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { subdividir } from '../lib/subdividir.mjs'
import { lineLengthMeters } from '../lib/geo.mjs'

const tramo = (a, b) => lineLengthMeters([a, b])

describe('subdividir', () => {
  const coords = [[-72.2, 7.7], [-72.19, 7.7], [-72.19, 7.705]]   // ~1,1 km y ~550 m

  it('ningún tramo mide más del paso, y los extremos originales quedan intactos', () => {
    const out = subdividir(coords, 30)
    for (let i = 1; i < out.length; i++) expect(tramo(out[i - 1], out[i])).toBeLessThanOrEqual(30.001)
    expect(out[0]).toBe(coords[0])
    expect(out[out.length - 1]).toBe(coords[2])
    expect(out).toContain(coords[1])
  })

  it('reparte cada tramo en partes iguales', () => {
    const out = subdividir([[-72.2, 7.7], [-72.19, 7.7]], 30)
    const n = out.length - 1
    const largos = out.slice(1).map((p, i) => tramo(out[i], p))
    for (const l of largos) expect(l).toBeCloseTo(largos[0], 3)
    expect(n).toBe(Math.ceil(tramo(coords[0], coords[1]) / 30))
  })

  it('no toca una vía cuyos tramos ya son cortos', () => {
    const cortos = [[-72.2, 7.7], [-72.2001, 7.7], [-72.2002, 7.7]]
    expect(subdividir(cortos, 30)).toEqual(cortos)
  })
})
```

`scripts/test/drape.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { alturaEnPosts, alturaTriangulo, normalTriangulo, postDe } from '../lib/drape.mjs'
import { makeEnuFrame, geodeticToEnu } from '../lib/enu.mjs'
import { tileXToLon, tileYToLat } from '../lib/terrarium.mjs'

// DEM de juguete: una tesela z12 de 3x3 posts (width/height 3) en la tesela
// (1223, 1948); dem.tile dice dónde está.
const dem = {
  width: 3, height: 3,
  data: new Float32Array([0, 10, 20, 30, 40, 50, 60, 70, 100]),
  tile: { z: 12, x0: 1223, y0: 1948, nx: 1, ny: 1 },
}
// lon/lat del post (c, f) con la convención de esquina de píxel a 256 posts
// por tesela: coordenada de tesela x0 + c/256.
const lonDe = c => tileXToLon(1223 + c / 256, 12)
const latDe = f => tileYToLat(1948 + f / 256, 12)

describe('alturaEnPosts', () => {
  it('devuelve el post exacto en cada vértice', () => {
    for (let f = 0; f < 3; f++) for (let c = 0; c < 3; c++) expect(alturaEnPosts(dem, c, f)).toBeCloseTo(dem.data[f * 3 + c], 9)
  })
  it('la diagonal va de arriba-derecha a abajo-izquierda', () => {
    // celda (1,1): a=40 b=50 c=70 d=100, torcida. Centro: media de b y c.
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
    // Un plano por a, c y b en ENU: la normal es perpendicular a sus aristas.
    const P = (c, f) => { const [e, nn, u] = geodeticToEnu(frame, latDe(f), lonDe(c), dem.data[f * 3 + c]); return [e, u, -nn] }
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
```

- [x] **Step 2: Verlos fallar** (módulos inexistentes).

- [x] **Step 3: Implementar**

`scripts/lib/subdividir.mjs`:

```js
import { lineLengthMeters } from './geo.mjs'

/** Inserta puntos interpolados en lon/lat para que ningún tramo pase de
 *  `pasoM`. Corre antes del drapeado: cada punto nuevo se apoya en el relieve
 *  por su cuenta, y un tramo de 30 m nunca cruza por debajo de una loma de la
 *  malla de 36 m. Los puntos originales se conservan por referencia. */
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
```

`scripts/lib/drape.mjs`:

```js
import { geodeticToEnu } from './enu.mjs'
import { tileXf, tileYf, tileXToLon, tileYToLat } from './terrarium.mjs'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** (lon, lat) → posts fraccionarios (u, v) de la rejilla del DEM, acotados. */
export function postDe (dem, lon, lat) {
  const { z, x0, y0 } = dem.tile
  return [
    clamp((tileXf(lon, z) - x0) * 256, 0, dem.width - 1),
    clamp((tileYf(lat, z) - y0) * 256, 0, dem.height - 1),
  ]
}

/** Celda y triángulo que contienen (u, v): (a,c,b) si fx + fy <= 1, si no
 *  (b,c,d). Es la diagonal de arriba-derecha a abajo-izquierda que dibuja el
 *  relieve (src/scene/nodoTerreno.ts) y que drape.ts fijó con test. */
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

/** Normal del triángulo del DEM que contiene el punto, en ejes de three
 *  (x=este, y=arriba, z=-norte), unitaria y hacia arriba. Es la del plano
 *  que el relieve dibuja ahí, así que una calzada extruida sobre ella queda
 *  pegada a la ladera. */
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
```

- [x] **Step 4: Verlos pasar.**

---

### Task 3: Pirámide del DEM, errores por nodo, y el pipeline entero

**Files:**
- Create: `scripts/lib/dem-tiles.mjs`
- Modify: `scripts/lib/terrarium.mjs` (`fetchDem` devuelve `tile`), `scripts/lib/pack.mjs` (`nrm`), `scripts/build-data.mjs`
- Test: `scripts/test/dem-tiles.test.mjs`, `scripts/test/pack.test.mjs`

**Interfaces:**
- `fetchDem` devuelve además `tile: { z, x0, y0, nx, ny }`.
- `alturaVertice(dem, z, x, y, i, j)` y `dentroVertice(dem, dentro, z, x, y, i, j)`: valor del píxel `(i, j)` (0..256) de la tesela `(z, x, y)` de la pirámide; para z = 12 es el post; para z < 12, el promedio del bloque `s×s` (`s = 2^(12-z)`) que empieza en el post correspondiente; fuera de la rejilla, 0 y fuera.
- `teselaRgba(dem, dentro, z, x, y)` → `Uint8Array(257*257*4)` (Terrarium + alpha 255/254).
- `errorNodo(dem, z, x, y)` → metros (máximo sobre los posts del nodo) o `null` si ningún post del nodo está dentro. Vértices del nodo: `(z, x, y)` píxeles `8i` de su tesela (z ≤ 12), o posts a paso `2^(15-z)` dentro de la tesela z12 ancestro (z 13, 14).
- `packRoads(lines)` devuelve también `nrm: Int8Array(segmentCount * 6)` desde `l.nrm` (una normal `[x,y,z]` por punto).

- [x] **Step 1: Tests que fallan**

`scripts/test/dem-tiles.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { alturaVertice, teselaRgba, errorNodo, encodeTerrarium } from '../lib/dem-tiles.mjs'
import { decodeTerrarium } from '../lib/terrarium.mjs'

// DEM de juguete: 2x2 teselas z12 (512x512 posts), altura = c + f.
const W = 512, H = 512
const data = new Float32Array(W * H)
for (let f = 0; f < H; f++) for (let c = 0; c < W; c++) data[f * W + c] = c + f
const dem = { width: W, height: H, data, tile: { z: 12, x0: 100, y0: 200, nx: 2, ny: 2 } }
const dentro = new Uint8Array(W * H).fill(255)

describe('encodeTerrarium', () => {
  it('ida y vuelta a 1/256 m', () => {
    for (const h of [-32768, -12.5, 0, 0.75, 1234.3, 8848]) {
      const [r, g, b] = encodeTerrarium(h)
      expect(decodeTerrarium(r, g, b)).toBeCloseTo(h, 2)
    }
  })
})

describe('alturaVertice', () => {
  it('en z12 es el post, y el píxel 256 es el primero de la vecina', () => {
    expect(alturaVertice(dem, 12, 100, 200, 5, 7)).toBe(5 + 7)
    expect(alturaVertice(dem, 12, 100, 200, 256, 0)).toBe(256)     // post 256 = tesela (101, 200), post 0
    expect(alturaVertice(dem, 12, 101, 200, 0, 0)).toBe(256)
  })
  it('en z11 es el promedio del bloque 2x2', () => {
    // píxel (1, 1) de la tesela z11 (50, 100) = bloque de posts [2,3] x [2,3]: media de 4,5,5,6 = 5
    expect(alturaVertice(dem, 11, 50, 100, 1, 1)).toBe(5)
  })
  it('fuera de la rejilla vale 0', () => {
    expect(alturaVertice(dem, 12, 102, 200, 3, 3)).toBe(0)
  })
})

describe('teselaRgba', () => {
  it('257x257 RGBA con Terrarium y alpha 255 dentro, 254 fuera', () => {
    const d2 = new Uint8Array(W * H)   // todo fuera
    const t = teselaRgba(dem, d2, 12, 100, 200)
    expect(t.length).toBe(257 * 257 * 4)
    expect(t[3]).toBe(254)
    const t1 = teselaRgba(dem, dentro, 12, 100, 200)
    expect(t1[3]).toBe(255)
    const i = (7 * 257 + 5) * 4
    expect(decodeTerrarium(t1[i], t1[i + 1], t1[i + 2])).toBeCloseTo(12, 2)
  })
})

describe('errorNodo', () => {
  it('un plano inclinado se representa sin error a cualquier nivel', () => {
    for (const [z, x, y] of [[12, 100, 200], [11, 50, 100], [13, 200, 400], [14, 400, 800]]) {
      expect(errorNodo(dem, dentro, z, x, y)).toBeCloseTo(0, 6)
    }
  })
  it('un pico entre vértices sí da error, y decrece al refinar', () => {
    const d = new Float32Array(W * H)
    d[100 * W + 100] = 80                               // un post aislado
    const dem2 = { ...dem, data: d }
    const e12 = errorNodo(dem2, dentro, 12, 100, 200)   // vértices cada 8 posts: el post 100 no es vértice (100 % 8 = 4)
    const e14 = errorNodo(dem2, dentro, 14, 400, 800)   // paso 2: tampoco
    expect(e12).toBeCloseTo(80, 3)
    expect(e14).toBeCloseTo(80, 3)
    const d3 = new Float32Array(W * H); d3[104 * W + 104] = 80   // 104 % 8 = 0: es vértice en z12
    expect(errorNodo({ ...dem, data: d3 }, dentro, 12, 100, 200)).toBeCloseTo(0, 3)
  })
  it('un nodo sin ningún post dentro devuelve null', () => {
    expect(errorNodo(dem, new Uint8Array(W * H), 12, 100, 200)).toBeNull()
  })
})
```

`scripts/test/pack.test.mjs`, añadir:

```js
it('escribe una normal Int8 por extremo de tramo, desde l.nrm', () => {
  const lines = [{ enu: [[0, 0, 0], [10, 0, 0], [20, 0, 0]], nrm: [[0, 1, 0], [0.6, 0.8, 0], [0, 0, 1]] }]
  const { nrm, segmentCount } = packRoads(lines)
  expect(segmentCount).toBe(2)
  expect(Array.from(nrm)).toEqual([0, 127, 0, 76, 102, 0, 76, 102, 0, 0, 0, 127])
})
```

- [x] **Step 2: Verlos fallar.**

- [x] **Step 3: Implementar `dem-tiles.mjs`**

```js
import { PNG } from 'pngjs'
import { writeFile, mkdir } from 'node:fs/promises'
import { alturaEnPosts } from './drape.mjs'

export const LADO = 257   // 256 posts más el borde compartido con la vecina

export function encodeTerrarium (h) {
  const v = Math.max(0, Math.min(65535.996, h + 32768))
  const r = Math.floor(v / 256), g = Math.floor(v % 256)
  const b = Math.min(255, Math.round((v - Math.floor(v)) * 256))
  return [r, g, b]
}

/** Post (c, f) de la rejilla global G que corresponde al píxel (i, j) de la
 *  tesela (z, x, y) de la pirámide, y el tamaño s del bloque que promedia. */
function origen (dem, z, x, y) {
  const s = 2 ** (12 - z)
  return { s, c0: (x * s - dem.tile.x0) * 256, f0: (y * s - dem.tile.y0) * 256 }
}

function promedio (arr, W, H, c, f, s) {
  let suma = 0, n = 0
  for (let ff = f; ff < f + s; ff++) {
    if (ff < 0 || ff >= H) continue
    for (let cc = c; cc < c + s; cc++) {
      if (cc < 0 || cc >= W) continue
      suma += arr[ff * W + cc]; n++
    }
  }
  return n ? suma / n : 0
}

export function alturaVertice (dem, z, x, y, i, j) {
  const { s, c0, f0 } = origen(dem, z, x, y)
  return promedio(dem.data, dem.width, dem.height, c0 + i * s, f0 + j * s, s)
}

export function dentroVertice (dem, dentro, z, x, y, i, j) {
  const { s, c0, f0 } = origen(dem, z, x, y)
  return promedio(dentro, dem.width, dem.height, c0 + i * s, f0 + j * s, s) > 0
}

export function teselaRgba (dem, dentro, z, x, y) {
  const out = new Uint8Array(LADO * LADO * 4)
  for (let j = 0; j < LADO; j++) {
    for (let i = 0; i < LADO; i++) {
      const [r, g, b] = encodeTerrarium(alturaVertice(dem, z, x, y, i, j))
      const o = (j * LADO + i) * 4
      out[o] = r; out[o + 1] = g; out[o + 2] = b
      // 254 y no 0 fuera: el canvas del navegador premultiplica por alpha y
      // con 0 destruye el RGB; con 254 el error es de un metro en posts que
      // solo dan forma al borde que se descarta.
      out[o + 3] = dentroVertice(dem, dentro, z, x, y, i, j) ? 255 : 254
    }
  }
  return out
}

/** Error geométrico del nodo (z, x, y): máximo sobre sus posts de |superficie
 *  que dibuja el navegador − post|. El navegador arma el nodo con 33×33
 *  vértices: píxeles 8i de la tesela de su nivel si z ≤ 12, o posts a paso
 *  2^(15−z) de la tesela z12 ancestro si z > 12 (nodoTerreno.ts). Acá se
 *  reproduce esa superficie con la misma diagonal (alturaEnPosts sobre una
 *  rejilla de 33×33) y se compara. null si el nodo no tiene un post dentro. */
export function errorNodo (dem, dentro, z, x, y) {
  const k = Math.max(0, z - 12)
  const zt = Math.min(z, 12), xt = x >> k, yt = y >> k
  const paso = 8 >> k                                   // píxeles de la tesela entre vértices
  const off = { i: ((x & ((1 << k) - 1)) * 256) >> k, j: ((y & ((1 << k) - 1)) * 256) >> k }
  const rej = { width: 33, height: 33, data: new Float32Array(33 * 33) }
  for (let j = 0; j <= 32; j++) for (let i = 0; i <= 32; i++) rej.data[j * 33 + i] = alturaVertice(dem, zt, xt, yt, off.i + i * paso, off.j + j * paso)
  // Posts del nodo en G.
  const { s, c0, f0 } = origen(dem, zt, xt, yt)
  const cIni = c0 + off.i * s, fIni = f0 + off.j * s, ancho = 32 * paso * s
  let peor = 0, alguno = false
  for (let f = Math.max(0, fIni); f <= Math.min(dem.height - 1, fIni + ancho); f++) {
    for (let c = Math.max(0, cIni); c <= Math.min(dem.width - 1, cIni + ancho); c++) {
      if (!dentro[f * dem.width + c]) continue
      alguno = true
      const h = alturaEnPosts(rej, (c - cIni) / (paso * s), (f - fIni) / (paso * s))
      const d = Math.abs(h - dem.data[f * dem.width + c])
      if (d > peor) peor = d
    }
  }
  return alguno ? peor : null
}

/** Escribe public/data/dem/{z}/{x}/{y}.png para z8..z12 y errores.json para
 *  z8..z14. Devuelve cuántas teselas y nodos salieron. */
export async function escribirPiramide (dem, dentro, dir) {
  const { x0, y0, nx, ny } = dem.tile
  let teselas = 0
  const errores = {}
  for (let z = 8; z <= 14; z++) {
    const k = z - 12
    const xa = k >= 0 ? x0 << k : x0 >> -k, xb = k >= 0 ? ((x0 + nx) << k) - 1 : (x0 + nx - 1) >> -k
    const ya = k >= 0 ? y0 << k : y0 >> -k, yb = k >= 0 ? ((y0 + ny) << k) - 1 : (y0 + ny - 1) >> -k
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const e = errorNodo(dem, dentro, z, x, y)
        if (e == null) continue
        errores[`${z}/${x}/${y}`] = +e.toFixed(2)
        if (z <= 12) {
          const png = new PNG({ width: LADO, height: LADO })
          png.data.set(teselaRgba(dem, dentro, z, x, y))
          await mkdir(`${dir}/${z}/${x}`, { recursive: true })
          await writeFile(`${dir}/${z}/${x}/${y}.png`, PNG.sync.write(png))
          teselas++
        }
      }
    }
  }
  await writeFile(`${dir}/errores.json`, JSON.stringify(errores))
  return { teselas, nodos: Object.keys(errores).length }
}
```

`terrarium.mjs` `fetchDem`: devolver `{ data, width, height, bounds, tile: { z, x0: r.x0, y0: r.y0, nx: r.nx, ny: r.ny } }`.

`pack.mjs`: `nrm = new Int8Array(segmentCount * 6)`; por tramo `k`, escribir `Math.round(v * 127)` de `l.nrm[k-1]` y `l.nrm[k]`; devolver `nrm`.

- [x] **Step 4: `build-data.mjs`**

- Tras `waysToLines` y `orientar`: `l.coords = subdividir(l.coords)`.
- Paso 5 (drapeado): `heights = l.coords.map(([lon, lat]) => alturaTriangulo(dem, lon, lat))`, `l.nrm = l.coords.map(([lon, lat]) => normalTriangulo(dem, frame, lon, lat))`.
- Paso 6: `writeBin(`${OUT}/roads-nrm.bin`, packed.nrm)`.
- Paso 8: después de escribir `terrain.bin`, `const dentro = stateMask(municipios, rejillaDem(dem))` con `rejillaDem = dem => ({ W: dem.width, H: dem.height, colOf: lon => (tileXf(lon, 12) - dem.tile.x0) * 256, rowOf: lat => (tileYf(lat, 12) - dem.tile.y0) * 256, latDeFila: f => tileYToLat(dem.tile.y0 + f / 256, 12) })`, luego `escribirPiramide(dem, dentro, `${OUT}/dem`)`; `terrain.json` gana `dem: dem.tile`. Log de teselas y nodos.
- `npm run data` y `npm run verify`. Esperado: ~348 teselas, ~700.000 tramos, `verify` en verde.

- [x] **Step 5: Verlos pasar** (tests + data regenerada).

---

### Task 4: Navegador: Mercator, carga de `nrm`, `TerrainMeta.dem`

**Files:**
- Create: `src/data/mercator.ts`, `src/data/mercator.test.ts`
- Modify: `src/data/types.ts`, `src/data/load.ts`, `src/data/load.test.ts`

**Interfaces:**
- `xTesela(lon, z)`, `yTesela(lat, z)`, `lonDeTesela(x, z)`, `latDeTesela(y, z)`.
- `TerrainMeta.dem: { z: number; x0: number; y0: number; nx: number; ny: number }`.
- `checkCoherence(roads, positions, segIds, index, nrm: Int8Array)`; `loadAll` devuelve `normals: Int8Array` y ya no redrapea.

- [x] **Step 1: Tests que fallan**

`mercator.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { xTesela, yTesela, lonDeTesela, latDeTesela } from './mercator'

describe('mercator', () => {
  it('San Cristóbal cae en la tesela 2452/3919 a z13', () => {
    expect(Math.floor(xTesela(-72.22, 13))).toBe(2452)
    expect(Math.floor(yTesela(7.77, 13))).toBe(3919)
  })
  it('ida y vuelta', () => {
    expect(lonDeTesela(xTesela(-72.22, 12), 12)).toBeCloseTo(-72.22, 9)
    expect(latDeTesela(yTesela(7.77, 12), 12)).toBeCloseTo(7.77, 9)
  })
})
```

`load.test.ts`: los tests de `checkCoherence` pasan `nrm` (un `Int8Array(segIds.length * 6)`) y uno nuevo:

```ts
test('checkCoherence lanza si roads-nrm.bin no trae seis bytes por segmento', () => {
  const roads: RoadsMeta = { count: 1, ways: [] }
  expect(() => checkCoherence(roads, new Float32Array(6), new Float32Array(1), new Uint32Array([0, 1]), new Int8Array(5)))
    .toThrow(/roads-nrm/)
})
```

- [x] **Step 2: Verlos fallar.**

- [x] **Step 3: Implementar**

`mercator.ts`:

```ts
// Teselas Web Mercator (z/x/y), la misma matemática que scripts/lib/terrarium.mjs.
export const xTesela = (lon: number, z: number): number => (lon + 180) / 360 * 2 ** z
export const yTesela = (lat: number, z: number): number => {
  const r = lat * Math.PI / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z
}
export const lonDeTesela = (x: number, z: number): number => x / 2 ** z * 360 - 180
export const latDeTesela = (y: number, z: number): number =>
  Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI
```

`types.ts`: `dem: { z: number; x0: number; y0: number; nx: number; ny: number }` en `TerrainMeta`.

`load.ts`: quitar el import y la llamada a `redrapear` (con su comentario; el nuevo dice que las posiciones llegan apoyadas desde el pipeline sobre la triangulación del DEM que dibuja el nivel fino, nodoTerreno.ts); `checkCoherence` gana:

```ts
  if (nrm.length !== segIds.length * 6) {
    throw new Error(`roads-nrm.bin incoherente: ${nrm.length} bytes, esperado 6 por segmento = ${segIds.length * 6}`)
  }
```

`loadAll` carga `/data/roads-nrm.bin` → `normals = new Int8Array(nBuf)` y lo devuelve.

- [x] **Step 4: Verlos pasar** y `npx tsc --noEmit` (fallará en `App.tsx`/`Terrain.tsx` por `dem`: se arregla en Task 6; seguir).

---

### Task 5: Teselas en el navegador y selección del quadtree

**Files:**
- Create: `src/scene/demTiles.ts`, `src/scene/demTiles.test.ts`, `src/scene/quadtree.ts`, `src/scene/quadtree.test.ts`

**Interfaces:**
- `LADO = 257`. `Tesela = { alturas: Float32Array; dentro: Uint8Array; min: number; max: number }`.
- `decodificar(rgba: Uint8ClampedArray | Uint8Array): Tesela` (Terrarium, alpha 255 = dentro).
- `class CacheTeselas { constructor(base = '/data/dem', max = 400); get(z, x, y): Tesela | undefined; pedir(z, x, y): void }`.
- `ERROR_PX = 2`. `Nodo = { z: number; x: number; y: number }`. `clave(n) = \`${z}/${x}/${y}\``. `hijos(n): Nodo[]`.
- `seleccionar(raices, vista: { intersecta(caja: Box3): boolean; posicion: Vector3; mpp(d: number): number }, datos: { error(n): number | null; listo(n): boolean; pedir(n): void; caja(n): Box3 }, zMax): Nodo[]`.

- [x] **Step 1: Tests que fallan**

`demTiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { decodificar, LADO } from './demTiles'

describe('decodificar', () => {
  it('lee Terrarium y el alpha 255 como dentro', () => {
    const rgba = new Uint8Array(LADO * LADO * 4)
    // post (3, 2) = 1234.5 m: v = 1234.5 + 32768 = 34002.5 -> r=132, g=210, b=128
    const o = (2 * LADO + 3) * 4
    rgba[o] = 132; rgba[o + 1] = 210; rgba[o + 2] = 128; rgba[o + 3] = 255
    const t = decodificar(rgba)
    expect(t.alturas[2 * LADO + 3]).toBeCloseTo(1234.5, 2)
    expect(t.dentro[2 * LADO + 3]).toBe(1)
    expect(t.dentro[0]).toBe(0)
    expect(t.max).toBeCloseTo(1234.5, 2)
    expect(t.min).toBeCloseTo(-32768, 2)
  })
})
```

`quadtree.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { ERROR_PX, clave, hijos, seleccionar, type Nodo } from './quadtree'

const todo = { intersecta: () => true }
// Cajas de 1000 m de lado en el origen, sin altura, y un error fijo por nivel.
const datos = (errorPorZ: Record<number, number | null>, listos = (n: Nodo) => true) => {
  const pedidos: string[] = []
  return {
    pedidos,
    error: (n: Nodo) => errorPorZ[n.z] ?? null,
    listo: listos,
    pedir: (n: Nodo) => { pedidos.push(clave(n)) },
    caja: () => new Box3(new Vector3(-500, 0, -500), new Vector3(500, 0, 500)),
  }
}
const vista = (d: number, mpp = (dist: number) => dist / 1000) => ({ ...todo, posicion: new Vector3(0, d, 0), mpp })
const raiz: Nodo = { z: 8, x: 76, y: 121 }

describe('hijos', () => {
  it('los cuatro de z+1, en orden', () => {
    expect(hijos({ z: 8, x: 76, y: 121 }).map(clave)).toEqual(['9/152/242', '9/153/242', '9/152/243', '9/153/243'])
  })
})

describe('seleccionar', () => {
  it('a lo lejos dibuja la raíz sin pedir nada', () => {
    // error 100 m a 100 km = 1 px < ERROR_PX
    const d = datos({ 8: 100, 9: 50 })
    expect(seleccionar([raiz], vista(100_000), d, 15).map(clave)).toEqual(['8/76/121'])
    expect(d.pedidos).toEqual([])
  })

  it('de cerca subdivide hasta que el error proyectado baja de ERROR_PX', () => {
    // a 10 km: 100 m = 10 px -> subdivide; 50 m = 5 px -> subdivide; 10 m = 1 px -> se queda en z10
    const d = datos({ 8: 100, 9: 50, 10: 10, 11: 5 })
    const sel = seleccionar([raiz], vista(10_000), d, 15)
    expect(sel.every(n => n.z === 10)).toBe(true)
    expect(sel).toHaveLength(16)
  })

  it('respeta zMax', () => {
    const d = datos({ 8: 100, 9: 100, 10: 100, 11: 100 })
    expect(seleccionar([raiz], vista(1_000), d, 9).every(n => n.z === 9)).toBe(true)
  })

  it('si faltan hijos, pide los que existen y dibuja al padre', () => {
    const d = datos({ 8: 100, 9: 50 }, n => n.z === 8)
    const sel = seleccionar([raiz], vista(10_000), d, 15)
    expect(sel.map(clave)).toEqual(['8/76/121'])
    expect(d.pedidos).toHaveLength(4)
  })

  it('un hijo vacío (error null) ni se pide ni se dibuja', () => {
    const d = datos({ 8: 100, 9: 50 }, n => n.z === 8)
    d.error = (n: Nodo) => (n.z === 9 && n.x === 152 ? null : ({ 8: 100, 9: 50 } as Record<number, number>)[n.z] ?? null)
    seleccionar([raiz], vista(10_000), d, 15)
    expect(d.pedidos).toHaveLength(2)
  })

  it('fuera del frustum no dibuja ni pide', () => {
    const d = datos({ 8: 100, 9: 50 })
    const sel = seleccionar([raiz], { ...vista(10_000), intersecta: () => false }, d, 15)
    expect(sel).toEqual([])
    expect(d.pedidos).toEqual([])
  })

  it('ERROR_PX es 2', () => { expect(ERROR_PX).toBe(2) })
})
```

- [x] **Step 2: Verlos fallar.**

- [x] **Step 3: Implementar**

`demTiles.ts`:

```ts
export const LADO = 257

export interface Tesela { alturas: Float32Array; dentro: Uint8Array; min: number; max: number }

/** Terrarium: h = r*256 + g + b/256 − 32768. Alpha 255 = dentro del estado
 *  (254 fuera; el pipeline no usa 0 porque el canvas premultiplica). */
export function decodificar (rgba: Uint8ClampedArray | Uint8Array): Tesela {
  const n = LADO * LADO
  const alturas = new Float32Array(n)
  const dentro = new Uint8Array(n)
  let min = Infinity, max = -Infinity
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const h = rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256 - 32768
    alturas[i] = h
    dentro[i] = rgba[o + 3] === 255 ? 1 : 0
    if (h < min) min = h
    if (h > max) max = h
  }
  return { alturas, dentro, min, max }
}

/** Carga perezosa con LRU. Una petición en vuelo por clave; un fallo de red
 *  se olvida para poder reintentar. */
export class CacheTeselas {
  private readonly teselas = new Map<string, Tesela>()
  private readonly enVuelo = new Set<string>()
  constructor (private readonly base = '/data/dem', private readonly max = 400) {}

  get (z: number, x: number, y: number): Tesela | undefined {
    const k = `${z}/${x}/${y}`
    const t = this.teselas.get(k)
    if (t) { this.teselas.delete(k); this.teselas.set(k, t) }   // al final: recién usada
    return t
  }

  pedir (z: number, x: number, y: number): void {
    const k = `${z}/${x}/${y}`
    if (this.teselas.has(k) || this.enVuelo.has(k)) return
    this.enVuelo.add(k)
    fetch(`${this.base}/${k}.png`)
      .then(r => { if (!r.ok) throw new Error(`${k}: HTTP ${r.status}`); return r.blob() })
      .then(b => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then(bmp => {
        const cv = new OffscreenCanvas(LADO, LADO)
        const ctx = cv.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(bmp, 0, 0)
        bmp.close()
        this.teselas.set(k, decodificar(ctx.getImageData(0, 0, LADO, LADO).data))
        while (this.teselas.size > this.max) this.teselas.delete(this.teselas.keys().next().value!)
      })
      .catch(e => console.warn('tesela', k, e))
      .finally(() => this.enVuelo.delete(k))
  }
}
```

`quadtree.ts`:

```ts
import type { Box3, Vector3 } from 'three'

/** Tolerancia del LOD en píxeles: un nodo se subdivide mientras su error
 *  geométrico proyectado pase de esto, y las vías se levantan exactamente
 *  esto (roadsShader.ts) para que el relieve dibujado nunca las tape. */
export const ERROR_PX = 2

export interface Nodo { z: number; x: number; y: number }
export const clave = (n: Nodo): string => `${n.z}/${n.x}/${n.y}`
export const hijos = (n: Nodo): Nodo[] => [
  { z: n.z + 1, x: n.x * 2, y: n.y * 2 }, { z: n.z + 1, x: n.x * 2 + 1, y: n.y * 2 },
  { z: n.z + 1, x: n.x * 2, y: n.y * 2 + 1 }, { z: n.z + 1, x: n.x * 2 + 1, y: n.y * 2 + 1 },
]

export interface Vista { intersecta (caja: Box3): boolean; posicion: Vector3; mpp (d: number): number }
export interface Datos {
  /** Error geométrico en metros; null = nodo vacío (ningún post dentro del estado). */
  error (n: Nodo): number | null
  listo (n: Nodo): boolean
  pedir (n: Nodo): void
  caja (n: Nodo): Box3
}

/** Los nodos a dibujar este cuadro. Puro: decide, no carga ni dibuja. */
export function seleccionar (raices: Nodo[], vista: Vista, datos: Datos, zMax: number): Nodo[] {
  const salida: Nodo[] = []
  const visitar = (n: Nodo) => {
    const error = datos.error(n)
    if (error == null) return
    if (!datos.listo(n)) { datos.pedir(n); return }
    const caja = datos.caja(n)
    if (!vista.intersecta(caja)) return
    if (n.z < zMax) {
      const d = Math.max(1, caja.distanceToPoint(vista.posicion))
      if (error / vista.mpp(d) > ERROR_PX) {
        const h = hijos(n).filter(c => datos.error(c) != null)
        if (h.every(c => datos.listo(c))) { for (const c of h) visitar(c); return }
        for (const c of h) if (!datos.listo(c)) datos.pedir(c)
      }
    }
    salida.push(n)
  }
  for (const r of raices) visitar(r)
  return salida
}
```

- [x] **Step 4: Verlos pasar.**

---

### Task 6: La malla de cada nodo y el componente de relieve

**Files:**
- Create: `src/scene/nodoTerreno.ts`, `src/scene/nodoTerreno.test.ts`, `src/scene/TerrainLod.tsx`
- Delete: `src/scene/Terrain.tsx`
- Modify: `src/App.tsx`, `src/scene/PickingPass.tsx` (oclusor), `src/scene/terrainShader.ts` (solo comentario)

**Interfaces:**
- `ventana(n: Nodo, dem: TerrainMeta['dem'])` → `{ zt, xt, yt, paso, offI, offJ }`: tesela de la pirámide que alimenta al nodo y dónde caen sus 33×33 vértices.
- `geometriaNodo(n, tesela, dem, frame)` → `{ geometry: BufferGeometry; caja: Box3 }`. 33×33 + faldón, atributos `position`, `normal`, `elevation`, `inside`.
- `raices(dem)` → las teselas z8 ancestros del rango.
- `<TerrainLod meta />`: grupo `name="terrain"` con un `Mesh` por nodo seleccionado.

- [x] **Step 1: Tests que fallan**

`nodoTerreno.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { geometriaNodo, ventana, raices, VERTICES, LADO_NODO } from './nodoTerreno'
import { LADO, type Tesela } from './demTiles'
import { makeEnuFrame } from '../data/enu'

const dem = { z: 12, x0: 1223, y0: 1948, nx: 14, ny: 17 }

describe('ventana', () => {
  it('z ≤ 12 lee su propia tesela cada 8 píxeles', () => {
    expect(ventana({ z: 11, x: 611, y: 974 }, dem)).toEqual({ zt: 11, xt: 611, yt: 974, paso: 8, offI: 0, offJ: 0 })
  })
  it('z 13 a 15 leen la tesela z12 ancestro con paso 4, 2 y 1', () => {
    expect(ventana({ z: 13, x: 2447, y: 3897, }, dem)).toEqual({ zt: 12, xt: 1223, yt: 1948, paso: 4, offI: 128, offJ: 128 })
    expect(ventana({ z: 15, x: 9784 + 3, y: 15584 + 5 }, dem)).toEqual({ zt: 12, xt: 1223, yt: 1948, paso: 1, offI: 96, offJ: 160 })
  })
})

describe('raices', () => {
  it('son las 4 teselas z8 que cubren el rango z12', () => {
    expect(raices(dem)).toEqual([{ z: 8, x: 76, y: 121 }, { z: 8, x: 77, y: 121 }, { z: 8, x: 76, y: 122 }, { z: 8, x: 77, y: 122 }])
  })
})

describe('geometriaNodo', () => {
  const frame = makeEnuFrame(8.021973, -71.901563, 0)
  // Tesela plana a 1000 m, toda dentro, salvo la fila 0 que está fuera.
  const alturas = new Float32Array(LADO * LADO).fill(1000)
  const dentro = new Uint8Array(LADO * LADO).fill(1)
  dentro.fill(0, 0, LADO)
  const tesela: Tesela = { alturas, dentro, min: 1000, max: 1000 }

  it('33x33 vértices más el faldón, y los triángulos que tocan', () => {
    const { geometry } = geometriaNodo({ z: 12, x: 1230, y: 1956 }, tesela, dem, frame)
    expect(geometry.getAttribute('position').count).toBe(VERTICES + 4 * LADO_NODO)
    expect(geometry.getIndex()!.count).toBe((32 * 32 * 2 + 4 * 32 * 2) * 3)
    expect(geometry.getAttribute('inside').count).toBe(VERTICES + 4 * LADO_NODO)
    expect(geometry.getAttribute('elevation').array[0]).toBe(1000)
  })

  it('el faldón cuelga por debajo del borde y hereda su normal', () => {
    const { geometry } = geometriaNodo({ z: 12, x: 1230, y: 1956 }, tesela, dem, frame)
    const pos = geometry.getAttribute('position'), nor = geometry.getAttribute('normal')
    const borde = 0, faldon = VERTICES   // el primer vértice del faldón copia al (0,0)
    expect(pos.getY(faldon)).toBeLessThan(pos.getY(borde) - 4)
    expect(nor.getX(faldon)).toBeCloseTo(nor.getX(borde), 6)
    expect(nor.getY(faldon)).toBeCloseTo(nor.getY(borde), 6)
  })

  it('la caja envuelve todos los vértices y el terreno plano da normales verticales', () => {
    const { geometry, caja } = geometriaNodo({ z: 12, x: 1230, y: 1956 }, tesela, dem, frame)
    const pos = geometry.getAttribute('position'), nor = geometry.getAttribute('normal')
    for (let i = 0; i < VERTICES; i++) {
      expect(caja.containsPoint({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) } as any)).toBe(true)
      expect(nor.getY(i)).toBeGreaterThan(0.99)
    }
  })

  it('inside sale de la tesela: la fila 0 va fuera', () => {
    const { geometry } = geometriaNodo({ z: 12, x: 1230, y: 1956 }, tesela, dem, frame)
    const ins = geometry.getAttribute('inside')
    expect(ins.getX(0)).toBe(0)            // fila 0
    expect(ins.getX(33)).toBeGreaterThan(0.5) // fila 1
  })
})
```

- [x] **Step 2: Verlos fallar.**

- [x] **Step 3: Implementar `nodoTerreno.ts`**

```ts
import * as THREE from 'three'
import { geodeticToEnu, type EnuFrame } from '../data/enu'
import { lonDeTesela, latDeTesela } from '../data/mercator'
import { LADO, type Tesela } from './demTiles'
import type { Nodo } from './quadtree'
import type { TerrainMeta } from '../data/types'

export const LADO_NODO = 33                 // vértices por lado
export const VERTICES = LADO_NODO * LADO_NODO
const CELDAS = LADO_NODO - 1

type Dem = TerrainMeta['dem']

/** Qué tesela de la pirámide alimenta al nodo y dónde caen sus vértices:
 *  píxel (offI + i·paso, offJ + j·paso). z ≤ 12 lee su propia tesela cada 8
 *  píxeles; z13 a z15 leen la tesela z12 ancestro a paso 4, 2 y 1. Es la
 *  misma regla que errorNodo (scripts/lib/dem-tiles.mjs) usa para medir el
 *  error, así que el error mide exactamente lo que se dibuja. */
export function ventana (n: Nodo, dem: Dem) {
  const k = Math.max(0, n.z - dem.z)
  return {
    zt: Math.min(n.z, dem.z), xt: n.x >> k, yt: n.y >> k, paso: 8 >> k,
    offI: ((n.x & ((1 << k) - 1)) * 256) >> k, offJ: ((n.y & ((1 << k) - 1)) * 256) >> k,
  }
}

export function raices (dem: Dem): Nodo[] {
  const k = dem.z - 8
  const out: Nodo[] = []
  for (let y = dem.y0 >> k; y <= (dem.y0 + dem.ny - 1) >> k; y++) {
    for (let x = dem.x0 >> k; x <= (dem.x0 + dem.nx - 1) >> k; x++) out.push({ z: 8, x, y })
  }
  return out
}

// Cuánto cuelga el faldón: contra la grieta entre dos niveles vecinos, que
// mide el error del nodo grueso. Calibrable.
const FALDON_MIN = 5
const FALDON_REL = 0.02

export function geometriaNodo (n: Nodo, tesela: Tesela, dem: Dem, frame: EnuFrame, error = 0) {
  const { paso, offI, offJ } = ventana(n, dem)
  const total = VERTICES + 4 * LADO_NODO
  const pos = new Float32Array(total * 3)
  const elev = new Float32Array(total)
  const ins = new Uint8Array(total)
  const caja = new THREE.Box3()
  const v = new THREE.Vector3()
  const escala = 2 ** n.z
  for (let j = 0; j < LADO_NODO; j++) {
    const lat = latDeTesela((n.y + j / CELDAS), n.z)
    for (let i = 0; i < LADO_NODO; i++) {
      const lon = lonDeTesela((n.x + i / CELDAS), n.z)
      const p = (offJ + j * paso) * LADO + (offI + i * paso)
      const h = tesela.alturas[p]
      const [e, no, u] = geodeticToEnu(frame, lat, lon, h)
      const k = j * LADO_NODO + i
      pos[k * 3] = e; pos[k * 3 + 1] = u; pos[k * 3 + 2] = -no
      elev[k] = h
      ins[k] = tesela.dentro[p] ? 255 : 0
      caja.expandByPoint(v.set(e, u, -no))
    }
  }
  void escala
  // Índices de la rejilla, con la diagonal de arriba-derecha a abajo-izquierda:
  // (a,c,b) y (b,c,d). Misma regla que alturaEnPosts en el pipeline.
  const idx: number[] = []
  for (let j = 0; j < CELDAS; j++) {
    for (let i = 0; i < CELDAS; i++) {
      const a = j * LADO_NODO + i, b = a + 1, c = a + LADO_NODO, d = c + 1
      idx.push(a, c, b, b, c, d)
    }
  }
  // Normales sobre la rejilla sola: el faldón no debe torcerlas.
  const interior = new THREE.BufferGeometry()
  interior.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, VERTICES * 3), 3))
  interior.setIndex(idx)
  interior.computeVertexNormals()
  const nor = new Float32Array(total * 3)
  nor.set(interior.getAttribute('normal').array as Float32Array)

  // Faldón: los cuatro bordes copiados hacia abajo. Orden: norte (j=0, i
  // creciente), sur (j=32), oeste (i=0, j creciente), este (i=32).
  const cuelga = Math.max(FALDON_MIN, error) + FALDON_REL * caja.getSize(v).x
  const bordes: number[][] = [[], [], [], []]
  for (let t = 0; t < LADO_NODO; t++) {
    bordes[0].push(t); bordes[1].push(CELDAS * LADO_NODO + t)
    bordes[2].push(t * LADO_NODO); bordes[3].push(t * LADO_NODO + CELDAS)
  }
  let k = VERTICES
  bordes.forEach((b, q) => {
    const base = k
    for (const src of b) {
      pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - cuelga; pos[k * 3 + 2] = pos[src * 3 + 2]
      nor[k * 3] = nor[src * 3]; nor[k * 3 + 1] = nor[src * 3 + 1]; nor[k * 3 + 2] = nor[src * 3 + 2]
      elev[k] = elev[src]; ins[k] = ins[src]
      k++
    }
    for (let t = 0; t < CELDAS; t++) {
      const s0 = b[t], s1 = b[t + 1], f0 = base + t, f1 = base + t + 1
      // El norte y el oeste miran hacia afuera con un orden; el sur y el este con el otro.
      if (q === 0 || q === 3) idx.push(s0, f0, s1, s1, f0, f1)
      else idx.push(s0, s1, f0, f0, s1, f1)
    }
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geometry.setAttribute('elevation', new THREE.BufferAttribute(elev, 1))
  geometry.setAttribute('inside', new THREE.BufferAttribute(ins, 1, true))
  geometry.setIndex(idx)
  caja.expandByPoint(v.set(caja.min.x, caja.min.y - cuelga, caja.min.z))
  return { geometry, caja }
}
```

- [x] **Step 4: `TerrainLod.tsx`**

```tsx
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { makeEnuFrame } from '../data/enu'
import { metrosPorPixel } from './roadStyle'
import { terrainVert, terrainFrag } from './terrainShader'
import { CacheTeselas } from './demTiles'
import { seleccionar, clave, type Nodo } from './quadtree'
import { geometriaNodo, raices, ventana } from './nodoTerreno'
import type { TerrainMeta } from '../data/types'

// Nivel más fino de esta fase: z15 es la superficie exacta del DEM y no hay
// imagen que justifique ir más abajo (eso es la fase B).
const Z_MAX = 15
// Geometrías que se conservan aunque no se dibujen, para no rearmar el nodo
// al volver a él. Un nodo son ~1.200 vértices: 800 nodos, ~50 MB. Calibrable.
const GEOMETRIAS_MAX = 800

export function TerrainLod ({ meta }: { meta: TerrainMeta }) {
  const { camera, size } = useThree()
  const grupo = useRef<THREE.Group>(null)
  const frame = useMemo(() => makeEnuFrame(meta.origin.lat, meta.origin.lon, meta.origin.h), [meta])
  const cache = useMemo(() => new CacheTeselas(), [])
  const errores = useRef<Record<string, number> | null>(null)
  useEffect(() => { fetch('/data/dem/errores.json').then(r => r.json()).then(e => { errores.current = e }) }, [])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: terrainVert, fragmentShader: terrainFrag,
    uniforms: { uMin: { value: meta.min }, uMax: { value: meta.max }, uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) } },
  }), [meta])

  // Nodo -> malla armada (visible o no), en orden de uso para la LRU.
  const mallas = useMemo(() => new Map<string, { mesh: THREE.Mesh; caja: THREE.Box3 }>(), [])
  const frustum = useMemo(() => new THREE.Frustum(), [])
  const m4 = useMemo(() => new THREE.Matrix4(), [])

  const errorDe = (n: Nodo): number | null => {
    const e = errores.current
    if (!e) return n.z === 8 ? 1e9 : null   // sin errores.json todavía: solo raíces, y grandes para que refine en cuanto llegue
    if (n.z <= 14) return e[clave(n)] ?? null
    return e[clave({ z: 14, x: n.x >> 1, y: n.y >> 1 })] == null ? null : 0
  }
  const teselaDe = (n: Nodo) => { const w = ventana(n, meta.dem); return cache.get(w.zt, w.xt, w.yt) }
  const cajaDe = (n: Nodo): THREE.Box3 => {
    const k = clave(n)
    let m = mallas.get(k)
    if (!m) {
      const { geometry, caja } = geometriaNodo(n, teselaDe(n)!, meta.dem, frame, errorDe(n) ?? 0)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      mesh.visible = false
      grupo.current!.add(mesh)
      m = { mesh, caja }
    } else { mallas.delete(k) }
    mallas.set(k, m)
    return m.caja
  }

  useFrame(() => {
    if (!grupo.current) return
    m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    frustum.setFromProjectionMatrix(m4)
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 45
    const sel = seleccionar(raices(meta.dem), {
      intersecta: c => frustum.intersectsBox(c), posicion: camera.position, mpp: d => metrosPorPixel(d, fov, size.height),
    }, {
      error: errorDe,
      listo: n => teselaDe(n) !== undefined,
      pedir: n => { const w = ventana(n, meta.dem); cache.pedir(w.zt, w.xt, w.yt) },
      caja: cajaDe,
    }, Z_MAX)
    const visibles = new Set(sel.map(clave))
    for (const [k, m] of mallas) m.mesh.visible = visibles.has(k)
    // LRU de geometrías: las más viejas primero.
    for (const [k, m] of mallas) {
      if (mallas.size <= GEOMETRIAS_MAX) break
      if (visibles.has(k)) continue
      grupo.current.remove(m.mesh); m.mesh.geometry.dispose(); mallas.delete(k)
    }
  })

  // name="terrain": PickingPass.tsx recorre este grupo para el oclusor de
  // solo profundidad.
  return <group ref={grupo} name="terrain" />
}
```

`App.tsx`: `import { TerrainLod } from './scene/TerrainLod'`; `<TerrainLod meta={data.terrain} />` en vez de `<Terrain .../>`; `Roads` y `Picker` reciben `normals={data.normals}` (Task 7). Borrar `src/scene/Terrain.tsx`.

`PickingPass.tsx`, en `render()`: en vez de `getObjectByName('terrain') as Mesh` y su geometría, tomar el grupo y para cada `Mesh` visible bajo él, dibujar `new THREE.Mesh(child.geometry, depthMaterial)` con `bajada` (o mejor: un `Mesh` reutilizado cambiando `geometry`). El error si no existe el grupo se conserva.

- [x] **Step 5: `npm test`, `npx tsc --noEmit`.** Ver el relieve en Chrome: `foto.mjs` en el scratchpad.

---

### Task 7: Las vías con la normal del terreno

**Files:**
- Modify: `src/scene/roadStyle.ts` (`repartirPorNivel` reparte `normals`), `src/scene/roadsShader.ts` (`extrusionGlsl`, `ATTR_VERT_GLSL`), `src/scene/Roads.tsx`, `src/scene/PickingPass.tsx`, `src/App.tsx`
- Test: `src/scene/roadStyle.test.ts`, `src/scene/roadsShader.test.ts`, `src/scene/picking.test.ts`

**Interfaces:**
- `repartirPorNivel(positions, segIds, index, ways, porVia, normals?: Int8Array)` → `Tanda.normales: Int8Array` (6 por segmento).
- `extrusionGlsl` requiere `attribute vec3 instanceNormalStart; attribute vec3 instanceNormalEnd;` y usa `ERROR_PX`.

- [x] **Step 1: Tests que fallan**

`roadStyle.test.ts` (en `describe('repartirPorNivel')` si existe, o nuevo):

```ts
  it('reparte las normales por nivel junto a los segmentos', () => {
    const vias = [{ highway: 'residential' }, { highway: 'motorway' }] as Way[]
    const index = new Uint32Array([0, 1, 2])
    const positions = new Float32Array(12)
    const segIds = new Float32Array([0, 1])
    const normals = new Int8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const tandas = repartirPorNivel(positions, segIds, index, vias, [], normals)
    expect(Array.from(tandas.find(t => t.nivel === 2)!.normales)).toEqual([1, 2, 3, 4, 5, 6])
    expect(Array.from(tandas.find(t => t.nivel === 6)!.normales)).toEqual([7, 8, 9, 10, 11, 12])
  })
```

`roadsShader.test.ts`:

```ts
test('la extrusión va en el plano del terreno y se levanta ERROR_PX píxeles', () => {
  const g = extrusionGlsl(false).replace(/\/\/.*$/gm, '')
  expect(g).toContain('instanceNormalStart')
  expect(g).toMatch(/cross\(\s*dirV\s*,\s*terrV\s*\)/)
  expect(g).toContain(`terrV * ( ${ERROR_PX.toFixed(1)} * mppV )`)
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  expect(shader.vertexShader).toContain('attribute vec3 instanceNormalStart;')
  expect(shader.vertexShader).toContain('attribute vec3 instanceNormalEnd;')
})
```

(y el test de la derecha pasa a comprobar `cross( dirV, terrV )` y la ausencia de `cross( terrV, dirV )`.)

`picking.test.ts`: el test de extrusión comprueba además `attribute vec3 instanceNormalStart;`.

- [x] **Step 2: Verlos fallar.**

- [x] **Step 3: Implementar**

`roadStyle.ts` `repartirPorNivel`: parámetro `normals?: Int8Array`; `const nrm = NIVELES.map((_, n) => new Int8Array(cuenta[n] * 6))`; en el bucle, si `normals`, copiar 6 bytes de `s*6` a `k[n]*6`; `Tanda.normales`.

`roadsShader.ts`:
- `import { ERROR_PX } from './quadtree'`.
- `ATTR_VERT_GLSL` declara `attribute vec3 instanceNormalStart; attribute vec3 instanceNormalEnd;`.
- `extrusionGlsl`, tras `arribaV`:

```glsl
        // Normal del terreno en este extremo (pipeline, scripts/lib/drape.mjs):
        // la calzada se extruye en el plano de la ladera y no en el horizontal,
        // así que ni la mitad de arriba se entierra ni la de abajo flota.
        vec3 nEje = ( position.y < 0.5 ) ? instanceNormalStart : instanceNormalEnd;
        vec3 terrV = dot( nEje, nEje ) > 0.25 ? normalize( ( viewMatrix * vec4( nEje, 0.0 ) ).xyz ) : arribaV;
        vec3 ladoV = normalize( cross( dirV, terrV ) );
```

  y tras el desplazamiento lateral y las tapas, antes de `clip`:

```glsl
        // Alza: la tolerancia del LOD, en metros a esta profundidad. El relieve
        // dibujado se aparta menos que eso de la superficie real a cualquier
        // distancia (quadtree.ts), así que nunca tapa la calzada; y cubre de
        // sobra la precisión del depth buffer (d²·6e-9 m: a 108 km, 70 m,
        // contra 216 m de alza).
        eje.xyz += terrV * ( ${ERROR_PX.toFixed(1)} * mppV );
```

  Actualizar el comentario de la cruz: `cross( dirV, terrV )`.

`Roads.tsx`: prop `normals: Int8Array`; `repartirPorNivel(..., porVia, normals)`; por tanda:

```ts
    const nrmBuf = new THREE.InstancedInterleavedBuffer(t.normales, 6, 1)
    geometry.setAttribute('instanceNormalStart', new THREE.InterleavedBufferAttribute(nrmBuf, 3, 0, true))
    geometry.setAttribute('instanceNormalEnd', new THREE.InterleavedBufferAttribute(nrmBuf, 3, 3, true))
```

  Quitar `ALZA_POR_D2`, `ALZA_MINIMA`, el `raiz` ref y `raiz.current.position.y = ...`; el `<group>` externo queda sin ref.

`PickingPass.tsx`: `usePicking({ ..., normals })`, mismos dos atributos sobre `normals` entero; deps del `useMemo`.

`App.tsx`: `normals={data.normals}` a `Roads` y `Picker`; `Picker` lo pasa a `usePicking`.

- [x] **Step 4: `npm test`, `npx tsc --noEmit`, `npm run build`.**

---

### Desvíos respecto al plan, encontrados al verificar en Chrome

- **Contorno del estado por textura, no por vértice.** A vista de estado el
  borde salía en bloques de kilómetros: a z8 una celda mide 4,6 km. El
  atributo `inside` se sustituyó por `uvMascara` y `stateMask` a 1024² como
  `DataTexture` de un canal (`TerrainLod.tsx`, `terrainShader.ts`).
- **Sin ajuste de profundidad al eje.** `clip.z = ndc.z * clip.w` escondía la
  mitad cuesta arriba de toda calzada en ladera y hacía asomar las tapas como
  orejas (medido en cenital, arrastrando la cámara con el ratón). Cada vértice
  lleva su profundidad; `depthWrite: false` evita que los tramos compitan.
- **`apoyar` en el pipeline y `ALZA_MIN_M = 0,25 m`.** Con los 30 m solos,
  124.875 tramos se apartaban del relieve más de 20 cm y a 30 m de vista se
  enterraban tramos enteros. Bisección hasta 20 cm o 4 m de largo, y alza
  mínima en metros en el shader.

### Task 8: Verificación en Chrome

- [x] **Step 1:** `foto.mjs` (vista de estado y Libertador a ~570 m): la vista de estado igual a la de hoy salvo más detalle de relieve; sin errores de consola.
- [x] **Step 2:** `cerca.mjs`: a 30 m el relieve tiene forma (no plano) y la calzada va pegada a él; sin sierra en juntas.
- [x] **Step 3:** Script `hueco.mjs`: buscar "Vía a Los Llanos", elegir el resultado de Fernández Feo, alejar hasta la barra de 100 m, captura: la vía continua, sin extremos cortados en diagonal.
- [x] **Step 4:** `lazo-cerca.mjs` sigue en OK (borde sí, terreno no).
- [x] **Step 5:** fps: `page.evaluate` con `requestAnimationFrame` durante 2 s orbitando a 100 m; esperado ≥ 30.
- [x] **Step 6:** `npm test`, `npx tsc --noEmit`, `npm run build`, `npm run verify`. Reportar sin commitear.
