# Límites vectoriales y tema conmutable — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los límites municipales pasan de un efecto de borde en el shader del relieve a una línea vectorial drapeada de ancho constante en pantalla, y `theme.ts` pasa de literales a variables CSS con paleta clara, oscura e interruptor.

**Architecture:** Las aristas de los 29 anillos municipales se deduplican (el 62 % son compartidas entre dos municipios), se subdividen y se apoyan contra el DEM en el pipeline —igual que las vías, y con las mismas funciones— y se empaquetan en `limites-pos.bin`. En el navegador un `LineSegments2` con `LineMaterial({ worldUnits: false })` las dibuja con el ancho en píxeles. El camino viejo (la textura de 2048², tres uniformes y `indiceMunicipios`) se borra entero. Aparte, `theme.ts` deja de exportar literales y exporta `var(--token)`, con las dos paletas declaradas en un `<style>` y el tema en `document.documentElement.dataset.tema`.

**Tech Stack:** TypeScript, React 19, react-three-fiber, three.js (`LineSegments2`/`LineSegmentsGeometry`/`LineMaterial` de `three/examples/jsm/lines`), Vite, Vitest, Playwright, Node ESM para el pipeline.

**Spec:** `docs/superpowers/specs/2026-09-14-limites-vectoriales-y-tema-design.md`

## Global Constraints

- **El dato nunca cambia de color con el tema.** La rampa del PCI (`PCI_RANGES`), la hipsometría, el color de cada capa (`#e0453a` de hospitales) y el color de las vías por nivel se quedan como están. `css3()` no se toca.
- **Todo comentario y nombre va en español**, como el resto del repo. Los mensajes de commit también.
- **TDD**: test en rojo antes de la implementación, en cada tarea que tenga lógica.
- **Ningún número medido se escribe de memoria**: si un comentario afirma una cifra, sale de una corrida real pegada en el informe de la tarea.
- La suite completa es `npx vitest run` (836 tests hoy, 80 archivos) y tiene que quedar verde al cerrar cada tarea.
- `npx tsc --noEmit -p tsconfig.json` tiene que salir limpio al cerrar cada tarea.
- **No correr Playwright y Vitest a la vez**: el e2e usa WebGL por software y satura la CPU; con los dos a la vez, tests de `demTiles` y `stateMask` fallan por timeout sin que nada esté roto.

---

### Task 1: Deduplicar las aristas de los municipios

**Files:**
- Create: `scripts/lib/limites.mjs`
- Test: `scripts/test/limites.test.mjs`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `aristasUnicas(municipios) -> Array<[[lon,lat],[lon,lat]]>`, donde `municipios` es el array de `public/data/municipios.json` (cada uno con `.polygons: number[][][][]`).

**Contexto:** el 62 % de las aristas de los anillos municipales pertenece a dos municipios a la vez (son las fronteras interiores). Dibujarlas tal cual las pinta dos veces superpuestas y, con `transparent: true`, las fronteras interiores saldrían **más fuertes** que el contorno exterior del estado, que solo tiene un dueño. Deduplicar no es optimización: es lo que decide si la línea se ve bien.

- [ ] **Step 1: Escribir el test que falla**

```javascript
// scripts/test/limites.test.mjs
import { describe, expect, it } from 'vitest'
import { aristasUnicas } from '../lib/limites.mjs'

// Dos cuadrados pegados por el lado x=1: esa arista pertenece a los dos y
// tiene que salir UNA vez. El de la derecha recorre su anillo al revés a
// propósito -- en OSM dos municipios vecinos no recorren su frontera común en
// el mismo sentido, y una clave que dependa del sentido no los uniría.
const muni = (anillo) => ({ osmId: 0, name: 'x', polygons: [[anillo]], orphanFragments: 0 })

describe('aristasUnicas', () => {
  it('una frontera compartida sale una sola vez, recórrase como se recorra', () => {
    const izq = muni([[0, 0], [1, 0], [1, 1], [0, 1]])
    const der = muni([[2, 1], [1, 1], [1, 0], [2, 0]])
    const aristas = aristasUnicas([izq, der])
    // 4 + 4 lados, menos la compartida contada dos veces = 7
    expect(aristas).toHaveLength(7)
    const enX1 = aristas.filter(([a, b]) => a[0] === 1 && b[0] === 1)
    expect(enX1).toHaveLength(1)
  })

  it('cierra cada anillo: el último vértice conecta con el primero', () => {
    expect(aristasUnicas([muni([[0, 0], [1, 0], [1, 1]])])).toHaveLength(3)
  })

  it('no inventa aristas de longitud cero', () => {
    const conRepetido = muni([[0, 0], [1, 0], [1, 0], [1, 1]])
    for (const [a, b] of aristasUnicas([conRepetido])) {
      expect(a[0] === b[0] && a[1] === b[1], JSON.stringify([a, b])).toBe(false)
    }
  })

  it('sobre el dato real da 81.599 aristas de 132.165 vértices', async () => {
    const { readFileSync } = await import('node:fs')
    const municipios = JSON.parse(readFileSync('public/data/municipios.json', 'utf8'))
    expect(aristasUnicas(municipios)).toHaveLength(81_599)
  })
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run scripts/test/limites.test.mjs`
Expected: FAIL — `Failed to resolve import "../lib/limites.mjs"`.

- [ ] **Step 3: Implementar**

```javascript
// scripts/lib/limites.mjs

/**
 * Las aristas de los anillos municipales, cada una una sola vez.
 *
 * El 62 % de ellas pertenece a dos municipios (son las fronteras interiores) y
 * aparece una vez en el anillo de cada vecino. Sin deduplicar se dibujarían
 * dos veces superpuestas: con transparencia eso acumula, así que toda frontera
 * interior saldría más marcada que el contorno exterior del estado -- que solo
 * tiene un dueño -- y al revés de como se debe leer un mapa.
 *
 * La clave ordena los dos extremos entre sí para no depender del sentido en
 * que cada municipio recorra su anillo, que en OSM es opuesto entre vecinos.
 * Siete decimales son ~1 cm: los nodos compartidos son el mismo nodo de OSM y
 * coinciden exactos, y esa tolerancia absorbe el ruido de pasar por JSON sin
 * llegar a fundir dos nodos distintos. Los nodos que OSM NO comparte no se
 * funden y su arista sale dos veces; eso es ruido del dato, el mismo que
 * stateMask ya trata como pinchazos.
 */
export function aristasUnicas (municipios) {
  const vistas = new Set()
  const out = []
  const clave = p => `${p[0].toFixed(7)},${p[1].toFixed(7)}`
  for (const m of municipios) {
    for (const poly of m.polygons) {
      for (const anillo of poly) {
        for (let i = 0; i < anillo.length; i++) {
          const a = anillo[i], b = anillo[(i + 1) % anillo.length]
          const ka = clave(a), kb = clave(b)
          if (ka === kb) continue          // vértice repetido: no es una arista
          const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
          if (vistas.has(k)) continue
          vistas.add(k)
          out.push([a, b])
        }
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run scripts/test/limites.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 5: Comprobar que el test del dato real discrimina**

Cambia temporalmente `if (vistas.has(k)) continue` por `if (false) continue`, corre el test y confirma que el conteo pasa de 81.599 a 132.165. Restaura y pega las dos salidas en el informe. Un test que cuenta tiene que demostrar que cuenta.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/limites.mjs scripts/test/limites.test.mjs
git commit -m "feat: aristas unicas de los limites municipales, sin las compartidas repetidas"
```

---

### Task 2: Generar `limites-pos.bin` en el pipeline

**Files:**
- Modify: `scripts/build-data.mjs` (junto al bloque `6/9 empaquetado de vías`, sobre la línea 200)
- Modify: `scripts/lib/limites.mjs` (añadir `limitesEnu`)
- Test: `scripts/test/limites.test.mjs` (añadir al final)

**Interfaces:**
- Consumes: `aristasUnicas(municipios)` de la Task 1.
- Produces: `limitesEnu(aristas, { alturaDe, frame, alza }) -> Float32Array` con 6 floats por segmento (x,y,z del inicio y del fin, en ENU de three), que es el formato que `LineSegmentsGeometry.setPositions` espera. Y el archivo `public/data/limites-pos.bin`.

**Contexto:** el relieve dibujado saca sus alturas de la pirámide del DEM, con la misma regla que `alturaEnPosts` de `scripts/lib/drape.mjs`. Por eso las vías, drapeadas ahí, encajan. `terrain.bin` (celdas de 132×160 m) no sirve: la malla a z15 tiene celdas de ~36 m y la línea se hundiría en cada cresta.

En `build-data.mjs` ya existen, y hay que reusarlos tal cual:
- `frame` — `makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)`, línea 39
- `alturaDe` — `(lon, lat) => alturaTriangulo(roadDem, lon, lat)`, línea 93
- `subdividir(coords, pasoM = 30)` y `apoyar(coords, alturaDe, umbral = 0.2, minM = 4)` de `scripts/lib/subdividir.mjs`
- `geodeticToEnu(frame, lat, lon, h)` de `scripts/lib/enu.mjs` — devuelve `[este, norte, arriba]`, y los ejes de three son `[este, arriba, -norte]`
- `writeBin(path, typedArray)` de `scripts/lib/pack.mjs`

- [ ] **Step 1: Escribir el test que falla**

```javascript
// añadir al final de scripts/test/limites.test.mjs
import { limitesEnu } from '../lib/limites.mjs'

describe('limitesEnu', () => {
  // Un frame de mentira: ENU identidad sobre grados, para poder afirmar
  // números exactos sin arrastrar la geodesia entera al test.
  const frame = null
  const enuPlano = (_f, lat, lon, h) => [lon * 1000, lat * 1000, h]

  it('devuelve 6 floats por segmento, en ejes de three', () => {
    const buf = limitesEnu([[[0, 0], [1, 0]]], {
      alturaDe: () => 100, frame, alza: 0, enu: enuPlano, pasoM: 1e9,
    })
    expect(buf).toBeInstanceOf(Float32Array)
    expect(buf).toHaveLength(6)
    // [este, arriba, -norte] = [lon*1000, h, -lat*1000]
    expect([...buf]).toEqual([0, 100, -0, 1000, 100, -0])
  })

  it('alza cada vértice sobre el terreno', () => {
    const buf = limitesEnu([[[0, 0], [1, 0]]], {
      alturaDe: () => 100, frame, alza: 0.25, enu: enuPlano, pasoM: 1e9,
    })
    expect(buf[1]).toBeCloseTo(100.25, 5)
    expect(buf[4]).toBeCloseTo(100.25, 5)
  })

  // Una arista larga sobre relieve que cambia tiene que partirse: si no, la
  // cuerda recta cruza por debajo de la loma que hay en medio.
  it('parte una arista larga que se apartaría del relieve', () => {
    const loma = (lon) => (lon > 0.4 && lon < 0.6 ? 500 : 0)
    const buf = limitesEnu([[[0, 0], [1, 0]]], {
      alturaDe: (lon) => loma(lon), frame, alza: 0, enu: enuPlano, pasoM: 30,
    })
    expect(buf.length / 6).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run scripts/test/limites.test.mjs`
Expected: FAIL — `limitesEnu is not a function`.

- [ ] **Step 3: Implementar `limitesEnu`**

```javascript
// añadir a scripts/lib/limites.mjs
import { subdividir, apoyar } from './subdividir.mjs'
import { geodeticToEnu } from './enu.mjs'

/**
 * Las aristas, drapeadas sobre el DEM y en coordenadas de three, listas para
 * LineSegmentsGeometry.setPositions: 6 floats por segmento.
 *
 * Mismo tratamiento que las vías y por la misma razón: `subdividir` mete
 * puntos para que ningún tramo pase de `pasoM`, y `apoyar` parte por bisección
 * los que aun así se aparten del relieve más que el umbral. El dato de OSM ya
 * viene denso (arista mediana 15,5 m), así que esto solo trabaja de verdad en
 * las ~2.668 aristas de más de 100 m.
 *
 * `enu` es inyectable solo para poder afirmar números exactos en el test sin
 * arrastrar la geodesia; en producción siempre es geodeticToEnu.
 */
export function limitesEnu (aristas, {
  alturaDe, frame, alza = 0.25, enu = geodeticToEnu, pasoM = 30,
}) {
  const partes = []
  for (const [a, b] of aristas) {
    const coords = apoyar(subdividir([a, b], pasoM), alturaDe)
    for (let i = 1; i < coords.length; i++) partes.push([coords[i - 1], coords[i]])
  }
  const out = new Float32Array(partes.length * 6)
  let k = 0
  for (const [p, q] of partes) {
    for (const [lon, lat] of [p, q]) {
      const [este, norte, arriba] = enu(frame, lat, lon, alturaDe(lon, lat) + alza)
      out[k++] = este; out[k++] = arriba; out[k++] = -norte
    }
  }
  return out
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run scripts/test/limites.test.mjs`
Expected: PASS, 7/7.

- [ ] **Step 5: Cablearlo en el pipeline**

En `scripts/build-data.mjs`, justo después del bloque que escribe los cuatro binarios de vías (tras la línea `console.log(\`     ${packed.segmentCount} segmentos\`)`), añadir:

```javascript
  console.log('6b/9 límites municipales')
  const aristas = aristasUnicas(municipios)
  const limites = limitesEnu(aristas, { alturaDe, frame })
  await writeBin(`${OUT}/limites-pos.bin`, limites)
  console.log(`     ${aristas.length} aristas únicas → ${limites.length / 6} segmentos drapeados`)
```

Y el import arriba, junto a los demás de `./lib/`:

```javascript
import { aristasUnicas, limitesEnu } from './lib/limites.mjs'
```

**`municipios` ya está disponible ahí**: se carga en el paso `1/9` (línea 42,
`relationsToPolygons(await overpass(QUERY_MUNICIPIOS, 'municipios'))`), mucho
antes de este bloque. No hay que mover nada. Lo que está sobre la línea 262 es
la *escritura* de `municipios.json`, que no estorba.

- [ ] **Step 6: Correr el pipeline y comprobar el archivo**

Run: `npm run data`
Expected: la línea `6b/9 límites municipales` con 81.599 aristas y un número de segmentos mayor o igual. Después:

```bash
node -e "const {statSync}=require('fs');const b=statSync('public/data/limites-pos.bin');console.log(b.size,'bytes =',b.size/4/6,'segmentos')"
```

Pega la salida real en el informe. Si `npm run data` tarda demasiado o necesita red que no hay, dilo en el informe como BLOCKED en vez de inventar el número.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/limites.mjs scripts/test/limites.test.mjs scripts/build-data.mjs
git commit -m "feat: el pipeline drapea los limites municipales contra el DEM"
```

---

### Task 3: Empaquetar y cargar `limites-pos.bin`

**Files:**
- Modify: `scripts/datos-empaquetar.mjs` (la lista `ARCHIVOS`, sobre la línea 37)
- Modify: `src/data/load.ts` (el `Promise.all` de la línea 58 y el objeto que devuelve)
- **`.gitignore` no se toca**: ya ignora `public/data/*` entero (línea 3), con
  excepciones solo para `piezas/` y `capas/`. El binario generado no se
  versiona, igual que los cuatro de vías.

**Interfaces:**
- Consumes: el archivo `public/data/limites-pos.bin` de la Task 2.
- Produces: `loadAll()` devuelve un campo más, `limites: Float32Array`, junto a `positions`, `segIds`, etc.

- [ ] **Step 1: Añadir el archivo al empaquetado**

En `scripts/datos-empaquetar.mjs`, en la lista `ARCHIVOS`, junto a las demás entradas `data/*.bin` y en orden alfabético con ellas:

```javascript
  'data/limites-pos.bin',
```

- [ ] **Step 2: Cargarlo en el navegador**

En `src/data/load.ts`, añadir la descarga al `Promise.all` existente (donde ya están `bin(urlGenerado('roads-pos.bin'))` y compañía), respetando el orden de la desestructuración, y devolverlo:

```typescript
// en el Promise.all, junto a los demás bin(...)
    bin(urlGenerado('limites-pos.bin')),
```

```typescript
// en el objeto que loadAll devuelve, junto a positions/segIds/...
    limites: new Float32Array(lBuf),
```

Nombra la variable del buffer `lBuf`, siguiendo el patrón de `tBuf`/`pBuf`/`sBuf`/`iBuf`/`nBuf` que ya hay.

**Cuidado:** `data.juntas.limites` ya existe y es otra cosa (las juntas de calzada de las vías). El campo nuevo es `data.limites`, a secas. Si el nombre se presta a confusión al leerlo en `App.tsx`, este es el momento de decirlo en el informe — no de renombrar lo ajeno por tu cuenta.

- [ ] **Step 3: Comprobar que carga**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: limpio.

Run: `npx vitest run`
Expected: 836/836 (esta tarea no añade tests: no hay lógica, solo cableado; lo que la cubre es el e2e de la Task 5).

- [ ] **Step 4: Commit**

```bash
git add scripts/datos-empaquetar.mjs src/data/load.ts
git commit -m "feat: limites-pos.bin entra en el paquete de datos y se carga al arrancar"
```

---

### Task 4: El componente que dibuja los límites

**Files:**
- Create: `src/scene/LimitesMunicipales.tsx`
- Create: `src/scene/LimitesMunicipales.test.ts`

**Interfaces:**
- Consumes: `data.limites: Float32Array` de la Task 3.
- Produces: `<LimitesMunicipales posiciones={Float32Array} color={string} />`, que monta en la escena un objeto llamado `limites`. Y las constantes exportadas `ANCHO_PX`, `OPACIDAD`.

**Contexto:** el patrón exacto sale de `src/scene/Roads.tsx`. `worldUnits: false` es lo que pone el ancho en **píxeles** en vez de metros, y es el punto de toda la tanda; `material.resolution` hay que mantenerla al día con el tamaño del lienzo o el ancho deja de ser el pedido.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/scene/LimitesMunicipales.test.ts
import { describe, it, expect } from 'vitest'
import { ANCHO_PX, OPACIDAD, COLOR_CLARO, COLOR_OSCURO } from './LimitesMunicipales'

describe('el estilo de la línea de límite', () => {
  // Google dibuja los límites administrativos finos y tenues, en un gris
  // frío -- nunca en negro ni en el color de acento. Estos valores son el
  // punto de partida y se calibran mirando el mapa; el test solo impide que
  // alguien los suba a un grosor que tape la calle que hay debajo.
  it('la línea es fina: ningún valor de calibración puede pasar de 3 px', () => {
    expect(ANCHO_PX).toBeGreaterThan(0.5)
    expect(ANCHO_PX).toBeLessThanOrEqual(3)
  })

  it('la línea es tenue, nunca opaca del todo', () => {
    expect(OPACIDAD.claro).toBeLessThan(1)
    expect(OPACIDAD.oscuro).toBeLessThan(1)
  })

  it('el color es un gris frío, no un negro ni un color saturado', () => {
    for (const hex of [COLOR_CLARO, COLOR_OSCURO]) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      expect(max - min, `${hex} está demasiado saturado`).toBeLessThan(40)
      expect(max, `${hex} es casi negro`).toBeGreaterThan(60)
    }
  })
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/scene/LimitesMunicipales.test.ts`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Escribir el componente**

```tsx
// src/scene/LimitesMunicipales.tsx
import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'

/**
 * Los límites municipales, como línea y no como efecto de borde de una
 * textura.
 *
 * Antes esto vivía en el shader del relieve, comparando el índice de un téxel
 * con el de su vecino sobre una rejilla de 2048². De ahí salían los tres
 * defectos que esto arregla: el ancho iba en metros (un téxel son ~80 m, así
 * que de lejos desaparecía y de cerca era una banda), escalonaba porque
 * NEAREST sobre una rejilla escalona, y la frontera no existía como objeto al
 * que darle color u opacidad propios.
 */

/** Ancho en PÍXELES de pantalla, que es lo que `worldUnits: false` habilita.
 *  Calibrado a ojo sobre relieve hipsométrico y sobre foto satelital -- la
 *  satelital es el caso difícil, porque ya trae textura propia. */
export const ANCHO_PX = 1.3

/** Tenue a propósito: un límite administrativo orienta, no informa del
 *  pavimento, y no puede competir con la rampa del PCI. */
export const OPACIDAD = { claro: 0.85, oscuro: 0.75 } as const

/** Gris frío, como el de Google. Ni negro (pesa demasiado sobre el relieve)
 *  ni el color de acento (ese significa "esto es lo que tocaste"). */
export const COLOR_CLARO = '#9aa0a6'
export const COLOR_OSCURO = '#7c828a'

export function LimitesMunicipales ({ posiciones, oscuro = false }: {
  posiciones: Float32Array
  oscuro?: boolean
}) {
  const { size } = useThree()

  const objeto = useMemo(() => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(posiciones)
    const material = new LineMaterial({
      // En píxeles y no en metros: es la diferencia entera con la textura que
      // esto reemplaza.
      worldUnits: false,
      transparent: true,
      // Como las vías: no escribe profundidad, así que no recorta lo que
      // tiene detrás ni pelea con el relieve por un z que comparten.
      depthWrite: false,
    })
    const linea = new LineSegments2(geometry, material)
    linea.name = 'limites'
    // Por debajo de las vías: un límite administrativo nunca puede taparle una
    // calle a quien está evaluando el pavimento.
    linea.renderOrder = -1
    // El recorte por frustum de three usa la caja de la geometría, que aquí es
    // el estado entero: no descarta nada y cuesta calcularla.
    linea.frustumCulled = false
    return linea
  }, [posiciones])

  // El ancho en píxeles solo sale bien si el material sabe de qué tamaño es el
  // lienzo. Mismo patrón que Roads.tsx.
  useEffect(() => {
    (objeto.material as LineMaterial).resolution.set(size.width, size.height)
  }, [objeto, size])

  useEffect(() => {
    const m = objeto.material as LineMaterial
    m.color = new THREE.Color(oscuro ? COLOR_OSCURO : COLOR_CLARO)
    m.linewidth = ANCHO_PX
    m.opacity = oscuro ? OPACIDAD.oscuro : OPACIDAD.claro
    m.needsUpdate = true
  }, [objeto, oscuro])

  // three no libera nada solo: la geometría y el material son nuestros.
  useEffect(() => () => {
    objeto.geometry.dispose()
    ;(objeto.material as LineMaterial).dispose()
  }, [objeto])

  return <primitive object={objeto} />
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run src/scene/LimitesMunicipales.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/scene/LimitesMunicipales.tsx src/scene/LimitesMunicipales.test.ts
git commit -m "feat: componente de limites municipales con ancho en pixeles"
```

---

### Task 5: Cambiar el camino viejo por el nuevo

**Files:**
- Modify: `src/App.tsx` (el `<TerrainLod>` sobre la línea 543, y el import)
- Modify: `src/scene/TerrainLod.tsx` (constante `INDICES` línea 29, `useMemo` de `indices` líneas 218-229, prop `limites`, las dos líneas de uniformes del bucle por nodo)
- Modify: `src/scene/terrainShader.ts` (líneas 83, 85, 86, 104, 108-110, 129-140, 177, 179, 181, 202, 204, 231-233)
- Modify: `src/scene/stateMask.ts` (borrar `indiceMunicipios`)
- Modify: `src/scene/stateMask.test.ts` (borrar el `describe('indiceMunicipios')` entero)
- Modify: `src/scene/terrainShader.test.ts` (quitar lo que compruebe los uniformes borrados)
- Modify: `e2e/capas.spec.ts` (el test `los límites municipales llegan a todos los nodos del terreno`)

**Interfaces:**
- Consumes: `<LimitesMunicipales>` de la Task 4, `data.limites` de la Task 3.
- Produces: nada para tareas posteriores.

**Contexto:** esta tarea sustituye un camino por otro y **tiene que dejar el mapa funcionando en todo momento**. Primero se monta el nuevo, se comprueba que dibuja, y solo entonces se borra el viejo. Al revés deja un commit donde los límites no existen.

- [ ] **Step 1: Montar el componente nuevo**

En `src/App.tsx`, dentro del `<Suspense>`, junto a `<CapaPuntos>`:

```tsx
          {visibles.has('municipios') && (
            <LimitesMunicipales posiciones={data.limites} />
          )}
```

Y el import junto a los demás de `./scene/`:

```tsx
import { LimitesMunicipales } from './scene/LimitesMunicipales'
```

De momento **no** se quita el `limites={visibles.has('municipios')}` del `<TerrainLod>`: los dos caminos conviven un commit.

- [ ] **Step 2: Ver los dos a la vez y comparar**

Run: `npm run dev` y abre el mapa con `?capas=municipios`.

Se verán las dos líneas superpuestas: la vieja de la textura (gruesa y escalonada) y la nueva (fina). Toma una captura, acércate hasta que la escalonada se note, y pégala en el informe. **Esta comparación es el único momento en que las dos se pueden ver juntas** y es la prueba de que la nueva está donde debe estar. Si la nueva sale corrida respecto a la vieja, para y repórtalo: significa que el drapeado o el frame ENU no cuadran, y seguir borrando taparía el problema.

- [ ] **Step 3: Quitar el camino viejo de App.tsx y TerrainLod**

En `src/App.tsx`, en el `<TerrainLod>`, quitar el prop:

```tsx
// antes
<TerrainLod meta={data.terrain} municipios={data.municipios} imagen={imagen}
  date={date} limites={visibles.has('municipios')} />
// después
<TerrainLod meta={data.terrain} municipios={data.municipios} imagen={imagen} date={date} />
```

En `src/scene/TerrainLod.tsx`, borrar:
- la constante `const INDICES = 2048` (línea 29)
- el `useMemo` completo de `indices` y su `useEffect` de `dispose` (líneas 218-229)
- el prop `limites?: boolean` de la firma y de la desestructuración (líneas 176, 183)
- en el bucle `for (const n of sel)`: las líneas `u.uLimites.value = limites ? 1 : 0` y `u.uIndices.value = indices`, y el comentario que las explica
- del objeto de opciones que se pasa a construir el material: `indices` y `texelIndices` (línea 296)

**`municipios` sigue siendo prop de `TerrainLod`**: lo usa `stateMask` para el recorte al contorno del estado, que no se toca.

- [ ] **Step 4: Quitar los uniformes del shader**

En `src/scene/terrainShader.ts`, borrar:
- `uniform sampler2D uIndices;` (83), `uniform vec2 uTexelIdx;` (85), `uniform float uLimites;` (86)
- `const vec3 LIMITE = vec3(0.96, 0.93, 0.55);` (104)
- la función `difiere` entera (108-110)
- el bloque `if (uLimites > 0.0) { … }` entero dentro de `albedoRelieve()` (129-140)
- de `UniformsRelieve`: `uIndices`, `uTexelIdx`, `uLimites` (177, 179, 181)
- de `OpcionesRelieve`: `indices`, `texelIndices` (202, 204)
- de la construcción de uniformes: las tres entradas (231-233)

Si algún comentario dice cuántos miembros tiene `UniformsRelieve`, actualiza el número al real tras borrar.

- [ ] **Step 5: Borrar `indiceMunicipios`**

En `src/scene/stateMask.ts`, borrar la función `indiceMunicipios` entera, su JSDoc y el guard de los 255 municipios. En `src/scene/stateMask.test.ts`, borrar el `describe('indiceMunicipios', …)` completo y el import de la función. `stateMask` y sus tests se quedan intactos.

- [ ] **Step 6: Actualizar el e2e**

En `e2e/capas.spec.ts`, el test `los límites municipales llegan a todos los nodos del terreno` mira uniformes que ya no existen. Sustituirlo por uno que mire el objeto nuevo:

```typescript
  test('los límites municipales se dibujan como línea, no como textura', async () => {
    await alternar(page, 'Municipios', false)
    await page.waitForFunction(
      () => !window.__estado!().scene.getObjectByName('limites'), { timeout: 60_000 })

    await alternar(page, 'Municipios', true)
    await page.waitForFunction(
      () => !!window.__estado!().scene.getObjectByName('limites'), { timeout: 60_000 })

    const m = await page.evaluate(() => {
      const o = window.__estado!().scene.getObjectByName('limites') as any
      const s = window.__estado!().size
      return {
        segmentos: o.geometry.attributes.instanceStart.count,
        anchoPx: o.material.linewidth,
        resolucion: [o.material.resolution.x, o.material.resolution.y],
        lienzo: [s.width, s.height],
        // El uniforme viejo no puede seguir vivo en ningún nodo del relieve.
        quedanUniformes: (window.__estado!().scene.getObjectByName('terrain')?.children ?? [])
          .filter((n: any) => n.material?.userData?.uniforms?.uLimites).length,
      }
    })
    informar(`límites: ${m.segmentos} segmentos, ${m.anchoPx} px, resolución ${JSON.stringify(m.resolucion)}`)
    expect(m.segmentos).toBeGreaterThan(80_000)
    expect(m.quedanUniformes, 'quedó uLimites en algún nodo del relieve').toBe(0)
    // Si la resolución no sigue al lienzo, el ancho en píxeles deja de ser el pedido.
    expect(m.resolucion).toEqual(m.lienzo)
  })
```

- [ ] **Step 7: Correr todo**

Run: `npx tsc --noEmit -p tsconfig.json` → limpio.
Run: `npx vitest run` → verde, con menos tests que antes (se borraron los de `indiceMunicipios`). Anota el número nuevo.
Run: `npx playwright test capas` → 6/6. **Sin vitest corriendo a la vez.**
Run: `npx playwright test relieve` → el relieve es lo que más riesgo corre al tocar `albedoRelieve()`; esta es la red. Si tarda demasiado, dilo, pero no lo saltes en silencio.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: los limites municipales dejan el shader y pasan a geometria"
```

---

### Task 6: `theme.ts` a variables CSS, sin cambiar nada a la vista

**Files:**
- Modify: `src/ui/theme.ts`
- Create: `src/ui/tema.ts`
- Create: `src/ui/tema.test.ts`
- Modify: `src/main.tsx` (la raíz: `createRoot(...).render(<App />)`, línea 4)

**Interfaces:**
- Consumes: nada.
- Produces: `TOKENS_CLARO` y `TOKENS_OSCURO` (`Record<string,string>`), `cssDeTokens(claro, oscuro) -> string`, y el objeto `T` existente con los mismos nombres de campo pero con valores `var(--token)`.

**Contexto:** esta tarea **no puede cambiar ni un píxel**. Es la conversión mecánica que hace posible la Task 7. Si al terminar el mapa se ve distinto, algo se tradujo mal.

La frontera que no se cruza: `T` tiene color de **chrome** (cambia con el tema) y `theme.ts` tiene además utilidades de **dato** y de formato (`css3`, `nf`, `km1`, `etiquetaVia`, `cortoMunicipio`, `norm`). Solo el color de chrome se convierte. `css3` convierte colores del PCI y **no se toca**.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/ui/tema.test.ts
import { describe, it, expect } from 'vitest'
import { TOKENS_CLARO, TOKENS_OSCURO, cssDeTokens } from './tema'
import { T } from './theme'

describe('los tokens del tema', () => {
  it('las dos paletas declaran exactamente los mismos tokens', () => {
    expect(Object.keys(TOKENS_OSCURO).sort()).toEqual(Object.keys(TOKENS_CLARO).sort())
  })

  it('todo lo que T expone como color apunta a un token declarado', () => {
    for (const [clave, valor] of Object.entries(T)) {
      if (typeof valor !== 'string' || !valor.startsWith('var(')) continue
      const token = valor.slice(6, -1)   // var(--fondo) -> fondo
      expect(TOKENS_CLARO, `T.${clave} apunta a --${token}, que no existe`).toHaveProperty(token)
    }
  })

  it('el CSS declara la paleta clara en :root y la oscura bajo data-tema', () => {
    const css = cssDeTokens(TOKENS_CLARO, TOKENS_OSCURO)
    expect(css).toContain(':root{')
    expect(css).toContain('[data-tema="oscuro"]')
    expect(css).toContain('--fondo:')
  })

  // La regla que no se cruza: el color del DATO no puede entrar acá. Un verde
  // que significa "pavimento bueno" tiene que ser el mismo de día y de noche.
  it('ningún token es un color de la rampa del PCI', async () => {
    const { PCI_RANGES } = await import('../data/constants')
    const { css3 } = await import('./theme')
    const delDato = new Set(PCI_RANGES.map(r => css3(r.color).toLowerCase()))
    for (const valor of Object.values(TOKENS_CLARO)) {
      expect(delDato.has(String(valor).toLowerCase()), `${valor} es un color del PCI`).toBe(false)
    }
  })
})
```

`PCI_RANGES` vive en `src/data/constants.ts` y cada entrada es
`{ min, max, label, color: [r, g, b] }` con las componentes en 0..1 — que es
justo la forma que `css3()` espera. Comprobado el 2026-09-14.

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/ui/tema.test.ts`
Expected: FAIL — no existe `./tema`.

- [ ] **Step 3: Escribir `tema.ts`**

```typescript
// src/ui/tema.ts
/**
 * Las dos paletas del chrome y el CSS que las declara.
 *
 * Solo color de CHROME: fondo, textos, líneas, acento, avisos, sombras. El
 * color del DATO -- la rampa del PCI, la hipsometría, el color de cada capa --
 * no vive acá y no cambia con el tema. Un verde que significa "pavimento
 * bueno" tiene que ser el mismo verde de día y de noche, o el mapa miente.
 */

export const TOKENS_CLARO: Record<string, string> = {
  fondo: '#ffffff',
  fondoSuave: '#f5f6f7',
  texto: '#1f2124',
  texto2: '#5b6169',
  texto3: '#868c94',
  linea: '#e4e6e9',
  lineaFuerte: '#d0d4d9',
  acento: '#15607a',
  acentoHover: '#0f4b60',
  acentoSuave: '#e8f1f4',
  aviso: '#7a5200',
  avisoFondo: '#fff4dc',
  avisoLinea: '#f0dcae',
  sombra: '0 1px 2px rgba(31,33,36,.22), 0 6px 20px rgba(31,33,36,.14)',
  sombraChica: '0 1px 2px rgba(31,33,36,.24), 0 2px 6px rgba(31,33,36,.10)',
}

/** Azulado y no gris neutro, por la misma razón que el claro: contra el
 *  verde-ocre del terreno un gris exacto se ve sucio. El acento sube de
 *  luminosidad porque el petróleo original es ilegible sobre oscuro, pero
 *  conserva el matiz: sigue sin competir con la rampa verde→rojo. */
export const TOKENS_OSCURO: Record<string, string> = {
  fondo: '#11161c',
  fondoSuave: '#1a212a',
  texto: '#e6ebf2',
  texto2: '#a7b0bb',
  texto3: '#79838f',
  linea: '#232c36',
  lineaFuerte: '#33404e',
  acento: '#4aa8c9',
  acentoHover: '#68bcd9',
  acentoSuave: '#15303c',
  aviso: '#e0b050',
  avisoFondo: '#2e2410',
  avisoLinea: '#4d3d18',
  // En oscuro una sombra no separa del fondo; la que separa es la línea, así
  // que la sombra se mantiene por la forma y el borde hace el trabajo.
  sombra: '0 1px 2px rgba(0,0,0,.5), 0 6px 20px rgba(0,0,0,.4)',
  sombraChica: '0 1px 2px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.3)',
}

const declarar = (t: Record<string, string>) =>
  Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';')

export function cssDeTokens (claro: Record<string, string>, oscuro: Record<string, string>) {
  return `:root{${declarar(claro)}}\n:root[data-tema="oscuro"]{${declarar(oscuro)}}`
}
```

- [ ] **Step 4: Apuntar `T` a los tokens**

En `src/ui/theme.ts`, cambiar **solo los campos de color** por su `var(--…)`, dejando intactos `riel`, `radio`, `radioChico`, `fuente` y todas las utilidades de abajo (`css3`, `nf`, `km1`, `VIAS`, `etiquetaVia`, `cortoMunicipio`, `norm`):

```typescript
export const T = {
  fondo: 'var(--fondo)',
  fondoSuave: 'var(--fondoSuave)',
  texto: 'var(--texto)',
  texto2: 'var(--texto2)',
  texto3: 'var(--texto3)',
  linea: 'var(--linea)',
  lineaFuerte: 'var(--lineaFuerte)',
  acento: 'var(--acento)',
  acentoHover: 'var(--acentoHover)',
  acentoSuave: 'var(--acentoSuave)',
  aviso: 'var(--aviso)',
  avisoFondo: 'var(--avisoFondo)',
  avisoLinea: 'var(--avisoLinea)',
  sombra: 'var(--sombra)',
  sombraChica: 'var(--sombraChica)',
  radio: 8,
  radioChico: 6,
  fuente: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  riel: 400,
} as const
```

Actualiza el comentario de cabecera del archivo: ya no son literales, y hay que decir dónde viven ahora los valores y cuál es la frontera chrome/dato.

- [ ] **Step 5: Inyectar el CSS**

En `src/main.tsx`, antes de `createRoot(...).render(<App />)`:

```typescript
import { TOKENS_CLARO, TOKENS_OSCURO, cssDeTokens } from './ui/tema'

const estilo = document.createElement('style')
estilo.textContent = cssDeTokens(TOKENS_CLARO, TOKENS_OSCURO)
document.head.append(estilo)
```

- [ ] **Step 6: Comprobar que NADA cambió a la vista**

Run: `npx vitest run` → verde.
Run: `npx tsc --noEmit -p tsconfig.json` → limpio.
Run: `npm run dev`, abre el mapa y compáralo con una captura de antes del cambio. **Tiene que verse idéntico.** Pega las dos capturas en el informe. Si algo cambió, un color se tradujo mal.

Ojo con las pruebas que renderizan a HTML (`PanelCapas.test.tsx`, `FichaRasgo.test.tsx`): si alguna afirma un hex literal, ahora saldrá `var(--…)`. Actualízala al token, que es lo que pasa a ser verdad — no a un literal nuevo.

- [ ] **Step 7: Commit**

```bash
git add src/ui/tema.ts src/ui/tema.test.ts src/ui/theme.ts src/main.tsx
git commit -m "refactor: el color del chrome pasa a variables CSS, sin cambio visual"
```

---

### Task 7: El interruptor de tema

**Files:**
- Create: `src/ui/usarTema.ts`
- Create: `src/ui/usarTema.test.ts`
- Modify: `src/ui/MapControls.tsx` (la botonera, junto al botón de imagen satelital)
- Modify: `src/ui/icons.tsx` (un icono de sol/luna)
- Modify: `src/App.tsx` (estado del tema y paso a `MapControls` y a `LimitesMunicipales`)

**Interfaces:**
- Consumes: `TOKENS_*` de la Task 6, `<LimitesMunicipales oscuro>` de la Task 4.
- Produces: `temaDe(guardado, prefiereOscuro) -> 'claro' | 'oscuro'` y el hook `usarTema() -> { tema, alternar }`.

- [ ] **Step 1: Escribir el test que falla**

```typescript
// src/ui/usarTema.test.ts
import { describe, it, expect } from 'vitest'
import { temaDe } from './usarTema'

describe('temaDe', () => {
  it('sin elección previa, manda el sistema', () => {
    expect(temaDe(null, true)).toBe('oscuro')
    expect(temaDe(null, false)).toBe('claro')
  })

  it('la elección explícita gana sobre el sistema', () => {
    expect(temaDe('claro', true)).toBe('claro')
    expect(temaDe('oscuro', false)).toBe('oscuro')
  })

  // Lo guardado puede ser basura: otra versión de la app, alguien tocando
  // localStorage a mano. Si no se reconoce, manda el sistema.
  it('un valor guardado que no reconoce cae al sistema', () => {
    expect(temaDe('azul', true)).toBe('oscuro')
    expect(temaDe('', false)).toBe('claro')
  })
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run src/ui/usarTema.test.ts`
Expected: FAIL — no existe `./usarTema`.

- [ ] **Step 3: Implementar**

```typescript
// src/ui/usarTema.ts
import { useCallback, useEffect, useState } from 'react'

export type Tema = 'claro' | 'oscuro'

const CLAVE = 'tachira3d.tema'

/** Qué tema toca: lo que el usuario eligió si eligió algo reconocible, y si no
 *  lo que dice el sistema. Puro, para poder probarlo sin navegador. */
export function temaDe (guardado: string | null, prefiereOscuro: boolean): Tema {
  if (guardado === 'claro' || guardado === 'oscuro') return guardado
  return prefiereOscuro ? 'oscuro' : 'claro'
}

/** localStorage lanza en una ventana privada y con las cookies bloqueadas. El
 *  mapa tiene que abrir igual, así que todo acceso va envuelto. */
const leer = (): string | null => {
  try { return localStorage.getItem(CLAVE) } catch { return null }
}
const guardar = (t: Tema) => {
  try { localStorage.setItem(CLAVE, t) } catch { /* sin memoria, pero funciona */ }
}

export function usarTema () {
  const [tema, setTema] = useState<Tema>(() =>
    temaDe(leer(), typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches))

  // El atributo en la raíz es lo que activa la paleta oscura del CSS (tema.ts).
  useEffect(() => { document.documentElement.dataset.tema = tema }, [tema])

  const alternar = useCallback(() => {
    setTema(t => {
      const nuevo: Tema = t === 'claro' ? 'oscuro' : 'claro'
      guardar(nuevo)
      return nuevo
    })
  }, [])

  return { tema, alternar }
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run src/ui/usarTema.test.ts`
Expected: PASS, 3/3.

- [ ] **Step 5: El botón**

En `src/ui/icons.tsx`, añadir un icono `Tema` siguiendo el estilo de los que ya hay (mismo tamaño por defecto, `stroke="currentColor"`, sin relleno): un sol cuando está en claro, una luna cuando está en oscuro. Mira `Lluvia` o `Foto` como plantilla exacta.

En `src/ui/MapControls.tsx`, añadir el botón junto al de imagen satelital, con el mismo patrón:

```tsx
      {/* El título no cambia con el estado, igual que el satelital y la
          lluvia: prende y apaga algo, y aria-pressed dice cuál de las dos. */}
      <Boton titulo="Tema oscuro" activo={oscuro} onClick={onTema}><Tema /></Boton>
```

Añadir `oscuro: boolean` y `onTema: () => void` a las props de `MapControls`, junto a `imagen`/`onImagen`.

En `src/App.tsx`: `const { tema, alternar } = usarTema()`, pasar `oscuro={tema === 'oscuro'}` y `onTema={alternar}` a `MapControls`, y `oscuro={tema === 'oscuro'}` a `<LimitesMunicipales>`.

- [ ] **Step 6: El blanco disfrazado de dato**

En `src/scene/CapaPuntos.tsx`, la etiqueta del marcador lleva `background: 'rgba(255,255,255,.82)'` fijo. Eso es chrome, no dato: en tema oscuro queda un rectángulo blanco sobre un mapa oscuro. Cámbialo por el token, añadiendo a las dos paletas de `tema.ts`:

```typescript
  etiquetaFondo: 'rgba(255,255,255,.82)',   // en TOKENS_CLARO
  etiquetaFondo: 'rgba(17,22,28,.82)',      // en TOKENS_OSCURO
```

y en `CapaPuntos.tsx` usar `T.etiquetaFondo` (añádelo también a `T` en `theme.ts` como `var(--etiquetaFondo)`). El color del texto ya sale de `T.texto`, así que ese acompaña solo.

- [ ] **Step 7: Comprobarlo con los ojos y con el e2e**

Run: `npm run dev`. Con el tema oscuro puesto, mira y pega capturas de:
- La ficha de vías con la rampa del PCI: el verde de "bueno" y el rojo de "malo" tienen que seguir distinguiéndose entre sí y del fondo.
- Las etiquetas de hospital.
- La atribución de OSM y Esri, que es obligación legal y no puede quedar ilegible.

Añadir al final de `e2e/capas.spec.ts`:

```typescript
  test('el tema cambia el chrome y NO cambia el color del dato', async () => {
    const fondoPanel = () => page.evaluate(() =>
      getComputedStyle(document.querySelector('[role="group"][aria-label="Capas del mapa"]')!)
        .backgroundColor)
    const claro = await fondoPanel()
    await page.getByRole('button', { name: 'Tema oscuro' }).click()
    await expect.poll(fondoPanel).not.toBe(claro)

    // La rampa del PCI es dato: el mismo verde de día y de noche.
    const rampa = await page.evaluate(() => getComputedStyle(document.documentElement)
      .getPropertyValue('--fondo'))
    expect(rampa.trim()).not.toBe('')
  })
```

- [ ] **Step 8: Correr todo**

Run: `npx tsc --noEmit -p tsconfig.json` → limpio.
Run: `npx vitest run` → verde. Anota el número.
Run: `npx playwright test capas` → verde, **sin vitest a la vez**.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: interruptor de tema claro y oscuro, con la eleccion recordada"
```

---

## Auto-revisión del plan

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| §3.2 deduplicar aristas | Task 1 |
| §3.3 drapeado en el pipeline | Task 2 |
| §3.4 archivos que aparecen | Tasks 2 y 3 |
| §3.5 cómo se dibuja | Task 4 |
| §3.6 el estilo | Task 4 (constantes) + Task 5 Step 2 (calibrar mirando) |
| §3.7 lo que se borra | Task 5 |
| §4.1 frontera chrome/dato | Task 6 (test que la protege) |
| §4.2 de objeto a variables | Task 6 |
| §4.3 la paleta oscura | Task 6 |
| §4.4 elegir, recordar, no imponer | Task 7 |
| §4.5 lo que hay que comprobar | Task 7 Step 7 |
| §5 cómo se prueba | repartido; el e2e en Tasks 5 y 7 |

Sin huecos.

**Riesgo que el plan no puede quitar:** la Task 2 depende de `npm run data`, que baja el DEM y consulta Overpass. Si en la máquina donde se ejecute eso no corre, la Task 2 queda BLOQUEADA y hay que decirlo, no inventar el binario. El resto del plan depende de ese archivo, así que el bloqueo es duro.
