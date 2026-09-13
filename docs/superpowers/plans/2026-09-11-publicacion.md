# Tanda 1: publicación — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cualquier persona clone el repo público, corra tres comandos y vea el mapa; y que el mismo mapa se sirva solo desde GitHub Pages.

**Architecture:** Las rutas de datos dejan de ser absolutas y pasan por dos funciones que respetan el `base` de Vite, para que el sitio funcione bajo el subdirectorio `/tachira-3d/`. La imagen satelital deja de repartirse y se pide siempre en vivo a Esri. Los datos generados por el pipeline, que no caben en git, viajan en un `tar.gz` como asset de un Release, con un script que lo arma y otro que lo baja. Una Action verifica cada pull request y despliega `master` a Pages.

**Tech Stack:** TypeScript, React 19, three.js, Vite 8, Vitest 5, Node 24, GitHub Actions, `tar` del sistema.

**Spec:** [docs/superpowers/specs/2026-09-11-mapa-publico-capas-overture-design.md](../specs/2026-09-11-mapa-publico-capas-overture-design.md), sección 4.

## Global Constraints

- **Node** `>=24`. El repo corre con v24.14.0.
- **Comentarios y mensajes en español**, como todo el repo. Los identificadores de código también (`urlVersionado`, no `versionedUrl`).
- **Nada de dependencias nuevas.** `tar` se invoca como binario del sistema; viene con Windows 10+, macOS y Linux.
- **Los tres comandos de verificación** del repo son `npx vitest run`, `npx tsc --noEmit` y `npm run build`. Los tres tienen que quedar verdes al final de cada tarea.
- **El aviso de tamaño de bundle en `npm run build` ya existe** antes de este trabajo y no lo introduce ninguna tarea. No se toca el umbral para taparlo.
- **`public/data/` sigue fuera de git** salvo `piezas/`. El `.gitignore` actual es `public/data/*` más `!public/data/piezas/`.
- **URL del repo:** `https://github.com/sssamuelll/tachira-3d`. Sitio en `https://sssamuelll.github.io/tachira-3d/`.
- **TDD.** Cada tarea empieza por una prueba que falla por el motivo correcto.
- **Un commit por tarea**, con el mensaje que da la tarea.

---

### Task 1: Las dos funciones de ruta

Hoy 18 rutas de `src/` empiezan por `/data/`. Bajo GitHub Pages el sitio cuelga de `/tachira-3d/`, así que esas rutas se irían a la raíz del dominio y darían 404. Esta tarea crea el único sitio donde se decide dónde vive un dato.

**Files:**
- Create: `src/data/rutas.ts`
- Create: `src/data/rutas.test.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `urlVersionado(rel: string): string` y `urlGenerado(rel: string): string`, las dos exportadas de `src/data/rutas.ts`. Reciben una ruta **relativa al raíz de datos, sin barra inicial** (`'piezas/x.glb'`, `'edificios/index.json'`) y devuelven la URL completa.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `src/data/rutas.test.ts`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { urlVersionado, urlGenerado } from './rutas'

afterEach(() => { vi.unstubAllEnvs() })

describe('urlVersionado', () => {
  it('cuelga del raíz de datos del propio sitio', () => {
    expect(urlVersionado('piezas/obelisco-italianos.glb')).toBe('/data/piezas/obelisco-italianos.glb')
  })

  it('respeta el subdirectorio bajo el que se sirve el sitio', () => {
    // Es el caso de GitHub Pages: el sitio no está en la raíz del dominio.
    vi.stubEnv('BASE_URL', '/tachira-3d/')
    expect(urlVersionado('piezas/obelisco-italianos.glb')).toBe('/tachira-3d/data/piezas/obelisco-italianos.glb')
  })

  it('no se va al bucket aunque VITE_DATOS esté puesto: lo versionado viaja con el sitio', () => {
    vi.stubEnv('VITE_DATOS', 'https://datos.ejemplo.org')
    expect(urlVersionado('piezas/x.glb')).toBe('/data/piezas/x.glb')
  })
})

describe('urlGenerado', () => {
  it('sin VITE_DATOS va junto al sitio, igual que lo versionado', () => {
    expect(urlGenerado('terrain.json')).toBe('/data/terrain.json')
  })

  it('con VITE_DATOS va al bucket', () => {
    vi.stubEnv('VITE_DATOS', 'https://datos.ejemplo.org')
    expect(urlGenerado('edificios/index.json')).toBe('https://datos.ejemplo.org/edificios/index.json')
  })

  it('una barra final de sobra en VITE_DATOS no duplica la barra', () => {
    vi.stubEnv('VITE_DATOS', 'https://datos.ejemplo.org/')
    expect(urlGenerado('terrain.bin')).toBe('https://datos.ejemplo.org/terrain.bin')
  })

  it('bajo subdirectorio y sin bucket, cuelga del subdirectorio', () => {
    vi.stubEnv('BASE_URL', '/tachira-3d/')
    expect(urlGenerado('dem/errores.json')).toBe('/tachira-3d/data/dem/errores.json')
  })
})
```

- [ ] **Step 2: Correr la prueba y ver que falla por el motivo correcto**

Run: `npx vitest run src/data/rutas.test.ts`
Expected: FAIL — no resuelve el módulo `./rutas`. Si falla por otra cosa, arreglar antes de seguir.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/data/rutas.ts`:

```ts
/**
 * Dónde vive cada dato del mapa. Es el único sitio que lo decide.
 *
 * Hay dos clases de dato y no siempre están en el mismo sitio:
 *
 *  - VERSIONADOS: pequeños, en git, se despliegan junto al sitio. Hoy
 *    `piezas/`. Viajan siempre con el código, para que un clon del repo
 *    los tenga sin bajar nada.
 *  - GENERADOS: los hornea el pipeline y no caben en git. Hoy también viajan
 *    junto al sitio; cuando pasen de lo que GitHub Pages admite, `VITE_DATOS`
 *    los manda a un bucket sin que ningún consumidor se entere.
 *
 * Las dos parten de `BASE_URL`, que Vite rellena desde `base` en
 * vite.config.ts y SIEMPRE termina en barra. Eso es lo que hace que el sitio
 * funcione bajo `/tachira-3d/`: una ruta absoluta como '/data/terrain.json'
 * se iría a la raíz del dominio y daría 404.
 *
 * Las dos leen el entorno EN CADA LLAMADA, no al importar el módulo: así una
 * prueba puede cambiarlo con vi.stubEnv.
 */

/** El raíz de datos del propio sitio. BASE_URL ya trae la barra final. */
const raizDelSitio = () => `${import.meta.env.BASE_URL}data`

/** Datos versionados en git: siempre junto al sitio. */
export function urlVersionado (rel: string): string {
  return `${raizDelSitio()}/${rel}`
}

/** Datos generados por el pipeline: junto al sitio, o donde diga VITE_DATOS. */
export function urlGenerado (rel: string): string {
  const externo = import.meta.env.VITE_DATOS
  return externo ? `${externo.replace(/\/$/, '')}/${rel}` : `${raizDelSitio()}/${rel}`
}
```

- [ ] **Step 4: Declarar VITE_DATOS para TypeScript**

`import.meta.env.VITE_DATOS` no existe en los tipos de `vite/client`. Crear `src/vite-env.d.ts` si no existe, o añadir a él:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Raíz de los datos generados por el pipeline cuando no viajan con el
   *  sitio. Sin definir, se sirven desde el propio sitio. La define la Action
   *  de despliegue; en local no se pone. */
  readonly VITE_DATOS?: string
}
```

Antes de crearlo, comprobar si ya existe: `ls src/vite-env.d.ts`. Si existe, añadir solo el bloque `interface ImportMetaEnv`.

- [ ] **Step 5: Correr la prueba y ver que pasa**

Run: `npx vitest run src/data/rutas.test.ts`
Expected: PASS, 7 pruebas.

- [ ] **Step 6: Enseñarle a Vite el subdirectorio**

Modificar `vite.config.ts` entero, que hoy son tres líneas:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` decide de qué ruta cuelga el sitio, y con él el BASE_URL que leen
// urlVersionado y urlGenerado (src/data/rutas.ts). En local es la raíz; la
// Action de despliegue pone BASE_PATH=/tachira-3d/ porque GitHub Pages sirve
// el repo bajo su propio nombre. Con dominio propio, BASE_PATH vuelve a '/'
// y no hay nada más que cambiar.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
```

- [ ] **Step 7: Verificar que el build bajo subdirectorio reescribe las rutas**

Run: `BASE_PATH=/tachira-3d/ npm run build && grep -o '/tachira-3d/assets/[^"]*' dist/index.html | head -2`
Expected: sale al menos una ruta que empieza por `/tachira-3d/assets/`. Después, `npm run build` a secas para dejar `dist/` como estaba.

- [ ] **Step 8: Verificación completa y commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: todo verde, con el aviso de tamaño de bundle que ya existía.

```bash
git add src/data/rutas.ts src/data/rutas.test.ts src/vite-env.d.ts vite.config.ts
git commit -m "feat: urlVersionado y urlGenerado, y el base de Vite por BASE_PATH

Un solo sitio decide dónde vive cada dato. Separa lo versionado en git, que
viaja con el sitio, de lo que hornea el pipeline, que podrá irse a un bucket
por VITE_DATOS sin tocar ningún consumidor. Las dos cuelgan de BASE_URL para
que el sitio funcione bajo el subdirectorio de GitHub Pages.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BF7KiZiJ8QPKqHQh1cS18Z"
```

---

### Task 2: Migrar las 18 rutas y cerrar la puerta

Ahora que existen las funciones, ningún archivo de `src/` puede volver a escribir `/data/` a mano. La prueba de esta tarea es la que lo impide para siempre.

**Files:**
- Modify: `src/data/buildings.ts:3-4`
- Modify: `src/data/load.ts:58-65`
- Modify: `src/data/piezas.ts` (los 6 campos `glb`)
- Modify: `src/data/piezas.test.ts:104,150`
- Modify: `src/scene/Piezas.tsx:107-111`
- Modify: `src/scene/demTiles.ts:33`
- Modify: `src/scene/TerrainLod.tsx:181`
- Modify: `src/data/rutas.test.ts` (se le añade la prueba de barrido)

**Interfaces:**
- Consumes: `urlVersionado`, `urlGenerado` de `src/data/rutas.ts`.
- Produces: `PIEZAS[].glb` pasa a ser **relativo al raíz de datos**: `'piezas/centro-civico.glb'`, sin barra inicial. Quien lo consuma tiene que resolverlo con `urlVersionado`. `BUILDINGS_BASE` y `BUILDINGS_INDEX` conservan su nombre y su forma (`BUILDINGS_BASE` termina en barra).

- [ ] **Step 1: Escribir la prueba de barrido, que falla**

Añadir al final de `src/data/rutas.test.ts`:

```ts
// @ts-ignore -- igual que buildings.test.ts: vitest corre en Node, la app solo
// tiene los tipos de vite/client. El repo no depende de @types/node.
import { readdirSync, readFileSync } from 'node:fs'
// @ts-ignore
import { join } from 'node:path'

it('ningún archivo de src/ escribe una ruta absoluta a los datos', () => {
  // La razón de existir de rutas.ts: una ruta '/data/…' funciona en local y
  // da 404 bajo el subdirectorio de GitHub Pages. Esta prueba es lo que
  // impide que reaparezca.
  const ofensores: string[] = []
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name)
      if (entrada.isDirectory()) { recorrer(ruta); continue }
      if (!/\.tsx?$/.test(entrada.name)) continue
      if (ruta.endsWith('rutas.test.ts')) continue          // este mismo archivo
      readFileSync(ruta, 'utf8').split('\n').forEach((linea, i) => {
        if (/['"`]\/data\//.test(linea)) ofensores.push(`${ruta}:${i + 1}`)
      })
    }
  }
  recorrer('src')
  expect(ofensores).toEqual([])
})
```

- [ ] **Step 2: Correr la prueba y ver que falla nombrando los 18 sitios**

Run: `npx vitest run src/data/rutas.test.ts`
Expected: FAIL, con una lista de unos 18 `archivo:línea`. Esa lista es la lista de trabajo de los pasos siguientes.

- [ ] **Step 3: Migrar `src/data/buildings.ts`**

Sustituir las líneas 3 y 4:

```ts
import { ORIGIN } from './constants'
import { urlGenerado } from './rutas'

export const BUILDINGS_BASE = urlGenerado('edificios/')
export const BUILDINGS_INDEX = `${BUILDINGS_BASE}index.json`
```

- [ ] **Step 4: Migrar `src/data/load.ts`**

Añadir el import y envolver las ocho rutas del `Promise.all`:

```ts
import { urlGenerado } from './rutas'
```

```ts
  const [terrain, roads, municipios, tBuf, pBuf, sBuf, iBuf, nBuf] = await Promise.all([
    json<TerrainMeta>(urlGenerado('terrain.json')),
    json<RoadsMeta>(urlGenerado('roads-meta.json')),
    json<Municipio[]>(urlGenerado('municipios.json')),
    bin(urlGenerado('terrain.bin')),
    bin(urlGenerado('roads-pos.bin')),
    bin(urlGenerado('roads-segid.bin')),
    bin(urlGenerado('roads-index.bin')),
    bin(urlGenerado('roads-nrm.bin')),
  ])
```

- [ ] **Step 5: Migrar `src/scene/demTiles.ts`**

El valor por defecto del constructor, línea 33:

```ts
  constructor (private readonly base = urlGenerado('dem'), private readonly max = 400) {}
```

con `import { urlGenerado } from '../data/rutas'` arriba. `this.base` se usa en la línea 46 como `` `${this.base}/${k}.png` ``, y `urlGenerado('dem')` no trae barra final, así que sigue saliendo bien.

- [ ] **Step 6: Migrar `src/scene/TerrainLod.tsx`**

Línea 181:

```ts
    fetch(urlGenerado('dem/errores.json')).then(r => r.json()).then(e => { errores.current = e })
```

con `import { urlGenerado } from '../data/rutas'` arriba.

- [ ] **Step 7: Hacer relativos los GLB de las piezas**

En `src/data/piezas.ts`, los seis campos `glb` pierden el prefijo `/data/`:

```ts
    glb: 'piezas/obelisco-italianos.glb',
    glb: 'piezas/obelisco-ovalo.glb',
    glb: 'piezas/viaducto-viejo.glb',
    glb: 'piezas/viaducto-nuevo.glb',
    glb: 'piezas/centro-civico.glb',
    glb: 'piezas/plaza-bolivar.glb',
```

Y el comentario del campo en la interfaz `Pieza` deja claro de qué es relativo:

```ts
  /** Ruta del GLB RELATIVA al raíz de datos, sin barra inicial. Quien la
   *  consuma la resuelve con urlVersionado (src/data/rutas.ts). */
  glb: string
```

- [ ] **Step 8: Resolver el GLB al cargarlo**

En `src/scene/Piezas.tsx`, añadir `import { urlVersionado } from '../data/rutas'` y sustituir el bloque de las líneas 107-111:

```ts
      // La pieza declara su GLB relativo al raíz de datos; acá se resuelve.
      // El segundo argumento de parseAsync es la carpeta desde la que el GLB
      // resolvería recursos externos, así que se deriva de la URL ya resuelta.
      const url = urlVersionado(def.glb)
      void fetch(url, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
        const buffer = await response.arrayBuffer()
        if (controller.signal.aborted) return
        const gltf = await loader.parseAsync(buffer, url.slice(0, url.lastIndexOf('/') + 1))
```

- [ ] **Step 9: Corregir las dos aserciones de `piezas.test.ts`**

Líneas 104 y 150:

```ts
  expect(pieza.glb).toBe('piezas/plaza-bolivar.glb')
```
```ts
  expect(pieza.glb).toBe('piezas/centro-civico.glb')
```

- [ ] **Step 10: Añadir una prueba que fija la forma relativa de todos los GLB**

En `src/data/piezas.test.ts`, junto a las otras pruebas del manifiesto:

```ts
test('todas las piezas declaran su GLB relativo al raíz de datos', () => {
  // Con barra inicial el GLB se iría a la raíz del dominio y daría 404 bajo
  // el subdirectorio de GitHub Pages.
  for (const pieza of PIEZAS) {
    expect(pieza.glb.startsWith('piezas/')).toBe(true)
    expect(pieza.glb.endsWith('.glb')).toBe(true)
  }
})
```

- [ ] **Step 11: Correr la prueba de barrido y ver que pasa**

Run: `npx vitest run src/data/rutas.test.ts src/data/piezas.test.ts`
Expected: PASS. Si la lista de ofensores sigue trayendo algo, migrarlo con `urlGenerado` si lo hornea el pipeline o con `urlVersionado` si está en git.

- [ ] **Step 12: Comprobar en el navegador que las piezas siguen apareciendo**

Run: `npm run dev`

Abrir `http://localhost:5173/` y, con el mapa cargado, en la consola:

```js
var recursoFibra = performance.getEntriesByType('resource')
  .find(r => new URL(r.name).pathname.endsWith('/@react-three_fiber.js'));
var { _roots } = await import(recursoFibra.name);
var visor = [..._roots.values()][0].store.getState();
visor.controls.target.set(-36506.55, 680, 28135.70);
visor.camera.position.set(-36380, 780, 28280);
visor.controls.update();
```

Expected: el Centro Cívico y la Plaza Bolívar aparecen apoyados, y la pestaña de red no muestra ningún 404.

- [ ] **Step 13: Verificación completa y commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`

```bash
git add src/data/buildings.ts src/data/load.ts src/data/piezas.ts src/data/piezas.test.ts \
        src/data/rutas.test.ts src/scene/Piezas.tsx src/scene/demTiles.ts src/scene/TerrainLod.tsx
git commit -m "refactor: las rutas de datos salen de rutas.ts, y una prueba impide que vuelvan

Las 18 rutas '/data/…' de src/ pasan por urlVersionado o urlGenerado. Los GLB
de las piezas quedan relativos al raíz de datos y Piezas.tsx los resuelve. Un
barrido de src/ falla si reaparece una ruta absoluta: con ella el sitio
funciona en local y da 404 bajo el subdirectorio de GitHub Pages.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BF7KiZiJ8QPKqHQh1cS18Z"
```

---

### Task 3: La imagen satelital, solo en vivo

Esri permite **usar** su servicio de teselas con atribución, no repartir copias. Hoy el repo hornea 217 teselas de los niveles z8 a z12 en `public/data/img/` y las sirve desde su propio origen; los niveles z13 a z17 ya se piden en vivo. Esta tarea borra el horneado: el mapa se ve igual, el sitio deja de copiar nada, y sin red queda la hipsometría del relieve.

**Files:**
- Modify: `src/scene/imagenTeselas.ts:20-38`
- Modify: `src/scene/imagenTeselas.test.ts`
- Delete: `scripts/bake-img.mjs`, `scripts/test/bake-img.test.mjs`, `public/data/img/`
- Modify: `package.json` (quitar el script `img`)
- Modify: `.gitignore` si menciona `img`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `urlImagen(z, x, y)` conserva su firma y pasa a devolver siempre una URL de Esri. **Desaparece la exportación `Z_HORNEADO`**; cualquier import de ella deja de compilar.

- [ ] **Step 1: Cambiar las pruebas a lo que se quiere, y verlas fallar**

Sustituir el primer `describe` de `src/scene/imagenTeselas.test.ts`, y añadir el import de `vi`:

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { urlImagen, ancestroCargado, CacheImagenes } from './imagenTeselas'

describe('urlImagen', () => {
  it('todos los niveles se piden en vivo a Esri, que pone la fila antes que la columna', () => {
    // No se reparte ninguna tesela: Esri permite usar el servicio, no copiarlo.
    expect(urlImagen(8, 76, 121)).toMatch(/World_Imagery\/MapServer\/tile\/8\/121\/76$/)
    expect(urlImagen(12, 1229, 1954)).toMatch(/World_Imagery\/MapServer\/tile\/12\/1954\/1229$/)
    expect(urlImagen(15, 9832, 15633)).toMatch(/World_Imagery\/MapServer\/tile\/15\/15633\/9832$/)
  })

  it('ninguna URL sale del propio sitio', () => {
    for (const z of [8, 10, 12, 15, 17]) {
      expect(urlImagen(z, 100, 200).startsWith('https://')).toBe(true)
    }
  })
})
```

En el mismo archivo, el `describe('ancestroCargado')` se queda **tal cual**: sus cuatro pruebas siguen siendo válidas, incluida la que ya dice que sin ninguna tesela cargada el nodo se queda con la hipsometría.

- [ ] **Step 2: Correr y ver que falla por el motivo correcto**

Run: `npx vitest run src/scene/imagenTeselas.test.ts`
Expected: FAIL — `urlImagen(8, …)` devuelve `/data/img/8/76/121.jpg`, y el import de `Z_HORNEADO` que ya no se usa puede dar aviso. El fallo tiene que ser el de la aserción, no un error de importación.

- [ ] **Step 3: Dejar `urlImagen` en vivo para todos los niveles**

En `src/scene/imagenTeselas.ts`, sustituir el bloque de comentario de cabecera que va de "De dónde sale cada nivel" hasta el final de `urlImagen`:

```ts
/**
 * La foto satelital que se cuelga de cada nodo del relieve. Un nodo del
 * quadtree ES una tesela (z, x, y) de Web Mercator, así que le toca la tesela
 * de imagen del MISMO z/x/y: no hay reproyección, ni bordes, ni un atlas.
 *
 * Todos los niveles se piden en vivo a Esri. No se guarda ni se reparte
 * ninguna tesela: sus condiciones permiten usar el servicio con atribución,
 * no redistribuir copias. La atribución está en pantalla (MapControls.tsx).
 *
 * Sin red, la petición falla y el nodo cae a la tesela viva más gruesa que ya
 * llegó (ancestroCargado). Si no llegó ninguna, el material apaga la imagen y
 * queda la hipsometría del relieve: nunca un hueco gris.
 */

// Nivel más fino que se pide. Esri sirve San Cristóbal hasta z18, pero z17 ya
// da 0,30 m por texel y es donde TerrainLod corta el quadtree.
export const Z_MAX_IMG = 17

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'

// Intentos antes de dar por perdida una tesela para el resto de la sesión.
const INTENTOS = 2

/** Esri sirve /tile/{z}/{fila}/{columna}: la y ANTES que la x, al revés que
 *  la ruta {z}/{x}/{y} de nuestras teselas. Invertirlo no da 404, da una
 *  tesela de otro sitio del planeta. */
export const urlImagen = (z: number, x: number, y: number): string =>
  `${ESRI}/${z}/${y}/${x}`
```

Comprobar que `Z_HORNEADO` no quede declarada ni importada en ningún sitio:

Run: `grep -rn "Z_HORNEADO" src scripts`
Expected: sin resultados.

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run src/scene/imagenTeselas.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir la prueba del camino sin red, y verla fallar**

Añadir al final de `src/scene/imagenTeselas.test.ts`:

```ts
afterEach(() => { vi.restoreAllMocks() })

describe('sin red', () => {
  it('una tesela que no llega no entra en la caché, y el nodo se queda sin imagen', async () => {
    // Es el camino que sustituye al horneado: antes, sin red, el nodo caía a
    // la tesela guardada en el repo. Ahora cae a la hipsometría, y eso tiene
    // que ser un camino normal, no una excepción sin atrapar.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }))
    const cache = new CacheImagenes()

    cache.pedir(12, 1229, 1954)
    await vi.waitFor(() => { expect(globalThis.fetch).toHaveBeenCalled() })

    expect(cache.tiene(12, 1229, 1954)).toBe(false)
    expect(cache.mejor({ z: 12, x: 1229, y: 1954 })).toBeNull()
  })
})
```

Run: `npx vitest run src/scene/imagenTeselas.test.ts`
Expected: PASS directamente si el camino ya era correcto, o FAIL si `pedir` deja la promesa sin atrapar. Si falla, arreglar `pedir` para que el `.catch` registre el fallo y suelte la clave de `enVuelo`, y volver a correr.

- [ ] **Step 6: Borrar el horneado**

```bash
git rm scripts/bake-img.mjs scripts/test/bake-img.test.mjs
rm -rf public/data/img .cache/img
```

`public/data/img/` no está en git (lo excluye `public/data/*`), por eso se borra con `rm` y no con `git rm`.

- [ ] **Step 7: Quitar el script de `package.json`**

Borrar la línea `"img": "node scripts/bake-img.mjs",` del bloque `scripts`.

- [ ] **Step 8: Comprobar que no quedan referencias**

Run: `grep -rn "bake-img\|data/img\|run img" src scripts docs package.json .gitignore`
Expected: solo apariciones dentro de `docs/` que describan el pasado. Si alguna doc afirma en presente que existe el horneado, corregirla en esta misma tarea.

- [ ] **Step 9: Comprobar en el navegador**

Run: `npm run dev`

Abrir `http://localhost:5173/` con la pestaña de red abierta, filtrando por `img`, y recargar con Ctrl+Shift+R.

Expected:
1. Ninguna petición a `/data/img`. Todas a `server.arcgisonline.com`.
2. La vista de estado se dibuja con imagen. Anotar cuánto tarda en verse completa, que es lo que antes salía del disco.
3. El botón de imagen la apaga y queda la hipsometría.

- [ ] **Step 10: Verificación completa y commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`

```bash
git add src/scene/imagenTeselas.ts src/scene/imagenTeselas.test.ts package.json
git commit -m "refactor: la imagen satelital se pide siempre en vivo, no se reparte

Esri permite usar su servicio de teselas con atribución, no redistribuir
copias. Las 217 teselas horneadas de z8 a z12 desaparecen con su script; los
niveles finos ya se pedían en vivo. El mapa se ve igual. Sin red, el nodo cae
a la tesela viva más gruesa y, si no hay ninguna, a la hipsometría: una prueba
fija ese camino con fetch fallando.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BF7KiZiJ8QPKqHQh1cS18Z"
```

---

### Task 4: Empaquetar los datos base

Los datos que hornea el pipeline pesan 59 MB comprimidos y no caben en git. Esta tarea los mete en un `tar.gz` con un archivo que dice de cuándo son.

**Files:**
- Create: `scripts/datos-empaquetar.mjs`
- Create: `scripts/test/datos-empaquetar.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: nada.
- Produces: de `scripts/datos-empaquetar.mjs` se exportan `CONTENIDO: string[]` (las rutas, relativas a `public/`, que entran en el paquete) y `versionDe(terrain, sha, fecha): { fecha, scripts, origen, bbox }`. El asset se llama siempre `datos-base.tar.gz`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `scripts/test/datos-empaquetar.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { CONTENIDO, versionDe } from '../datos-empaquetar.mjs'

describe('CONTENIDO', () => {
  it('nombra lo que entra, en vez de excluir lo que no', () => {
    // Una lista explícita es la garantía de que nada nuevo viaja por
    // descuido: piezas/ y capas/ van en git, e img/ ya no existe.
    expect(CONTENIDO).toContain('data/terrain.bin')
    expect(CONTENIDO).toContain('data/edificios')
    expect(CONTENIDO).toContain('data/VERSION')
  })

  it('deja fuera lo que ya viaja con el sitio', () => {
    expect(CONTENIDO).not.toContain('data/piezas')
    expect(CONTENIDO).not.toContain('data/capas')
    expect(CONTENIDO).not.toContain('data/img')
  })

  it('no repite ninguna entrada', () => {
    expect(new Set(CONTENIDO).size).toBe(CONTENIDO.length)
  })
})

describe('versionDe', () => {
  it('describe los datos que empaqueta, no el momento de empaquetarlos', () => {
    // origen y bbox salen de terrain.json, que es el dato real que viaja:
    // si alguien regenera con otro origen, el VERSION lo dice.
    const terrain = {
      origin: { lat: 8.021973, lon: -71.901563, h: 0 },
      bbox: { w: -72.5, e: -71.2, n: 8.7, s: 7.2 },
      width: 1024,
    }

    expect(versionDe(terrain, 'abc1234', '2026-09-11')).toEqual({
      fecha: '2026-09-11',
      scripts: 'abc1234',
      origen: { lat: 8.021973, lon: -71.901563, h: 0 },
      bbox: { w: -72.5, e: -71.2, n: 8.7, s: 7.2 },
    })
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run scripts/test/datos-empaquetar.test.mjs`
Expected: FAIL — no resuelve `../datos-empaquetar.mjs`.

- [ ] **Step 3: Escribir el script**

Crear `scripts/datos-empaquetar.mjs`:

```js
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/**
 * Empaqueta los datos que hornea el pipeline en un solo tar.gz, para
 * publicarlo como asset de un Release. Son 59 MB comprimidos: no caben en git
 * y el repo tiene que poder clonarse sin ellos.
 *
 * Lo que NO entra: public/data/piezas y public/data/capas viajan en git con
 * el sitio, así que meterlos acá los duplicaría.
 *
 * Uso: npm run datos:empaquetar
 * Después, crear a mano un Release con la etiqueta datos-AAAA-MM-DD y subir
 * datos-base.tar.gz como asset. Eso es lo que baja scripts/datos-bajar.mjs.
 *
 * ponytail: tar del sistema, no una librería. Viene con Windows 10+, macOS y
 * Linux. Si algún día hace falta empaquetar desde un entorno sin tar, entra
 * una dependencia; hoy sería una dependencia por nada.
 */

/** Lo que entra en el paquete, relativo a public/. Lista explícita y no
 *  exclusiones: lo que no está nombrado no viaja, y añadir una carpeta nueva
 *  al pipeline obliga a decidir acá si se reparte. */
export const CONTENIDO = [
  'data/VERSION',
  'data/dem',
  'data/edificios',
  'data/municipios.json',
  'data/terrain.bin',
  'data/terrain.json',
  'data/roads-approaches.json',
  'data/roads-index.bin',
  'data/roads-meta.json',
  'data/roads-nrm.bin',
  'data/roads-pos.bin',
  'data/roads-segid.bin',
  'data/roads-structures.json',
]

export const ASSET = 'datos-base.tar.gz'

/** El sello del paquete. origen y bbox salen de terrain.json porque describen
 *  los datos que de verdad viajan, no una constante que podría haberse
 *  movido después de hornear. */
export function versionDe (terrain, sha, fecha) {
  return { fecha, scripts: sha, origen: terrain.origin, bbox: terrain.bbox }
}

async function main () {
  for (const rel of CONTENIDO) {
    if (rel === 'data/VERSION') continue          // lo escribe este script
    if (!existsSync(`public/${rel}`)) {
      throw new Error(`falta public/${rel}: corre el pipeline antes de empaquetar`)
    }
  }

  const terrain = JSON.parse(await readFile('public/data/terrain.json', 'utf8'))
  const sha = execFileSync('git', ['rev-parse', 'HEAD:scripts'], { encoding: 'utf8' }).trim()
  const fecha = new Date().toISOString().slice(0, 10)
  const version = versionDe(terrain, sha, fecha)
  await writeFile('public/data/VERSION', JSON.stringify(version, null, 2) + '\n')

  execFileSync('tar', ['-czf', ASSET, '-C', 'public', ...CONTENIDO], { stdio: 'inherit' })

  const bytes = readFileSync(ASSET)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  console.log(`\n${ASSET}  ${(bytes.length / 1e6).toFixed(1)} MB`)
  console.log(`sha256  ${sha256}`)
  console.log(`\nCrea el Release con la etiqueta  datos-${fecha}  y sube ese archivo como asset:`)
  console.log(`  gh release create datos-${fecha} ${ASSET} --title "Datos base ${fecha}" --notes "sha256 ${sha256}"`)
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}`) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
```

- [ ] **Step 4: Correr la prueba y ver que pasa**

Run: `npx vitest run scripts/test/datos-empaquetar.test.mjs`
Expected: PASS, 4 pruebas.

- [ ] **Step 5: Añadir el script a `package.json`**

En el bloque `scripts`, junto a los que ya están:

```json
    "datos:empaquetar": "node scripts/datos-empaquetar.mjs",
```

- [ ] **Step 6: Correrlo de verdad**

Run: `npm run datos:empaquetar`
Expected: imprime el tamaño, un sha256 y la línea de `gh release create`. El tamaño debería rondar los 59 MB. Comprobar que `datos-base.tar.gz` existe y que `public/data/VERSION` trae los cuatro campos:

Run: `cat public/data/VERSION && tar -tzf datos-base.tar.gz | head -5 && tar -tzf datos-base.tar.gz | grep -c "^data/piezas" || echo "piezas fuera del paquete, correcto"`

- [ ] **Step 7: Que el tar.gz no se cuele en git**

Añadir a `.gitignore`:

```
datos-base.tar.gz
```

Run: `git status --short | grep datos-base`
Expected: sin resultados.

- [ ] **Step 8: Verificación completa y commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`

```bash
git add scripts/datos-empaquetar.mjs scripts/test/datos-empaquetar.test.mjs package.json .gitignore
git commit -m "feat: npm run datos:empaquetar arma el tar.gz de los datos base

59 MB comprimidos que no caben en git y van como asset de un Release. La lista
de contenido es explícita y no por exclusiones: lo que no está nombrado no
viaja, y piezas/ queda fuera porque ya va en git. Escribe un VERSION con la
fecha, el sha de scripts/ y el origen y bbox leídos de terrain.json.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BF7KiZiJ8QPKqHQh1cS18Z"
```

---

### Task 5: Bajar los datos base

El otro extremo: quien clone el repo corre un comando y tiene los datos.

**Files:**
- Create: `scripts/datos-bajar.mjs`
- Create: `scripts/test/datos-bajar.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ASSET` de `scripts/datos-empaquetar.mjs`.
- Produces: `elegirRelease(releases, pedida)` y `assetDe(release)`, exportadas de `scripts/datos-bajar.mjs`.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `scripts/test/datos-bajar.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { elegirRelease, assetDe } from '../datos-bajar.mjs'

const rel = (tag, assets = ['datos-base.tar.gz']) => ({
  tag_name: tag,
  assets: assets.map(name => ({ name, browser_download_url: `https://ejemplo/${tag}/${name}`, size: 1 })),
})

describe('elegirRelease', () => {
  it('toma la etiqueta de datos más reciente, sin fiarse del orden en que vengan', () => {
    const releases = [rel('datos-2026-08-01'), rel('datos-2026-09-11'), rel('datos-2026-09-02')]
    expect(elegirRelease(releases).tag_name).toBe('datos-2026-09-11')
  })

  it('ignora las etiquetas que no son de datos', () => {
    // El repo tendrá Releases de versión del visor, que no traen datos.
    const releases = [rel('v2.0.0'), rel('datos-2026-09-11'), rel('estable')]
    expect(elegirRelease(releases).tag_name).toBe('datos-2026-09-11')
  })

  it('una etiqueta pedida a mano manda sobre la más reciente', () => {
    const releases = [rel('datos-2026-09-11'), rel('datos-2026-08-01')]
    expect(elegirRelease(releases, 'datos-2026-08-01').tag_name).toBe('datos-2026-08-01')
  })

  it('si la etiqueta pedida no existe, lo dice con su nombre', () => {
    expect(() => elegirRelease([rel('datos-2026-09-11')], 'datos-2020-01-01'))
      .toThrow(/datos-2020-01-01/)
  })

  it('sin ningún Release de datos, lo dice en vez de bajar cualquier cosa', () => {
    expect(() => elegirRelease([rel('v2.0.0')])).toThrow(/datos-/)
  })
})

describe('assetDe', () => {
  it('encuentra el paquete por su nombre', () => {
    expect(assetDe(rel('datos-2026-09-11')).name).toBe('datos-base.tar.gz')
  })

  it('un Release sin el paquete se denuncia nombrando la etiqueta', () => {
    expect(() => assetDe(rel('datos-2026-09-11', ['otra-cosa.zip'])))
      .toThrow(/datos-2026-09-11/)
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run scripts/test/datos-bajar.test.mjs`
Expected: FAIL — no resuelve `../datos-bajar.mjs`.

- [ ] **Step 3: Escribir el script**

Crear `scripts/datos-bajar.mjs`:

```js
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { ASSET } from './datos-empaquetar.mjs'

/**
 * Baja los datos base del último Release y los desempaca en public/.
 * Es el segundo de los tres comandos que abren el README:
 *   npm ci  ·  npm run datos:bajar  ·  npm run dev
 *
 * Con TACHIRA_DATOS_TAG se fija una etiqueta concreta, que es lo que hay que
 * hacer para reproducir un estado viejo del mapa.
 *
 * ponytail: la API pública sin token admite 60 peticiones por hora por IP.
 * Acá se gasta una. Si CI llegara a toparse, se le pasa el GITHUB_TOKEN que
 * la Action ya tiene.
 */

const REPO = 'sssamuelll/tachira-3d'
const CACHE = '.cache/datos'
const ETIQUETA_DATOS = /^datos-\d{4}-\d{2}-\d{2}$/

/** El Release del que bajar: el pedido a mano, o el de datos más reciente.
 *  Las etiquetas son datos-AAAA-MM-DD, así que ordenan bien como texto. */
export function elegirRelease (releases, pedida) {
  if (pedida) {
    const encontrado = releases.find(r => r.tag_name === pedida)
    if (!encontrado) throw new Error(`no hay ningún Release con la etiqueta ${pedida}`)
    return encontrado
  }
  const datos = releases.filter(r => ETIQUETA_DATOS.test(r.tag_name))
  if (!datos.length) throw new Error(`${REPO} no tiene ningún Release con etiqueta datos-AAAA-MM-DD`)
  return datos.sort((a, b) => b.tag_name.localeCompare(a.tag_name))[0]
}

/** El asset del paquete dentro de un Release. */
export function assetDe (release) {
  const asset = (release.assets ?? []).find(a => a.name === ASSET)
  if (!asset) throw new Error(`el Release ${release.tag_name} no trae ${ASSET}`)
  return asset
}

async function main () {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`la API de GitHub contestó HTTP ${res.status}`)

  const release = elegirRelease(await res.json(), process.env.TACHIRA_DATOS_TAG)
  const asset = assetDe(release)
  const local = `${CACHE}/${release.tag_name}.tar.gz`

  if (existsSync(local)) {
    console.log(`${release.tag_name} ya estaba en ${CACHE}`)
  } else {
    console.log(`bajando ${release.tag_name}  (${(asset.size / 1e6).toFixed(1)} MB)`)
    await mkdir(CACHE, { recursive: true })
    const paquete = await fetch(asset.browser_download_url)
    if (!paquete.ok) throw new Error(`el asset contestó HTTP ${paquete.status}`)
    await writeFile(local, Buffer.from(await paquete.arrayBuffer()))
  }

  await mkdir('public', { recursive: true })
  execFileSync('tar', ['-xzf', local, '-C', 'public'], { stdio: 'inherit' })
  console.log(`\ndesempacado. public/data/VERSION:`)
  console.log(readFileSync('public/data/VERSION', 'utf8'))
}

if (import.meta.url === `file://${process.argv[1].replaceAll('\\', '/')}`) {
  main().catch(e => { console.error(e.message); process.exit(1) })
}
```

- [ ] **Step 4: Correr la prueba y ver que pasa**

Run: `npx vitest run scripts/test/datos-bajar.test.mjs`
Expected: PASS, 7 pruebas.

- [ ] **Step 5: Añadir el script a `package.json`**

```json
    "datos:bajar": "node scripts/datos-bajar.mjs",
```

- [ ] **Step 6: Verificación completa y commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`

No se puede probar `npm run datos:bajar` de verdad todavía: el repo es privado y no hay ningún Release. Queda comprobado en la sección de cierre, después de que Samuel cree el primero.

```bash
git add scripts/datos-bajar.mjs scripts/test/datos-bajar.test.mjs package.json
git commit -m "feat: npm run datos:bajar trae los datos base del último Release

Elige la etiqueta datos-AAAA-MM-DD más reciente, o la que diga
TACHIRA_DATOS_TAG para reproducir un estado viejo, guarda el paquete en
.cache/datos para no volver a bajarlo y lo desempaca en public/.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BF7KiZiJ8QPKqHQh1cS18Z"
```

---

### Task 6: La Action

Que ningún pull request rojo se pueda fundir, y que `master` se despliegue solo.

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: `npm run datos:bajar` de la Task 5, `BASE_PATH` de la Task 1.
- Produces: nada que consuma código.

- [ ] **Step 1: Escribir el workflow**

Crear `.github/workflows/pages.yml`:

```yaml
# Verifica cada pull request y despliega master a GitHub Pages.
#
# datos:bajar va ANTES que los tests a propósito: buildings.test.ts,
# piezas.test.ts y Buildings.test.ts leen chunks reales de
# public/data/edificios/, que no están en git.
name: pages

on:
  pull_request:
  push:
    branches: [master]

permissions:
  contents: read
  pages: write
  id-token: write

# Un despliegue a la vez. Sin cancelar el que esté en curso: dejar el sitio a
# medias es peor que esperar.
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  verificar:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - name: Bajar los datos base
        run: npm run datos:bajar
      - name: Pruebas
        run: npx vitest run
      - name: Tipos
        run: npx tsc --noEmit
      - name: Build
        run: npm run build
        env:
          BASE_PATH: /tachira-3d/
      - uses: actions/upload-pages-artifact@v3
        if: github.event_name == 'push'
        with:
          path: dist

  desplegar:
    if: github.event_name == 'push'
    needs: verificar
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.despliegue.outputs.page_url }}
    steps:
      - id: despliegue
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Comprobar que el YAML es válido**

Run: `node -e "const {readFileSync}=require('fs');const t=readFileSync('.github/workflows/pages.yml','utf8');if(t.includes('\t'))throw new Error('YAML con tabulaciones');console.log('sin tabulaciones,',t.split('\n').length,'líneas')"`
Expected: imprime el número de líneas. Un tabulador en YAML es un error de sintaxis.

- [ ] **Step 3: Ensayar en local lo mismo que hará la Action**

Run: `npm ci && npx vitest run && npx tsc --noEmit && BASE_PATH=/tachira-3d/ npm run build`
Expected: todo verde. `npm run datos:bajar` se salta porque los datos ya están en local.

Después, `npm run build` a secas para dejar `dist/` sin el prefijo.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci: verificar cada PR y desplegar master a GitHub Pages

Pruebas, tipos y build en todo pull request; con push a master, además
despliega. datos:bajar va antes de vitest porque las pruebas de edificios y
piezas leen chunks reales que no están en git.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BF7KiZiJ8QPKqHQh1cS18Z"
```

---

### Task 7: Licencias y atribución

Los datos derivan de OpenStreetMap y ODbL exige atribución. Hoy el mapa no la muestra: la única línea en pantalla es la de Esri, y solo cuando la imagen está prendida.

**Files:**
- Create: `LICENSE`, `LICENSE-DATOS.md`
- Modify: `src/ui/MapControls.tsx` (`Atribucion`)
- Modify: `src/App.tsx:532`
- Create: `src/ui/atribucion.test.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `Atribucion` cambia de firma. Pasa de `{ visible: boolean }` a `{ imagen: boolean }`: ya no se oculta entera, solo la línea de Esri depende de si la imagen está prendida.

- [ ] **Step 1: Escribir la prueba que falla**

Crear `src/ui/atribucion.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Atribucion } from './MapControls'

// ODbL exige atribuir a OpenStreetMap siempre que se muestren sus datos, y
// las vías, los edificios y los municipios se ven con la imagen apagada. La
// atribución de Esri es distinta: solo aplica cuando su imagen está en
// pantalla.

describe('Atribucion', () => {
  it('nombra a OpenStreetMap y su licencia aunque la imagen esté apagada', () => {
    const html = renderToStaticMarkup(<Atribucion imagen={false} />)

    expect(html).toContain('OpenStreetMap')
    expect(html).toContain('ODbL')
  })

  it('nombra el terreno, que no es de OSM', () => {
    expect(renderToStaticMarkup(<Atribucion imagen={false} />)).toContain('Terrarium')
  })

  it('con la imagen apagada no atribuye a Esri, porque no se está usando', () => {
    expect(renderToStaticMarkup(<Atribucion imagen={false} />)).not.toContain('Esri')
  })

  it('con la imagen prendida, añade a Esri sin quitar lo demás', () => {
    const html = renderToStaticMarkup(<Atribucion imagen />)

    expect(html).toContain('Esri')
    expect(html).toContain('OpenStreetMap')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run src/ui/atribucion.test.tsx`
Expected: FAIL — con `imagen={false}` el componente devuelve `null` y el HTML sale vacío, así que no contiene `OpenStreetMap`.

Si falla por no encontrar `react-dom/server`, comprobar `ls node_modules/react-dom/server.js`; `react-dom` ya es dependencia del proyecto.

- [ ] **Step 3: Cambiar el componente**

En `src/ui/MapControls.tsx`, sustituir `Atribucion` entera:

```tsx
/** Los créditos de las fuentes de datos, abajo y al centro.
 *
 * La línea de OSM es PERMANENTE: ODbL exige atribuir siempre que se muestren
 * sus datos, y las vías, los edificios y los municipios se ven con la imagen
 * apagada. La de Esri solo aparece cuando su imagen está en pantalla, que es
 * cuando aplica. */
export function Atribucion ({ imagen }: { imagen: boolean }) {
  return (
    <div style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 12, zIndex: 20,
      fontFamily: T.fuente, fontSize: 11, lineHeight: 1.3, color: T.texto2,
      background: 'rgba(255,255,255,.72)', borderRadius: 4, padding: '3px 8px',
      pointerEvents: 'none', userSelect: 'none', whiteSpace: 'nowrap',
      maxWidth: '60vw', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      © colaboradores de OpenStreetMap (ODbL) · Terreno: Terrarium / AWS Open Data
      {imagen && ' · Imagen: Esri, Maxar, Earthstar Geographics y la comunidad de usuarios de GIS'}
    </div>
  )
}
```

- [ ] **Step 4: Cambiar quien lo usa**

En `src/App.tsx`, línea 532:

```tsx
      <Atribucion imagen={imagen} />
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npx vitest run src/ui/atribucion.test.tsx`
Expected: PASS, 4 pruebas.

- [ ] **Step 6: Escribir `LICENSE`**

Crear `LICENSE` con este texto, que es el canónico de MIT. No reescribirlo ni resumirlo:

```text
MIT License

Copyright (c) 2026 Samuel Ballesteros

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Si el titular no es ese nombre, Samuel lo corrige; el resto del texto no se toca.

- [ ] **Step 7: Escribir `LICENSE-DATOS.md`**

Crear `LICENSE-DATOS.md`:

```markdown
# Licencia de los datos

El código de este repositorio va bajo [MIT](LICENSE). Los datos no: casi todos
derivan de OpenStreetMap, y ODbL se hereda.

## Datos derivados de OpenStreetMap — ODbL 1.0

Vías, edificios, municipios, las capas y todo lo que la comunidad aporte al
mapa, tanto en `public/data/` como lo que produzcan los scripts de `scripts/`.

Licencia: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

Atribución obligatoria al reutilizarlos:

> © colaboradores de OpenStreetMap

Las contribuciones de la comunidad a este mapa van bajo ODbL a propósito: es
lo que deja abierta la puerta a subirlas a OpenStreetMap el día que se pueda.

## Relieve — Terrarium

El modelo de elevación sale de las teselas Terrarium de
[AWS Open Data](https://registry.opendata.aws/terrain-tiles/), que combinan
SRTM, GMTED2010 y otras fuentes públicas. Sus términos y la lista completa de
fuentes están en ese registro.

## Piezas 3D — CC BY 4.0

Los modelos de `public/data/piezas/` están generados para este proyecto, no
levantados en campo. Cada uno documenta en `docs/` qué parte suya está medida
y qué parte es estimada.

Licencia: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Imagen satelital — ni se guarda ni se reparte

La imagen de fondo es Esri World Imagery y se pide en vivo al servidor de
Esri cuando el mapa la muestra. Este repositorio **no contiene ni distribuye
ninguna tesela de imagen**, y no hay ningún dato derivado de ella por medios
automáticos.
```

- [ ] **Step 8: Comprobar en el navegador**

Run: `npm run dev`

Abrir `http://localhost:5173/` y apagar la imagen con el botón de los controles.
Expected: la línea de abajo sigue visible, dice OpenStreetMap y ODbL, y ya no menciona a Esri. Al prenderla otra vez, Esri vuelve a aparecer al final de la misma línea. A 400 px de ancho la línea se recorta con puntos suspensivos y no rompe el diseño.

- [ ] **Step 9: Verificación completa y commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`

```bash
git add LICENSE LICENSE-DATOS.md src/ui/MapControls.tsx src/ui/atribucion.test.tsx src/App.tsx
git commit -m "feat: licencias y la atribución de OSM que ODbL exige

El código va MIT; los datos derivados de OSM, ODbL, que se hereda a las capas
y a lo que aporte la comunidad. Las piezas 3D, CC BY 4.0.

La atribución en pantalla deja de depender de que la imagen esté prendida: las
vías, los edificios y los municipios se ven con la imagen apagada y son datos
de OSM. La línea de Esri es la que ahora aparece solo cuando aplica.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BF7KiZiJ8QPKqHQh1cS18Z"
```

---

### Task 8: README, CONTRIBUTING y los metadatos del paquete

Lo primero que ve quien llegue al repo.

**Files:**
- Create: `README.md`, `CONTRIBUTING.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: los nombres de script de las Tasks 4 y 5.
- Produces: nada que consuma código.

- [ ] **Step 1: Arreglar los metadatos de `package.json`**

Cambiar la cabecera del archivo, dejando `scripts` y las dependencias como están:

```json
{
  "name": "tachira-3d",
  "version": "1.0.0",
  "description": "Visor 3D del estado Táchira sobre el terreno real: vialidad, edificaciones y piezas generadas, hecho para que la comunidad lo mantenga.",
  "license": "MIT",
  "repository": { "type": "git", "url": "https://github.com/sssamuelll/tachira-3d.git" },
  "engines": { "node": ">=24" },
  "type": "module",
  "private": "true",
```

Borrar `"main": "index.js"`, que apunta a un archivo que no existe. `directories.doc` y `keywords` se pueden dejar. `private` se queda: el paquete no se publica en npm.

- [ ] **Step 2: Comprobar que el paquete sigue siendo válido**

Run: `node -e "const p=require('./package.json');console.log(p.name,p.license,p.engines.node);console.log(Object.keys(p.scripts).join(' '))"`
Expected: imprime `tachira-3d MIT >=24` y la lista de scripts, con `datos:empaquetar` y `datos:bajar` dentro y sin `img`.

- [ ] **Step 3: Escribir `README.md`**

Crear `README.md`:

````markdown
# Táchira 3D

Un mapa 3D del estado Táchira sobre el terreno real: la vialidad, las
edificaciones y algunas piezas modeladas una a una.

No es un mapa terminado. Es un mapa que la comunidad va llenando, capa a capa,
porque de Venezuela hay poco levantado y lo que hay está repartido.

**Mapa:** https://sssamuelll.github.io/tachira-3d/

## Correrlo

```bash
git clone https://github.com/sssamuelll/tachira-3d
cd tachira-3d
npm ci
npm run datos:bajar     # ~59 MB de datos base, del último Release
npm run dev
```

`npm run datos:bajar` hace falta porque los datos que hornea el pipeline no
caben en git. Van como asset de un Release y el script trae el más reciente.

## Qué hay dentro

El terreno se dibuja con un quadtree sobre teselas de elevación, con nivel de
detalle por distancia, y encima va la imagen satelital, que se pide en vivo y
nunca se guarda. Las vías son geometría fusionada con su calzada extruida en
metros reales, con los puentes a su cota y sus empalmes tallados en el
terreno. Las edificaciones se hornean en teselas y se cargan según la cámara.
Las piezas son modelos generados en Blender que se apoyan solos sobre el
relieve.

Todo dato del mapa separa **lo medido de lo estimado**, y lo dice. La altura
de un edificio sin `building:levels` en OpenStreetMap es una estimación a
partir de su huella y su entorno, y el repo lo declara en vez de disimularlo.

- [Piezas 3D](docs/piezas-3d.md) · [Centro Cívico](docs/centro-civico.md) · [Plaza Bolívar](docs/plaza-bolivar.md)
- [Edificaciones](docs/edificaciones-tachira.md) · [Cota de los puentes](docs/cota-puentes.md) · [Empalmes](docs/empalmes-puentes.md)
- [Especificaciones y planes](docs/superpowers/)

## Hecho con

React 19, three.js y React Three Fiber sobre Vite 8; TypeScript; Vitest.
Los datos salen de OpenStreetMap por Overpass, el relieve de las teselas
Terrarium de AWS Open Data, y las piezas de scripts de Blender.

## Contribuir

Hace falta. Lee [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencias

El código va [MIT](LICENSE). Los datos, no: casi todos derivan de
OpenStreetMap y heredan ODbL. Está todo en [LICENSE-DATOS.md](LICENSE-DATOS.md).

© colaboradores de OpenStreetMap
````

- [ ] **Step 4: Escribir `CONTRIBUTING.md`**

Crear `CONTRIBUTING.md`:

````markdown
# Contribuir

Este mapa se llena entre varios. Cualquier aporte sirve: un hospital que falta,
una vía mal trazada, un edificio que no existe, una corrección de un dato que
está mal.

## Antes de mandar nada

```bash
npm ci
npm run datos:bajar
npx vitest run      # las pruebas
npx tsc --noEmit    # los tipos
npm run build       # el build
```

Los tres tienen que quedar verdes. La Action los corre en cada pull request y
uno rojo no se puede fundir.

El build avisa de que un trozo del bundle pasa de 500 kB. Ese aviso ya estaba
antes y no es tu culpa. No subas el umbral para taparlo.

## La regla que no se negocia

**Lo medido y lo estimado van separados, y se dice cuál es cuál.**

Este mapa mezcla datos reales con geometría inventada, porque de otra forma no
habría mapa. Lo que no se vale es que no se note la diferencia. Si añades algo
estimado, escribe de dónde salió y qué parte te inventaste. Todos los
documentos de `docs/` están hechos así; míralos antes de escribir el tuyo.

## Añadir una pieza 3D

Un monumento, una plaza, un edificio que merezca estar modelado a mano.
El camino completo está en [docs/piezas-3d.md](docs/piezas-3d.md), y el
Centro Cívico es el ejemplo más reciente:
[docs/centro-civico.md](docs/centro-civico.md).

En resumen: un script de Blender que genera el GLB a partir de un JSON de
medidas, el GLB sellado con su procedencia, una entrada en `src/data/piezas.ts`
y un documento que separa lo medido de lo estimado.

## Regenerar los datos base

Solo hace falta si cambias el pipeline.

```bash
npm run data          # vías, terreno, municipios (baja de Overpass, tarda)
npm run edificios     # hornea las edificaciones en teselas
npm run verify        # comprueba lo generado
npm run datos:empaquetar
```

`datos:empaquetar` deja un `datos-base.tar.gz` y te imprime el comando para
crear el Release. Publicarlo lo hace quien mantiene el repo.

## Mandar el cambio

- **Un pull request por cosa.** Una capa nueva y un arreglo de un bug son dos.
- **Di de dónde sacaste el dato.** Si es de OpenStreetMap, el id. Si lo sabes
  porque vives ahí, dilo también: eso vale, y vale más si está escrito.
- **Si rompes una prueba, arréglala de verdad.** Cambiar lo que la prueba
  espera para que pase es peor que dejarla roja.
- Los comentarios y los mensajes de commit van en español, como el resto.

## Reportar sin escribir código

Abre un [issue](https://github.com/sssamuelll/tachira-3d/issues) diciendo qué
está mal y dónde, con coordenadas o con un enlace al mapa si puedes. Eso ya es
una contribución.

## Trato

Este proyecto lo mantiene gente en su tiempo libre, y lo usa gente que no
programa. Se responde con paciencia y se pregunta sin pena. No se le falta el
respeto a nadie por lo que no sabe, ni por de dónde es, ni por cómo piensa. A
quien venga a joder se le saca y ya.
````

- [ ] **Step 5: Comprobar que los enlaces del README apuntan a algo**

Run: `for f in docs/piezas-3d.md docs/centro-civico.md docs/plaza-bolivar.md docs/edificaciones-tachira.md docs/cota-puentes.md docs/empalmes-puentes.md CONTRIBUTING.md LICENSE LICENSE-DATOS.md docs/superpowers; do [ -e "$f" ] && echo "ok   $f" || echo "ROTO $f"; done`
Expected: todo `ok`.

- [ ] **Step 6: Verificación completa y commit**

Run: `npx vitest run && npx tsc --noEmit && npm run build`

```bash
git add README.md CONTRIBUTING.md package.json
git commit -m "docs: README y CONTRIBUTING para abrir el repo

Los tres comandos que lo ponen a correr, qué hay dentro, y las reglas: pruebas
verdes, medido y estimado separados y escritos, un PR por cosa. package.json
gana nombre, descripción, licencia, repositorio y engines, y pierde el main
que apuntaba a un archivo inexistente.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BF7KiZiJ8QPKqHQh1cS18Z"
```

---

## Cierre: lo que hace Samuel a mano

Estos pasos necesitan su cuenta y no los puede dar un agente. Van en este
orden y después de que las ocho tareas estén verdes.

- [ ] **1. Decidir qué pasa con lo que está sin commit.** `package.json` y
  `package-lock.json` traen cambios de antes de esta tanda, y
  `src/data/puentes.ts` con su prueba están sin trackear. Nada de eso es de
  este trabajo. Commitearlo, descartarlo o dejarlo, pero decidirlo antes de
  fundir.

- [ ] **2. Fundir en `master`.** `master` está 120 commits atrás y no tiene
  nada por delante, así que entra en fast-forward:

  ```bash
  git checkout master && git merge --ff-only feat/vialidad-3d && git push origin master
  ```

- [ ] **3. Poner el repo público.** En Settings, General, Danger Zone.

- [ ] **4. Activar Pages.** Settings, Pages, Source: **GitHub Actions**.

- [ ] **4b. Exigir las comprobaciones antes de fundir.** Settings, Branches,
  regla para `master`: *Require status checks to pass before merging*, y marcar
  `verificar`. **Sin esto GitHub no impide fundir un pull request en rojo**, por
  mucho que la Action lo marque. Lo levantó la revisión final: `CONTRIBUTING.md`
  prometía ese bloqueo y hubo que corregir el texto hasta que exista la regla.

- [ ] **5. Crear el primer Release de datos.**

  ```bash
  npm run datos:empaquetar
  ```

  y correr el comando `gh release create` que imprime.

- [ ] **6. Comprobar que el círculo cierra.** En una carpeta distinta:

  ```bash
  git clone https://github.com/sssamuelll/tachira-3d prueba-limpia
  cd prueba-limpia && npm ci && npm run datos:bajar && npm run dev
  ```

  Que el mapa se vea. Eso es el criterio de hecho de toda la tanda.

- [ ] **7. Abrir `https://sssamuelll.github.io/tachira-3d/`** con la pestaña de
  red abierta. Que no haya ningún 404, que las piezas aparezcan y que la línea
  de atribución esté abajo.

- [ ] **8. Escribir `docs/publicacion.md`** con lo que se midió: cuánto tarda
  la vista de estado ahora que las teselas gruesas vienen de Esri, cuánto tarda
  la Action, y el sha256 del primer Release.

## Riesgos

- **`npm run datos:bajar` en CI puede toparse con el límite de la API de
  GitHub**, que sin token son 60 peticiones por hora y por IP. Los corredores
  de Actions comparten IP. Si aparece un HTTP 403, pasarle el `GITHUB_TOKEN`
  que la Action ya tiene en la cabecera `Authorization`.
- **59 MB bajados en cada corrida de CI.** Si tarda de más, cachear
  `.cache/datos` con `actions/cache` usando la etiqueta del Release como clave.
  Medirlo antes de añadirlo.
- **La vista de estado ahora pide 217 teselas por red al arrancar.** Si se ve
  lenta, el arreglo es pedir los niveles gruesos antes que los finos, no volver
  a hornear.
- **`vi.stubEnv` sobre `import.meta.env`** funciona porque `rutas.ts` lee el
  entorno dentro de las funciones. Si alguien lo saca a una constante de
  módulo, las pruebas de la Task 1 dejan de significar nada.

## Comprobado antes de escribir este plan

Para que nadie pierda tiempo averiguándolo otra vez:

```
vi.stubEnv('BASE_URL', '/tachira-3d/')   funciona; import.meta.env es un objeto en vitest
Response global                          existe en Node 24, sirve para simular el fallo de Esri
CacheImagenes                            se exporta (imagenTeselas.ts:73)
scripts/test/*.test.mjs                  vitest los recoge sin configurar nada
BASE_PATH=/tachira-3d/ npm run build     reescribe las rutas de dist/index.html
Esri sirve z8, z10 y z12 en vivo          HTTP 200 en ~110 ms cada una
```
