# Visor y editor 3D de vialidad — Estado Táchira

Fecha: 2026-09-05
Estado: aprobado, listo para plan de implementación

## 1. Qué es

Una aplicación local de un solo usuario para **levantar y visualizar el estado de la
red vial del estado Táchira** sobre el terreno andino real, en 3D.

El problema que resuelve no es mostrar carreteras: la geometría ya existe en
OpenStreetMap y está completa. El problema es que **el estado de las vías no está
registrado en ninguna parte**. Una consulta a Overpass del 2026-09-05 devuelve 23
vías con el tag `smoothness` sobre 26.712 vías totales del estado — 0,09%. Esta
aplicación es la herramienta que llena ese vacío.

La geometría viene de OSM y es regenerable. Los datos de condición son del usuario
y nunca se sobreescriben.

## 2. Evidencia

Todos los números verificados contra Overpass API, snapshot OSM 2026-09-05.
Lo marcado ESTIMADO sale del primer corrido del pipeline.

```
bbox           S 7.3612911   W -72.4878225   N 8.6826552   E -71.3153029
extensión      147,1 km (N-S) × 129,3 km (E-O)
municipios     29  (admin_level=6)          coincide con los 29 reales
vías           26.712 con tag highway=*
  motorway 34 · trunk 327 · primary 276 · secondary 344 · tertiary 555
  unclassified 1.526 · residential 16.091 · track 1.114 · resto 6.445
red principal  3.062 segmentos = 4.126,9 km   (motorway…unclassified)
con surface    6.232  (23%)
con smoothness 23     (0,09%)   ← el vacío que llena esta app
altura máxima  3.942 m  (pico más alto etiquetado en OSM)
vértices vías  ~400.000  ESTIMADO
```

## 3. Decisiones tomadas y por qué

| decisión | valor | razón |
|---|---|---|
| Origen de la data | captura desde cero | no existe inventario previo; no hay conflación que resolver |
| Usuarios | uno, local | sin backend, sin auth, sin conflictos de edición |
| Alcance | los 26.712 segmentos | decisión explícita del usuario, incluye calles urbanas |
| Escala de condición | PCI 0-100 (ASTM D6433) | estándar de ingeniería vial |
| Motor de render | r3f + takram, **sin MapLibre** | decisión explícita del usuario |

### 3.1 PCI y procedencia

ASTM D6433 exige inspección de campo con unidades de muestreo, tipos de deterioro,
severidad y densidad. Con 26.712 segmentos y una sola persona, la mayoría de los
valores no serán medidos. Un PCI estimado presentado como medido es un número
inventado con apariencia de rigor, y en un informe público eso es peor que no tener
dato.

Por eso **cada valor carga su procedencia**, y es un campo obligatorio:

```
medido    inspección con ficha de deterioros — defendible
estimado  juicio a ojo o desde imagen — útil, marcado como tal
heredado  aplicado en bloque por municipio+tipo — relleno inicial
```

La interfaz distingue las tres visualmente y permite filtrar por ellas. Un mapa de
"solo lo medido" es un entregable distinto de uno de "todo lo estimado", y ambos
son legítimos mientras la diferencia sea visible.

Rangos ASTM D6433 para la leyenda:

```
86-100 Good        41-55 Poor         0-10 Failed
71-85  Satisfactory 26-40 Very Poor
56-70  Fair         11-25 Serious
```

### 3.2 Dos campos distintos: jerarquía y rodadura

"Tipo de vía" es ambiguo y aquí son dos campos separados:

| campo | origen | editable | valores |
|---|---|---|---|
| `highway` | OSM | no | `motorway` `trunk` `primary` `secondary` `tertiary` `unclassified` `residential` `track` … |
| `tipo` | usuario | sí | `asfalto` `concreto` `granzon` `tierra` `empedrado` `sin_definir` |

`highway` es la jerarquía funcional y viene dada: describe el rol de la vía en la red,
no su construcción. `tipo` es la rodadura y es dato del usuario.

Las **6.232 vías que ya traen `surface` en OSM** (23%) siembran `tipo` con procedencia
`heredado`, mapeando `asphalt→asfalto`, `concrete→concreto`, `gravel|compacted→granzon`,
`ground|dirt|earth→tierra`, `sett|cobblestone→empedrado`. El resto arranca en
`sin_definir`. Eso es casi una cuarta parte del estado poblada sin trabajo manual.

### 3.3 Qué aporta takram y qué no

`@takram/three-geospatial` provee atmósfera (Precomputed Atmospheric Scattering de
Bruneton), nubes volumétricas, post-proceso, y las primitivas geodésicas
(`Geodetic`, `Ellipsoid`, `PointOfView`, `TilingScheme`, `TileCoordinate`).

**No provee**: malla de terreno, carga de elevación, líneas geoespaciales, ni
picking. Sus demos de terreno usan `3d-tiles-renderer` contra Google Photorealistic
3D Tiles — ~2.500 ciudades en 49 países, solo zonas urbanas densas, con API key de
Google. El Táchira andino no está cubierto.

Terreno, vías, selección y UI se construyen en este proyecto.

## 4. Arquitectura

### 4.1 Sistema de coordenadas — la decisión de la que depende todo

takram trabaja en ECEF. El Táchira está a ~6.378.000 m del origen y float32 tiene 7
dígitos significativos: la precisión ahí es de ~0,5 m, lo que produce jitter y
z-fighting visibles.

**Se resuelve con world origin rebasing.** Origen del mundo fijo en el centroide del
bbox:

```
lat₀   8.021973°N
lon₀  71.901563°O
h₀    0 m (elipsoide WGS84)
```

Todo (terreno y vías) se calcula en coordenadas locales **ENU (East-North-Up)**
relativas a ese origen, usando `Ellipsoid.getEastNorthUpFrame()` de takram. Las
coordenadas pasan de ~10⁷ a **±73.600 m en N, ±64.700 m en E** — cómodas para
float32. Los componentes de atmósfera reciben la posición geodésica real, que es lo
que necesitan para el scattering.

La curvatura terrestre a 73,55 km del origen produce **424 m de caída** — un 11% del
relieve máximo. No se aplana: sale correcta por derivarse del elipsoide.

takram ya contempló esta técnica; existen los stories `Atmosphere-WorldOriginRebasing`
y `Clouds-WorldOriginRebasing` como referencia.

### 4.2 Diagrama de datos

```
BUILD (una vez, offline)                    RUNTIME (navegador)

Overpass ──┐                                terrain.bin ──→ malla 1024²
           ├─→ vías + municipios                              + shader hipso/hillshade
AWS DEM ───┘         │                      roads-*.bin ──→ LineSegments2
                     ↓                                          ↑
              proyección ENU                  attrTexture 164² ──┘
                     ↓                            ↑
              drapeado sobre DEM completo         │
                     ↓                       Map<segId, {pci,fuente}>
              binarios + metadata                 ↕
                                             pci-tachira.json (disco)
```

## 5. Terreno

### 5.1 Fuente

**AWS Terrain Tiles (Terrarium)** — `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`.
Público, gratuito, sin API key. Decodificación:

```
elevación_m = (R × 256 + G + B / 256) − 32768
```

A z12 el bbox requiere **238 tiles** (x 1223–1236, y 1948–1964 = 14 × 17), que
forman un grid de **3584 × 4352 px** a **~36 m/px**. La grilla slippy cubre algo más
que el bbox; se recorta al bbox exacto tras decodificar.

### 5.2 Dos resoluciones, a propósito

| uso | resolución | por qué |
|---|---|---|
| malla que se pinta | 1024 × 1024 (~130 m) | 1M vértices corre en cualquier laptop |
| drapeado de vías | 3584 × 4352 (~36 m) | precisión donde se mide, no donde se mira |

Esa separación es deliberada: se pierde detalle en lo que solo se observa, nunca en
lo que se mide. El drapeado se calcula en build, así que la resolución alta no cuesta
nada en runtime.

`terrain.bin` = `Int16Array` de 1024×1024, alturas en metros enteros, row-major desde
el norte. **2,0 MB.** Metadata en `terrain.json`: bbox, dimensiones, min/max, origen ENU.

La malla **no** es una `PlaneGeometry`. El grid es regular en lat/lon (como viene el
DEM) y cada vértice se proyecta individualmente a ENU, de modo que la curvatura queda
incorporada en las posiciones.

### 5.3 Textura

**Hipsometría + hillshade calculados en el fragment shader** desde el propio DEM
(normales por diferencias finitas). Cero imagery externa, cero problema de licencia.
Con la perspectiva aérea de takram encima se lee mejor que una ortofoto plana.

Imagery satelital real queda como mejora posterior, no como requisito.

## 6. Las vías

### 6.1 Geometría

Render con `LineSegments2` (fat lines, ancho en píxeles) — necesario para que una
carretera se lea desde 100 km de altura. Cada polilínea de N puntos se expande a N−1
segmentos en el build.

```
roads-pos.bin     Float32Array   6 floats por segmento (x,y,z ×2), ENU metros   ~8,9 MB
roads-segid.bin   Uint32Array    1 por segmento → índice de vía                 ~1,5 MB
roads-index.bin   Uint32Array    26.713 offsets, formato CSR
roads-meta.json   array 26.712 × { osmId, ref, name, highway, municipio, km }
```

Todos los tamaños ESTIMADO sobre ~400.000 vértices. Carga total con terreno: ~12,5 MB.

Formato binario, no GeoJSON: `fetch` → `ArrayBuffer` → GPU, sin parsear 26.712
features en runtime.

### 6.2 Atributos por data texture

El color **no vive en el buffer de geometría**. Vive en una textura RGBA8 de
**164 × 164** (26.896 texels ≥ 26.712) indexada por id de vía:

```
R  PCI 0-100, o 255 = sin evaluar
G  fuente: 0 sin · 1 heredado · 2 estimado · 3 medido
B  flags: bit0 visible según filtro · bit1 seleccionado
A  reservado
```

El vertex shader recibe `segId` como atributo por instancia y calcula:

```glsl
vec2 uv = (vec2(mod(segId, 164.0), floor(segId / 164.0)) + 0.5) / 164.0;
```

Consecuencia: cambiar un PCI = escribir 1 texel. Repintar los 16.091 tramos de un
municipio = subir **105 KB**. Filtro, selección y color se resuelven en GPU sin tocar
la geometría. Es el equivalente de `setFeatureState` de MapLibre, construido a mano.

### 6.3 Drapeado

Cada vértice muestrea el DEM de resolución completa por interpolación bilineal, más
un **offset vertical calibrable** (arranca en 25 m) para evitar z-fighting contra la
malla de 1024², que es más suave que el terreno real.

El offset es una constante ajustable, no un número mágico: al acercarse a una
carretera en quebrada el valor correcto cambia, y esa calibración no se puede derivar
del modelo.

## 7. Selección — un solo mecanismo

Raycast contra 26.712 líneas no es viable. En su lugar, **id buffer en GPU**: un pase
que renderiza cada vía con su id codificado en RGB a un `WebGLRenderTarget`.

```
R = (id >> 16) & 255      id 0 reservado = "nada"
G = (id >>  8) & 255      los ids de vía empiezan en 1
B =  id        & 255      24 bits ≫ 26.712 necesarios
```

- **Clic** → `readRenderTargetPixels` de 1×1 bajo el cursor.
- **Lazo** → polígono en pantalla, leer los píxeles de su bbox, filtrar por
  point-in-polygon, extraer ids únicos.

Mismo buffer, dos interacciones. El pase corre solo cuando hace falta, nunca cada
frame. Sin antialiasing ni tone mapping en ese target.

En el pase de picking las líneas se renderizan a **8 px** — más anchas que en el pase
visible — para dar tolerancia de clic sobre una carretera de 2 px. Valor calibrable:
demasiado ancho y las vías paralelas se tapan entre sí.

El readback de un lazo grande a 1920×1080 son ~8 MB y toma decenas de milisegundos.
Aceptable para una acción puntual; se ejecuta al soltar el lazo, no durante el arrastre.

## 8. Interfaz

Con 26.712 segmentos y un solo capturador, la edición uno-por-uno no se termina.
**La edición masiva no es una conveniencia, es el mecanismo principal.**

```
┌──────────────────────────────────────────────────────┐
│                                            [☀ hora]  │
│   escena 3D                                [◐ nubes] │
│                                                      │
│ ┌─ filtros ──┐                    ┌─ edición ──────┐ │
│ │ municipio  │                    │ PCI    [ 45 ]  │ │
│ │ tipo vía   │                    │ fuente [heredado]│
│ │ rango PCI  │                    │ tipo   [asfalto]│
│ │ procedencia│                    │ nota   [......]│ │
│ │            │                    │                │ │
│ │ 1.526 seg  │                    │ [aplicar a 1.526]│
│ │ 812,4 km   │                    └────────────────┘ │
│ └────────────┘                                       │
│ ── cobertura por municipio ─────────────────────────  │
└──────────────────────────────────────────────────────┘
```

Selección: clic · shift-clic (agregar) · lazo poligonal · *seleccionar todo lo filtrado*.

La barra de cobertura muestra % evaluado por municipio. Es el mapa de progreso sobre
los 26.712 y la única forma de saber qué falta.

Cámara: `PointOfView` de takram (heading/pitch/distance sobre un objetivo geodésico),
más "volar a municipio" que encuadra su bbox.

Cielo: `<Atmosphere>` como provider, con `<Sky>`, `<Stars>`, `<SunLight>`, `<SkyLight>`
y `<AerialPerspective>`. La hora es ajustable — la posición del sol cambia el
hillshade y con él la lectura del relieve.

## 9. Persistencia

`pci-tachira.json`, **separado del GeoJSON a propósito**:

```json
{ "version": 1,
  "actualizado": "2026-09-05",
  "registros": {
    "12345678": { "pci": 45, "fuente": "heredado", "tipo": "asfalto",
                  "fecha": "2026-09-05", "nota": "" } } }
```

Clave = OSM way id. Escritura por **File System Access API**: el archivo se elige una
vez, el handle queda en IndexedDB, y después autoguarda con debounce sin volver a
preguntar. Es un archivo real, versionable en git, con diff legible.

Chrome y Edge lo soportan; Firefox no y cae a descarga. Va marcado en el código.

**Ids huérfanos:** si alguien parte una vía en OSM, un pedazo conserva el id y el otro
nace nuevo. El pipeline **reporta los ids huérfanos y no los borra**. Aparecen en el
diff de git y los resuelve el usuario.

## 10. Pipeline de build

`scripts/build-data.mjs`, corre una vez y es re-ejecutable:

```
1  Overpass    → 29 municipios (admin_level=6) + 26.712 vías con geometría
2  municipio   → por el punto medio del segmento; un tramo que cruza límite cae en
                 uno solo. Cortar en el límite duplicaría segmentos y rompería los ids
3  tipo        → sembrado desde el `surface` de OSM (§3.2), resto `sin_definir`
4  longitud    → turf geodésico sobre la geometría ORIGINAL, nunca la simplificada
5  DEM         → 238 tiles Terrarium z12 → decodificar → recortar al bbox
6  proyección  → todo a ENU local (origen §4.1)
7  drapeado    → altura bilineal del DEM completo + offset
8  empaquetado → terrain.bin · roads-pos.bin · roads-segid.bin · roads-index.bin
9  metadata    → terrain.json · roads-meta.json · municipios.json
10 reporte     → conteo real de vértices, ids huérfanos, km por municipio
```

Los tiles descargados se cachean en `.cache/` para no volver a bajarlos.

## 11. Verificación

`scripts/verify-data.mjs` corre sobre la salida del pipeline y **falla** si:

1. **La ida y vuelta `geodetic → ENU → geodetic` no reproduce lat/lon con error < 1 m**,
   sobre el bbox y el origen reales de `terrain.json` y con altura distinta de cero.
   Si la proyección está mal, todo el mapa está mal y no se nota a simple vista.
2. Hay `osmId` repetidos en `roads-meta.json`.
3. Alguna vía tiene asignado un municipio que no existe en `municipios.json`.
4. Algún `km` o `km3d` no es finito o no es positivo.
5. Alguna vía quedó sin municipio asignado.
6. El terreno está degenerado: rango `max − min` menor de 1.000 m, elevación media fuera
   de 100–2.000 m, más del 1% de celdas pegadas a cualquiera de los dos topes del clamp,
   o el tamaño del grid distinto de `width × height`.
7. El drapeado está plano: menos del 50% de las vías con `km3d > km`, o alguna con
   `km3d < km`.
8. Hay ids en `pci-tachira.json` que no existen en `roads-meta.json` — distinguiendo
   un archivo ausente (se omite) de uno ilegible o corrupto (falla).

Sin framework de tests: asserts en un script ejecutable, salida 1 al fallar, y **todos los
checks se evalúan aunque uno falle**.

> **Corregida durante la ejecución.** La primera versión de esta lista tenía tres checks
> que no podían fallar nunca. `suma por municipio == total` compara dos sumas del mismo
> array, así que la asociatividad la hace verdadera aunque la asignación esté mal o una
> vía esté duplicada. `elevación >= -500` es imposible de violar porque `downsample()` ya
> clampea a ese valor antes de calcular el mínimo. Y `km3d >= km` pasa con el drapeado
> completamente plano, porque entonces `km3d == km` exacto. Los umbrales de los checks 6 y
> 7 se fijaron midiendo el dato real: rango 3.885 m, media 940 m, cero celdas en el clamp,
> y 78,9% de las vías con desnivel — cada umbral queda holgado frente a lo observado y
> lejos de lo que produciría el defecto que vigila.

## 12. Stack

```
vite · react 19 · typescript
three ≥0.170 · @react-three/fiber ≥9.0.4 · @react-three/drei
postprocessing · @react-three/postprocessing
@takram/three-geospatial          0.9.1    Geodetic, Ellipsoid, PointOfView
@takram/three-atmosphere                   Atmosphere, Sky, Stars, AerialPerspective
@takram/three-geospatial-effects           GBuffer, LensFlare
@takram/three-clouds                       opcional, apagado por defecto

build-time: @turf/length · @turf/boolean-point-in-polygon · pngjs
```

**Versiones fijas y exactas, sin `^`** — `core` está en alpha 0.9.x y su API puede
romper entre versiones menores.

Sin backend, sin router, sin gestor de estado. Los 26.712 registros viven en un `Map`
fuera del árbol de React y se pintan por data texture; React solo maneja los paneles,
que es estado pequeño y `useState` alcanza.

### Estructura

```
scripts/     build-data.mjs · verify-data.mjs
public/data/ terrain.bin · terrain.json · roads-*.bin · roads-meta.json · municipios.json
src/scene/   Terrain · Roads · PickingPass · Camera · Sky
src/ui/      FilterPanel · EditPanel · CoverageBar · LassoOverlay
src/data/    store · attrTexture · persist
```

## 13. Riesgos

| riesgo | mitigación |
|---|---|
| `core@0.9.1` en alpha, API puede romper | versiones exactas sin rango |
| nubes volumétricas son ray-marching, comen GPU | apagadas por defecto, toggle |
| vías flotando o enterradas al acercarse | offset vertical calibrable (§6.3) |
| ~12,5 MB de carga inicial | local; gzip comprime bien terreno y posiciones |
| readback del lazo tarda decenas de ms | se ejecuta al soltar, no durante el arrastre |
| sin mapa 2D, no hay plano plano imprimible | fuera de alcance, se decide después |

## 14. Fuera de alcance

Backend, multiusuario, offline o móvil, import de Excel, quadtree con LOD, imagery
satelital, PMTiles, subida de los datos de vuelta a OSM.

## 15. Fuentes

- Conteos, bbox y elevación: consultas propias a Overpass API, snapshot OSM 2026-09-05
- three-geospatial: https://github.com/takram-design-engineering/three-geospatial
- AWS Terrain Tiles: https://registry.opendata.aws/terrain-tiles/
- Cobertura Google 3D Tiles: https://developers.google.com/maps/documentation/javascript/3d/coverage
- ASTM D6433 — Standard Practice for Roads and Parking Lots Pavement Condition Index Surveys
