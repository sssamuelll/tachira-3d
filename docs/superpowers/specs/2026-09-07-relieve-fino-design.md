# Relieve fino por teselas, y las vías bien apoyadas (fase A)

Fecha: 2026-09-07. Rama: `feat/vialidad-3d`. Fase B (imagen satelital) va en
spec aparte y monta sobre esta.

## Problema

1. El relieve es una sola malla de 1024² (~130 m por celda) sobre un DEM que
   ya tenemos a ~36 m. A 30 m de vista es un plano.
2. Las vías se apoyan en la malla solo en sus vértices. 16.582 tramos miden
   más de 100 m, y un tramo recto entre dos vértices apoyados cruza por debajo
   de la loma que la malla levanta entre ellos: medido, 262 tramos se hunden
   más de 8 m (la alza mínima) y el peor 188 m. Es el hueco con extremos
   cortados en diagonal de la Vía a Los Llanos.
3. La calzada se extruye en el plano horizontal. En una ladera atravesada, la
   mitad de arriba se entierra y la de abajo flota. La alza fija de 8 m que lo
   tapaba hoy sería un slab flotante a 30 m de vista.

## Decisión

Un quadtree de teselas Web Mercator (el mismo esquema z/x/y de Terrarium y de
las imágenes satelitales de la fase B) con nivel de detalle por error en
pantalla. Las vías se parten a 30 m, se apoyan en el pipeline sobre la
triangulación del DEM completo y se extruyen en el plano del terreno, con una
alza en píxeles igual a la tolerancia del LOD.

Descartado: terreno de Cesium ion (token, red obligatoria, mismos 30 m en
Venezuela) y una sola malla al DEM completo (15,6 M de vértices siempre en
pantalla).

## 1. Datos (`scripts/`)

### 1.1 Pirámide del DEM: `public/data/dem/{z}/{x}/{y}.png`

- z12: las 238 teselas Terrarium de `.cache/dem`, reescritas como PNG RGBA.
  RGB es la altura Terrarium tal cual (`decodeTerrarium`); **A = 255 si el
  post está dentro del estado, 0 fuera**, con la unión de los 29 municipios
  rasterizada a la resolución del DEM (3584×4352) por `scripts/lib/state-mask.mjs`,
  que es el mismo algoritmo de barrido de `src/scene/stateMask.ts` (esa se
  queda: la usa el minimapa).
- z8 a z11: derivadas de la anterior, altura = promedio 2×2, dentro = OR 2×2.
  Rango de teselas: el de los padres del rango z12 (1223–1236 × 1948–1964);
  un padre sin hijos en el rango se rellena con altura 0 y dentro = 0.
- Total ≈ 348 teselas, ~13 MB.
- `public/data/dem/errores.json`: `{ "z/x/y": metros }` para z8 a z14, el
  error geométrico de cada nodo (§2.2). Nodos z15 en adelante: 0.

Convención de rejilla, ÚNICA para pipeline y navegador: el post `(c, f)` de la
tesela z12 `(tx, ty)` está en la coordenada de tesela `(tx + c/256, ty + f/256)`
(esquina del píxel, no centro). La rejilla global G tiene 3584×4352 posts;
`terrain.json` gana `dem: { z: 12, x0, y0, nx, ny }`.

### 1.2 Vías: partidas, apoyadas, con normal

- `scripts/lib/subdividir.mjs`: `subdividir(coords, pasoM = 30)` inserta puntos
  interpolados en lon/lat para que ningún tramo mida más de 30 m. Corre
  ANTES del drapeado y de las longitudes. Después, `apoyar(coords, alturaDe,
  umbral = 0.2, minM = 4)` parte por bisección los tramos cuya cuerda se
  aparta del relieve más de 20 cm (medido en el medio y en los cuartos): un
  tramo recto entre dos puntos apoyados cruza por debajo de una arista
  convexa del DEM. Medido con solo los 30 m: 124.875 de 664.531 tramos se
  apartaban más de 20 cm. Ese umbral es la alza mínima de la calzada en el
  navegador (§3).
- `scripts/lib/drape.mjs`: `alturaTriangulo(dem, lon, lat)` y
  `normalTriangulo(dem, frame, lon, lat)` sobre G con la regla de diagonal de
  `src/scene/drape.ts` (triángulos `(a,c,b)` y `(b,c,d)`, diagonal de
  arriba-derecha a abajo-izquierda; `fx + fy <= 1` cae en el primero). La
  normal es la del triángulo en ENU (producto cruz de sus aristas
  proyectadas con `geodeticToEnu`), unitaria, apuntando arriba.
- `pack.mjs` escribe además `roads-nrm.bin`: Int8 ×6 por tramo (normal en el
  inicio y en el fin, ×127). `load.ts` lo carga y `checkCoherence` exige
  `nrm.length === segIds.length * 6`.
- Se va `redrapear` de `load.ts`: las posiciones llegan apoyadas sobre la
  misma superficie que el nivel fino dibuja. `alturaMalla` de `drape.ts` se
  queda para el minimapa.
- Los tramos suben de 450.261 a unos 800.000; `roads-pos.bin` a ~19 MB.

## 2. Relieve (`src/scene/`)

### 2.1 Módulos

- `src/data/mercator.ts`: `lonToTileX`, `latToTileY` (fraccionarios),
  `tileXToLon`, `tileYToLat`. Misma matemática que `terrarium.mjs`.
- `src/scene/demTiles.ts`: carga y decodifica una tesela (`fetch` →
  `createImageBitmap` → `OffscreenCanvas` → `Float32Array` de alturas y
  `Uint8Array` de dentro), caché LRU de 400 teselas, una petición en vuelo por
  clave. `muestra(z12tile, u, v)` devuelve la altura de la triangulación en
  coordenadas fraccionarias de post; en un post exacto es el post.
- `src/scene/quadtree.ts`: `seleccionar(raices, camara, tolerancia, cargado)`
  devuelve la lista de nodos a dibujar. Puro: recibe la posición de cámara, el
  frustum, `metrosPorPixel` como función de la distancia y un predicado
  "tiene datos". Un nodo se subdivide si `error / mpp(distancia al AABB) >
  tolerancia`, `z < zMax` y sus cuatro hijos tienen datos; si le faltan, se
  dibuja él y se piden los hijos. Fuera del frustum no se dibuja ni se pide.
- `src/scene/TerrainLod.tsx`: sustituye a `Terrain.tsx`. Un `<group
  name="terrain">` con un `Mesh` por nodo dibujado; geometrías cacheadas por
  nodo y liberadas con la LRU. Material único: `terrainShader.ts` sin cambios
  de fondo (hipsometría, sombreado, descarte por `inside`).

### 2.2 Nodo

- Nodo = tesela `(z, x, y)`, z8 a z15 en esta fase. Rejilla de 33×33 vértices
  en `(x + i/32, y + j/32)` de su nivel; ENU vía `geodeticToEnu` con el
  `ORIGIN` de siempre. Altura: para z ≤ 15 los vértices caen en posts enteros
  de G (cada `2^(15-z)` posts); z15 es la superficie exacta. Triangulación de
  cada celda con la misma diagonal de §1.2.
- Faldón: un anillo de vértices copiados hacia abajo `max(error, 5) + 2 %` del
  ancho del nodo, para que el cambio de nivel entre vecinos no abra grietas.
  Sus normales son las del borde, no las del faldón.
- Atributos: `position`, `normal` (calculadas sobre la rejilla sin faldón),
  `elevation` (altura cruda, ver `terrainShader.ts`), `uvMascara`.
- El recorte al contorno del estado NO va por vértice: a z8 una celda mide
  4,6 km y el borde salía en bloques (visto). Va por textura: `stateMask` a
  1024² sobre el bbox del terreno (la rejilla de siempre, ~130 m), muestreada
  con filtro lineal en el fragment por `uvMascara`, así que el corte cae a
  media celda del borde real a cualquier nivel. El alpha de las teselas sigue
  existiendo para `errorNodo` (qué nodos tienen posts dentro).
- AABB del nodo: extensión en ENU por la altura mínima y máxima de sus posts.
- `error` (metros): para z < 15, máximo sobre los posts del nodo de
  `|superficie decimada − post|`, calculado en el pipeline (§1.1). Para z ≥ 15, 0.
- Raíces: las 4 teselas z8 (76–77 × 121–122).

### 2.3 Tolerancia

`ERROR_PX = 2` en `quadtree.ts`, exportada. Es la única definición: el LOD
subdivide hasta que el relieve dibujado se aparta menos de eso de la
superficie real, y las vías se levantan exactamente eso (§3).

## 3. Vías sobre el relieve (`roadsShader.ts`, `Roads.tsx`, `PickingPass.tsx`)

- Atributos nuevos en las dos geometrías (visible y de ids):
  `instanceNormalStart` y `instanceNormalEnd`, de un
  `InstancedInterleavedBuffer(Int8Array, 6, 1)` normalizado.
- En `extrusionGlsl`: `terrV = normalize((viewMatrix * vec4(normal, 0)).xyz)`
  con `normal` la del extremo que toca a este vértice; si mide menos de 0,5 se
  usa `arribaV`. El lado es `cross(dirV, terrV)` (derecha del sentido de
  marcha, mismo invariante que hoy). La alza: `eje.xyz += terrV *
  max(ERROR_PX * mppV, ALZA_MIN_M)`, con `ERROR_PX` importado del quadtree y
  `ALZA_MIN_M = 0,25 m` en `roadsShader.ts`: en píxeles a lo lejos, en metros
  de cerca (el hundimiento que el pipeline deja entre puntos apoyados, §1.2,
  y lo que un terraplén real levanta la vía). Vale para los dos pases.
- Se va el ajuste de profundidad al eje (`clip.z = ndc.z * clip.w`, el que
  three usa en `worldUnits`). Es para una cinta que mira a la cámara: en una
  calzada inclinada con la ladera deja el borde cuesta arriba con una
  profundidad más honda que el relieve que tiene debajo y el test lo esconde.
  Medido en cenital durante la implementación: media calzada desaparecía y las
  tapas asomaban como orejas. Los tramos no compiten entre sí en profundidad
  porque no la escriben (`depthWrite: false`).
- Se van de `Roads.tsx` `ALZA_POR_D2`, `ALZA_MINIMA` y `raiz.position.y`: la
  precisión del depth buffer (d² · 6e-9 m, a 108 km 70 m) queda por debajo de
  2 px · mpp (216 m) a toda distancia, y la ladera la absorbe la inclinación.
- `PickingPass.tsx`: el oclusor recorre todas las mallas bajo el grupo
  `terrain` en vez de un solo `getObjectByName`. `OCLUSOR_ABAJO` se queda en
  250 m, con el comentario actualizado: ya no cubre un desfase entre dos
  mallas, solo el error del LOD, así que puede bajar cuando se mida.

## 4. Lo que no cambia

Minimapa (`terrain.bin` de 1024² y `stateMask.ts` siguen), cielo y perspectiva
aérea, cámara, búsqueda, edición, `roads-meta.json` salvo `km3d`.

## 5. Fuera de alcance (fase B y después)

Imagen satelital, z16 y z17, sol real con sombras, calcomanía de vías sobre
el terreno.

## 6. Verificación

Tests: `mercator` ida y vuelta contra `terrarium.mjs` (mismos números en
casos fijos); `subdividir` (ningún tramo > 30 m, extremos intactos, no toca
tramos cortos); `drape.mjs` contra la regla de diagonal (mismos casos que
`drape.test.ts`); `state-mask.mjs` (cuadrado, agujero, dos polígonos);
`quadtree.seleccionar` con un árbol sintético (subdivide por error y distancia,
respeta zMax, no pide fuera del frustum, dibuja al padre si faltan hijos);
`demTiles.muestra` en post exacto y en el centro de una celda torcida;
`checkCoherence` con `nrm`; GLSL con `instanceNormalStart` y `terrV`;
`errores.json` no vacío y decreciente con z en promedio. `tsc` y `build`.

Pipeline: `npm run data` y `npm run verify` corren sin red (la caché está).

Chrome: la Vía a Los Llanos sin hueco; la Libertador a 30 m con el relieve
refinándose al acercarse y la calzada pegada a la ladera; vista de estado
indistinguible de hoy; un lazo sobre una vía detrás de una loma no la agarra
y sobre una visible sí; fps ≥ 30 orbitando a 100 m con la consola limpia.
