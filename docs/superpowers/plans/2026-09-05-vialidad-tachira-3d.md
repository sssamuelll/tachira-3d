# Visor y editor 3D de vialidad del Táchira — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir una aplicación local de un solo usuario que muestre los 26.712 segmentos viales del estado Táchira sobre el terreno andino real en 3D, y permita cargarles condición (PCI 0-100), tipo de rodadura y procedencia mediante edición masiva.

**Architecture:** Un pipeline de build offline extrae OSM y un DEM público, los proyecta a coordenadas locales ENU y los empaqueta como binarios. El navegador los carga directo a la GPU: el terreno como una malla de 1024², las vías como `LineSegments2`, y los atributos editables como una data texture de 164² que el shader lee por id de vía. La selección usa un id buffer renderizado en GPU, que sirve igual para clic y para lazo.

**Tech Stack:** Vite · React 19 · TypeScript · three ≥0.170 · @react-three/fiber ≥9.0.4 · @takram/three-geospatial 0.9.1 · @takram/three-atmosphere · postprocessing · vitest · pngjs (build-time)

**Spec:** `docs/superpowers/specs/2026-09-05-vialidad-tachira-3d-design.md`

## Global Constraints

- **Versiones de takram fijas y exactas, sin `^`.** `core` está en alpha 0.9.x y su API puede romper entre versiones menores.
- **Origen ENU** — todo el proyecto usa este único origen: `lat₀ = 8.021973°N`, `lon₀ = -71.901563°`, `h₀ = 0` sobre el elipsoide WGS84.
- **bbox del Táchira** — `S 7.3612911 · W -72.4878225 · N 8.6826552 · E -71.3153029`.
- **Elipsoide WGS84** — `a = 6378137.0`, `f = 1/298.257223563`. Ningún módulo redefine estas constantes; todos importan de `scripts/lib/wgs84.mjs` o `src/data/constants.ts`.
- **La longitud se calcula siempre sobre la geometría original**, nunca sobre una simplificada.
- **Procedencia obligatoria** en todo valor de PCI y de tipo: `medido` | `estimado` | `heredado`. Nunca se escribe un PCI sin ella.
- **Sin backend, sin router, sin gestor de estado.** Los 26.712 registros viven en un `Map` fuera de React.
- **Idioma de la interfaz: español.** Nombres de código en inglés.
- **Sin emoji** en interfaz ni en mensajes de commit.

## Desviaciones del spec (deliberadas, anotadas para trazabilidad)

1. **La longitud no usa `@turf/length`.** turf calcula por haversine, que asume esfera y produce ~0,5% de error — sobre 4.127 km son ~20 km. Como el pipeline ya convierte a ECEF, la longitud se calcula como suma de distancias euclidianas en ECEF entre nodos consecutivos. Para segmentos de decenas o cientos de metros la diferencia cuerda-arco es despreciable (~2×10⁻⁶ % a 1 km), y el resultado es más exacto que haversine con una dependencia menos. Misma semántica: longitud sobre el elipsoide con `h = 0`.
2. **Se añade `km3d`** además de `km`. Como el drapeado ya calcula la altura de cada vértice, la longitud real recorrida sale gratis. En los Andes la diferencia contra la longitud cartográfica es del 2–5% y es el número que de verdad describe una vía de montaña. `km` sigue siendo el valor cartográfico oficial.
3. **`@turf/boolean-point-in-polygon` se reemplaza** por una implementación propia de ray casting en `scripts/lib/geo.mjs` (12 líneas). Se necesita un solo predicado; no justifica una dependencia.

Resultado: el pipeline no depende de turf. `@turf/*` sale del stack.

## File Structure

```
scripts/
  lib/wgs84.mjs        constantes del elipsoide — única fuente
  lib/enu.mjs          geodetic ↔ ECEF ↔ ENU              ← el cimiento
  lib/geo.mjs          longitud, punto medio, point-in-polygon
  lib/overpass.mjs     consultas a Overpass con caché en disco
  lib/terrarium.mjs    descarga, decodifica y ensambla el DEM
  lib/pack.mjs         escritura de los binarios
  build-data.mjs       orquesta el pipeline
  verify-data.mjs      los 6 checks del spec §11
  test/*.test.mjs      tests de las libs
public/data/           salida del pipeline (los .bin están gitignored)
src/
  data/constants.ts    origen ENU, bbox, rangos PCI, paleta, vocabularios
  data/types.ts        tipos compartidos
  data/load.ts         fetch de los binarios
  data/store.ts        Map de atributos, fuera de React
  data/attrTexture.ts  la data texture 164²
  data/persist.ts      File System Access API
  scene/Sky.tsx        wrapper de takram
  scene/Terrain.tsx    malla del terreno
  scene/terrainShader.ts hipsometría + hillshade
  scene/Roads.tsx      LineSegments2
  scene/roadsShader.ts patch de LineMaterial que lee la data texture
  scene/PickingPass.tsx id buffer en GPU
  scene/Camera.tsx     PointOfView de takram
  ui/FilterPanel.tsx · ui/EditPanel.tsx · ui/CoverageBar.tsx · ui/LassoOverlay.tsx
  App.tsx · main.tsx
```

---

# FASE 1 — Pipeline de datos

La fase que sostiene todo. Si la proyección está mal, el mapa sale torcido y no se nota mirándolo.

## Task 1: Andamiaje y constantes del elipsoide

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `scripts/lib/wgs84.mjs`
- Test: `scripts/test/wgs84.test.mjs`

**Interfaces:**
- Produces: `scripts/lib/wgs84.mjs` exporta `A`, `F`, `B`, `E2`, `EP2` (números).

- [ ] **Step 1: Inicializar el proyecto**

```bash
npm init -y
npm pkg set name="vialidad-tachira" type="module" private=true
npm pkg set scripts.dev="vite" scripts.build="vite build"
npm pkg set scripts.test="vitest run" scripts.data="node scripts/build-data.mjs" scripts.verify="node scripts/verify-data.mjs"
npm i -D vite vitest typescript @types/react @types/react-dom @vitejs/plugin-react pngjs
npm i react react-dom three @react-three/fiber @react-three/drei postprocessing @react-three/postprocessing
npm i --save-exact @takram/three-geospatial@0.9.1 @takram/three-atmosphere @takram/three-geospatial-effects
```

- [ ] **Step 2: Fijar las versiones de takram sin rango**

Abrir `package.json` y confirmar que las tres entradas `@takram/*` aparecen sin `^` ni `~`. Si alguna tiene rango, corregirla a la versión exacta que instaló `npm ls @takram/three-atmosphere`.

- [ ] **Step 3: Crear `vite.config.ts` y `tsconfig.json`**

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
```

```json
// tsconfig.json
{ "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "jsx": "react-jsx", "strict": true, "skipLibCheck": true,
    "types": ["vite/client"] },
  "include": ["src"] }
```

- [ ] **Step 4: Escribir el test del elipsoide**

```js
// scripts/test/wgs84.test.mjs
import { test, expect } from 'vitest'
import { A, F, B, E2, EP2 } from '../lib/wgs84.mjs'

test('constantes WGS84 coherentes entre sí', () => {
  expect(A).toBe(6378137.0)
  expect(B).toBeCloseTo(6356752.314245, 6)      // semieje menor conocido
  expect(E2).toBeCloseTo(0.00669437999014, 12)  // primera excentricidad al cuadrado
  expect(EP2).toBeCloseTo(0.00673949674228, 12) // segunda excentricidad al cuadrado
  expect(E2).toBeCloseTo(F * (2 - F), 15)
  expect(EP2).toBeCloseTo((A * A - B * B) / (B * B), 12)
})
```

- [ ] **Step 5: Correr el test y verificar que falla**

Run: `npx vitest run scripts/test/wgs84.test.mjs`
Expected: FAIL — no se puede resolver `../lib/wgs84.mjs`

- [ ] **Step 6: Implementar**

```js
// scripts/lib/wgs84.mjs
export const A = 6378137.0                    // semieje mayor, m
export const F = 1 / 298.257223563            // achatamiento
export const B = A * (1 - F)                  // semieje menor, m
export const E2 = F * (2 - F)                 // primera excentricidad²
export const EP2 = (A * A - B * B) / (B * B)  // segunda excentricidad²
```

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `npx vitest run scripts/test/wgs84.test.mjs`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts scripts/lib/wgs84.mjs scripts/test/wgs84.test.mjs
git commit -m "feat: andamiaje del proyecto y constantes WGS84"
```

---

## Task 2: Proyección geodésica ↔ ENU

El módulo del que depende la corrección de todo el mapa.

**Files:**
- Create: `scripts/lib/enu.mjs`
- Test: `scripts/test/enu.test.mjs`

**Interfaces:**
- Consumes: `wgs84.mjs` → `A, B, E2, EP2`
- Produces:
  - `geodeticToEcef(latDeg, lonDeg, h) → [X, Y, Z]`
  - `ecefToGeodetic(X, Y, Z) → [latDeg, lonDeg, h]`
  - `makeEnuFrame(lat0Deg, lon0Deg, h0) → frame` (objeto opaco)
  - `ecefToEnu(frame, X, Y, Z) → [e, n, u]`
  - `enuToEcef(frame, e, n, u) → [X, Y, Z]`
  - `geodeticToEnu(frame, latDeg, lonDeg, h) → [e, n, u]`
  - `enuToGeodetic(frame, e, n, u) → [latDeg, lonDeg, h]`

- [ ] **Step 1: Escribir los tests**

```js
// scripts/test/enu.test.mjs
import { test, expect } from 'vitest'
import {
  geodeticToEcef, ecefToGeodetic, makeEnuFrame,
  geodeticToEnu, enuToGeodetic,
} from '../lib/enu.mjs'

const LAT0 = 8.021973, LON0 = -71.901563   // origen del proyecto

test('ECEF en el ecuador y en el polo', () => {
  const [x, y, z] = geodeticToEcef(0, 0, 0)
  expect(x).toBeCloseTo(6378137.0, 3); expect(y).toBeCloseTo(0, 3); expect(z).toBeCloseTo(0, 3)
  const [, , zp] = geodeticToEcef(90, 0, 0)
  expect(zp).toBeCloseTo(6356752.314245, 3)
})

test('el origen del frame es el cero de ENU', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  const [e, n, u] = geodeticToEnu(f, LAT0, LON0, 0)
  expect(Math.hypot(e, n, u)).toBeLessThan(1e-6)
})

test('los ejes ENU apuntan a donde deben', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  const [e1, n1] = geodeticToEnu(f, LAT0, LON0 + 0.01, 0)  // al este
  expect(e1).toBeGreaterThan(1000); expect(Math.abs(n1)).toBeLessThan(10)
  const [e2, n2] = geodeticToEnu(f, LAT0 + 0.01, LON0, 0)  // al norte
  expect(n2).toBeGreaterThan(1000); expect(Math.abs(e2)).toBeLessThan(10)
})

test('CRITICO: round-trip geodetic → ENU → geodetic bajo 1 mm en todo el bbox', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  const S = 7.3612911, W = -72.4878225, N = 8.6826552, E = -71.3153029
  let peor = 0
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const lat = S + (N - S) * i / 10
      const lon = W + (E - W) * j / 10
      for (const h of [0, 1000, 3942]) {
        const [e, n, u] = geodeticToEnu(f, lat, lon, h)
        const [lat2, lon2, h2] = enuToGeodetic(f, e, n, u)
        // 1e-5 grados ≈ 1,1 m; medimos en metros para que el umbral sea legible
        const dLat = (lat2 - lat) * 111320
        const dLon = (lon2 - lon) * 111320 * Math.cos(lat * Math.PI / 180)
        peor = Math.max(peor, Math.hypot(dLat, dLon, h2 - h))
      }
    }
  }
  expect(peor).toBeLessThan(0.001)   // el spec exige < 1 m; exigimos mil veces más
})

test('la curvatura no se aplana: 147 km producen ~424 m de caída', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  const [, , u] = geodeticToEnu(f, LAT0 + 147.1 / 2 / 111.32, LON0, 0)
  expect(u).toBeLessThan(-380)
  expect(u).toBeGreaterThan(-470)
})

test('el bbox completo cabe holgado en float32', () => {
  const f = makeEnuFrame(LAT0, LON0, 0)
  for (const [lat, lon] of [[7.3612911, -72.4878225], [8.6826552, -71.3153029]]) {
    const [e, n] = geodeticToEnu(f, lat, lon, 0)
    expect(Math.abs(e)).toBeLessThan(100000)
    expect(Math.abs(n)).toBeLessThan(100000)
  }
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run scripts/test/enu.test.mjs`
Expected: FAIL — no se puede resolver `../lib/enu.mjs`

- [ ] **Step 3: Implementar**

`ecefToGeodetic` usa el método cerrado de Bowring, que da precisión sub-milimétrica para alturas terrestres sin iterar.

```js
// scripts/lib/enu.mjs
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
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run scripts/test/enu.test.mjs`
Expected: PASS — los 6 tests, incluido el round-trip bajo 1 mm.

Si el round-trip falla, revisar el signo de la matriz ENU en `ecefToEnu`/`enuToEcef`: una es la transpuesta exacta de la otra.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/enu.mjs scripts/test/enu.test.mjs
git commit -m "feat: proyeccion geodetica a ENU local con round-trip verificado"
```

---

## Task 3: Longitud, punto medio y point-in-polygon

**Files:**
- Create: `scripts/lib/geo.mjs`
- Test: `scripts/test/geo.test.mjs`

**Interfaces:**
- Consumes: `enu.mjs` → `geodeticToEcef`
- Produces:
  - `lineLengthMeters(coords) → number` — `coords` es `[[lon, lat], …]` (orden GeoJSON), longitud sobre el elipsoide con `h = 0`
  - `lineLength3dMeters(coords, heights) → number` — igual pero usando las alturas dadas
  - `midpointIndex(coords) → number` — índice del vértice más cercano a la mitad de la longitud
  - `pointInRing(lon, lat, ring) → boolean` — ray casting sobre un anillo `[[lon, lat], …]`
  - `pointInPolygon(lon, lat, polygon) → boolean` — `polygon` es `[exterior, ...huecos]`

- [ ] **Step 1: Escribir los tests**

```js
// scripts/test/geo.test.mjs
import { test, expect } from 'vitest'
import { lineLengthMeters, lineLength3dMeters, midpointIndex, pointInPolygon } from '../lib/geo.mjs'

test('un grado de longitud en el ecuador mide ~111,3 km', () => {
  expect(lineLengthMeters([[0, 0], [1, 0]])).toBeCloseTo(111319.5, -1)
})

test('un grado de latitud mide ~110,6 km cerca del ecuador', () => {
  const d = lineLengthMeters([[0, 0], [0, 1]])
  expect(d).toBeGreaterThan(110000); expect(d).toBeLessThan(111000)
})

test('la longitud es la suma de los tramos', () => {
  const a = lineLengthMeters([[-72, 8], [-71.99, 8]])
  const b = lineLengthMeters([[-71.99, 8], [-71.98, 8]])
  const total = lineLengthMeters([[-72, 8], [-71.99, 8], [-71.98, 8]])
  expect(total).toBeCloseTo(a + b, 6)
})

test('una linea de un solo punto mide cero', () => {
  expect(lineLengthMeters([[-72, 8]])).toBe(0)
})

test('la longitud 3d es mayor que la plana cuando hay desnivel', () => {
  const coords = [[-72, 8], [-71.99, 8]]
  const plana = lineLengthMeters(coords)
  const conCuesta = lineLength3dMeters(coords, [0, 500])
  expect(conCuesta).toBeGreaterThan(plana)
  expect(conCuesta).toBeCloseTo(Math.hypot(plana, 500), 0)
})

test('el punto medio de una linea uniforme cae en el centro', () => {
  expect(midpointIndex([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])).toBe(2)
})

test('point-in-polygon dentro, fuera y en un hueco', () => {
  const cuadro = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
  expect(pointInPolygon(5, 5, cuadro)).toBe(true)
  expect(pointInPolygon(15, 5, cuadro)).toBe(false)
  const conHueco = [cuadro[0], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]
  expect(pointInPolygon(5, 5, conHueco)).toBe(false)
  expect(pointInPolygon(2, 2, conHueco)).toBe(true)
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run scripts/test/geo.test.mjs`
Expected: FAIL — no se puede resolver `../lib/geo.mjs`

- [ ] **Step 3: Implementar**

```js
// scripts/lib/geo.mjs
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
  let acc = 0
  for (let i = 1; i < coords.length; i++) {
    acc += chord(coords[i - 1][0], coords[i - 1][1], 0, coords[i][0], coords[i][1], 0)
    if (acc >= half) return i
  }
  return coords.length - 1
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
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run scripts/test/geo.test.mjs`
Expected: PASS — los 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/geo.mjs scripts/test/geo.test.mjs
git commit -m "feat: longitud geodesica por ECEF, punto medio y point-in-polygon"
```

---

## Task 4: Cliente de Overpass con caché

**Files:**
- Create: `scripts/lib/overpass.mjs`
- Test: `scripts/test/overpass.test.mjs`

**Interfaces:**
- Produces:
  - `overpass(query, cacheKey) → Promise<object>` — respuesta JSON, cacheada en `.cache/<cacheKey>.json`
  - `QUERY_MUNICIPIOS` (string) — relaciones `admin_level=6` con geometría
  - `QUERY_VIAS` (string) — ways con `highway` y geometría
  - `waysToLines(json) → Array<{ osmId, tags, coords }>` — `coords` en `[[lon, lat], …]`
  - `assembleRings(members, role) → { rings, orphanFragments }` — encadena los fragmentos
    de un rol por extremos compartidos (tolerancia `1e-7` grados) y devuelve solo anillos
    **cerrados**; los que no cierran se cuentan como huérfanos, nunca se cierran con una
    cuerda arbitraria
  - `relationsToPolygons(json) → Array<{ osmId, name, polygons, orphanFragments }>` —
    `polygons` es un array de polígonos y cada polígono es `[exterior, ...huecos]`

> **Corregido durante la ejecución.** La primera versión de esta tarea trataba cada
> miembro `outer` como un anillo cerrado independiente. En OSM los bordes administrativos
> vienen partidos porque los tramos de frontera se comparten entre municipios vecinos:
> verificado contra Overpass el 2026-09-05, **los 29 municipios del Táchira tienen 2 o más
> miembros `outer`** — 1.001 fragmentos en total, hasta 68 en uno solo (Cárdenas), y ningún
> rol `inner`. Sin ensamblado, del segundo fragmento en adelante se trataban como huecos y
> la asignación de municipio de las 26.712 vías salía mal sin que nada fallara.

- [ ] **Step 1: Escribir los tests**

Los tests no golpean la red: verifican el parseo con respuestas fijas.

```js
// scripts/test/overpass.test.mjs
import { test, expect } from 'vitest'
import { waysToLines, relationsToPolygons, QUERY_VIAS, QUERY_MUNICIPIOS } from '../lib/overpass.mjs'

test('las consultas apuntan al Tachira y piden geometria', () => {
  for (const q of [QUERY_VIAS, QUERY_MUNICIPIOS]) {
    expect(q).toContain('VE-S')
    expect(q).toContain('out geom')
  }
})

test('waysToLines extrae id, tags y coordenadas en orden lon,lat', () => {
  const json = { elements: [{
    type: 'way', id: 42, tags: { highway: 'primary', name: 'Troncal 5', surface: 'asphalt' },
    geometry: [{ lat: 8.0, lon: -72.0 }, { lat: 8.1, lon: -72.1 }],
  }] }
  const [w] = waysToLines(json)
  expect(w.osmId).toBe(42)
  expect(w.tags.highway).toBe('primary')
  expect(w.coords).toEqual([[-72.0, 8.0], [-72.1, 8.1]])
})

test('waysToLines descarta ways sin geometria o con menos de dos nodos', () => {
  const json = { elements: [
    { type: 'way', id: 1, tags: { highway: 'primary' } },
    { type: 'way', id: 2, tags: { highway: 'primary' }, geometry: [{ lat: 8, lon: -72 }] },
    { type: 'node', id: 3 },
  ] }
  expect(waysToLines(json)).toHaveLength(0)
})

// El caso real: la frontera viene partida en fragmentos abiertos, uno de ellos
// con los puntos en orden invertido. Un test con un único member ya cerrado
// pasa aunque el ensamblado no exista — es el caso que nunca ocurre.
const frag = (...pts) => ({ type: 'way', role: 'outer', geometry: pts.map(([lon, lat]) => ({ lat, lon })) })

test('relationsToPolygons encadena los fragmentos partidos de la frontera', () => {
  const json = { elements: [{
    type: 'relation', id: 7, tags: { name: 'Municipio Junín' },
    members: [
      frag([0, 0], [0, 1]),
      frag([1, 1], [1, 0], [0, 0]),   // este cierra el anillo
      frag([0, 1], [1, 1]),
    ],
  }] }
  const [m] = relationsToPolygons(json)
  expect(m.osmId).toBe(7)
  expect(m.name).toBe('Municipio Junín')
  expect(m.polygons).toHaveLength(1)
  expect(m.polygons[0][0][0]).toEqual(m.polygons[0][0].at(-1))   // anillo cerrado
  expect(m.orphanFragments).toBe(0)
})

test('un fragmento que no cierra se cuenta como huerfano, no se cierra solo', () => {
  const json = { elements: [{
    type: 'relation', id: 8, tags: { name: 'X' },
    members: [frag([0, 0], [0, 1]), frag([5, 5], [6, 6])],
  }] }
  const [m] = relationsToPolygons(json)
  expect(m.polygons).toHaveLength(0)
  expect(m.orphanFragments).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run scripts/test/overpass.test.mjs`
Expected: FAIL — no se puede resolver `../lib/overpass.mjs`

- [ ] **Step 3: Implementar**

```js
// scripts/lib/overpass.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const ENDPOINT = 'https://overpass-api.de/api/interpreter'
const CACHE = '.cache'

export const QUERY_MUNICIPIOS = `[out:json][timeout:600];
area["ISO3166-2"="VE-S"][admin_level=4]->.a;
relation(area.a)["boundary"="administrative"]["admin_level"="6"];
out geom;`

export const QUERY_VIAS = `[out:json][timeout:900];
area["ISO3166-2"="VE-S"][admin_level=4]->.a;
way(area.a)["highway"];
out geom;`

export async function overpass (query, cacheKey) {
  const path = `${CACHE}/${cacheKey}.json`
  if (existsSync(path)) {
    console.log(`  cache: ${path}`)
    return JSON.parse(await readFile(path, 'utf8'))
  }
  console.log(`  consultando Overpass (${cacheKey})…`)
  const res = await fetch(ENDPOINT, { method: 'POST', body: query })
  if (!res.ok) throw new Error(`Overpass devolvió ${res.status} para ${cacheKey}`)
  const json = await res.json()
  if (!json.elements) throw new Error(`Overpass no devolvió elements para ${cacheKey}`)
  await mkdir(CACHE, { recursive: true })
  await writeFile(path, JSON.stringify(json))
  return json
}

export function waysToLines (json) {
  return json.elements
    .filter(el => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2)
    .map(el => ({
      osmId: el.id,
      tags: el.tags ?? {},
      coords: el.geometry.map(g => [g.lon, g.lat]),
    }))
}

export function relationsToPolygons (json) {
  return json.elements
    .filter(el => el.type === 'relation' && Array.isArray(el.members))
    .map(el => {
      const rings = el.members
        .filter(m => m.role === 'outer' && Array.isArray(m.geometry) && m.geometry.length >= 4)
        .map(m => m.geometry.map(g => [g.lon, g.lat]))
      return { osmId: el.id, name: el.tags?.name ?? `relación ${el.id}`, polygon: rings }
    })
    .filter(m => m.polygon.length > 0)
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run scripts/test/overpass.test.mjs`
Expected: PASS — los 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/overpass.mjs scripts/test/overpass.test.mjs
git commit -m "feat: cliente de Overpass con cache y parseo de ways y relaciones"
```

---

## Task 5: DEM desde AWS Terrarium

**Files:**
- Create: `scripts/lib/terrarium.mjs`
- Test: `scripts/test/terrarium.test.mjs`

**Interfaces:**
- Produces:
  - `decodeTerrarium(r, g, b) → number` — elevación en metros
  - `lonToTileX(lon, z) → number`, `latToTileY(lat, z) → number` (enteros)
  - `tileXToLon(x, z) → number`, `tileYToLat(y, z) → number` (bordes noroeste del tile)
  - `tileRangeForBbox(bbox, z) → { x0, x1, y0, y1, nx, ny }` — `bbox` es `{ s, w, n, e }`
  - `fetchDem(bbox, z) → Promise<{ data: Float32Array, width, height, bounds }>` — grid completo, caché en `.cache/dem/`
  - `sampleBilinear(dem, lon, lat) → number`
  - `downsample(dem, width, height) → Int16Array`

- [ ] **Step 1: Escribir los tests**

```js
// scripts/test/terrarium.test.mjs
import { test, expect } from 'vitest'
import {
  decodeTerrarium, lonToTileX, latToTileY, tileRangeForBbox, sampleBilinear, downsample,
} from '../lib/terrarium.mjs'

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
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run scripts/test/terrarium.test.mjs`
Expected: FAIL — no se puede resolver `../lib/terrarium.mjs`

- [ ] **Step 3: Implementar**

```js
// scripts/lib/terrarium.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { PNG } from 'pngjs'

const BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'
const CACHE = '.cache/dem'
const TILE = 256

export const decodeTerrarium = (r, g, b) => (r * 256 + g + b / 256) - 32768

export const lonToTileX = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z)
export const latToTileY = (lat, z) => {
  const r = lat * Math.PI / 180
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z)
}
export const tileXToLon = (x, z) => x / 2 ** z * 360 - 180
export const tileYToLat = (y, z) =>
  Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI

export function tileRangeForBbox (bbox, z) {
  const x0 = lonToTileX(bbox.w, z), x1 = lonToTileX(bbox.e, z)
  const y0 = latToTileY(bbox.n, z), y1 = latToTileY(bbox.s, z)   // y crece hacia el sur
  return { x0, x1, y0, y1, nx: x1 - x0 + 1, ny: y1 - y0 + 1 }
}

async function fetchTile (z, x, y) {
  const path = `${CACHE}/${z}_${x}_${y}.png`
  if (existsSync(path)) return PNG.sync.read(await readFile(path))
  const res = await fetch(`${BASE}/${z}/${x}/${y}.png`)
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} devolvió ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(CACHE, { recursive: true })
  await writeFile(path, buf)
  return PNG.sync.read(buf)
}

export async function fetchDem (bbox, z) {
  const r = tileRangeForBbox(bbox, z)
  const width = r.nx * TILE, height = r.ny * TILE
  const data = new Float32Array(width * height)
  let n = 0
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      const png = await fetchTile(z, tx, ty)
      const ox = (tx - r.x0) * TILE, oy = (ty - r.y0) * TILE
      for (let py = 0; py < TILE; py++) {
        for (let px = 0; px < TILE; px++) {
          const i = (py * TILE + px) * 4
          data[(oy + py) * width + ox + px] =
            decodeTerrarium(png.data[i], png.data[i + 1], png.data[i + 2])
        }
      }
      if (++n % 25 === 0) console.log(`  DEM ${n}/${r.nx * r.ny} tiles`)
    }
  }
  // La grilla slippy cubre algo más que el bbox; guardamos sus bordes reales.
  const bounds = {
    w: tileXToLon(r.x0, z), e: tileXToLon(r.x1 + 1, z),
    n: tileYToLat(r.y0, z), s: tileYToLat(r.y1 + 1, z),
  }
  return { data, width, height, bounds }
}

export function sampleBilinear (dem, lon, lat) {
  const { data, width, height, bounds } = dem
  const fx = (lon - bounds.w) / (bounds.e - bounds.w) * (width - 1)
  const fy = (bounds.n - lat) / (bounds.n - bounds.s) * (height - 1)   // fila 0 = norte
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(fy)))
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1)
  const tx = fx - x0, ty = fy - y0
  const a = data[y0 * width + x0], b = data[y0 * width + x1]
  const c = data[y1 * width + x0], d = data[y1 * width + x1]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

export function downsample (dem, outW, outH) {
  const { data, width, height } = dem
  const out = new Int16Array(outW * outH)
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(height - 1, Math.round(y / (outH - 1) * (height - 1)))
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(width - 1, Math.round(x / (outW - 1) * (width - 1)))
      // Terrarium marca el océano muy por debajo; recortamos para que quepa en Int16
      out[y * outW + x] = Math.max(-500, Math.min(9000, Math.round(data[sy * width + sx])))
    }
  }
  return out
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run scripts/test/terrarium.test.mjs`
Expected: PASS — los 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/terrarium.mjs scripts/test/terrarium.test.mjs
git commit -m "feat: descarga y decodificacion del DEM de AWS Terrarium"
```

---

## Task 6: Empaquetado de binarios

**Files:**
- Create: `scripts/lib/pack.mjs`
- Test: `scripts/test/pack.test.mjs`

**Interfaces:**
- Consumes: nada de tareas anteriores
- Produces:
  - `packRoads(lines) → { positions: Float32Array, segIds: Float32Array, index: Uint32Array, segmentCount }`
    donde `lines` es `Array<{ enu: Array<[e, n, u]> }>` ya proyectadas
  - `writeBin(path, typedArray) → Promise<void>`

Formato de `positions`: 6 floats por segmento — `[e1, u1, -n1, e2, u2, -n2, …]`. **El orden de ejes es
el de three.js**: X = este, Y = arriba, Z = sur (el norte es −Z). Esa conversión se hace aquí, una sola
vez, y ningún otro módulo la repite.

`segIds` tiene un float por segmento (el índice de la vía). Es `Float32Array` y no `Uint32Array`
porque los atributos enteros por instancia requieren `vertexAttribIPointer` y no todos los caminos de
three lo soportan; los enteros hasta 2²⁴ son exactos en float32 y 26.712 queda muy por debajo.

`index` tiene `lines.length + 1` entradas (formato CSR): `index[i]` es el primer segmento de la vía `i`.

- [ ] **Step 1: Escribir los tests**

```js
// scripts/test/pack.test.mjs
import { test, expect } from 'vitest'
import { packRoads } from '../lib/pack.mjs'

test('una polilinea de 3 puntos produce 2 segmentos', () => {
  const p = packRoads([{ enu: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] }])
  expect(p.segmentCount).toBe(2)
  expect(p.positions.length).toBe(2 * 6)
  expect(p.segIds.length).toBe(2)
})

test('convierte ENU a ejes de three: X=este, Y=arriba, Z=-norte', () => {
  const p = packRoads([{ enu: [[10, 20, 30], [40, 50, 60]] }])
  expect(Array.from(p.positions.slice(0, 6))).toEqual([10, 30, -20, 40, 60, -50])
})

test('el indice CSR marca el inicio de cada via', () => {
  const p = packRoads([
    { enu: [[0, 0, 0], [1, 0, 0]] },                 // 1 segmento
    { enu: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },      // 2 segmentos
  ])
  expect(Array.from(p.index)).toEqual([0, 1, 3])
  expect(p.segmentCount).toBe(3)
})

test('cada segmento lleva el indice de su via', () => {
  const p = packRoads([
    { enu: [[0, 0, 0], [1, 0, 0]] },
    { enu: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
  ])
  expect(Array.from(p.segIds)).toEqual([0, 1, 1])
})

test('una via con menos de dos puntos no aporta segmentos', () => {
  const p = packRoads([{ enu: [[0, 0, 0]] }, { enu: [[0, 0, 0], [1, 0, 0]] }])
  expect(p.segmentCount).toBe(1)
  expect(Array.from(p.index)).toEqual([0, 0, 1])
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run scripts/test/pack.test.mjs`
Expected: FAIL — no se puede resolver `../lib/pack.mjs`

- [ ] **Step 3: Implementar**

```js
// scripts/lib/pack.mjs
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export function packRoads (lines) {
  let segmentCount = 0
  for (const l of lines) segmentCount += Math.max(0, l.enu.length - 1)

  const positions = new Float32Array(segmentCount * 6)
  const segIds = new Float32Array(segmentCount)
  const index = new Uint32Array(lines.length + 1)

  let s = 0
  for (let i = 0; i < lines.length; i++) {
    index[i] = s
    const pts = lines[i].enu
    for (let k = 1; k < pts.length; k++) {
      const [e1, n1, u1] = pts[k - 1]
      const [e2, n2, u2] = pts[k]
      const o = s * 6
      positions[o]     = e1; positions[o + 1] = u1; positions[o + 2] = -n1
      positions[o + 3] = e2; positions[o + 4] = u2; positions[o + 5] = -n2
      segIds[s] = i
      s++
    }
  }
  index[lines.length] = s
  return { positions, segIds, index, segmentCount }
}

export async function writeBin (path, typedArray) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, Buffer.from(
    typedArray.buffer, typedArray.byteOffset, typedArray.byteLength,
  ))
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run scripts/test/pack.test.mjs`
Expected: PASS — los 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/pack.mjs scripts/test/pack.test.mjs
git commit -m "feat: empaquetado de vias a binarios con ejes de three"
```

---

## Task 7: El pipeline completo

**Files:**
- Create: `scripts/build-data.mjs`
- Modify: `.gitignore` (añadir `.cache/`)

**Interfaces:**
- Consumes: todas las libs de las tareas 2–6
- Produces estos archivos en `public/data/`:
  - `terrain.bin` — `Int16Array` 1024×1024, row-major desde el norte
  - `terrain.json` — `{ width, height, bbox: {s,w,n,e}, min, max, origin: {lat, lon, h} }`
  - `roads-pos.bin`, `roads-segid.bin`, `roads-index.bin`
  - `roads-meta.json` — `{ count, ways: Array<{ osmId, ref, name, highway, surface, tipo, municipio, km, km3d }> }`
    (`tipo` es la rodadura sembrada desde `surface`, ver §3.2)
  - `municipios.json` — `Array<{ osmId, name, polygons }>`, donde `polygons` es un array
    de polígonos y cada polígono es `[exterior, ...huecos]` (ver la nota en la Task 4)

- [ ] **Step 1: Escribir el pipeline**

```js
// scripts/build-data.mjs
import { writeFile, mkdir } from 'node:fs/promises'
import { makeEnuFrame, geodeticToEnu } from './lib/enu.mjs'
import { lineLengthMeters, lineLength3dMeters, midpointIndex, pointInPolygon } from './lib/geo.mjs'
import { overpass, waysToLines, relationsToPolygons, QUERY_VIAS, QUERY_MUNICIPIOS } from './lib/overpass.mjs'
import { fetchDem, sampleBilinear, downsample } from './lib/terrarium.mjs'
import { packRoads, writeBin } from './lib/pack.mjs'

const BBOX = { s: 7.3612911, w: -72.4878225, n: 8.6826552, e: -71.3153029 }
const ORIGIN = { lat: 8.021973, lon: -71.901563, h: 0 }
const Z = 12
const GRID = 1024
const OUT = 'public/data'

// El surface de OSM siembra el tipo de rodadura (spec §3.2)
const SURFACE_A_TIPO = {
  asphalt: 'asfalto', paved: 'asfalto', chipseal: 'asfalto',
  concrete: 'concreto', 'concrete:plates': 'concreto', 'concrete:lanes': 'concreto',
  gravel: 'granzon', compacted: 'granzon', fine_gravel: 'granzon', unpaved: 'granzon',
  ground: 'tierra', dirt: 'tierra', earth: 'tierra', mud: 'tierra', grass: 'tierra',
  sett: 'empedrado', cobblestone: 'empedrado', paving_stones: 'empedrado',
  unhewn_cobblestone: 'empedrado', pebblestone: 'empedrado',
}
// `wood`, `metal` y `asfalto_y_grava` quedan en sin_definir a propósito. Los dos
// primeros son superficies de puente, no rodadura de carretera; el tercero es un valor
// libre que inventó un mapeador y no pertenece al esquema de OSM. Meterlos en una
// categoría que no les toca es peor que dejar que el usuario los clasifique.
// (La primera versión de esta tabla escribía `concrete_plates` con guión bajo. El valor
//  real de OSM lleva dos puntos, así que esa entrada nunca coincidió con nada.)

async function main () {
  await mkdir(OUT, { recursive: true })
  const frame = makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)

  console.log('1/9  municipios')
  const municipios = relationsToPolygons(await overpass(QUERY_MUNICIPIOS, 'municipios'))
  console.log(`     ${municipios.length} municipios`)

  console.log('2/9  vías')
  const lines = waysToLines(await overpass(QUERY_VIAS, 'vias'))
  console.log(`     ${lines.length} vías`)

  console.log('3/9  DEM')
  const dem = await fetchDem(BBOX, Z)
  console.log(`     grid ${dem.width} x ${dem.height}`)

  console.log('4/9  municipio por punto medio')
  // Un tramo que cruza límite cae en uno solo. Cortar en el límite duplicaría
  // segmentos y rompería los ids, que es lo que ancla los datos del usuario.
  // un municipio puede ser multipolígono (enclaves), de ahí el .some()
  const findMunicipio = (lon, lat) =>
    municipios.find(mm => mm.polygons.some(p => pointInPolygon(lon, lat, p))) ?? null

  let resolvedByVote = 0
  for (const l of lines) {
    const [lon, lat] = l.coords[midpointIndex(l.coords)]
    const m = findMunicipio(lon, lat)
    if (m) { l.municipio = m.name; continue }

    // El punto medio cayó en una grieta de precisión entre fronteras vecinas.
    // Se resuelve por voto: gana el municipio con más vértices de esta vía.
    // No "el primer vértice que resuelva" — eso depende del orden del array.
    // Empate: gana el primero insertado. Arbitrario, pero determinista.
    const votes = new Map()
    for (const [vlon, vlat] of l.coords) {
      const v = findMunicipio(vlon, vlat)
      if (v) votes.set(v.name, (votes.get(v.name) ?? 0) + 1)
    }
    let winner = null, best = 0
    for (const [name, count] of votes) if (count > best) { winner = name; best = count }
    l.municipio = winner
    if (winner) resolvedByVote++
  }
  const unassigned = lines.filter(l => !l.municipio).length
  console.log(`     ${resolvedByVote} resueltas por voto · sin municipio: ${unassigned}`)

  const totalOrphanFragments = municipios.reduce((s, m) => s + m.orphanFragments, 0)
  if (totalOrphanFragments > 0) {
    console.warn(`     AVISO: ${totalOrphanFragments} fragmentos de frontera sin cerrar`)
  }

  console.log('5/9  drapeado y longitudes')
  let vertices = 0
  for (const l of lines) {
    const heights = l.coords.map(([lon, lat]) => sampleBilinear(dem, lon, lat))
    l.km = lineLengthMeters(l.coords) / 1000
    l.km3d = lineLength3dMeters(l.coords, heights) / 1000
    l.enu = l.coords.map(([lon, lat], i) => geodeticToEnu(frame, lat, lon, heights[i]))
    vertices += l.coords.length
  }
  console.log(`     ${vertices} vértices en total`)

  console.log('6/9  empaquetado de vías')
  const packed = packRoads(lines)
  await writeBin(`${OUT}/roads-pos.bin`, packed.positions)
  await writeBin(`${OUT}/roads-segid.bin`, packed.segIds)
  await writeBin(`${OUT}/roads-index.bin`, packed.index)
  console.log(`     ${packed.segmentCount} segmentos`)

  console.log('7/9  metadata de vías')
  await writeFile(`${OUT}/roads-meta.json`, JSON.stringify({
    count: lines.length,
    ways: lines.map(l => ({
      osmId: l.osmId,
      ref: l.tags.ref ?? null,
      name: l.tags.name ?? null,
      highway: l.tags.highway,
      surface: l.tags.surface ?? null,
      tipo: SURFACE_A_TIPO[l.tags.surface] ?? 'sin_definir',
      municipio: l.municipio,
      km: +l.km.toFixed(4),
      km3d: +l.km3d.toFixed(4),
    })),
  }))

  console.log('8/9  terreno')
  const grid = downsample(dem, GRID, GRID)
  await writeBin(`${OUT}/terrain.bin`, grid)
  let min = Infinity, max = -Infinity
  for (const v of grid) { if (v < min) min = v; if (v > max) max = v }
  await writeFile(`${OUT}/terrain.json`, JSON.stringify({
    width: GRID, height: GRID, bbox: dem.bounds, min, max, origin: ORIGIN,
  }))
  console.log(`     elevación ${min} a ${max} m`)

  console.log('9/9  municipios')
  await writeFile(`${OUT}/municipios.json`, JSON.stringify(municipios))

  const seeded = lines.filter(l => SURFACE_A_TIPO[l.tags.surface]).length
  console.log(`\nlisto. ${lines.length} vías · ${packed.segmentCount} segmentos · ` +
              `${seeded} con tipo sembrado desde surface`)
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Añadir `.cache/` al gitignore**

```bash
grep -q '^\.cache/$' .gitignore || echo '.cache/' >> .gitignore
```

- [ ] **Step 3: Correr el pipeline**

Run: `npm run data`
Expected: termina sin error e imprime los 9 pasos. La primera corrida baja 238 tiles y consulta
Overpass dos veces — puede tardar varios minutos. Las siguientes salen de `.cache/`.

Contrastar la salida contra el spec §2:
- 29 municipios
- ~26.712 vías (el número puede haber cambiado; OSM es un dato vivo)
- elevación máxima cercana a 3.942 m
- ~6.232 vías con tipo sembrado desde `surface`

Si alguno se desvía mucho, revisar antes de seguir. Si sale distinto pero coherente
(OSM creció), anotar los números nuevos y continuar.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-data.mjs .gitignore public/data/terrain.json public/data/roads-meta.json public/data/municipios.json
git commit -m "feat: pipeline de datos del Tachira desde OSM y Terrarium"
```

---

## Task 8: Verificación de los datos generados

**Files:**
- Create: `scripts/verify-data.mjs`

**Interfaces:**
- Consumes: la salida de la Task 7 y `enu.mjs`, `geo.mjs`
- Produces: código de salida 0 si todo pasa, 1 si algo falla

Implementa los 8 checks del spec §11.

> **Corregido durante la ejecución.** La primera versión tenía 6 checks y tres de ellos no
> podían fallar nunca: `suma por municipio == total` comparaba dos sumas del mismo array,
> `elevación >= -500` vigilaba un límite que `downsample()` ya garantiza por construcción, y
> `km3d >= km` pasaba con el drapeado completamente plano. Los umbrales de los checks nuevos
> se fijaron midiendo el dato real, y cada uno se probó rompiéndolo a propósito. Un check que
> no puedes hacer fallar a mano es un check que no sirve.

- [ ] **Step 1: Escribir el verificador**

```js
// scripts/verify-data.mjs
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { makeEnuFrame, geodeticToEnu, enuToGeodetic } from './lib/enu.mjs'

const OUT = 'public/data'
const failures = []
const check = (ok, msg) => { console.log(`${ok ? '  ok  ' : 'FALLA '} ${msg}`); if (!ok) failures.push(msg) }

const meta = JSON.parse(await readFile(`${OUT}/roads-meta.json`, 'utf8'))
const terrain = JSON.parse(await readFile(`${OUT}/terrain.json`, 'utf8'))
const municipios = JSON.parse(await readFile(`${OUT}/municipios.json`, 'utf8'))
const bin = await readFile(`${OUT}/terrain.bin`)
const grid = new Int16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2)

// 1. round-trip geodetic → ENU → geodetic bajo 1 m en todo el bbox, con altura != 0.
// Si la proyección está mal, todo el mapa está mal y no se nota a simple vista.
const frame = makeEnuFrame(terrain.origin.lat, terrain.origin.lon, terrain.origin.h)
let worst = 0
for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
  const lat = terrain.bbox.s + (terrain.bbox.n - terrain.bbox.s) * i / 20
  const lon = terrain.bbox.w + (terrain.bbox.e - terrain.bbox.w) * j / 20
  const [e, n, u] = geodeticToEnu(frame, lat, lon, 1000)
  const [lat2, lon2, h2] = enuToGeodetic(frame, e, n, u)
  worst = Math.max(worst, Math.hypot(
    (lat2 - lat) * 111320,
    (lon2 - lon) * 111320 * Math.cos(lat * Math.PI / 180),
    h2 - 1000,
  ))
}
check(worst < 1, `round-trip ENU: peor error ${worst.toExponential(2)} m (umbral 1 m)`)

// 2. ningún osmId se repite en roads-meta.json (doble conteo)
const ids = meta.ways.map(w => w.osmId)
const uniqueIds = new Set(ids)
check(uniqueIds.size === ids.length, `osmId únicos: ${uniqueIds.size} de ${ids.length}`)

// 3. todo municipio asignado existe de verdad en municipios.json (no es un nombre inventado)
const municipioNames = new Set(municipios.map(m => m.name))
const invented = meta.ways.filter(w => w.municipio && !municipioNames.has(w.municipio))
check(invented.length === 0, `vías con municipio inventado: ${invented.length}`)

// 4. km y km3d finitos y positivos en toda vía (cierra el hueco de NaN, que "< umbral" no detecta)
const badLengths = meta.ways.filter(w =>
  !Number.isFinite(w.km) || !Number.isFinite(w.km3d) || w.km <= 0 || w.km3d <= 0)
check(badLengths.length === 0, `vías con km/km3d no finito o no positivo: ${badLengths.length}`)

// 5. toda vía tiene municipio
const noMunicipio = meta.ways.filter(w => !w.municipio)
check(noMunicipio.length === 0, `vías sin municipio: ${noMunicipio.length}`)

// 6. terreno no degenerado: rango, media, clamp y tamaño de grid, cada uno con su propio umbral
let sum = 0, clamped = 0
for (const v of grid) { sum += v; if (v === -500 || v === 9000) clamped++ }
const mean = sum / grid.length
const range = terrain.max - terrain.min
check(range >= 1000, `rango de elevación: ${range} m (umbral >= 1000 m)`)
check(mean >= 100 && mean <= 2000, `elevación media: ${mean.toFixed(1)} m (esperado 100-2000)`)
check(clamped / grid.length < 0.01,
  `celdas en el tope del clamp: ${clamped} de ${grid.length} (${(clamped / grid.length * 100).toFixed(2)}%, umbral < 1%)`)
check(grid.length === terrain.width * terrain.height,
  `terrain.bin tiene ${grid.length} celdas, esperadas ${terrain.width * terrain.height}`)

// 7. drapeado no plano: la mayoría de las vías sube o baja con el terreno, y ninguna queda invertida
const draped = meta.ways.filter(w => w.km3d > w.km).length
const inverted = meta.ways.filter(w => w.km3d < w.km)
check(draped / meta.ways.length >= 0.5,
  `vías con km3d > km: ${draped} de ${meta.ways.length} (${(draped / meta.ways.length * 100).toFixed(1)}%, umbral >= 50%)`)
check(inverted.length === 0, `vías con km3d menor que km: ${inverted.length}`)

// 8. todo id en pci-tachira.json existe en roads-meta.json.
// Ausente se omite; ilegible o con JSON inválido falla (no aborta el script); presente y válido se verifica.
if (existsSync('pci-tachira.json')) {
  try {
    const pci = JSON.parse(await readFile('pci-tachira.json', 'utf8'))
    const knownIds = new Set(meta.ways.map(w => String(w.osmId)))
    const orphanIds = Object.keys(pci.registros ?? {}).filter(id => !knownIds.has(id))
    check(orphanIds.length === 0,
      `ids huérfanos en pci-tachira.json: ${orphanIds.length}${orphanIds.length ? ' → ' + orphanIds.slice(0, 5).join(', ') : ''}`)
  } catch (e) {
    check(false, `pci-tachira.json existe pero no se pudo leer/parsear: ${e.message}`)
  }
} else {
  console.log('  --   pci-tachira.json todavía no existe, se omite el chequeo de huérfanos')
}

console.log(`\n${failures.length === 0 ? 'todo en orden' : `${failures.length} fallas`}`)
process.exit(failures.length === 0 ? 0 : 1)
```

- [ ] **Step 2: Correr la verificación**

Run: `npm run verify`
Expected: todos los checks en `ok`, salida `todo en orden`, código 0.

Si el check 5 falla con pocas vías sin municipio, son tramos fronterizos cuyo punto medio cayó
en una grieta de precisión entre polígonos vecinos. El fallback del paso 4 de `build-data.mjs`
las resuelve por **voto mayoritario de vértices**: se cuenta en cuántos vértices de la vía cae
cada municipio y gana el que más tenga.

No "el primer vértice que resuelva" — eso depende del orden del array y asignaría una vía entera
al municipio de un ramal corto inicial cuando el grueso de su longitud está en otro. Tampoco "el
vértice más cercano", que exige calcular distancias para responder peor: la pregunta real no es
qué vértice está cerca, sino dónde está la mayor parte de la vía.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-data.mjs
git commit -m "feat: verificacion de los datos generados, con round-trip ENU como gate"
```

---

# FASE 2 — Terreno y cielo

## Task 9: Constantes, tipos y carga de datos en el navegador

**Files:**
- Create: `src/data/constants.ts`, `src/data/types.ts`, `src/data/load.ts`
- Test: `src/data/constants.test.ts`

**Interfaces:**
- Produces:
  - `constants.ts`: `ORIGIN`, `BBOX`, `GRID`, `ATTR_SIZE = 164`, `PCI_RANGES`, `FUENTES`, `TIPOS`, `pciColor(pci) → [r, g, b]`
  - `types.ts`: `Way`, `RoadsMeta`, `TerrainMeta`, `Municipio`, `Registro`, `Fuente`, `Tipo`
  - `load.ts`: `loadAll() → Promise<{ terrain, terrainGrid, roads, positions, segIds, index, municipios }>`

- [ ] **Step 1: Escribir el test de la paleta**

```ts
// src/data/constants.test.ts
import { test, expect } from 'vitest'
import { PCI_RANGES, pciColor, ATTR_SIZE } from './constants'

test('los 7 rangos ASTM cubren 0-100 sin huecos ni solapes', () => {
  const ordenados = [...PCI_RANGES].sort((a, b) => a.min - b.min)
  expect(ordenados[0].min).toBe(0)
  expect(ordenados[ordenados.length - 1].max).toBe(100)
  for (let i = 1; i < ordenados.length; i++) {
    expect(ordenados[i].min).toBe(ordenados[i - 1].max + 1)
  }
  expect(PCI_RANGES).toHaveLength(7)
})

test('pciColor devuelve gris para sin evaluar y color para los extremos', () => {
  const sinEvaluar = pciColor(null)
  expect(sinEvaluar[0]).toBe(sinEvaluar[1])
  expect(sinEvaluar[1]).toBe(sinEvaluar[2])
  expect(pciColor(100)).not.toEqual(pciColor(0))
})

test('la data texture cabe para 26.712 vias', () => {
  expect(ATTR_SIZE * ATTR_SIZE).toBeGreaterThanOrEqual(26712)
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/data/constants.test.ts`
Expected: FAIL — no se puede resolver `./constants`

- [ ] **Step 3: Implementar los tres módulos**

```ts
// src/data/constants.ts
export const ORIGIN = { lat: 8.021973, lon: -71.901563, h: 0 }
export const BBOX = { s: 7.3612911, w: -72.4878225, n: 8.6826552, e: -71.3153029 }
export const GRID = 1024
export const ATTR_SIZE = 164          // 164² = 26.896 ≥ 26.712 vías

// Rangos ASTM D6433
export const PCI_RANGES = [
  { min: 86, max: 100, label: 'Bueno',        color: [0.13, 0.62, 0.31] },
  { min: 71, max: 85,  label: 'Satisfactorio', color: [0.49, 0.75, 0.27] },
  { min: 56, max: 70,  label: 'Regular',      color: [0.95, 0.83, 0.25] },
  { min: 41, max: 55,  label: 'Deficiente',   color: [0.95, 0.60, 0.20] },
  { min: 26, max: 40,  label: 'Muy deficiente', color: [0.89, 0.36, 0.16] },
  { min: 11, max: 25,  label: 'Grave',        color: [0.78, 0.16, 0.16] },
  { min: 0,  max: 10,  label: 'Colapsado',    color: [0.45, 0.08, 0.12] },
] as const

export const SIN_EVALUAR: [number, number, number] = [0.45, 0.45, 0.45]

export const FUENTES = ['sin', 'heredado', 'estimado', 'medido'] as const
export const TIPOS = ['sin_definir', 'asfalto', 'concreto', 'granzon', 'tierra', 'empedrado'] as const

export function pciColor (pci: number | null): [number, number, number] {
  if (pci == null) return SIN_EVALUAR
  const r = PCI_RANGES.find(x => pci >= x.min && pci <= x.max)
  return r ? [...r.color] as [number, number, number] : SIN_EVALUAR
}
```

```ts
// src/data/types.ts
import type { FUENTES, TIPOS } from './constants'

export type Fuente = typeof FUENTES[number]
export type Tipo = typeof TIPOS[number]

export interface Way {
  osmId: number
  ref: string | null
  name: string | null
  highway: string
  surface: string | null
  tipo: Tipo
  municipio: string | null
  km: number
  km3d: number
}

export interface RoadsMeta { count: number; ways: Way[] }
export interface TerrainMeta {
  width: number; height: number
  bbox: { s: number; w: number; n: number; e: number }
  min: number; max: number
  origin: { lat: number; lon: number; h: number }
}
export interface Municipio { osmId: number; name: string; polygon: number[][][] }

export interface Registro { pci: number | null; fuente: Fuente; tipo: Tipo; fecha: string; nota: string }
```

```ts
// src/data/load.ts
import type { RoadsMeta, TerrainMeta, Municipio } from './types'

const bin = async (path: string) => (await fetch(path)).arrayBuffer()
const json = async <T>(path: string): Promise<T> => (await fetch(path)).json()

export async function loadAll () {
  const [terrain, roads, municipios, tBuf, pBuf, sBuf, iBuf] = await Promise.all([
    json<TerrainMeta>('/data/terrain.json'),
    json<RoadsMeta>('/data/roads-meta.json'),
    json<Municipio[]>('/data/municipios.json'),
    bin('/data/terrain.bin'),
    bin('/data/roads-pos.bin'),
    bin('/data/roads-segid.bin'),
    bin('/data/roads-index.bin'),
  ])
  return {
    terrain,
    terrainGrid: new Int16Array(tBuf),
    roads,
    positions: new Float32Array(pBuf),
    segIds: new Float32Array(sBuf),
    index: new Uint32Array(iBuf),
    municipios,
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/data/constants.test.ts`
Expected: PASS — los 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/constants.ts src/data/types.ts src/data/load.ts src/data/constants.test.ts
git commit -m "feat: constantes, tipos y carga de binarios en el navegador"
```

---

## Task 10: Escena mínima con cielo de takram

**Files:**
- Create: `src/main.tsx`, `src/App.tsx`, `src/scene/Sky.tsx`, `index.html`

**Interfaces:**
- Consumes: `constants.ts` → `ORIGIN`
- Produces: `<Sky />` — envuelve `<Atmosphere>` de takram con el origen del proyecto y la hora ajustable

- [ ] **Step 1: Crear `index.html` y `main.tsx`**

```html
<!-- index.html -->
<!doctype html>
<html lang="es">
  <head><meta charset="utf-8" /><title>Vialidad Táchira</title>
    <style>html,body,#root{margin:0;height:100%;background:#0b1017;color:#e8eaed;
      font:14px system-ui,sans-serif;overflow:hidden}</style>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client'
import App from './App'
createRoot(document.getElementById('root')!).render(<App />)
```

- [ ] **Step 2: Crear el wrapper del cielo**

Los nombres exactos de los props de `<Atmosphere>` están en la documentación del paquete; si alguno
no existe en la versión instalada, quitarlo y dejar los valores por defecto antes que inventar.

```tsx
// src/scene/Sky.tsx
import { useRef } from 'react'
import { Atmosphere, Sky as TakramSky, SunLight, SkyLight, AerialPerspective }
  from '@takram/three-atmosphere/r3f'
import type { AtmosphereApi } from '@takram/three-atmosphere/r3f'
import { useFrame } from '@react-three/fiber'
import { ORIGIN } from '../data/constants'

export function Sky ({ date }: { date: Date }) {
  const api = useRef<AtmosphereApi>(null)
  useFrame(() => { api.current?.updateByDate(date) })
  return (
    <Atmosphere ref={api} referenceDate={date}
      // el scattering necesita saber dónde estamos de verdad, aunque
      // la escena esté rebaseada al origen local
      correctAltitude
    >
      <TakramSky />
      <SunLight />
      <SkyLight />
      <AerialPerspective sky sunLight skyLight />
    </Atmosphere>
  )
}

export const SKY_ORIGIN = ORIGIN
```

- [ ] **Step 3: Crear el App shell**

```tsx
// src/App.tsx
import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer } from '@react-three/postprocessing'
import { Sky } from './scene/Sky'

export default function App () {
  const [date] = useState(() => new Date('2026-09-05T14:00:00Z'))
  return (
    <Canvas camera={{ position: [0, 40000, 60000], near: 10, far: 2_000_000, fov: 45 }}>
      <Suspense fallback={null}>
        <Sky date={date} />
        <OrbitControls maxDistance={400000} />
        <EffectComposer />
      </Suspense>
    </Canvas>
  )
}
```

- [ ] **Step 4: Verificar visualmente**

Run: `npm run dev` y abrir la URL que imprime.
Expected: se ve un cielo con atmósfera, sin errores en la consola del navegador.

Si `@takram/three-atmosphere/r3f` no exporta alguno de esos componentes, revisar
`node_modules/@takram/three-atmosphere/build/r3f/index.js` para los nombres reales de la versión
instalada, y ajustar. No adivinar.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.tsx src/App.tsx src/scene/Sky.tsx
git commit -m "feat: escena minima con atmosfera de takram"
```

---

## Task 11: Malla del terreno

**Files:**
- Create: `src/scene/Terrain.tsx`, `src/scene/terrainShader.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `load.ts` → `terrainGrid`, `terrain`; `constants.ts` → `ORIGIN`, `GRID`
- Produces: `<Terrain grid meta />`

La malla **no** es una `PlaneGeometry`. Cada vértice se proyecta individualmente desde lat/lon a ENU
para que la curvatura terrestre quede incorporada (424 m de caída a lo largo del estado, spec §4.1).
Se usa la misma matemática que el pipeline, portada a TypeScript.

- [ ] **Step 1: Portar la proyección a TypeScript**

Crear `src/data/enu.ts` con el mismo contenido que `scripts/lib/enu.mjs`, tipado. Es la única
duplicación deliberada del proyecto: el pipeline corre en Node y la escena en el navegador, y una
dependencia compartida entre ambos no compensa por seis funciones puras.

```ts
// src/data/enu.ts
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
```

- [ ] **Step 2: Escribir el test de coherencia entre las dos implementaciones**

```ts
// src/data/enu.test.ts
import { test, expect } from 'vitest'
import { makeEnuFrame, geodeticToEnu } from './enu'
import { makeEnuFrame as mkNode, geodeticToEnu as toEnuNode } from '../../scripts/lib/enu.mjs'

test('la version del navegador coincide con la del pipeline al milimetro', () => {
  const a = makeEnuFrame(8.021973, -71.901563, 0)
  const b = mkNode(8.021973, -71.901563, 0)
  for (const [lat, lon, h] of [[7.4, -72.4, 0], [8.6, -71.4, 3942], [8.0, -71.9, 1000]]) {
    const p = geodeticToEnu(a, lat, lon, h)
    const q = toEnuNode(b, lat, lon, h)
    expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(0.001)
  }
})
```

- [ ] **Step 3: Correr el test y verificar que falla, luego que pasa**

Run: `npx vitest run src/data/enu.test.ts`
Expected: primero FAIL por módulo ausente; tras el Step 1, PASS.

- [ ] **Step 4: Escribir el shader del terreno**

Hipsometría por elevación más hillshade calculado desde las normales de la propia malla.

```ts
// src/scene/terrainShader.ts
export const terrainVert = /* glsl */`
varying float vElev;
varying vec3 vNormalW;
void main () {
  vElev = position.y;
  vNormalW = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

export const terrainFrag = /* glsl */`
uniform float uMin;
uniform float uMax;
uniform vec3 uSun;
varying float vElev;
varying vec3 vNormalW;

vec3 hypso (float t) {
  if (t < 0.25) return mix(vec3(0.18,0.31,0.22), vec3(0.36,0.44,0.24), t / 0.25);
  if (t < 0.50) return mix(vec3(0.36,0.44,0.24), vec3(0.60,0.53,0.33), (t - 0.25) / 0.25);
  if (t < 0.75) return mix(vec3(0.60,0.53,0.33), vec3(0.62,0.47,0.40), (t - 0.50) / 0.25);
  return mix(vec3(0.62,0.47,0.40), vec3(0.90,0.90,0.92), (t - 0.75) / 0.25);
}

void main () {
  float t = clamp((vElev - uMin) / max(1.0, uMax - uMin), 0.0, 1.0);
  float shade = clamp(dot(normalize(vNormalW), normalize(uSun)) * 0.6 + 0.5, 0.15, 1.0);
  gl_FragColor = vec4(hypso(t) * shade, 1.0);
}`
```

- [ ] **Step 5: Escribir el componente del terreno**

```tsx
// src/scene/Terrain.tsx
import { useMemo } from 'react'
import * as THREE from 'three'
import { makeEnuFrame, geodeticToEnu } from '../data/enu'
import { terrainVert, terrainFrag } from './terrainShader'
import type { TerrainMeta } from '../data/types'

export function Terrain ({ grid, meta }: { grid: Int16Array; meta: TerrainMeta }) {
  const geometry = useMemo(() => {
    const { width: W, height: H, bbox } = meta
    const frame = makeEnuFrame(meta.origin.lat, meta.origin.lon, meta.origin.h)
    const pos = new Float32Array(W * H * 3)
    for (let y = 0; y < H; y++) {
      const lat = bbox.n - (bbox.n - bbox.s) * y / (H - 1)   // fila 0 = norte
      for (let x = 0; x < W; x++) {
        const lon = bbox.w + (bbox.e - bbox.w) * x / (W - 1)
        const [e, n, u] = geodeticToEnu(frame, lat, lon, grid[y * W + x])
        const i = (y * W + x) * 3
        pos[i] = e; pos[i + 1] = u; pos[i + 2] = -n      // ejes de three, igual que pack.mjs
      }
    }
    const idx = new Uint32Array((W - 1) * (H - 1) * 6)
    let k = 0
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const a = y * W + x, b = a + 1, c = a + W, d = c + 1
        idx[k++] = a; idx[k++] = c; idx[k++] = b
        idx[k++] = b; idx[k++] = c; idx[k++] = d
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    g.computeVertexNormals()
    return g
  }, [grid, meta])

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: terrainVert,
    fragmentShader: terrainFrag,
    uniforms: {
      uMin: { value: meta.min }, uMax: { value: meta.max },
      uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    },
  }), [meta])

  return <mesh geometry={geometry} material={material} frustumCulled={false} />
}
```

- [ ] **Step 6: Montarlo en App**

```tsx
// src/App.tsx — reemplazar el contenido completo
import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer } from '@react-three/postprocessing'
import { Sky } from './scene/Sky'
import { Terrain } from './scene/Terrain'
import { loadAll } from './data/load'

type Data = Awaited<ReturnType<typeof loadAll>>

export default function App () {
  const [data, setData] = useState<Data | null>(null)
  const [date] = useState(() => new Date('2026-09-05T14:00:00Z'))
  useEffect(() => { loadAll().then(setData) }, [])

  if (!data) return <div style={{ padding: 24 }}>cargando datos del Táchira…</div>

  return (
    <Canvas camera={{ position: [0, 60000, 90000], near: 10, far: 2_000_000, fov: 45 }}>
      <Suspense fallback={null}>
        <Sky date={date} />
        <Terrain grid={data.terrainGrid} meta={data.terrain} />
        <OrbitControls maxDistance={400000} />
        <EffectComposer />
      </Suspense>
    </Canvas>
  )
}
```

- [ ] **Step 7: Verificar visualmente**

Run: `npm run dev`
Expected: se ve el relieve del Táchira — la cordillera al este, el valle del río Táchira al oeste,
coloreado por elevación y con sombreado. Girando la cámara el relieve debe verse coherente, sin
picos aislados que griten error de índice.

- [ ] **Step 8: Commit**

```bash
git add src/data/enu.ts src/data/enu.test.ts src/scene/Terrain.tsx src/scene/terrainShader.ts src/App.tsx
git commit -m "feat: malla del terreno proyectada a ENU con hipsometria y hillshade"
```

---

## Task 12: Cámara geodésica

**Files:**
- Create: `src/scene/Camera.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `enu.ts` → `makeEnuFrame`, `geodeticToEnu`
- Produces: `<Camera target={{lat, lon}} distance heading pitch />` y `flyToBbox(bbox)`

- [ ] **Step 1: Escribir el componente**

```tsx
// src/scene/Camera.tsx
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeEnuFrame, geodeticToEnu } from '../data/enu'
import { ORIGIN } from '../data/constants'

const frame = makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)

export function enuOf (lat: number, lon: number, h = 0) {
  const [e, n, u] = geodeticToEnu(frame, lat, lon, h)
  return new THREE.Vector3(e, u, -n)
}

export function bboxCenterAndSpan (bbox: { s: number; w: number; n: number; e: number }) {
  const a = enuOf(bbox.s, bbox.w), b = enuOf(bbox.n, bbox.e)
  return { center: a.clone().add(b).multiplyScalar(0.5), span: a.distanceTo(b) }
}

/** Encuadra un bbox geodésico moviendo cámara y target de OrbitControls. */
export function FlyTo ({ bbox }: { bbox: { s: number; w: number; n: number; e: number } | null }) {
  const { camera, controls } = useThree() as any
  useEffect(() => {
    if (!bbox) return
    const { center, span } = bboxCenterAndSpan(bbox)
    camera.position.set(center.x, center.y + span * 0.7, center.z + span * 0.9)
    camera.updateProjectionMatrix()
    if (controls) { controls.target.copy(center); controls.update() }
  }, [bbox, camera, controls])
  return null
}
```

- [ ] **Step 2: Escribir el test del encuadre**

```ts
// src/scene/Camera.test.ts
import { test, expect } from 'vitest'
import { enuOf, bboxCenterAndSpan } from './Camera'
import { ORIGIN, BBOX } from '../data/constants'

test('el origen del proyecto cae en el cero de la escena', () => {
  const v = enuOf(ORIGIN.lat, ORIGIN.lon, 0)
  expect(v.length()).toBeLessThan(1e-6)
})

test('el span del bbox del Tachira ronda los 200 km de diagonal', () => {
  const { span } = bboxCenterAndSpan(BBOX)
  expect(span).toBeGreaterThan(180000)
  expect(span).toBeLessThan(220000)
})
```

- [ ] **Step 3: Correr el test y verificar que pasa**

Run: `npx vitest run src/scene/Camera.test.ts`
Expected: PASS — los 2 tests. La diagonal de 147 × 129 km es ~196 km.

- [ ] **Step 4: Montar `FlyTo` en App con `makeDefault` en OrbitControls**

En `src/App.tsx`, cambiar `<OrbitControls maxDistance={400000} />` por
`<OrbitControls makeDefault maxDistance={400000} />` y añadir `<FlyTo bbox={flyTo} />`
con `const [flyTo, setFlyTo] = useState<typeof BBOX | null>(null)`.
Importar `FlyTo` desde `./scene/Camera` y `BBOX` desde `./data/constants`.

`makeDefault` es lo que hace que `useThree().controls` esté disponible; sin eso `FlyTo`
mueve la cámara pero OrbitControls la devuelve a su sitio en el siguiente frame.

- [ ] **Step 5: Commit**

```bash
git add src/scene/Camera.tsx src/scene/Camera.test.ts src/App.tsx
git commit -m "feat: camara geodesica y encuadre de bbox"
```

---

# FASE 3 — Las vías

## Task 13: Store de atributos y siembra desde surface

**Files:**
- Create: `src/data/store.ts`
- Test: `src/data/store.test.ts`

**Interfaces:**
- Consumes: `types.ts` → `Registro`, `Way`, `Fuente`, `Tipo`
- Produces:
  - `class AttrStore` con: `constructor(ways: Way[])`, `get(i) → Registro`, `set(indices: number[], patch: Partial<Registro>) → void`, `seedFromSurface() → number`, `coverageByMunicipio() → Map<string, {total, evaluados}>`, `toJSON() → object`, `loadJSON(obj, ways) → string[]` (devuelve ids huérfanos), `onChange(cb)`

El store vive **fuera de React**: 26.712 registros no pasan por `useState`. Notifica cambios por
callback para que la data texture se actualice.

- [ ] **Step 1: Escribir los tests**

```ts
// src/data/store.test.ts
import { test, expect } from 'vitest'
import { AttrStore } from './store'
import type { Way } from './types'

const ways: Way[] = [
  { osmId: 1, ref: null, name: null, highway: 'residential', surface: 'asphalt', tipo: 'asfalto', municipio: 'Rubio', km: 1, km3d: 1 },
  { osmId: 2, ref: null, name: null, highway: 'track', surface: null, tipo: 'sin_definir', municipio: 'Rubio', km: 2, km3d: 2.1 },
  { osmId: 3, ref: null, name: null, highway: 'primary', surface: null, tipo: 'sin_definir', municipio: 'Junín', km: 3, km3d: 3.2 },
]

test('arranca sin evaluar y sin fuente', () => {
  const s = new AttrStore(ways)
  expect(s.get(0).pci).toBeNull()
  expect(s.get(0).fuente).toBe('sin')
})

test('seedFromSurface siembra el tipo como heredado y cuenta cuantas sembro', () => {
  const s = new AttrStore(ways)
  expect(s.seedFromSurface()).toBe(1)
  expect(s.get(0).tipo).toBe('asfalto')
  expect(s.get(0).fuente).toBe('heredado')
  expect(s.get(1).tipo).toBe('sin_definir')
  expect(s.get(1).fuente).toBe('sin')      // sin surface, no se siembra nada
})

test('set aplica el mismo parche a muchas vias de una', () => {
  const s = new AttrStore(ways)
  s.set([0, 1, 2], { pci: 45, fuente: 'heredado' })
  expect(s.get(0).pci).toBe(45)
  expect(s.get(2).pci).toBe(45)
  expect(s.get(2).fuente).toBe('heredado')
})

test('set notifica una sola vez por lote', () => {
  const s = new AttrStore(ways)
  let n = 0
  s.onChange(() => n++)
  s.set([0, 1, 2], { pci: 10, fuente: 'estimado' })
  expect(n).toBe(1)
})

test('la cobertura por municipio cuenta evaluados sobre total', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 80, fuente: 'medido' })
  const c = s.coverageByMunicipio()
  expect(c.get('Rubio')).toEqual({ total: 2, evaluados: 1 })
  expect(c.get('Junín')).toEqual({ total: 1, evaluados: 0 })
})

test('loadJSON restaura por osmId y reporta huerfanos sin borrarlos', () => {
  const s = new AttrStore(ways)
  const orphans = s.loadJSON({ version: 1, registros: {
    '2': { pci: 30, fuente: 'medido', tipo: 'tierra', fecha: '2026-09-05', nota: '' },
    '999': { pci: 50, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(1).pci).toBe(30)
  expect(orphans).toEqual(['999'])
})

test('toJSON solo serializa lo que tiene dato', () => {
  const s = new AttrStore(ways)
  s.set([1], { pci: 30, fuente: 'medido' })
  const out = s.toJSON() as any
  expect(Object.keys(out.registros)).toEqual(['2'])
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/data/store.test.ts`
Expected: FAIL — no se puede resolver `./store`

- [ ] **Step 3: Implementar**

```ts
// src/data/store.ts
import type { Way, Registro } from './types'

const hoy = () => new Date().toISOString().slice(0, 10)
const vacio = (): Registro => ({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '' })

export class AttrStore {
  private regs: Registro[]
  private listeners: Array<() => void> = []

  constructor (private ways: Way[]) {
    this.regs = ways.map(vacio)
  }

  get (i: number): Registro { return this.regs[i] }
  get length (): number { return this.regs.length }

  onChange (cb: () => void) { this.listeners.push(cb) }
  private notify () { for (const cb of this.listeners) cb() }

  set (indices: number[], patch: Partial<Registro>) {
    for (const i of indices) {
      this.regs[i] = { ...this.regs[i], ...patch, fecha: patch.fecha ?? hoy() }
    }
    this.notify()
  }

  /** El surface de OSM siembra el tipo de rodadura con procedencia heredado. */
  seedFromSurface (): number {
    let n = 0
    for (let i = 0; i < this.ways.length; i++) {
      const t = this.ways[i].tipo
      if (t !== 'sin_definir') {
        this.regs[i] = { ...this.regs[i], tipo: t, fuente: 'heredado', fecha: hoy() }
        n++
      }
    }
    this.notify()
    return n
  }

  coverageByMunicipio (): Map<string, { total: number; evaluados: number }> {
    const out = new Map<string, { total: number; evaluados: number }>()
    for (let i = 0; i < this.ways.length; i++) {
      const m = this.ways[i].municipio ?? 'sin municipio'
      const e = out.get(m) ?? { total: 0, evaluados: 0 }
      e.total++
      if (this.regs[i].pci != null) e.evaluados++
      out.set(m, e)
    }
    return out
  }

  toJSON () {
    const registros: Record<string, Registro> = {}
    for (let i = 0; i < this.regs.length; i++) {
      const r = this.regs[i]
      if (r.pci != null || r.fuente !== 'sin' || r.nota) registros[String(this.ways[i].osmId)] = r
    }
    return { version: 1, actualizado: hoy(), registros }
  }

  /** Devuelve los ids que ya no existen en la red. No los borra: los reporta. */
  loadJSON (obj: { registros?: Record<string, Registro> }, ways: Way[]): string[] {
    const porId = new Map(ways.map((w, i) => [String(w.osmId), i]))
    const orphans: string[] = []
    for (const [id, reg] of Object.entries(obj.registros ?? {})) {
      const i = porId.get(id)
      if (i == null) orphans.push(id)
      else this.regs[i] = { ...vacio(), ...reg }
    }
    this.notify()
    return orphans
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/data/store.test.ts`
Expected: PASS — los 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/store.ts src/data/store.test.ts
git commit -m "feat: store de atributos fuera de React con siembra desde surface"
```

---

## Task 14: Data texture de atributos

**Files:**
- Create: `src/data/attrTexture.ts`
- Test: `src/data/attrTexture.test.ts`

**Interfaces:**
- Consumes: `store.ts` → `AttrStore`; `constants.ts` → `ATTR_SIZE`, `FUENTES`
- Produces:
  - `class AttrTexture` con `texture: THREE.DataTexture`, `constructor(store)`, `refresh(visible?: Uint8Array) → void`
  - `encodeAttr(reg, visible, selected) → [r, g, b, a]`

Codificación (spec §6.2): R = PCI 0-100 o 255 sin evaluar · G = índice de fuente · B = bit0 visible,
bit1 seleccionado · A reservado.

- [ ] **Step 1: Escribir los tests**

```ts
// src/data/attrTexture.test.ts
import { test, expect } from 'vitest'
import { encodeAttr } from './attrTexture'
import type { Registro } from './types'

const reg = (p: Partial<Registro> = {}): Registro =>
  ({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '', ...p })

test('sin evaluar se codifica como 255 en R', () => {
  expect(encodeAttr(reg(), true, false)[0]).toBe(255)
})

test('el PCI va crudo en R y la fuente indexada en G', () => {
  const [r, g] = encodeAttr(reg({ pci: 45, fuente: 'medido' }), true, false)
  expect(r).toBe(45)
  expect(g).toBe(3)                       // sin=0 heredado=1 estimado=2 medido=3
})

test('los flags de visible y seleccionado van en bits distintos de B', () => {
  expect(encodeAttr(reg(), false, false)[2] & 1).toBe(0)
  expect(encodeAttr(reg(), true, false)[2] & 1).toBe(1)
  expect(encodeAttr(reg(), true, true)[2] & 2).toBe(2)
  expect(encodeAttr(reg(), false, true)[2]).toBe(2)
})

test('un PCI de 0 no se confunde con sin evaluar', () => {
  expect(encodeAttr(reg({ pci: 0, fuente: 'medido' }), true, false)[0]).toBe(0)
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/data/attrTexture.test.ts`
Expected: FAIL — no se puede resolver `./attrTexture`

- [ ] **Step 3: Implementar**

```ts
// src/data/attrTexture.ts
import * as THREE from 'three'
import { ATTR_SIZE, FUENTES } from './constants'
import type { Registro } from './types'
import type { AttrStore } from './store'

export function encodeAttr (reg: Registro, visible: boolean, selected: boolean):
  [number, number, number, number] {
  return [
    reg.pci == null ? 255 : Math.max(0, Math.min(100, Math.round(reg.pci))),
    FUENTES.indexOf(reg.fuente),
    (visible ? 1 : 0) | (selected ? 2 : 0),
    0,
  ]
}

export class AttrTexture {
  readonly texture: THREE.DataTexture
  private data: Uint8Array

  constructor (private store: AttrStore) {
    this.data = new Uint8Array(ATTR_SIZE * ATTR_SIZE * 4)
    this.texture = new THREE.DataTexture(
      this.data, ATTR_SIZE, ATTR_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType,
    )
    this.texture.magFilter = THREE.NearestFilter
    this.texture.minFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
    this.refresh()
  }

  /** `visible` y `selected` son máscaras opcionales de un byte por vía. */
  refresh (visible?: Uint8Array, selected?: Uint8Array) {
    for (let i = 0; i < this.store.length; i++) {
      const [r, g, b, a] = encodeAttr(
        this.store.get(i),
        visible ? visible[i] === 1 : true,
        selected ? selected[i] === 1 : false,
      )
      const o = i * 4
      this.data[o] = r; this.data[o + 1] = g; this.data[o + 2] = b; this.data[o + 3] = a
    }
    this.texture.needsUpdate = true
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/data/attrTexture.test.ts`
Expected: PASS — los 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/attrTexture.ts src/data/attrTexture.test.ts
git commit -m "feat: data texture de atributos indexada por id de via"
```

---

## Task 15: Render de las vías

**Files:**
- Create: `src/scene/Roads.tsx`, `src/scene/roadsShader.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `load.ts` → `positions`, `segIds`; `attrTexture.ts` → `AttrTexture`
- Produces: `<Roads positions segIds attr />`, y `patchLineMaterial(material, attrTexture, attrSize)`

`LineMaterial` de three trae su propio shader. El parche se inyecta **al inicio de `void main()`**,
que es mucho más estable entre versiones que reemplazar una línea interna. Si el string ancla no
aparece, se lanza un error: una actualización de three debe fallar ruidosamente, no en silencio.

- [ ] **Step 1: Escribir el parche del material**

```ts
// src/scene/roadsShader.ts
import * as THREE from 'three'

const ANCLA_VERT = 'void main() {'
const ANCLA_FRAG = 'vec4 diffuseColor = vec4( diffuse, opacity );'

export function patchLineMaterial (
  material: THREE.Material, attrTexture: THREE.DataTexture, attrSize: number,
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAttr = { value: attrTexture }
    shader.uniforms.uAttrSize = { value: attrSize }

    if (!shader.vertexShader.includes(ANCLA_VERT)) {
      throw new Error('roadsShader: no se encontró el ancla del vertex shader de LineMaterial')
    }
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `
        attribute float segId;
        uniform sampler2D uAttr;
        uniform float uAttrSize;
        varying vec4 vAttr;
        void main() {
          vAttr = texture2D(uAttr, (vec2(
            mod(segId, uAttrSize), floor(segId / uAttrSize)) + 0.5) / uAttrSize);
      `)

    if (!shader.fragmentShader.includes(ANCLA_FRAG)) {
      throw new Error('roadsShader: no se encontró el ancla del fragment shader de LineMaterial')
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `
        varying vec4 vAttr;

        vec3 pciColor (float pci) {
          if (pci > 100.5)          return vec3(0.45, 0.45, 0.45);  // sin evaluar
          if (pci >= 86.0)          return vec3(0.13, 0.62, 0.31);
          if (pci >= 71.0)          return vec3(0.49, 0.75, 0.27);
          if (pci >= 56.0)          return vec3(0.95, 0.83, 0.25);
          if (pci >= 41.0)          return vec3(0.95, 0.60, 0.20);
          if (pci >= 26.0)          return vec3(0.89, 0.36, 0.16);
          if (pci >= 11.0)          return vec3(0.78, 0.16, 0.16);
          return vec3(0.45, 0.08, 0.12);
        }
        void main() {
      `)
      .replace(ANCLA_FRAG, `
        float pci = vAttr.r * 255.0;
        float fuente = floor(vAttr.g * 255.0 + 0.5);
        float visible = mod(floor(vAttr.b * 255.0 + 0.5), 2.0);
        float selected = floor(mod(floor(vAttr.b * 255.0 + 0.5), 4.0) / 2.0);
        if (visible < 0.5) discard;
        // la procedencia modula la opacidad: medido sólido, heredado tenue
        float alpha = fuente >= 3.0 ? 1.0 : (fuente >= 2.0 ? 0.75 : 0.45);
        vec3 base = mix(pciColor(pci), vec3(1.0), selected * 0.6);
        vec4 diffuseColor = vec4( base, opacity * alpha );
      `)
  }
  material.needsUpdate = true
}
```

- [ ] **Step 2: Escribir el componente**

```tsx
// src/scene/Roads.tsx
import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree } from '@react-three/fiber'
import { patchLineMaterial } from './roadsShader'
import { ATTR_SIZE } from '../data/constants'
import type { AttrTexture } from '../data/attrTexture'

export function Roads (
  { positions, segIds, attr }: { positions: Float32Array; segIds: Float32Array; attr: AttrTexture },
) {
  const { size } = useThree()

  const object = useMemo(() => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(positions)
    geometry.setAttribute('segId', new THREE.InstancedBufferAttribute(segIds, 1))

    const material = new LineMaterial({
      linewidth: 2, worldUnits: false, transparent: true, depthWrite: false,
    })
    patchLineMaterial(material, attr.texture, ATTR_SIZE)

    const line = new LineSegments2(geometry, material)
    line.frustumCulled = false     // el bbox de una geometría instanciada no es fiable
    return line
  }, [positions, segIds, attr])

  // LineMaterial necesita saber el tamaño del lienzo para calcular el ancho en píxeles
  useEffect(() => {
    ;(object.material as LineMaterial).resolution.set(size.width, size.height)
  }, [object, size])

  return <primitive object={object} />
}
```

- [ ] **Step 3: Montarlo en App**

En `src/App.tsx`: crear el store y la textura una sola vez con `useMemo` sobre `data`, sembrar
desde surface, y renderizar `<Roads />` junto al terreno.

```tsx
// añadir dentro de App, después de cargar data
const { store, attr } = useMemo(() => {
  if (!data) return { store: null, attr: null }
  const s = new AttrStore(data.roads.ways)
  const sembradas = s.seedFromSurface()
  console.log(`${sembradas} vías con tipo sembrado desde surface`)
  return { store: s, attr: new AttrTexture(s) }
}, [data])

// y dentro del Canvas, junto a <Terrain />
{attr && <Roads positions={data.positions} segIds={data.segIds} attr={attr} />}
```

Añadir en `App.tsx` un `useEffect` que reconstruya la textura cuando el store cambie:

```tsx
useEffect(() => {
  if (!store || !attr) return
  store.onChange(() => attr.refresh())
}, [store, attr])
```

- [ ] **Step 4: Verificar visualmente**

Run: `npm run dev`
Expected: las vías aparecen sobre el terreno. Al no haber PCI cargado todavía, todas se ven grises;
las que trajeron `surface` se ven algo más tenues por el alpha de `heredado`. La consola imprime
cuántas se sembraron — debe rondar 6.232.

Si three lanza el error de ancla del shader, abrir `node_modules/three/examples/jsm/lines/LineMaterial.js`
y buscar el string real de esa versión, actualizando `ANCLA_FRAG`. **No quitar la comprobación.**

- [ ] **Step 5: Commit**

```bash
git add src/scene/Roads.tsx src/scene/roadsShader.ts src/App.tsx
git commit -m "feat: render de las 26.712 vias con color por PCI desde data texture"
```

---

# FASE 4 — Selección, edición y persistencia

## Task 16: Id buffer y selección por clic

**Files:**
- Create: `src/scene/PickingPass.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `load.ts` → `positions`, `segIds`
- Produces:
  - `encodeId(i) → [r, g, b]` y `decodeId(r, g, b) → number` — el id 0 significa "nada"; las vías empiezan en 1
  - `usePicking({ positions, segIds }) → { pickAt(x, y) → number | null, pickRegion(rect) → number[] }`

- [ ] **Step 1: Escribir el test de la codificación**

```ts
// src/scene/picking.test.ts
import { test, expect } from 'vitest'
import { encodeId, decodeId } from './PickingPass'

test('round-trip de ids en todo el rango util', () => {
  for (const i of [0, 1, 255, 256, 26712, 65535, 65536, 16777215]) {
    const [r, g, b] = encodeId(i)
    expect(decodeId(r, g, b)).toBe(i)
  }
})

test('los componentes se mantienen dentro de un byte', () => {
  const [r, g, b] = encodeId(26712)
  for (const c of [r, g, b]) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(256) }
})

test('el id 0 esta reservado para nada', () => {
  expect(decodeId(0, 0, 0)).toBe(0)
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/scene/picking.test.ts`
Expected: FAIL — no se puede resolver `./PickingPass`

- [ ] **Step 3: Implementar**

El pase de picking renderiza la misma geometría con un material propio, más ancho, a un render
target sin antialiasing. Solo corre cuando se le pide.

```tsx
// src/scene/PickingPass.tsx
import { useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree } from '@react-three/fiber'

export const encodeId = (i: number): [number, number, number] =>
  [(i >> 16) & 255, (i >> 8) & 255, i & 255]

export const decodeId = (r: number, g: number, b: number): number =>
  (r << 16) | (g << 8) | b

// Más ancho que el pase visible: da tolerancia de clic sobre una vía de 2 px.
// Demasiado ancho y las vías paralelas se tapan entre sí. Calibrable.
export const PICK_WIDTH = 8

function patchPickMaterial (material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('void main() {', `
      attribute float segId;
      varying float vSegId;
      void main() {
        vSegId = segId;
    `)
    const ancla = 'vec4 diffuseColor = vec4( diffuse, opacity );'
    if (!shader.fragmentShader.includes(ancla)) {
      throw new Error('PickingPass: no se encontró el ancla del fragment shader de LineMaterial')
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vSegId;\nvoid main() {')
      .replace(ancla, `
        float id = vSegId + 1.0;   // 0 queda reservado para "nada"
        vec4 diffuseColor = vec4(
          floor(mod(id / 65536.0, 256.0)) / 255.0,
          floor(mod(id / 256.0, 256.0)) / 255.0,
          floor(mod(id, 256.0)) / 255.0,
          1.0);
      `)
  }
  material.needsUpdate = true
}

export function usePicking (
  { positions, segIds }: { positions: Float32Array; segIds: Float32Array },
) {
  const { gl, scene, camera, size } = useThree()

  const { target, pickScene, pickLine } = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(size.width, size.height, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, colorSpace: THREE.NoColorSpace,
    })
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(positions)
    geometry.setAttribute('segId', new THREE.InstancedBufferAttribute(segIds, 1))
    const material = new LineMaterial({ linewidth: PICK_WIDTH, worldUnits: false })
    patchPickMaterial(material)
    const pickLine = new LineSegments2(geometry, material)
    pickLine.frustumCulled = false
    const pickScene = new THREE.Scene()
    pickScene.add(pickLine)
    return { target, pickScene, pickLine }
  }, [positions, segIds, size.width, size.height])

  const render = useCallback(() => {
    ;(pickLine.material as LineMaterial).resolution.set(size.width, size.height)
    const prevTarget = gl.getRenderTarget()
    const prevTone = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping
    gl.setRenderTarget(target)
    gl.setClearColor(0x000000, 1)
    gl.clear()
    gl.render(pickScene, camera)
    gl.setRenderTarget(prevTarget)
    gl.toneMapping = prevTone
  }, [gl, camera, target, pickScene, pickLine, size])

  const pickAt = useCallback((x: number, y: number): number | null => {
    render()
    const buf = new Uint8Array(4)
    // readRenderTargetPixels usa origen abajo-izquierda; el mouse usa arriba-izquierda
    gl.readRenderTargetPixels(target, x, size.height - y, 1, 1, buf)
    const id = decodeId(buf[0], buf[1], buf[2])
    return id === 0 ? null : id - 1
  }, [gl, target, render, size])

  const pickRegion = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, inside: (px: number, py: number) => boolean) => {
      render()
      const buf = new Uint8Array(rect.w * rect.h * 4)
      gl.readRenderTargetPixels(target, rect.x, size.height - rect.y - rect.h, rect.w, rect.h, buf)
      const ids = new Set<number>()
      for (let row = 0; row < rect.h; row++) {
        for (let col = 0; col < rect.w; col++) {
          const o = (row * rect.w + col) * 4
          const id = decodeId(buf[o], buf[o + 1], buf[o + 2])
          if (id === 0) continue
          // la fila 0 del buffer es la de abajo: la devolvemos a coordenadas de pantalla
          if (inside(rect.x + col, rect.y + rect.h - 1 - row)) ids.add(id - 1)
        }
      }
      return [...ids]
    }, [gl, target, render, size])

  return { pickAt, pickRegion }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/scene/picking.test.ts`
Expected: PASS — los 3 tests.

- [ ] **Step 5: Conectar el clic en App**

Dentro del `<Canvas>` añadir un componente que use `usePicking` y registre el handler:

```tsx
function ClickPicker (
  { positions, segIds, onPick }:
  { positions: Float32Array; segIds: Float32Array; onPick: (i: number | null, add: boolean) => void },
) {
  const { pickAt } = usePicking({ positions, segIds })
  const { gl } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const h = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect()
      onPick(pickAt(ev.clientX - r.left, ev.clientY - r.top), ev.shiftKey)
    }
    el.addEventListener('click', h)
    return () => el.removeEventListener('click', h)
  }, [gl, pickAt, onPick])
  return null
}
```

En `App`, mantener `const [selected, setSelected] = useState<Set<number>>(new Set())` y pasar un
`onPick` que agregue si `add` es cierto o reemplace si no. Tras cada cambio de selección, llamar
`attr.refresh(visibleMask, selectedMask)` donde las máscaras son `Uint8Array(store.length)`.

- [ ] **Step 6: Verificar visualmente**

Run: `npm run dev`
Expected: al hacer clic sobre una vía, esa vía se aclara (el shader mezcla hacia blanco cuando el
bit de seleccionado está activo). Shift-clic agrega a la selección. Clic en el vacío la limpia.

- [ ] **Step 7: Commit**

```bash
git add src/scene/PickingPass.tsx src/scene/picking.test.ts src/App.tsx
git commit -m "feat: id buffer en GPU y seleccion por clic"
```

---

## Task 17: Selección por lazo

**Files:**
- Create: `src/ui/LassoOverlay.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `PickingPass.tsx` → `pickRegion`; `geo` → un point-in-polygon en píxeles
- Produces: `<LassoOverlay active onFinish={(points) => void} />`

El readback se ejecuta **al soltar**, nunca durante el arrastre: leer 8 MB por frame congelaría la
interacción.

- [ ] **Step 1: Escribir el overlay**

```tsx
// src/ui/LassoOverlay.tsx
import { useEffect, useRef, useState } from 'react'

export type Pt = { x: number; y: number }

export function pointInLasso (px: number, py: number, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i].y > py) !== (poly[j].y > py) &&
        px < (poly[j].x - poly[i].x) * (py - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) {
      inside = !inside
    }
  }
  return inside
}

export function LassoOverlay ({ active, onFinish }: { active: boolean; onFinish: (p: Pt[]) => void }) {
  const [pts, setPts] = useState<Pt[]>([])
  const drawing = useRef(false)

  useEffect(() => { if (!active) { setPts([]); drawing.current = false } }, [active])
  if (!active) return null

  const rel = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  return (
    <svg
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 10 }}
      onMouseDown={e => { drawing.current = true; setPts([rel(e)]) }}
      onMouseMove={e => { if (drawing.current) setPts(p => [...p, rel(e)]) }}
      onMouseUp={() => {
        drawing.current = false
        if (pts.length >= 3) onFinish(pts)
        setPts([])
      }}
    >
      {pts.length > 1 && (
        <polygon
          points={pts.map(p => `${p.x},${p.y}`).join(' ')}
          fill="rgba(120,180,255,0.15)" stroke="#78b4ff" strokeWidth={1.5}
        />
      )}
    </svg>
  )
}
```

- [ ] **Step 2: Escribir el test del predicado**

```ts
// src/ui/lasso.test.ts
import { test, expect } from 'vitest'
import { pointInLasso } from './LassoOverlay'

const cuadro = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]

test('dentro y fuera del lazo', () => {
  expect(pointInLasso(5, 5, cuadro)).toBe(true)
  expect(pointInLasso(15, 5, cuadro)).toBe(false)
  expect(pointInLasso(-1, 5, cuadro)).toBe(false)
})

test('un lazo concavo excluye la muesca', () => {
  const u = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 6, y: 10 },
             { x: 6, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }]
  expect(pointInLasso(5, 8, u)).toBe(false)   // en la muesca
  expect(pointInLasso(2, 8, u)).toBe(true)
})
```

- [ ] **Step 3: Correr el test y verificar que pasa**

Run: `npx vitest run src/ui/lasso.test.ts`
Expected: PASS — los 2 tests.

- [ ] **Step 4: Conectar el lazo en App**

En `App`, mantener `const [lassoOn, setLassoOn] = useState(false)`. Al recibir `onFinish(pts)`,
calcular el bbox de `pts` en píxeles y llamar `pickRegion(rect, (px, py) => pointInLasso(px, py, pts))`.
El resultado son los índices de vía; agregarlos a la selección.

`pickRegion` vive dentro del Canvas y el overlay fuera, así que la función se sube a `App` con un
`useRef` que el componente de picking rellena al montarse.

- [ ] **Step 5: Verificar visualmente**

Run: `npm run dev`
Expected: activando el lazo y dibujando un polígono sobre un área, todas las vías dentro quedan
seleccionadas. El readback tarda un instante al soltar; durante el arrastre la interacción es fluida.

- [ ] **Step 6: Commit**

```bash
git add src/ui/LassoOverlay.tsx src/ui/lasso.test.ts src/App.tsx
git commit -m "feat: seleccion por lazo sobre el id buffer"
```

---

## Task 18: Panel de filtros

**Files:**
- Create: `src/ui/FilterPanel.tsx`
- Test: `src/ui/filter.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `types.ts` → `Way`; `store.ts` → `AttrStore`
- Produces:
  - `applyFilter(ways, store, f) → Uint8Array` — máscara de un byte por vía
  - `<FilterPanel ways municipios filter onChange count km />`
  - `interface Filter { municipio: string | null; highway: string | null; pciMin: number; pciMax: number; fuente: Fuente | null; soloSinEvaluar: boolean }`

- [ ] **Step 1: Escribir los tests del filtro**

```ts
// src/ui/filter.test.ts
import { test, expect } from 'vitest'
import { applyFilter, EMPTY_FILTER } from './FilterPanel'
import { AttrStore } from '../data/store'
import type { Way } from '../data/types'

const ways: Way[] = [
  { osmId: 1, ref: null, name: null, highway: 'primary', surface: null, tipo: 'sin_definir', municipio: 'Rubio', km: 1, km3d: 1 },
  { osmId: 2, ref: null, name: null, highway: 'residential', surface: null, tipo: 'sin_definir', municipio: 'Rubio', km: 2, km3d: 2 },
  { osmId: 3, ref: null, name: null, highway: 'primary', surface: null, tipo: 'sin_definir', municipio: 'Junín', km: 3, km3d: 3 },
]

test('el filtro vacio deja pasar todo', () => {
  const s = new AttrStore(ways)
  expect(Array.from(applyFilter(ways, s, EMPTY_FILTER))).toEqual([1, 1, 1])
})

test('filtra por municipio', () => {
  const s = new AttrStore(ways)
  expect(Array.from(applyFilter(ways, s, { ...EMPTY_FILTER, municipio: 'Rubio' }))).toEqual([1, 1, 0])
})

test('filtra por tipo de via', () => {
  const s = new AttrStore(ways)
  expect(Array.from(applyFilter(ways, s, { ...EMPTY_FILTER, highway: 'primary' }))).toEqual([1, 0, 1])
})

test('los filtros se combinan con Y', () => {
  const s = new AttrStore(ways)
  const m = applyFilter(ways, s, { ...EMPTY_FILTER, municipio: 'Rubio', highway: 'primary' })
  expect(Array.from(m)).toEqual([1, 0, 0])
})

test('filtra por rango de PCI y excluye las no evaluadas', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 90, fuente: 'medido' })
  s.set([1], { pci: 30, fuente: 'medido' })
  const m = applyFilter(ways, s, { ...EMPTY_FILTER, pciMin: 80, pciMax: 100 })
  expect(Array.from(m)).toEqual([1, 0, 0])
})

test('soloSinEvaluar deja las que no tienen PCI', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 90, fuente: 'medido' })
  const m = applyFilter(ways, s, { ...EMPTY_FILTER, soloSinEvaluar: true })
  expect(Array.from(m)).toEqual([0, 1, 1])
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run src/ui/filter.test.ts`
Expected: FAIL — no se puede resolver `./FilterPanel`

- [ ] **Step 3: Implementar**

```tsx
// src/ui/FilterPanel.tsx
import type { Way, Fuente } from '../data/types'
import type { AttrStore } from '../data/store'
import { FUENTES } from '../data/constants'

export interface Filter {
  municipio: string | null
  highway: string | null
  pciMin: number
  pciMax: number
  fuente: Fuente | null
  soloSinEvaluar: boolean
}

export const EMPTY_FILTER: Filter = {
  municipio: null, highway: null, pciMin: 0, pciMax: 100, fuente: null, soloSinEvaluar: false,
}

export function applyFilter (ways: Way[], store: AttrStore, f: Filter): Uint8Array {
  const mask = new Uint8Array(ways.length)
  const rangoActivo = f.pciMin > 0 || f.pciMax < 100
  for (let i = 0; i < ways.length; i++) {
    const w = ways[i], r = store.get(i)
    if (f.municipio && w.municipio !== f.municipio) continue
    if (f.highway && w.highway !== f.highway) continue
    if (f.fuente && r.fuente !== f.fuente) continue
    if (f.soloSinEvaluar && r.pci != null) continue
    if (rangoActivo && (r.pci == null || r.pci < f.pciMin || r.pci > f.pciMax)) continue
    mask[i] = 1
  }
  return mask
}

const box: React.CSSProperties = {
  position: 'absolute', top: 16, left: 16, zIndex: 20, width: 240,
  background: 'rgba(14,20,28,0.92)', border: '1px solid #2a3644',
  borderRadius: 6, padding: 12, display: 'grid', gap: 8,
}

export function FilterPanel ({ ways, filter, onChange, count, km }: {
  ways: Way[]
  filter: Filter
  onChange: (f: Filter) => void
  count: number
  km: number
}) {
  const municipios = [...new Set(ways.map(w => w.municipio).filter(Boolean))].sort() as string[]
  const highways = [...new Set(ways.map(w => w.highway))].sort()
  const set = (p: Partial<Filter>) => onChange({ ...filter, ...p })

  return (
    <div style={box}>
      <strong style={{ fontSize: 13 }}>Filtros</strong>

      <label>Municipio
        <select value={filter.municipio ?? ''} onChange={e => set({ municipio: e.target.value || null })}>
          <option value="">todos ({municipios.length})</option>
          {municipios.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <label>Tipo de vía
        <select value={filter.highway ?? ''} onChange={e => set({ highway: e.target.value || null })}>
          <option value="">todos</option>
          {highways.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </label>

      <label>Procedencia
        <select value={filter.fuente ?? ''} onChange={e => set({ fuente: (e.target.value || null) as Fuente | null })}>
          <option value="">todas</option>
          {FUENTES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>

      <label>PCI {filter.pciMin} a {filter.pciMax}
        <input type="range" min={0} max={100} value={filter.pciMin}
          onChange={e => set({ pciMin: +e.target.value })} />
        <input type="range" min={0} max={100} value={filter.pciMax}
          onChange={e => set({ pciMax: +e.target.value })} />
      </label>

      <label>
        <input type="checkbox" checked={filter.soloSinEvaluar}
          onChange={e => set({ soloSinEvaluar: e.target.checked })} /> solo sin evaluar
      </label>

      <div style={{ borderTop: '1px solid #2a3644', paddingTop: 8, fontVariantNumeric: 'tabular-nums' }}>
        {count.toLocaleString('es-VE')} segmentos · {km.toFixed(1)} km
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run src/ui/filter.test.ts`
Expected: PASS — los 6 tests.

- [ ] **Step 5: Montar el panel en App**

Mantener `const [filter, setFilter] = useState(EMPTY_FILTER)`. Calcular la máscara con `useMemo`
sobre `[ways, filter, storeVersion]`, y contar segmentos y km sumando `ways[i].km` donde la máscara
vale 1. Pasar la máscara a `attr.refresh(mask, selectedMask)`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/FilterPanel.tsx src/ui/filter.test.ts src/App.tsx
git commit -m "feat: panel de filtros por municipio, tipo, PCI y procedencia"
```

---

## Task 19: Panel de edición y aplicación masiva

**Files:**
- Create: `src/ui/EditPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `store.ts` → `AttrStore`; `constants.ts` → `PCI_RANGES`, `FUENTES`, `TIPOS`
- Produces: `<EditPanel store selection onApply onSelectAllFiltered />`

La procedencia es obligatoria: el botón de aplicar queda deshabilitado si no se eligió una. Es la
regla que sostiene la integridad del dato (spec §3.1).

- [ ] **Step 1: Escribir el panel**

```tsx
// src/ui/EditPanel.tsx
import { useState } from 'react'
import { PCI_RANGES, TIPOS } from '../data/constants'
import type { Fuente, Tipo } from '../data/types'

const box: React.CSSProperties = {
  position: 'absolute', top: 16, right: 16, zIndex: 20, width: 260,
  background: 'rgba(14,20,28,0.92)', border: '1px solid #2a3644',
  borderRadius: 6, padding: 12, display: 'grid', gap: 8,
}

const rangoDe = (pci: number) => PCI_RANGES.find(r => pci >= r.min && pci <= r.max)

export function EditPanel ({ selection, filteredCount, onApply, onSelectAllFiltered }: {
  selection: number[]
  filteredCount: number
  onApply: (patch: { pci?: number; fuente: Fuente; tipo?: Tipo; nota?: string }) => void
  onSelectAllFiltered: () => void
}) {
  const [pci, setPci] = useState(50)
  const [fuente, setFuente] = useState<Fuente | ''>('')
  const [tipo, setTipo] = useState<Tipo | ''>('')
  const [nota, setNota] = useState('')
  const [aplicaPci, setAplicaPci] = useState(true)

  const n = selection.length
  const rango = rangoDe(pci)

  return (
    <div style={box}>
      <strong style={{ fontSize: 13 }}>Edición</strong>

      {n === 0 ? (
        <div style={{ color: '#8b98a8' }}>
          Nada seleccionado. Haz clic sobre una vía, usa el lazo, o
          <button style={{ marginTop: 6, width: '100%' }} onClick={onSelectAllFiltered}>
            seleccionar las {filteredCount.toLocaleString('es-VE')} filtradas
          </button>
        </div>
      ) : (
        <>
          <div>{n.toLocaleString('es-VE')} seleccionada{n === 1 ? '' : 's'}</div>

          <label>
            <input type="checkbox" checked={aplicaPci} onChange={e => setAplicaPci(e.target.checked)} />
            {' '}PCI {pci} — {rango?.label}
          </label>
          <input type="range" min={0} max={100} value={pci} disabled={!aplicaPci}
            onChange={e => setPci(+e.target.value)} />

          <label>Procedencia (obligatoria)
            <select value={fuente} onChange={e => setFuente(e.target.value as Fuente | '')}>
              <option value="">elegir…</option>
              <option value="medido">medido — inspección con ficha</option>
              <option value="estimado">estimado — a ojo o desde imagen</option>
              <option value="heredado">heredado — aplicado en bloque</option>
            </select>
          </label>

          <label>Rodadura
            <select value={tipo} onChange={e => setTipo(e.target.value as Tipo | '')}>
              <option value="">no cambiar</option>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          <label>Nota
            <input value={nota} onChange={e => setNota(e.target.value)} placeholder="opcional" />
          </label>

          <button
            disabled={!fuente}
            title={fuente ? '' : 'Elige la procedencia antes de aplicar'}
            onClick={() => {
              onApply({
                ...(aplicaPci ? { pci } : {}),
                fuente: fuente as Fuente,
                ...(tipo ? { tipo: tipo as Tipo } : {}),
                ...(nota ? { nota } : {}),
              })
              setNota('')
            }}
          >
            aplicar a {n.toLocaleString('es-VE')}
          </button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Conectar en App**

`onApply` llama `store.set([...selection], patch)`. Como el store notifica, la data texture se
refresca sola. `onSelectAllFiltered` construye la selección desde la máscara del filtro.

Tras cada `store.set`, incrementar un `storeVersion` en estado para que los `useMemo` que dependen
del store (máscara del filtro, cobertura) recalculen.

- [ ] **Step 3: Verificar el flujo completo a mano**

Run: `npm run dev`

1. Filtrar por un municipio y por `residential`.
2. Pulsar *seleccionar las N filtradas*.
3. Poner PCI 45, procedencia `heredado`, rodadura `asfalto`, aplicar.
4. Las vías de ese municipio deben cambiar de gris a naranja, con opacidad tenue por ser heredadas.
5. Seleccionar una sola vía, ponerle PCI 90 y procedencia `medido`: debe verse verde y sólida,
   claramente distinta de sus vecinas heredadas.

Ese contraste entre lo medido y lo heredado es el objetivo central de la interfaz. Si no se
distingue de un vistazo, ajustar los valores de alpha en `roadsShader.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/ui/EditPanel.tsx src/App.tsx
git commit -m "feat: panel de edicion con procedencia obligatoria y aplicacion masiva"
```

---

## Task 20: Barra de cobertura

**Files:**
- Create: `src/ui/CoverageBar.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `store.ts` → `coverageByMunicipio()`
- Produces: `<CoverageBar store version onPick={(municipio) => void} />`

- [ ] **Step 1: Escribir el componente**

```tsx
// src/ui/CoverageBar.tsx
import { useMemo } from 'react'
import type { AttrStore } from '../data/store'

const bar: React.CSSProperties = {
  position: 'absolute', left: 16, right: 16, bottom: 16, zIndex: 20,
  background: 'rgba(14,20,28,0.92)', border: '1px solid #2a3644',
  borderRadius: 6, padding: '8px 12px', display: 'flex', gap: 6, overflowX: 'auto',
}

export function CoverageBar (
  { store, version, onPick }: { store: AttrStore; version: number; onPick: (m: string) => void },
) {
  const filas = useMemo(() => {
    void version   // fuerza el recálculo cuando el store cambia
    return [...store.coverageByMunicipio()]
      .map(([name, c]) => ({ name, ...c, pct: c.total ? c.evaluados / c.total : 0 }))
      .sort((a, b) => a.pct - b.pct)   // lo menos avanzado primero: ahí está el trabajo
  }, [store, version])

  const totalPct = filas.reduce((s, f) => s + f.evaluados, 0) /
                   Math.max(1, filas.reduce((s, f) => s + f.total, 0))

  return (
    <div style={bar}>
      <div style={{ minWidth: 90, fontVariantNumeric: 'tabular-nums' }}>
        <strong>{(totalPct * 100).toFixed(1)}%</strong><br />
        <span style={{ color: '#8b98a8', fontSize: 11 }}>evaluado</span>
      </div>
      {filas.map(f => (
        <button key={f.name} onClick={() => onPick(f.name)} title={`${f.evaluados} de ${f.total}`}
          style={{
            minWidth: 74, background: 'none', border: '1px solid #2a3644',
            borderRadius: 4, padding: '4px 6px', color: '#e8eaed', cursor: 'pointer',
            textAlign: 'left', fontSize: 11,
          }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {f.name}
          </div>
          <div style={{ height: 4, background: '#22303f', borderRadius: 2, marginTop: 3 }}>
            <div style={{
              height: '100%', width: `${f.pct * 100}%`, borderRadius: 2,
              background: f.pct > 0.66 ? '#22a04f' : f.pct > 0.33 ? '#f2d43f' : '#c9422a',
            }} />
          </div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Conectar en App**

`onPick` fija `filter.municipio` al municipio pulsado y llama a `FlyTo` con el bbox de su polígono
(calculado desde `municipios.json` con un min/max de las coordenadas del anillo exterior).

- [ ] **Step 3: Verificar visualmente**

Run: `npm run dev`
Expected: la barra lista los 29 municipios ordenados por avance, el menos evaluado primero. Al
aplicar PCI a un municipio, su barra sube y se reordena. Pulsando uno, la cámara vuela a él y el
filtro se ajusta.

- [ ] **Step 4: Commit**

```bash
git add src/ui/CoverageBar.tsx src/App.tsx
git commit -m "feat: barra de cobertura por municipio ordenada por avance"
```

---

## Task 21: Persistencia a archivo

**Files:**
- Create: `src/data/persist.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `store.ts` → `AttrStore`
- Produces:
  - `isFsAccessSupported() → boolean`
  - `pickFile() → Promise<FileSystemFileHandle | null>`
  - `saveHandle(h) / loadHandle() → Promise<FileSystemFileHandle | null>` (en IndexedDB)
  - `writeJSON(handle, obj) → Promise<void>`
  - `downloadJSON(obj, filename) → void` — el camino de respaldo en Firefox
  - `useAutosave(store, handle, version)` — hook con debounce de 2 s

- [ ] **Step 1: Escribir el módulo**

```ts
// src/data/persist.ts
import { useEffect, useRef } from 'react'
import type { AttrStore } from './store'

const DB = 'vialidad-tachira', STORE = 'handles', KEY = 'pci'

export const isFsAccessSupported = () => typeof (window as any).showSaveFilePicker === 'function'

function idb (): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function saveHandle (h: FileSystemFileHandle) {
  const db = await idb()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(h, KEY)
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
  })
}

export async function loadHandle (): Promise<FileSystemFileHandle | null> {
  const db = await idb()
  const h = await new Promise<any>((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(KEY)
    r.onsuccess = () => res(r.result ?? null); r.onerror = () => rej(r.error)
  })
  if (!h) return null
  // el permiso no sobrevive siempre a un reinicio del navegador
  const perm = await (h as any).queryPermission({ mode: 'readwrite' })
  if (perm === 'granted') return h
  return (await (h as any).requestPermission({ mode: 'readwrite' })) === 'granted' ? h : null
}

export async function pickFile (): Promise<FileSystemFileHandle | null> {
  if (!isFsAccessSupported()) return null
  const h = await (window as any).showSaveFilePicker({
    suggestedName: 'pci-tachira.json',
    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
  })
  await saveHandle(h)
  return h
}

export async function writeJSON (handle: FileSystemFileHandle, obj: unknown) {
  const w = await (handle as any).createWritable()
  await w.write(JSON.stringify(obj, null, 2))
  await w.close()
}

// ponytail: File System Access API; Firefox no lo soporta y cae a descarga manual
export function downloadJSON (obj: unknown, filename = 'pci-tachira.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function useAutosave (
  store: AttrStore | null, handle: FileSystemFileHandle | null, version: number,
) {
  const primera = useRef(true)
  useEffect(() => {
    if (!store || !handle) return
    if (primera.current) { primera.current = false; return }   // no guardar solo por montar
    const t = setTimeout(() => { writeJSON(handle, store.toJSON()).catch(console.error) }, 2000)
    return () => clearTimeout(t)
  }, [store, handle, version])
}
```

- [ ] **Step 2: Conectar en App**

Al arrancar, intentar `loadHandle()`; si devuelve un handle, leer el archivo y llamar
`store.loadJSON(obj, ways)`. Si devuelve ids huérfanos, mostrarlos en consola con un aviso claro de
que **no se borraron**.

Añadir un botón "archivo de datos" que llame `pickFile()`. Si `isFsAccessSupported()` es falso,
mostrar en su lugar un botón "descargar" que llame `downloadJSON(store.toJSON())`.

Llamar `useAutosave(store, handle, storeVersion)`.

- [ ] **Step 3: Verificar el ciclo completo**

Run: `npm run dev`

1. Pulsar "archivo de datos" y guardar como `pci-tachira.json` en la raíz del proyecto.
2. Aplicar PCI a un municipio. Esperar dos segundos.
3. En la terminal: `git status` debe mostrar `pci-tachira.json` modificado, y `git diff` debe
   mostrar los registros nuevos legibles.
4. Recargar la página: los colores deben volver tal cual, sin volver a elegir el archivo.
5. Correr `npm run verify`: el chequeo de ids huérfanos ahora sí se ejecuta y debe pasar.

- [ ] **Step 4: Commit**

```bash
git add src/data/persist.ts src/App.tsx
git commit -m "feat: persistencia a archivo local con autoguardado"
```

---

## Cierre

- [ ] **Correr la suite completa**

Run: `npm test`
Expected: PASS en los archivos de test de las tareas 1, 2, 3, 4, 5, 6, 9, 11, 13, 14, 16, 17 y 18.

- [ ] **Correr la verificación de datos**

Run: `npm run verify`
Expected: los 6 checks en `ok`, incluido el de ids huérfanos ahora que existe `pci-tachira.json`.

- [ ] **Commit final**

```bash
git add -A
git commit -m "chore: visor y editor 3D de vialidad del Tachira completo"
```

---

## Notas de la auto-revisión

Revisado el plan contra el spec sección por sección:

- **§3.1 procedencia obligatoria** → Task 19 la impone deshabilitando el botón sin `fuente`.
- **§3.2 tipo sembrado desde surface** → Task 7 (pipeline) y Task 13 (`seedFromSurface`).
- **§4.1 ENU rebasing** → Task 2, con el round-trip como test crítico, y replicado en Task 11.
- **§5 terreno a dos resoluciones** → Task 5 (`sampleBilinear` sobre el DEM completo, `downsample`
  para la malla) y Task 7 paso 5.
- **§6.2 data texture** → Task 14, consumida por el shader de Task 15.
- **§6.3 offset de drapeado** → **no implementado como constante separada.** El pipeline drapea a la
  altura exacta del DEM. Si al acercarse las vías se entierran en la malla de 1024², añadir la
  constante `DRAPE_OFFSET` en `build-data.mjs` paso 5 y sumarla a `heights`. Se deja fuera hasta
  observarlo: el valor correcto depende de qué tanto suaviza el downsample, y eso no se sabe sin
  mirarlo. `depthWrite: false` en el material ya evita el z-fighting más obvio.
- **§7 id buffer con 8 px** → Task 16, con `PICK_WIDTH` exportada y comentada como calibrable.
- **§8 interfaz** → Tasks 18, 19, 20.
- **§9 persistencia y huérfanos** → Task 21, y el check 5 de Task 8.
- **§11 los 6 checks** → Task 8. El sexto del spec (longitud sobre geometría simplificada) se
  reemplazó por `km3d ≥ km`, que verifica lo mismo de forma directa: el pipeline nunca simplifica,
  así que el check original no tendría nada que comparar, mientras que `km3d ≥ km` sí detecta un
  drapeado o una longitud mal calculados.
- **§13 riesgos** → versiones exactas en Task 1 paso 2; nubes fuera del alcance de este plan
  (el spec las declara opcionales y apagadas por defecto).

Nombres verificados como consistentes entre tareas: `AttrStore.set/get/onChange/seedFromSurface/
coverageByMunicipio/toJSON/loadJSON`, `AttrTexture.refresh`, `encodeId/decodeId`, `applyFilter/
EMPTY_FILTER`, `makeEnuFrame/geodeticToEnu`, `packRoads`, `sampleBilinear/downsample`.
