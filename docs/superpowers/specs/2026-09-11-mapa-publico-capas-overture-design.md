# El mapa público: publicación, capas y edificios de Overture

Fecha: 2026-09-11
Estado: aprobado en conversación por Samuel; pendiente de su revisión sobre este texto
Rama: `feat/vialidad-3d`, sobre el commit `d6f28a2`

## 1. Qué es

Tres tandas de trabajo que convierten el visor local de un solo usuario en un
**mapa público del estado Táchira que la comunidad mantiene capa a capa**:

1. **Publicación.** El repo se hace público, el mapa se sirve desde GitHub
   Pages, los datos base pesados viajan como asset de un Release, y la imagen
   satelital deja de repartirse.
2. **Sistema de capas.** Un catálogo declarativo, un archivo GeoJSON por capa
   versionado en git, un panel para prenderlas y apagarlas, y el dibujo de
   puntos sobre el terreno. Primera capa: hospitales y centros médicos.
   Municipios como líneas de división.
3. **Edificios de Overture.** La fuente de huellas de edificios pasa de
   Overpass a Overture Maps, que ya fusiona Google, Microsoft y OSM. El
   estimador de alturas y el horneador se conservan; se añaden filtros de
   calidad y la partición de chunks densos.

**Lo que esta spec no cubre**, a propósito: el editor comunitario con cuentas,
propuestas y moderación sobre Supabase. Es la cuarta tanda y va en su propia
spec. Lo que sí hace esta es dejar la forma de los datos lista para que esa
tanda no tenga que cambiar el visor.

Las tres tandas se implementan **en ese orden**, cada una con su plan. La 2
depende de la 1 por `urlVersionado`; la 3 depende de la 1 por `VITE_DATOS` y
por la partición de chunks, y de nada de la 2.

## 2. Evidencia

Todo medido el 2026-09-11 salvo indicación. Lo marcado ESTIMADO es proyección.

```
repo                    privado, 122 commits, sin README, LICENSE ni CONTRIBUTING
                        package.json: license ISC, private true, description vacía
master                  120 commits detrás de feat/vialidad-3d, ninguno por delante
rutas '/data/' en src   18, en 6 archivos: buildings.ts, load.ts, piezas.ts,
                        demTiles.ts, imagenTeselas.ts, TerrainLod.tsx
Node                    v24.14.0

public/data             dem 16 MB · edificios 132 MB (75 bin + 57 json) · img 3,4 MB
                        municipios 3,0 MB · roads 32,7 MB · terrain 2,0 MB · piezas 0,6 MB
tar.gz sin piezas       59 MB
edificios horneados     45.593 en 564 chunks z15; máximo 5.090 por chunk, 9,1 MB
horneador               lee de DEFAULT_INPUT (scratchpad de otra sesión) y
                        DEFAULT_SAT (otro proyecto en D:), ambos fuera del repo
imagen satelital        Esri World Imagery; z8-z12 horneadas (217 teselas),
                        z13-z17 pedidas en vivo desde el navegador
atribución OSM en UI    ninguna (solo la línea de Esri cuando hay imagen)

OSM en el bbox          hospitales 72 · clínicas y consultorios 53 · rutas de bus 14
                        tuberías 2 · canales 36 · edificios (ways) 67.881
Overture 2026-08-19.0   edificios en el bbox 733.196
                          Google 433.695 · Microsoft 233.173 · OSM 66.328
                          con height 0,38 % · con num_floors 0,52 %
                          una fuente por edificio, sin duplicados
cuadro barrio 909 m     OSM 90 · Overture 1.291 (985 G · 261 MS · 45 OSM)
                        mediana de área: OSM 151 m² · Google 26 m² · Microsoft 26 m²
                        bajo 15 m²: OSM 1/45 · Google 334/985 · Microsoft 72/261
                        confianza: Google en las 985 (0,68-0,91) · Microsoft ninguna
cuadro centro 909 m     OSM 937, prácticamente completo
CLI overturemaps        instalado; 1.377 rasgos del barrio en 4,5 s; conserva los
                        atributos no nulos; ids OSM como record_id 'w269769424@1'
proyección Overture     733k × 1,65 KB bin ≈ 1,2 GB · × 1,25 KB json ≈ 0,9 GB   ESTIMADO
```

Esri, "World Imagery Uses Permitted" (item `8e90a00a0a6845a49262e0b756f57a10`):
concede calcar a mano y compartir el vector resultante en sitios de datos
abiertos u OSM. Esri, blog de Living Atlas, condiciones: World Imagery *"cannot
be used as direct input to automated information extraction"*. Por eso ni se
reparten teselas ni se derivan huellas por máquina desde ellas.

## 3. Decisiones tomadas y por qué

| Decisión | Por qué | Fecha |
|---|---|---|
| Mapa comunitario con administración: revisión antes de publicar y además cuentas e historial | Samuel: "las dos, el mapa necesita una administración" | 2026-09-11 |
| GitHub Pages para el visor, Supabase para la administración, con cuenta dedicada al proyecto | Pages es estático; la administración necesita un servicio. La cuenta no debe ser la personal de Samuel | 2026-09-11 |
| Primera tanda de capas: municipios y hospitales; edición de puntos. Líneas después | Más mapa por menos trabajo; el flujo de propuestas se prueba sobre puntos | 2026-09-11 |
| Imagen satelital en vivo desde Esri, nunca repartida | Esri permite usar el servicio, no redistribuir teselas. El mapa se ve igual | 2026-09-11 |
| Huellas de edificios desde Overture, no desde un detector propio | 733k frente a 68k; ODbL limpia; Esri prohíbe la extracción automatizada; el vectorizador de Samuel se reserva para piezas concretas | 2026-09-11 |
| Contratos primero, después código | Samuel: "empezaría haciendo los contratos, para que construir sea fácil y no se sienta vibe coded" | 2026-09-11 |

## 4. Tanda 1: publicación

### 4.1 Criterio de hecho

Una persona sin acceso a la máquina de Samuel clona el repo público, corre tres
comandos y ve el mapa completo en local. La misma persona abre
`https://sssamuelll.github.io/tachira-3d/` y ve el mismo mapa. Un pull request
con un test rojo no se puede fundir.

```
git clone https://github.com/sssamuelll/tachira-3d
npm ci
npm run datos:bajar
npm run dev
```

### 4.2 Rama y despliegue

- `feat/vialidad-3d` se funde en `master` por fast-forward. No hay nada en
  `master` que conservar.
- Pages se configura con origen "GitHub Actions" y despliega desde `master`.
- Lo que hoy está sin commit y fuera de esta spec (`package.json`,
  `package-lock.json`, `src/data/puentes.ts`, `src/data/puentes.test.ts`) no
  entra en la fusión. Samuel decide qué hacer con eso aparte.

### 4.3 Rutas de datos

Hay dos clases de datos y tienen que poder vivir en sitios distintos:

- **Versionados**: pequeños, en git, se despliegan con el sitio. Hoy
  `piezas/`; en la tanda 2, `capas/`.
- **Generados**: pesados, fuera de git, hoy en Pages y en la tanda 3 en un
  bucket. `dem/`, `edificios/`, `municipios.json`, `roads-*`, `terrain.*`.

```ts
// src/data/rutas.ts
/** Datos versionados en git: se sirven junto al sitio. */
export function urlVersionado (rel: string): string
  // `${import.meta.env.BASE_URL}data/${rel}`

/** Datos generados por el pipeline: junto al sitio, o en el bucket que diga
 *  VITE_DATOS (sin barra final). */
export function urlGenerado (rel: string): string
  // VITE_DATOS ? `${VITE_DATOS}/${rel}` : `${import.meta.env.BASE_URL}data/${rel}`
```

- Las 18 rutas `'/data/…'` de los 6 archivos pasan por una de las dos. Ningún
  archivo de `src/` vuelve a contener el literal `/data/`.
- `PIEZAS[].glb` pasa a ser relativo al raíz de datos: `'piezas/centro-civico.glb'`.
  `Piezas.tsx` lo resuelve con `urlVersionado`. Las pruebas que hoy comparan
  con `'/data/piezas/…'` cambian a la forma relativa.
- `vite.config.ts`: `base: process.env.BASE_PATH ?? '/'`. Solo la Action
  define `BASE_PATH=/tachira-3d/`; en local sigue siendo `/`. Si algún día hay
  dominio propio, `BASE_PATH` vuelve a `/` y nada más cambia.
- `VITE_DATOS` queda definido en esta tanda y **sin valor**: las dos funciones
  resuelven al mismo sitio hasta la tanda 3.

### 4.4 Imagen satelital

- `urlImagen(z, x, y)` devuelve siempre la tesela de Esri. Desaparecen
  `Z_HORNEADO`, `scripts/bake-img.mjs`, `scripts/test/bake-img.test.mjs` y la
  carpeta `public/data/img/`. `.cache/img/` deja de tener sentido.
- `ancestroCargado` se conserva: sigue cayendo a la tesela viva más gruesa que
  ya llegó.
- Sin red, o con Esri caído, ninguna tesela llega y el nodo dibuja
  hipsometría. Ese camino ya existe (`TerrainLod`: `uImagen = 0` cuando no hay
  tesela); una prueba lo fija simulando `fetch` fallido.
- Al abrir la vista de estado se piden en vivo las teselas z8-z12 que antes
  venían horneadas. Son del orden de 217 y Esri las sirve en ~110 ms cada una.
  Se mide en Chrome tras implementar, sin fijar umbral antes de medir.

### 4.5 Datos base: empaquetar y bajar

```
npm run datos:empaquetar        scripts/datos-empaquetar.mjs
  1. escribe public/data/VERSION:
       { "fecha": "2026-09-11", "scripts": "<sha de git rev-parse HEAD:scripts>",
         "origen": {lat, lon, h}, "bbox": {s, w, n, e} }
  2. tar -czf datos-base.tar.gz -C public <lista explícita>
       data/VERSION data/dem data/edificios data/municipios.json data/terrain.bin
       data/terrain.json data/roads-approaches.json data/roads-index.bin
       data/roads-meta.json data/roads-nrm.bin data/roads-pos.bin
       data/roads-segid.bin data/roads-structures.json
     Lista explícita, no exclusiones: lo que no está nombrado no viaja.
  3. imprime tamaño y SHA-256 del tar.gz

Release en GitHub        etiqueta datos-<fecha del día>, asset datos-base.tar.gz.
                         Lo crea Samuel a mano con el tar.gz.

npm run datos:bajar             scripts/datos-bajar.mjs
  1. GET https://api.github.com/repos/sssamuelll/tachira-3d/releases
     elige la etiqueta más reciente que cumpla /^datos-\d{4}-\d{2}-\d{2}$/,
     o la que diga TACHIRA_DATOS_TAG si está definida
  2. baja el asset a .cache/datos/<etiqueta>.tar.gz si no está ya
  3. tar -xzf en public/ y muestra public/data/VERSION
```

`tar` se invoca como binario del sistema: viene con Windows 10+, macOS y Linux.
Sin dependencias nuevas.

Techos conocidos, escritos como `ponytail:` en el script: el asset admite 2 GB;
la API pública sin token admite 60 peticiones por hora por IP; Pages sirve
sitios de hasta 1 GB y unos 100 GB al mes. Ninguno aprieta en esta tanda.

### 4.6 Action

```yaml
# .github/workflows/pages.yml
on:  pull_request · push a master
jobs:
  verificar (siempre):
    actions/checkout · actions/setup-node node-version 24, cache npm
    npm ci
    npm run datos:bajar
    npx vitest run
    npx tsc --noEmit
    BASE_PATH=/tachira-3d/ npm run build
  desplegar (solo push a master, necesita verificar):
    actions/upload-pages-artifact path dist
    actions/deploy-pages
permissions: pages write, id-token write · concurrency: pages, sin cancelar en curso
```

Los tests leen chunks reales de `public/data/edificios/`, por eso `datos:bajar`
va antes de `vitest`. No se cachea el tar.gz entre corridas en esta tanda; se
mide cuánto tarda y se decide.

### 4.7 Licencias y atribución

```
LICENSE            MIT, el código
LICENSE-DATOS.md   ODbL 1.0 para todo lo derivado de OSM: vías, edificios,
                   municipios, capas, y las contribuciones de la comunidad.
                   Atribuciones: © OpenStreetMap contributors; terreno de
                   Terrarium (AWS Open Data: SRTM, GMTED y otras fuentes
                   listadas); huellas de Overture Maps (ODbL) desde la tanda 3.
                   Piezas 3D (public/data/piezas): CC BY 4.0.
```

Las contribuciones de la comunidad van en ODbL a propósito: es lo que deja la
puerta abierta a subirlas a OSM el día que se pueda.

`Atribucion` pasa a tener una línea **permanente**, visible siempre:
`© OpenStreetMap contributors (ODbL) · Terreno: Terrarium/AWS Open Data`, y la
línea de Esri solo cuando la imagen está prendida, como hoy. Hoy no hay
atribución de OSM en pantalla y ODbL la exige.

### 4.8 Documentos y metadatos

- `README.md`: qué es el mapa (el propósito nuevo, no el de la spec de
  2026-09-05), enlace a Pages, los tres comandos, cómo está hecho en cinco
  líneas, licencias, estado. Sin capturas hasta que Pages exista.
- `CONTRIBUTING.md`: cómo correr los tests; cómo añadir una capa (tanda 2) y
  una pieza 3D (enlaza `docs/piezas-3d.md`); cómo regenerar datos base y
  publicar un Release; reglas: tests verdes, medido y estimado separados y
  escritos, un PR por cosa; un párrafo de trato entre personas.
- `package.json`: `name` `tachira-3d`, `description`, `license` `MIT`,
  `repository`, `engines.node >=24`. `private` se queda en `true`: no se
  publica en npm.

### 4.9 Pruebas

- `src/data/rutas.test.ts`: `urlVersionado` y `urlGenerado` con y sin
  `VITE_DATOS`; y un recorrido de `src/**/*.{ts,tsx}` que falla si reaparece
  el literal `/data/` fuera de este mismo test.
- `imagenTeselas.test.ts`: `urlImagen` en z8 y z17 apunta a Esri; con `fetch`
  fallido el nodo termina con `uImagen = 0`.
- `scripts/test/datos-empaquetar.test.mjs`: la lista de archivos del tar es
  exactamente la declarada; `VERSION` trae los cuatro campos.
- `scripts/test/datos-bajar.test.mjs`: elección de etiqueta con fixtures de la
  API (varias etiquetas, etiquetas que no cumplen el patrón,
  `TACHIRA_DATOS_TAG`).

### 4.10 Lo que hace Samuel a mano

1. Poner el repo público.
2. Activar Pages con origen "GitHub Actions".
3. Correr `npm run datos:empaquetar` y crear el Release `datos-<fecha del día>`
   con el tar.gz.
4. Opcional, recomendado: mover el repo a una organización de GitHub del
   proyecto.

## 5. Tanda 2: sistema de capas

### 5.1 Criterio de hecho

El mapa muestra un panel con las capas. Prender "Hospitales y centros médicos"
dibuja los puntos apoyados en el terreno con su nombre al acercarse; hacer clic
en uno abre su ficha. Prender "Municipios" dibuja los límites sobre el
relieve. La URL refleja qué capas están prendidas y un enlace reproduce la
vista. Añadir una capa nueva es una entrada en el catálogo, un archivo GeoJSON
y, si viene de OSM, una consulta en el registro de semillas. Sin tocar
componentes.

### 5.2 Catálogo

```ts
// src/data/capas.ts
export type Geometria = 'punto' | 'linea' | 'poligono'

export interface Campo {
  clave: string                              // 'tipo'
  nombre: string                             // 'Tipo'
  tipo: 'texto' | 'opcion' | 'numero' | 'booleano'
  opciones?: readonly string[]               // solo si tipo === 'opcion'
  obligatorio?: boolean
}

export interface Capa {
  id: string                                 // 'hospitales'
  nombre: string                             // 'Hospitales y centros médicos'
  geometria: Geometria
  campos: readonly Campo[]
  archivo: string                            // 'capas/hospitales.geojson', relativo a urlVersionado
  porDefecto: boolean                        // visible sin ?capas=
  color: string                              // '#e0453a'
}

export const CAPAS: readonly Capa[]

/** Nombres que ningún campo del catálogo puede usar: los pone el sistema. */
export const RESERVADOS = ['origen', 'osmId', 'version'] as const

/** Capas que no salen de un archivo sino de componentes que ya existen. */
export const CAPAS_FIJAS: readonly { id: 'edificios' | 'municipios'; nombre: string; porDefecto: boolean }[]
```

Primera entrada del catálogo:

```ts
{
  id: 'hospitales',
  nombre: 'Hospitales y centros médicos',
  geometria: 'punto',
  campos: [
    { clave: 'nombre', nombre: 'Nombre', tipo: 'texto' },
    { clave: 'clase', nombre: 'Clase', tipo: 'opcion', opciones: ['hospital', 'clinica', 'consultorio', 'ambulatorio'], obligatorio: true },
    { clave: 'tipo', nombre: 'Tipo', tipo: 'opcion', opciones: ['publico', 'privado', 'sin_dato'], obligatorio: true },
    { clave: 'emergencias', nombre: 'Emergencias', tipo: 'booleano' },
  ],
  archivo: 'capas/hospitales.geojson',
  porDefecto: false,
  color: '#e0453a',
}
```

`nombre` no es obligatorio: en OSM muchos centros vienen sin nombre y eso es
un dato, no un error. `.gitignore` gana `!public/data/capas/`.

### 5.3 Archivo por capa

GeoJSON puro, un `FeatureCollection` en `public/data/capas/<id>.geojson`,
versionado en git, con salida ordenada por `id` y sangría de dos espacios para
que el diff de un PR sea legible.

```
FeatureCollection
  capa        'hospitales'               ┐ miembros ajenos; el estándar
  generado    '2026-09-11T14:02:00Z'     │ (RFC 7946 §6.1) los permite
  fuente      'OSM vía Overpass, …'      ┘
  features[]
    type        'Feature'
    id          texto opaco, único dentro de la capa, estable
                  de OSM: 'osm/node/123', 'osm/way/456', 'osm/relation/789'
                  de la comunidad: lo asigna el editor en la tanda 4
    geometry    Point | LineString | Polygon según capa.geometria
                coordenadas [lon, lat], como manda el estándar
    properties
      <campos de la capa>
      origen    'osm' | 'comunidad'
      osmId     'node/123', solo si origen === 'osm'
      version   entero ≥ 1
```

Este mismo rasgo es una fila de Postgres en la tanda 4: `id`, `capa`,
`geometry`, `properties`, con `version` para detectar que dos personas tocaron
el mismo hospital. Nada del visor cambia cuando la fila reemplace al archivo.

### 5.4 Cargador

```ts
// src/data/capas.ts
export type Rasgo = GeoJSON.Feature & { id: string; properties: Record<string, unknown> & { origen: 'osm' | 'comunidad'; osmId?: string; version: number } }

export async function cargarCapa (capa: Capa): Promise<Rasgo[]>
  // fetch(urlVersionado(capa.archivo)) → validarCapa → features

export function validarCapa (capa: Capa, coleccion: unknown): Rasgo[]
  // lanza con mensaje que nombra el rasgo y el motivo:
  //   - no es FeatureCollection, o coleccion.capa !== capa.id
  //   - id ausente o repetido
  //   - geometry.type no corresponde a capa.geometria
  //   - alguna coordenada cae fuera de BBOX (atrapa [lat, lon] invertidos)
  //   - falta un campo obligatorio, o un 'opcion' trae un valor fuera de opciones
  //   - properties usa un nombre RESERVADO como campo del catálogo
  //   - origen fuera de {'osm','comunidad'}; version no entero ≥ 1
```

En la tanda 4 `cargarCapa` lee de Supabase y cae al archivo si no responde.
La firma no cambia.

### 5.5 Estado y URL

```ts
// src/ui/capasUrl.ts
type Disponible = { id: string; porDefecto: boolean }   // [...CAPAS_FIJAS, ...CAPAS]

export function capasDesdeUrl (search: string, disponibles: readonly Disponible[]): Set<string>
  // ?capas=edificios,municipios,hospitales  → exactamente ese conjunto
  // sin ?capas=                             → las porDefecto
  // ?edificios=0                            → alias: quita 'edificios' del conjunto
  // ids que no están en disponibles se ignoran en silencio
export function capasAUrl (visibles: Set<string>, disponibles: readonly Disponible[]): string
  // '' si coincide con las porDefecto; si no, 'capas=a,b,c' en el orden de disponibles
```

`App.tsx` guarda `visibles` en estado, lo escribe en la URL con
`history.replaceState` en cada cambio, monta `Buildings`, `Piezas` y
`SombrasEdificios` solo si `visibles.has('edificios')`, y pasa
`visibles.has('municipios')` a `TerrainLod` para el uniform de límites. Las
vías no están en el panel: búsqueda y picking dependen de ellas y siempre se
dibujan.

### 5.6 Panel

`src/ui/PanelCapas.tsx`: una fila por capa, fijas primero y luego el catálogo
en su orden, cada una con una casilla y el color de la capa. Vive en
`MapControls` junto a los botones que ya existen. Sin categorías, sin buscador,
sin arrastrar: eso es para cuando haya más de diez capas.

### 5.7 Dibujo de puntos

`src/scene/CapaPuntos.tsx`, uno por capa de puntos visible:

- **Marcador**: un `THREE.Sprite` por rasgo con `sizeAttenuation: false`,
  tamaño constante en pantalla, textura generada en canvas con el color de la
  capa. Todos bajo un `Group` con `name = 'capa:' + id`.
- **Apoyo al terreno, en dos pasos**:
  1. Al montar, `y = alturaGruesa(lat, lon)`: muestreo de la rejilla de 1024²
     que ya está en memoria para el minimapa (`terrainGrid`). La función se
     extrae del muestreo que hoy vive en `src/ui/disco.ts` a
     `src/data/terreno.ts`, sin cambiar su comportamiento.
  2. Cada 30 cuadros, para los rasgos a menos de 3 km de la cámara,
     `alturaTerreno(p, scene)`; si devuelve número, se adopta. Se repite
     siempre, no solo hasta la primera vez: el primer impacto puede venir de
     un nodo grueso provisional y el fino llega después. Con menos de cien
     rasgos por capa son unos pocos raycasts por segundo. No se demandan
     teselas de DEM como hacen las piezas: los puntos se apoyan en lo que el
     relieve ya cargó para la cámara.
- **Etiqueta**: `<Html>` de drei con el nombre, `center`, solo para los rasgos
  a menos de 2 km de la cámara y como máximo 40 a la vez, los más cercanos.
  `ponytail:` techo de 40 nodos DOM; el camino de mejora es texto SDF en
  escena si alguna capa de puntos pasa de unos cientos de rasgos densos.
- **Clic**: `onClick` del sprite por raycast de r3f. No toca el pase de ids
  del issue #2. Abre `FichaRasgo` con nombre, los campos del catálogo con sus
  valores, `origen`, y enlace a OSM si hay `osmId`.

### 5.8 Municipios como límites

El terreno ya recorta el estado con una máscara de 1024² de un canal
(`stateMask`). Los límites municipales se dibujan con el mismo mecanismo,
sin geometría nueva y sin depender del LOD:

```ts
// src/scene/stateMask.ts
export function indiceMunicipios (municipios: Municipio[], bbox: Bbox, W: number, H: number): Uint8Array
  // 0 fuera del estado; i + 1 para el municipio i; en solapes gana el último
```

- Textura `RedFormat` de **2048²** (4 MB), aparte de la máscara de recorte.
- En el fragment del terreno, cuando la capa está prendida: se lee el índice
  en el texel y en sus vecinos a un texel de distancia; donde difieren se
  pinta la línea. Un uniform `uLimites` la prende y apaga.
- `ponytail:` a 2048² el texel mide unos 63 × 72 m en el Táchira, y la línea
  se ve escalonada al acercarse a una frontera. El camino de mejora es
  vectorial y drapeado sobre el DEM tallado, el mismo muestreo que la Plaza
  Bolívar tiene pendiente para sus escaleras.

### 5.9 Semilla desde OSM

```
npm run capa -- hospitales           scripts/capa.mjs <id>
  1. busca <id> en scripts/lib/capas-osm.mjs:
       { consulta: string (Overpass, con bbox), traducir(el) → { id, geometry, properties } | null }
  2. overpass(consulta, 'capa-<id>') con la caché de .cache/ que ya usa build-data
  3. traduce cada elemento; los null se descartan y se cuentan
  4. si ya existe public/data/capas/<id>.geojson, conserva sus rasgos con
     origen 'comunidad' y reemplaza los de origen 'osm'
  5. valida con validarCapa y escribe ordenado por id
  6. imprime cuántos entraron, cuántos se descartaron y por qué
```

Registro de hospitales:

```
consulta   ( nwr[amenity=hospital](bbox); nwr[amenity~"^(clinic|doctors)$"](bbox);
             nwr[healthcare~"^(hospital|clinic|centre|doctor)$"](bbox); ); out center;
traducir   punto: node → lat/lon; way y relation → center
           nombre       tags.name ?? ''
           clase        amenity=hospital → 'hospital' · clinic → 'clinica' · doctors → 'consultorio'
                        healthcare=centre → 'ambulatorio'; sin ninguna → null (se descarta)
           tipo         operator:type ∈ {public, government, community} → 'publico'
                        private → 'privado' · otro o ausente → 'sin_dato'
           emergencias  emergency=yes → true · no → false · ausente → se omite
           origen 'osm' · osmId '<type>/<id>' · version 1 · id 'osm/<type>/<id>'
```

Se corre una vez en esta tanda y el archivo resultante se commitea. Con lo que
OSM tiene hoy: 72 hospitales y 53 clínicas y consultorios.

### 5.10 Pruebas

- `capas.test.ts`: ids únicos en `CAPAS`; ningún campo usa un nombre
  reservado; `archivo` existe en `public/data/capas/`; `validarCapa` rechaza
  cada uno de los motivos de 5.4 con fixtures mínimos, y acepta el archivo real
  de hospitales.
- `capasUrl.test.ts`: `capasDesdeUrl` y `capasAUrl` van y vuelven; el alias
  `?edificios=0`; ids desconocidos.
- `terreno.test.ts`: `alturaGruesa` devuelve lo mismo que devolvía el muestreo
  de `disco.ts` en tres puntos conocidos.
- `stateMask.test.ts`: `indiceMunicipios` asigna 29 índices distintos, 0
  fuera, y coincide con `stateMask` en dónde hay estado y dónde no.
- `scripts/test/capa.test.mjs`: `traducir` de hospitales sobre fixtures
  Overpass (node con todo, way con center, sin amenity, `operator:type`
  raro); la fusión conserva un rasgo de `origen: 'comunidad'` y reemplaza uno
  de `origen: 'osm'`.

## 6. Tanda 3: edificios de Overture

### 6.1 Criterio de hecho

`npm run edificios` corre en cualquier máquina desde datos que el propio repo
sabe bajar, y el barrio al norte del Centro Cívico se ve construido. Correrlo
dos veces produce bytes idénticos. Las piezas siguen apoyadas y sus pruebas
siguen verdes. Existe `docs/edificios-overture.md` con los conteos por fuente
antes y después de los filtros y los recortes de comparación.

### 6.2 Fuente única y release fijado

Overture reemplaza a Overpass como **única** fuente de huellas. Los edificios de
OSM ya vienen dentro de Overture con su id original, así que "descartar lo que
ya existe en OSM" queda resuelto por construcción: una fuente por edificio,
sin duplicados. A cambio, la copia de OSM tiene la edad del release; hoy,
2026-08-02. Es un trueque consciente a favor del determinismo.

```
npm run edificios:overture           scripts/edificios-overture.mjs
  overturemaps download
    --bbox=-72.4878225,7.3612911,-71.3153029,8.6826552
    -f geojsonseq -t building
    -r <OVERTURE_RELEASE>                     constante del script: '2026-08-19.0'
    -o .cache/edificios/overture/<release>.geojsonseq
  requiere: pip install overturemaps           documentado en CONTRIBUTING
  no vuelve a bajar si el archivo del release ya existe
```

Cambiar de release es cambiar la constante y regenerar. El release queda
escrito en `index.json` bajo `sources`.

### 6.3 Ingesta

`ingerirEdificios` acepta un segundo tipo de documento, además del de
Overpass que ya entiende:

```
documento   { fuente: 'overture', release: '2026-08-19.0', features: Feature[] }

huella      { id, osmId, osmType, tags, polygons, fuente, confianza }
  id         sources[0].record_id 'w269769424@1' → 'way/269769424'
                                  'r3499128@7'   → 'relation/3499128'
             cualquier otra fuente               → 'overture/<feature.id>'
  osmId      el número, o null · osmType 'way' | 'relation' | null
  fuente     'osm' | 'google' | 'microsoft', por sources[0].dataset
  confianza  sources[0].confidence, o null
  polygons   Polygon y MultiPolygon → [{ outer, holes }] pasando por limpiarAnillo
  tags       building         class ?? subtype ?? 'yes'
             building:levels  num_floors, si viene
             height           height, si viene
             name             names.primary, si viene
             roof:shape       roof_shape · roof:material roof_material · roof:colour roof_color
```

Conservar el id de OSM importa: el estimador siembra su variación con
`semilla('altura:' + id)`, así que los edificios que ya estaban no cambian de
altura; y las pruebas de las piezas enumeran ids de OSM dentro de su caja.

### 6.4 Filtros

Una función pura, con umbrales como parámetro y valores iniciales declarados:

```
filtrarHuellas (huellas, umbrales) → { quedan, descartadas: { <motivo>: n } }

umbrales iniciales
  osm            se conservan todas
  google         confianza < 0,75                          → 'google-confianza'
                 área < 6 m²                                → 'google-diminuta'
                 área < 12 m² y confianza < 0,85            → 'google-diminuta-dudosa'
  microsoft      área < 20 m²                                → 'microsoft-diminuta'
                 elongación > 6                              → 'microsoft-astilla'
  cualquiera     is_underground                              → 'subterraneo'
                 anillo con menos de 4 vértices o área 0     → 'geometria'
```

Los umbrales son iniciales, no definitivos: se fijan **después** de medir, no
antes. El plan incluye una calibración sobre los dos cuadros de 909 m ya
renderizados, con el conteo por fuente y por motivo, y los recortes con las
huellas coloreadas por decisión. Si en el cuadro del barrio más del 1 % de las
huellas de máquina cae con su centroide dentro de una huella de OSM, se añade
un filtro de solape; Overture dice que no pasa, y se comprueba en vez de
creerlo.

Los conteos entran en `index.json`: `stats.fuentes` (por fuente, antes y
después) y `stats.filtros` (por motivo).

### 6.5 Altura

`estimarAltura` no cambia. `evidencia.perfil` pasa de `'osm'` fijo a la
`fuente` de la huella, para que el informe distinga qué alturas descansan en
tags de OSM y cuáles en pura morfología.

### 6.6 Techo

Desaparece el muestreo de color sobre teselas de Esri a z18 y su respaldo de
contexto a z12: era extracción automatizada sobre World Imagery, dependía de
una carpeta fuera del repo, y con diez veces más edificios pediría diez veces
más teselas.

```
paletaTecho (huella) → { rgb, fuente: 'paleta' | 'osm-roof-colour' }
  roof:colour parseable         → ese color, fuente 'osm-roof-colour'
  clase doméstica               → teja (178, 86, 54) 55 % · zinc (150, 150, 150) 35 % · zinc viejo (120, 110, 100) 10 %
  apartments/office/retail/…    → losa (160, 158, 152) 70 % · concreto (140, 140, 140) 30 %
  industrial/warehouse          → zinc 100 %
  sin clase                     → teja 40 % · zinc 40 % · losa 20 %
  la elección sale de semilla('techo:' + id): determinista por edificio
```

`crearMuestreadorTechos`, `medianaTecho`, `DEFAULT_SAT` y
`.cache/edificios/satelite` se borran con sus pruebas. `stats.roofSources`
pasa a contar `paleta` y `osm-roof-colour`.

### 6.7 Chunks

Hoy el máximo es 5.090 edificios y 9,1 MB en un chunk z15. Con diez veces más
edificios en el centro, eso no cabe en una petición.

```
agruparChunks (huellas, MAX = 2500)
  agrupa por z15; un grupo con más de MAX se parte en sus cuatro hijos z16,
  y de nuevo en z17 si alguno sigue pasando. No más hondo.
claves        '15/x/y' · '16/x/y' · '17/x/y'
claveValida   /^(1[5-7])\/(\d+)\/(\d+)$/, con x e y menores que 2^z
demNodes      sin cambio: los nodos z15 que toca la huella, sea cual sea el chunk
```

El cliente ya elige chunks por `bounds` y `demNodes`, no por la clave, así que
los chunks mixtos no lo tocan salvo por `claveValida`.

### 6.8 Rutas del horneador

`DEFAULT_INPUT` y `DEFAULT_SAT` desaparecen. `hornear()` lee de
`.cache/edificios/overture/` por defecto y no conoce ninguna ruta fuera del
repo. `npm run edificios` corre `edificios:overture` si falta el archivo del
release y después hornea.

### 6.9 Tamaño y dónde se sirve

Con las proporciones de hoy, 733k edificios darían del orden de 1,2 GB de
binario y 0,9 GB de metadata antes de filtros, y algo más de la mitad después
(ESTIMADO). Pages no admite un sitio de ese tamaño.

- Los datos generados se sirven desde un bucket con CORS abierto. La
  recomendación es Cloudflare R2, por no cobrar egreso, creado con la cuenta
  dedicada del proyecto. La Action define `VITE_DATOS=https://<bucket>` y,
  tras `vite build`, borra de `dist/data/` todo lo generado; `piezas/` y
  `capas/` se quedan en Pages.
- Subir el paquete al bucket es un paso manual de Samuel en esta tanda, con
  el mismo tar.gz del Release. Se automatiza cuando duela.
- El asset del Release sigue existiendo: es lo que baja `datos:bajar` para
  desarrollo y para los tests en CI. El asset admite 2 GB.

### 6.10 Piezas

- La caja `sustituye` del Centro Cívico sigue vaciando por centroide en el
  cliente, así que las huellas de Google o Microsoft sobre las torres
  desaparecen al dibujar. La prueba "dentro de la caja solo hay obra del
  propio conjunto" pasa a admitir, además de los cuatro ids de OSM, cualquier
  id `overture/*`.
- Si `relation/3499128` o los tres `building=roof` no vinieran en Overture, la
  prueba lo dice y la lista esperada se corrige con la explicación.
- Si aparecen huellas de máquina dentro del perímetro de la Plaza Bolívar,
  la prueba que hoy exige cero lo dice, y la plaza gana su propia caja
  `sustituye`: el mecanismo ya existe.

### 6.11 Pruebas

- `scripts/test/building-input.test.mjs`: el documento Overture se ingiere;
  ids de OSM se reconstruyen desde `record_id`; MultiPolygon produce varios
  `polygons`; mapeo de `class`, `num_floors`, `height`, `names`, `roof_*`.
- `scripts/test/building-filtros.test.mjs`: cada motivo con un fixture que lo
  dispara y uno que no; los umbrales entran por parámetro.
- `scripts/test/building-roof.test.mjs`: `paletaTecho` es determinista por id
  y respeta `roof:colour`.
- `scripts/test/build-buildings.test.mjs`: `agruparChunks` parte un grupo de
  MAX + 1 en z16 y no parte uno de MAX; hornear un fixture de veinte huellas
  dos veces da bytes idénticos en `.bin`, `.json` e `index.json`.
- `src/data/buildings.test.ts`: `claveValida` acepta z15, z16 y z17 y rechaza
  z14 y z18.
- Las pruebas de `piezas.test.ts` y `Buildings.test.ts` siguen verdes sobre
  los chunks regenerados.

## 7. Orden e hitos

```
1  publicación     master al día · Pages sirviendo · Release datos-<fecha> · README
2  capas           panel · hospitales desde OSM · municipios como límites · URL · ✓ 2026-09-13 · 127 hospitales
3  Overture        edificios regenerados · bucket · informe con calibración
4  editor          spec aparte: Supabase, cuentas, propuestas, moderación
```

Cada tanda se cierra con los tres comandos de verificación del repo, el
resultado escrito en su doc, y una revisión en Chrome de lo que cambió en
pantalla. Las tandas 1 y 2 caben en un plan cada una; la 3 también, con la
calibración como tarea propia antes de regenerar el estado completo.

## 8. Riesgos y lo que no se sabe

- **Esri en vivo para z8-z12 al arrancar.** Se mide en Chrome; si la vista de
  estado tarda visiblemente, el remedio es pedir esos niveles con prioridad
  antes que los finos, no volver a hornear.
- **La copia de OSM dentro de Overture envejece.** Hasta la tanda 4 la
  comunidad no edita huellas, así que no duele. Cuando duela, se sube de
  release.
- **Las huellas de máquina no traen relaciones.** Un edificio con patio de
  Google sale como polígono simple sin hueco. Se acepta; el estimador no
  depende de huecos.
- **`Html` de drei y rendimiento.** 40 etiquetas es un techo escrito; se mide.
- **R2 es una cuenta más que mantener.** Es el precio de servir más de 1 GB.
  Si Samuel prefiere no abrirla todavía, la tanda 3 puede hornear solo los
  municipios de San Cristóbal y Cárdenas primero para quedar bajo 1 GB en
  Pages, y el resto del estado entra cuando exista el bucket.
