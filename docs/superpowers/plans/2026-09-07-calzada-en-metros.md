# Calzada en metros — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que de 200 m de cámara para abajo las vías se vean como carreteras: ancho real en metros con perspectiva, juntas limpias, dos calzadas donde OSM tiene dos, y flechas de sentido en las de sentido único.

**Architecture:** Se sustituye el bloque de desplazamiento en píxeles del vertex shader de `LineMaterial` por una extrusión en metros sobre el plano horizontal, con el piso en píxeles calculado por vértice. La banda por nivel desaparece: cada vía se dibuja de su ancho (`aCalzada`), y el fragment shader deja de recortar. El pase de ids usa la misma extrusión. Las flechas se pintan en el fragment con la distancia recorrida (`vDist`) que ya existe.

**Tech Stack:** three@0.185 (`LineSegments2` + `LineMaterial` parcheado por `onBeforeCompile`) · @react-three/fiber · vitest · Playwright ad hoc sobre el Chrome del sistema para la verificación visual.

**Spec:** `docs/superpowers/specs/2026-09-07-calzada-en-metros-design.md`

## Global Constraints

- `worldUnits: false` se mantiene en los tres materiales: lo nuestro sustituye el bloque de pantalla de three, no activa su modo de mundo.
- Toda ancla contra el GLSL de three se comprueba antes de reemplazar y revienta con error si no aparece (mismo patrón que `ANCLA_VERT`).
- Las anclas viven SOLO en `roadsShader.ts`; `PickingPass.tsx` las importa.
- Lo que se dibuja se puede tocar: el pase de ids extruye con la misma fórmula que el visible.
- Literales GLSL siempre con punto decimal (`5.0`, no `5`).
- Nada se commitea sin que Samuel lo pida (regla del repo). Los pasos de commit de la plantilla se omiten a propósito.
- Comandos: `npm test -- <archivo>` corre un test; `npm test` la suite; `npx tsc --noEmit`; `npm run build`.

---

### Task 1: `porSegmento` — un valor por vía expandido a uno por segmento

**Files:**
- Modify: `src/scene/roadStyle.ts:157-166` (`cortePorSegmento`)
- Test: `src/scene/roadStyle.test.ts` (bloque `describe('corte')`)

**Interfaces:**
- Produces: `porSegmento(ways: Way[], index: Uint32Array, f: (w: Way) => number): Float32Array` — devuelve `index[ways.length]` floats, el de cada segmento igual a `f(vía dueña)`. `cortePorSegmento` pasa a estar definido sobre él (misma firma y resultado que hoy).

- [x] **Step 1: Test que falla**

Añadir dentro de `describe('corte', ...)` en `roadStyle.test.ts`, e importar `porSegmento` junto a `cortePorSegmento`:

```ts
  it('porSegmento expande un valor por vía a uno por segmento, en el orden del buffer', () => {
    // Tres vías con 2, 1 y 3 segmentos: CSR [0, 2, 3, 6].
    const vias = [
      { highway: 'residential' }, { highway: 'motorway' }, { highway: 'footway' },
    ] as Way[]
    const index = new Uint32Array([0, 2, 3, 6])
    const out = porSegmento(vias, index, w => w.highway.length)
    expect(Array.from(out)).toEqual([11, 11, 8, 7, 7, 7])
  })

  it('cortePorSegmento es porSegmento con el corte del nivel', () => {
    const vias = [{ highway: 'residential' }, { highway: 'motorway' }] as Way[]
    const index = new Uint32Array([0, 1, 2])
    expect(Array.from(cortePorSegmento(vias, index)))
      .toEqual(Array.from(porSegmento(vias, index, w => Math.min(mppCorte(NIVELES[nivelDe(w.highway)]), SIN_CORTE))))
  })
```

(`SIN_CORTE` también hay que importarlo.)

- [x] **Step 2: Verlo fallar**

Run: `npm test -- src/scene/roadStyle.test.ts`
Expected: FAIL, `porSegmento is not a function` / no exportado.

- [x] **Step 3: Implementar**

En `roadStyle.ts`, sustituir `cortePorSegmento` por:

```ts
/** Expande un valor por VÍA a uno por SEGMENTO, en el orden plano del buffer
 *  de posiciones. `index` es el mismo CSR que usa repartirPorNivel. Lo usan
 *  el corte y la calzada del pase de ids (PickingPass.tsx), que dibuja toda
 *  la red en un solo objeto y necesita sus atributos en ese orden. */
export function porSegmento (ways: Way[], index: Uint32Array, f: (w: Way) => number): Float32Array {
  const out = new Float32Array(index[ways.length])
  for (let i = 0; i < ways.length; i++) out.fill(f(ways[i]), index[i], index[i + 1])
  return out
}

/** El corte de cada SEGMENTO, para que el pase de ids pueda descartar lo que
 *  el acercamiento ya apagó (PickingPass.tsx). */
export const cortePorSegmento = (ways: Way[], index: Uint32Array): Float32Array =>
  porSegmento(ways, index, w => Math.min(mppCorte(NIVELES[nivelDe(w.highway)]), SIN_CORTE))
```

- [x] **Step 4: Verlo pasar**

Run: `npm test -- src/scene/roadStyle.test.ts`
Expected: PASS, incluidos los tests previos de `cortePorSegmento`.

---

### Task 2: Canales por defecto en sentido único

**Files:**
- Modify: `src/scene/calzada.ts:10-39`
- Test: `src/scene/calzada.test.ts:37-42`

**Interfaces:**
- Produces: `carrilesDe(via)` sin cambio de firma. Sin `lanes`: sentido único → `[1, 1, 1, 2, 2, 2, 2][nivel]`; doble sentido → `[1, 1, 2, 2, 2, 2, 4][nivel]`.

- [x] **Step 1: Tests que fallan**

Reemplazar el test `'un sentido único sin dato de carriles lleva la mitad: no hay vuelta que dibujar'` por estos tres:

```ts
  it('una avenida de sentido único sin dato lleva dos canales, no la mitad de la calzada', () => {
    // OSM: de las secundarias y terciarias de sentido único que sí traen
    // lanes, ninguna terciaria dice 1 y las secundarias dicen 2 en su mayoría.
    // Una vía dividida en dos ways es una calzada por way, y esa calzada tiene
    // dos canales; con "la mitad del nivel" la Avenida Libertador salía de
    // uno y se dibujaba de 3,4 m.
    for (const h of ['tertiary', 'secondary', 'primary', 'trunk', 'motorway']) {
      expect(carrilesDe(via({ highway: h, oneway: true }))).toBe(2)
    }
  })

  it('una calle o vía de servicio de sentido único lleva uno', () => {
    for (const h of ['residential', 'service', 'living_street', 'track']) {
      expect(carrilesDe(via({ highway: h, oneway: true }))).toBe(1)
    }
  })

  it('el sentido único nunca lleva más canales que la calzada completa de su nivel', () => {
    for (const h of ['footway', 'track', 'residential', 'tertiary', 'secondary', 'primary', 'motorway']) {
      expect(carrilesDe(via({ highway: h, oneway: true })))
        .toBeLessThanOrEqual(carrilesDe(via({ highway: h, oneway: false })))
    }
  })
```

- [x] **Step 2: Verlos fallar**

Run: `npm test -- src/scene/calzada.test.ts`
Expected: FAIL en el primero (`tertiary` da 1, esperado 2). Los otros dos pasan ya; se quedan porque fijan el invariante contra un retoque futuro de la tabla.

- [x] **Step 3: Implementar**

En `calzada.ts`, sustituir la constante `CANALES_POR_NIVEL` y su comentario, y el final de `carrilesDe`:

```ts
// Canales por defecto de cada nivel de la jerarquía, cuando OSM no dice
// cuántos hay -- que es el caso de 25.734 de las 26.712 vías. Salen del NIVEL
// y no de una lista de clases sueltas para que el ancho que resulte quepa en
// el ancho de referencia del nivel (NIVELES[n].metros, ver anchoCalzada).
//
// La segunda fila es sentido único. Una vía dividida en dos ways representa
// una sola calzada, así que no lleva la calzada completa; pero tampoco la
// mitad exacta: en el .cache de OSM, de las vías de sentido único que sí
// traen `lanes`, ninguna terciaria dice 1 canal y las secundarias dicen 2 en
// su mayoría. Con "la mitad" la Avenida Libertador salía de un canal.
const CANALES_POR_NIVEL = [1, 1, 2, 2, 2, 2, 4] as const
const CANALES_SENTIDO_UNICO = [1, 1, 1, 2, 2, 2, 2] as const
```

```ts
export function carrilesDe (via: Way): number {
  if (carrilesValidos(via.lanes)) return via.lanes
  if (PEATONALES.has(via.highway)) return 1
  const n = nivelDe(via.highway)
  return sentidoUnico(via) ? CANALES_SENTIDO_UNICO[n] : CANALES_POR_NIVEL[n]
}
```

Y en `anchoCalzada`, actualizar el comentario del tope (el dibujo ya no depende de él):

```ts
  // Acotado al ancho de referencia de su nivel. Ya no sostiene el dibujo (cada
  // vía se extruye de su propio ancho, roadsShader.ts): es una cota de
  // cordura contra un `lanes` disparatado de OSM, como la residential de seis
  // canales que hay en el dataset, que saldría de 20 m.
  return Math.min(metros, NIVELES[nivelDe(via.highway)].metros)
```

- [x] **Step 4: Verlos pasar**

Run: `npm test -- src/scene/calzada.test.ts`
Expected: PASS. El test `'no se aleja del ancho de referencia de su nivel'` sigue pasando (2 × 3,4 = 6,8 ≤ 9 de terciaria).

---

### Task 3: El pipeline orienta los nodos en el sentido de circulación

**Files:**
- Modify: `scripts/lib/road-meta.mjs`
- Modify: `scripts/build-data.mjs:38` (después de `waysToLines`)
- Modify: `src/data/types.ts:14` (comentario)
- Test: `scripts/test/road-meta.test.mjs`

**Interfaces:**
- Produces: `orientar(coords, oneway)` → los mismos `coords` si `oneway` no es `-1`/`'-1'`; una copia invertida si lo es.

- [x] **Step 1: Test que falla**

Añadir a `road-meta.test.mjs` (importar `orientar`):

```js
describe('orientar', () => {
  const coords = [[-72.1, 7.7], [-72.2, 7.8], [-72.3, 7.9]]

  it('invierte los nodos de un oneway=-1 para que el orden sea el sentido de circulación', () => {
    for (const value of ['-1', ' -1 ', -1]) {
      expect(orientar(coords, value)).toEqual([[-72.3, 7.9], [-72.2, 7.8], [-72.1, 7.7]])
    }
  })

  it('no toca la geometría de ninguna otra vía, ni la copia', () => {
    for (const value of ['yes', 'no', undefined, null, '1', 'reversible']) {
      expect(orientar(coords, value)).toBe(coords)
    }
  })

  it('no muta la entrada', () => {
    const copia = coords.map(c => [...c])
    orientar(coords, '-1')
    expect(coords).toEqual(copia)
  })
})
```

- [x] **Step 2: Verlo fallar**

Run: `npm test -- scripts/test/road-meta.test.mjs`
Expected: FAIL, `orientar` no exportado.

- [x] **Step 3: Implementar**

En `road-meta.mjs`:

```js
/** Deja los nodos en el sentido de circulación. OSM escribe oneway=-1 para
 *  "sentido único, contra el orden de los nodos", y normalizeOneway lo funde
 *  en true: la dirección tiene que quedar en la geometría, porque el shader
 *  dibuja las flechas hacia el final de la vía (roadsShader.ts). Devuelve el
 *  mismo array si no hay nada que invertir, y una copia si lo hay. */
export function orientar (coords, oneway) {
  const v = typeof oneway === 'string' ? oneway.trim() : oneway
  return v === '-1' || v === -1 ? coords.slice().reverse() : coords
}
```

En `build-data.mjs`, tras `const lines = waysToLines(await overpass(QUERY_VIAS, 'vias'))`:

```js
  for (const l of lines) l.coords = orientar(l.coords, l.tags.oneway)
```

y sumar `orientar` al import de `./lib/road-meta.mjs`.

En `types.ts`, la línea del campo:

```ts
  // true = circula en el orden de los nodos: el pipeline invierte las vías
  // con oneway=-1 al empaquetar (scripts/lib/road-meta.mjs, orientar).
  oneway?: boolean | null
```

- [x] **Step 4: Verlo pasar**

Run: `npm test -- scripts/test/road-meta.test.mjs`
Expected: PASS. No hace falta regenerar `public/data`: el `.cache/vias.json` actual tiene 0 vías con `oneway=-1`.

---

### Task 4: Extrusión en metros en el pase visible

**Files:**
- Modify: `src/scene/roadsShader.ts` (anclas nuevas, `extrusionGlsl`, `parcharExtrusion`, `ATTR_VERT_GLSL`, fragment)
- Modify: `src/scene/Roads.tsx:81-151`
- Test: `src/scene/roadsShader.test.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces (exportados de `roadsShader.ts`, los usa Task 6):
  - `ANCLA_EXTRUSION_INICIO = 'vec2 offset = vec2( dir.y, - dir.x );'`
  - `ANCLA_EXTRUSION_FIN = 'clip.xy += offset;'`
  - `extrusionGlsl(casing: boolean, colofon?: string): string` — el bloque GLSL; deja en scope `mppV`, `anchoBase`, `anchoM`; requiere `attribute float aCalzada;` y `uniform float uPisoPx;` declarados por quien lo use.
  - `parcharExtrusion(vertexShader: string, glsl: string): string` — reemplaza desde el inicio de la primera ancla hasta el final de la segunda; lanza si falta alguna.
- Los materiales del pase visible dejan de tener los uniforms `uMpp` y `uBandaPx`; conservan `uPisoPx`.

- [x] **Step 1: Tests que fallan**

En `roadsShader.test.ts`, ampliar el import con `ANCLA_EXTRUSION_INICIO, ANCLA_EXTRUSION_FIN, extrusionGlsl, parcharExtrusion` y añadir:

```ts
// La extrusión en metros reemplaza el bloque de desplazamiento en pantalla
// de three. Si three lo mueve o lo renombra, esto tiene que reventar acá y no
// en un mapa donde las vías salen de ancho cero.
test('las anclas de la extrusión existen, una vez y en orden, en el LineMaterial instalado', () => {
  const { vertexShader } = new LineMaterial()
  const a = vertexShader.indexOf(ANCLA_EXTRUSION_INICIO)
  const b = vertexShader.indexOf(ANCLA_EXTRUSION_FIN)
  expect(a).toBeGreaterThan(-1)
  expect(b).toBeGreaterThan(a)
  expect(vertexShader.lastIndexOf(ANCLA_EXTRUSION_INICIO)).toBe(a)
  expect(vertexShader.lastIndexOf(ANCLA_EXTRUSION_FIN)).toBe(b)
})

test('el vertex shader parcheado extruye en metros y ya no desplaza en píxeles', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  expect(shader.vertexShader).not.toContain(ANCLA_EXTRUSION_FIN)
  expect(shader.vertexShader).not.toContain('offset *= linewidth;')
  expect(shader.vertexShader).toContain('float mppV')
  expect(shader.vertexShader).toContain('attribute float aCalzada;')
  // Lo que el fragment necesita, calculado por vértice y no por uniform.
  for (const v of ['vCalzadaPx', 'vAnchoPx', 'vMpp']) {
    expect(shader.vertexShader).toContain(`varying float ${v};`)
    expect(shader.fragmentShader).toContain(`varying float ${v};`)
  }
  expect(shader.uniforms.uMpp).toBeUndefined()
  expect(shader.uniforms.uBandaPx).toBeUndefined()
  expect(shader.uniforms.uPisoPx).toBeDefined()
})

test('el contorno se extruye más ancho que el relleno; el relleno, de la calzada', () => {
  expect(extrusionGlsl(false)).toContain('float anchoM = anchoBase;')
  expect(extrusionGlsl(true)).toMatch(/float anchoM = anchoBase \+ min\(/)
})

test('parcharExtrusion lanza si falta cualquiera de las dos anclas', () => {
  const { vertexShader } = new LineMaterial()
  expect(() => parcharExtrusion(vertexShader.replace(ANCLA_EXTRUSION_INICIO, '//'), 'x')).toThrow(/desplazamiento/)
  expect(() => parcharExtrusion(vertexShader.replace(ANCLA_EXTRUSION_FIN, '//'), 'x')).toThrow(/desplazamiento/)
})

test('el fragment ya no recorta a una fracción de banda: la banda ES la calzada', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  expect(shader.fragmentShader).not.toContain('fraccion')
  expect(shader.fragmentShader).not.toContain('uBandaPx')
  expect(shader.fragmentShader).toContain('float t = vUv.x;')
})
```

- [x] **Step 2: Verlos fallar**

Run: `npm test -- src/scene/roadsShader.test.ts`
Expected: FAIL por exportaciones inexistentes (`ANCLA_EXTRUSION_INICIO` undefined, `extrusionGlsl is not a function`).

- [x] **Step 3: Implementar el vertex shader en `roadsShader.ts`**

Añadir después de `ANCLA_FRAG`:

```ts
/** Principio y fin del bloque del vertex shader de LineMaterial que desplaza
 *  el vértice en PÍXELES de pantalla (su modo worldUnits: false). Se
 *  sustituye entero por la extrusión en metros de abajo. El modo worldUnits
 *  de three no sirve para esto: orienta la cinta hacia la cámara y mide la
 *  distancia en 3D, como un tubo; una carretera es una banda plana sobre el
 *  terreno. */
export const ANCLA_EXTRUSION_INICIO = 'vec2 offset = vec2( dir.y, - dir.x );'
export const ANCLA_EXTRUSION_FIN = 'clip.xy += offset;'

// Cuánto sobresale el contorno oscuro, en píxeles de ancho total. El tope
// constante es lo que hace que a escala de calle el borde sea una orilla fina
// y no un marco; la parte proporcional evita que a lo lejos, con la vía en su
// piso de menos de 1 px, el contorno la envuelva y la convierta en una raya
// oscura sin color adentro. Medido en pantalla: a partir de ~5 px por lado la
// vía deja de parecer un brochazo; con 10 de tope, una troncal de 50 px no se
// queda sin color.
const CASING_MAX = 10
const CASING_REL = 0.6

/**
 * Extrusión de cada tramo a su ancho REAL en metros, sobre el plano horizontal
 * del mundo, con el piso en píxeles del nivel calculado a la profundidad de
 * cada vértice. Es lo que hace que a 30 m de vista el tramo cercano salga más
 * ancho que el lejano, y que dos calzadas de una avenida queden separadas.
 *
 * Trabaja en espacio de cámara con `start` y `end`, que el código de three
 * que queda arriba ya recortó al near plane. `projectionMatrix[1][1]` es
 * 1 / tan(fov/2), así que `mppV` es metrosPorPixel() (roadStyle.ts) evaluado
 * donde está el vértice y no en el punto que mira la cámara.
 *
 * El cuadrilátero que sale mide `anchoM` de ancho y se alarga `anchoM / 2` en
 * cada extremo: en coordenadas `vUv` es exactamente la forma que el test de
 * tapa redonda del fragment shader de three espera, así que las tapas quedan
 * del ancho de la vía por construcción. Con la banda por nivel de antes, la
 * tapa tenía el radio de la banda y el cuerpo el de la calzada, y en cada
 * junta sobresalía un pico.
 *
 * La última línea es el mismo ajuste de profundidad del modo worldUnits de
 * three: todos los vértices del cuadrilátero toman la z del eje, para que los
 * tramos solapen limpio en las juntas y el borde exterior no se hunda en una
 * ladera.
 *
 * Deja en scope `mppV`, `anchoBase` (la calzada) y `anchoM` (lo que se
 * extruye) para que `colofon` rellene los varyings que necesite. Requiere
 * `attribute float aCalzada;` y `uniform float uPisoPx;` declarados.
 */
export function extrusionGlsl (casing: boolean, colofon = ''): string {
  return `
        vec4 eje = ( position.y < 0.5 ) ? start : end;
        vec3 largo = end.xyz - start.xyz;
        vec3 dirV = dot( largo, largo ) > 0.0 ? normalize( largo ) : vec3( 1.0, 0.0, 0.0 );
        vec3 arribaV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
        vec3 ladoV = normalize( cross( arribaV, dirV ) );
        float mppV = max( -eje.z, 1e-3 ) * 2.0 / ( projectionMatrix[1][1] * resolution.y );
        float anchoBase = max( aCalzada, uPisoPx * mppV );
        float anchoM = ${casing
          ? `anchoBase + min( ${CASING_MAX.toFixed(1)}, ${CASING_REL.toFixed(1)} * anchoBase / mppV ) * mppV;`
          : 'anchoBase;'}
        float hw = 0.5 * anchoM;
        eje.xyz += ladoV * ( hw * position.x );
        if ( position.y < 0.0 ) eje.xyz -= dirV * hw;
        else if ( position.y > 1.0 ) eje.xyz += dirV * hw;
        vec4 clip = projectionMatrix * eje;
        vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
        clip.z = clipPose.z * clip.w;
        ${colofon}
  `
}

/** Sustituye el bloque de pantalla de three (entre las dos anclas, ambas
 *  incluidas) por `glsl`. Lo usan el pase visible y el de ids. */
export function parcharExtrusion (vertexShader: string, glsl: string): string {
  const a = vertexShader.indexOf(ANCLA_EXTRUSION_INICIO)
  const b = vertexShader.indexOf(ANCLA_EXTRUSION_FIN)
  if (a < 0 || b < a) {
    throw new Error('roadsShader: no se encontró el bloque de desplazamiento en pantalla del vertex shader de LineMaterial')
  }
  return vertexShader.slice(0, a) + glsl + vertexShader.slice(b + ANCLA_EXTRUSION_FIN.length)
}
```

Reescribir `ATTR_VERT_GLSL`:

```ts
export const ATTR_VERT_GLSL = `
      attribute float segId;
      attribute float aCalzada;
      attribute float aCanales;
      attribute float instanceDistanceStart;
      attribute float instanceDistanceEnd;
      uniform sampler2D uAttr;
      uniform float uAttrSize;
      uniform float uPisoPx;
      varying vec4 vAttr;
      varying float vCalzadaPx;
      varying float vAnchoPx;
      varying float vMpp;
      varying float vCanales;
      varying float vDist;
      void main() {
        vAttr = texture2D(uAttr, (vec2(
          mod(segId, uAttrSize), floor(segId / uAttrSize)) + 0.5) / uAttrSize);
        vCanales = aCanales;
        // Distancia recorrida a lo largo de la vía, en metros, para la fase de
        // las rayas discontinuas y las flechas. Dentro de una vía los
        // segmentos van consecutivos, así que es continua a lo largo del trazo.
        vDist = (position.y < 0.5) ? instanceDistanceStart : instanceDistanceEnd;
`
```

(Se va `uniform float uMpp;` y la línea `vCalzadaPx = max(uPisoPx, aCalzada / ...)`: ahora la pone la extrusión.)

En `patchLineMaterial`, dentro de `onBeforeCompile`:

- quitar `shader.uniforms.uMpp = ...` y `shader.uniforms.uBandaPx = ...`; queda `uPisoPx`.
- sustituir la línea `shader.vertexShader = shader.vertexShader.replace(ANCLA_VERT, ATTR_VERT_GLSL)` por:

```ts
    shader.vertexShader = parcharExtrusion(
      shader.vertexShader.replace(ANCLA_VERT, ATTR_VERT_GLSL),
      extrusionGlsl(casing, `
        // Lo que el fragment necesita en píxeles, a la profundidad de ESTE
        // vértice. La calzada es siempre la del relleno, también cuando se
        // está dibujando el contorno: es la referencia de las marcas.
        vCalzadaPx = anchoBase / mppV;
        vAnchoPx = anchoM / mppV;
        vMpp = mppV;`),
    )
```

- [x] **Step 4: Implementar el fragment shader en `roadsShader.ts`**

En el reemplazo de `ANCLA_VERT` del fragment, las declaraciones pasan a:

```ts
        varying vec4 vAttr;
        varying float vCalzadaPx;
        varying float vAnchoPx;
        varying float vMpp;
        varying float vCanales;
        varying float vDist;
```

(se van `uniform float uMpp;` y `uniform float uBandaPx;`).

En el reemplazo de `ANCLA_FRAG`, sustituir el bloque del recorte (desde el comentario `// Recorte a la calzada real de ESTA vía.` hasta `alpha *= 1.0 - smoothstep(1.0 - aaBorde, 1.0, abs(t));`) por:

```glsl
        // Coordenada transversal: -1 a +1 a lo ancho de lo que este pase
        // extruye (la calzada en el relleno, la calzada más el borde en el
        // contorno). Ya no hay banda de nivel que recortar: cada vía se dibuja
        // de su ancho desde el vertex shader.
        float t = vUv.x;
        // Antialiasing del filo, también en las tapas redondas: three descarta
        // fuera del círculo a secas, y a 400 px de ancho el escalón se nota en
        // cada final de vía.
        float aaBorde = 2.0 / max(vAnchoPx, 1.0);
        float r = abs(vUv.y) > 1.0 ? length(vec2(vUv.x, abs(vUv.y) - 1.0)) : abs(vUv.x);
        alpha *= 1.0 - smoothstep(1.0 - aaBorde, 1.0, r);
```

En `MARCAS_CUERPO_GLSL`, cambiar las tres apariciones de `uMpp` por `vMpp` (`w = ...`, `e = ...`).

- [x] **Step 5: `Roads.tsx`**

- Import: `import { NIVELES, repartirPorNivel, metrosPorPixel, presencia } from './roadStyle'` (se van `anchoPx`, `anchoCasingPx`).
- Constructor del material: `new LineMaterial({ worldUnits: false, transparent: true, depthWrite: false })` (se va `linewidth: 2`).
- El bucle de `useFrame` queda:

```ts
    for (const o of objetos) {
      const alpha = presencia(o.nivel, mpp)
      // Un nivel apagado no se dibuja en absoluto, en vez de dibujarse con
      // opacidad 0: son dos draw calls de decenas de miles de segmentos que a
      // vista de estado no aportan un solo píxel. El pase de ids descarta los
      // mismos por el mismo corte (PickingPass.tsx).
      o.relleno.linea.visible = alpha > 0
      o.casing.linea.visible = alpha > 0
      // La opacidad del material es la base que el shader multiplica por el
      // foco y la selección (roadsShader.ts), así que el desvanecimiento por
      // acercamiento se compone con los otros dos sin tocar el GLSL.
      o.relleno.material.opacity = alpha
      o.casing.material.opacity = alpha
      // El ancho ya no se fija acá: lo extruye el vertex shader en metros, con
      // el piso en píxeles del nivel evaluado en cada vértice (roadsShader.ts).
      // Solo hay que decirle el piso; `resolution` ya la pone el efecto de
      // arriba.
      for (const capa of [o.relleno, o.casing]) {
        const u = capa.material.userData.uniforms
        if (u) u.uPisoPx.value = o.nivel.pisoPx
      }
    }
```

Actualizar el comentario del `useFrame` (línea 110): "La presencia de cada nivel depende de cuánto terreno cabe en un píxel, así que se recalcula mientras la cámara se mueve."

Y el comentario de `porVia` (líneas 48-53): "Ancho de calzada y canales de cada vía: el ancho es lo que el vertex shader extruye en metros, y los canales dicen cuántas separaciones pintar, si lleva eje de doble sentido y si lleva flechas."

- [x] **Step 6: Verlos pasar**

Run: `npm test -- src/scene/roadsShader.test.ts && npx tsc --noEmit`
Expected: PASS y typecheck limpio. (`picking.test.ts` sigue pasando: el pase de ids no cambia hasta Task 6.)

---

### Task 5: Flechas de sentido

**Files:**
- Modify: `src/scene/roadsShader.ts` (`MARCAS_CUERPO_GLSL` y constantes)
- Test: `src/scene/roadsShader.test.ts`

**Interfaces:**
- Produces: constantes exportadas `FLECHA_M = 5`, `CABEZA_M = 2`, `CABEZA_ANCHO_M = 1.2`, `TALLO_M = 0.3`, `FLECHA_CICLO_M = 40`.

- [x] **Step 1: Tests que fallan**

```ts
import { ..., FLECHA_M, CABEZA_M, CABEZA_ANCHO_M, TALLO_M, FLECHA_CICLO_M } from './roadsShader'

test('las flechas de sentido se pintan solo en sentido único y hacia vDist creciente', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  const f = shader.fragmentShader
  expect(f).toContain('float flecha')
  // Dentro del condicional de sentido único, y después de que `unico` existe.
  expect(f.indexOf('float unico')).toBeLessThan(f.indexOf('float flecha'))
  expect(f).toMatch(/if\s*\(\s*unico\s*>\s*0\.5\s*\)/)
  // La cabeza se estrecha hacia FLECHA_M: la punta va al final de la vía.
  expect(f).toContain(`(${FLECHA_M.toFixed(2)} - u)`)
  // El contorno no lleva flechas: es el mismo trazo, pero solo borde.
  const contorno = new LineMaterial()
  patchLineMaterial(contorno, {} as DataTexture, 164, true)
  const sc = realShader(contorno)
  ;(contorno as any).onBeforeCompile(sc)
  expect(sc.fragmentShader).not.toContain('float flecha')
})

test('la flecha tiene las proporciones de una flecha de pavimento', () => {
  // Norma: 5 m de largo en vía urbana, cabeza más ancha que el tallo, y cabe
  // en un canal de 3,4 m con margen. El ciclo deja varias por cuadra.
  expect(FLECHA_M).toBeGreaterThan(CABEZA_M)
  expect(CABEZA_ANCHO_M).toBeGreaterThan(TALLO_M * 2)
  expect(CABEZA_ANCHO_M).toBeLessThan(3.0)
  expect(FLECHA_CICLO_M).toBeGreaterThan(FLECHA_M * 4)
  expect(FLECHA_CICLO_M).toBeLessThanOrEqual(60)
})
```

- [x] **Step 2: Verlos fallar**

Run: `npm test -- src/scene/roadsShader.test.ts`
Expected: FAIL, constantes `undefined` y `float flecha` ausente.

- [x] **Step 3: Implementar**

Constantes, junto a `MARCA_M` y compañía:

```ts
// Flecha de sentido, medidas de pavimento urbano: 5 m de largo, cabeza de
// 2 m por 1,20 de ancho, tallo de 30 cm. Una por canal, y cada 40 m -- unas
// dos o tres por cuadra, como en la calle. Solo en sentido único: en doble
// sentido el eje amarillo ya dice lo que hay que decir, y la calle real no
// las lleva. Calibrables.
export const FLECHA_M = 5
export const CABEZA_M = 2
export const CABEZA_ANCHO_M = 1.2
export const TALLO_M = 0.3
export const FLECHA_CICLO_M = 40
// A cuántos metros del arranque de cada vía cae la primera: un ramal de 50 m
// se lleva una flecha en vez de ninguna.
const FLECHA_DESDE_M = 10

const f2 = (n: number) => n.toFixed(2)
```

En `MARCAS_CUERPO_GLSL`, después de `base = mix(base, ${PINTURA_AMARILLA}, me);` y antes de cerrar el `if`:

```ts
      // Flechas de sentido, hacia vDist creciente: el orden de nodos de OSM,
      // que el pipeline deja en el sentido de circulación (orientar,
      // scripts/lib/road-meta.mjs). Se dibujan en METROS sobre la calzada
      // real, con el mismo piso de píxeles que el resto de la pintura.
      if (unico > 0.5) {
        float calzadaM = vCalzadaPx * vMpp;
        float u = mod(vDist - ${f2(FLECHA_DESDE_M)}, ${f2(FLECHA_CICLO_M)});   // metros desde el arranque de la flecha
        float tallo = max(${f2(TALLO_M)}, ${f2(MARCA_MIN_PX)} * vMpp) * 0.5;
        float cuello = ${f2(FLECHA_M - CABEZA_M)};
        float flecha = 0.0;
        for (int k = 0; k < 8; k++) {
          if (float(k) >= canales) break;
          float ck = -1.0 + (2.0 * float(k) + 1.0) / canales;      // centro del canal k
          float dm = abs(t - ck) * calzadaM * 0.5;                  // metros al centro del canal
          float enTallo = smoothstep(-e, 0.0, u) * (1.0 - smoothstep(cuello - e, cuello, u))
                        * (1.0 - smoothstep(tallo - e, tallo + e, dm));
          float semi = ${f2(CABEZA_ANCHO_M / 2)} * clamp((${f2(FLECHA_M)} - u) / ${f2(CABEZA_M)}, 0.0, 1.0);
          float enCabeza = smoothstep(cuello - e, cuello, u) * (1.0 - smoothstep(${f2(FLECHA_M)} - e, ${f2(FLECHA_M)}, u))
                         * (1.0 - smoothstep(semi - e, semi + e, dm));
          flecha = max(flecha, max(enTallo, enCabeza));
        }
        base = mix(base, pintura, flecha * detalle);
      }
```

(`e`, `t`, `canales`, `pintura` y `detalle` ya existen en ese scope.)

- [x] **Step 4: Verlos pasar**

Run: `npm test -- src/scene/roadsShader.test.ts`
Expected: PASS.

---

### Task 6: El pase de ids extruye igual

**Files:**
- Modify: `src/scene/PickingPass.tsx:60-127` (`patchPickMaterial`), `:141-153` (geometría)
- Test: `src/scene/picking.test.ts`

**Interfaces:**
- Consumes: `extrusionGlsl`, `parcharExtrusion` (Task 4); `porSegmento` (Task 1); `anchoCalzada` (`calzada.ts`).
- Produces: el material de ids gana el uniform `uPisoPx` (valor `PICK_WIDTH`) y el atributo `aCalzada`.

- [x] **Step 1: Tests que fallan**

En `picking.test.ts` (importar `ANCLA_EXTRUSION_FIN` de `./roadsShader` y `PICK_WIDTH` de `./PickingPass`):

```ts
// Lo que se dibuja se puede tocar, también a 30 m: el pase visible extruye
// cada vía a su ancho en metros, y si el de ids siguiera picando en 8 px
// fijos, una avenida de 400 px solo se seleccionaría por su eje.
test('el pase de ids extruye en metros con la misma fórmula que el visible', () => {
  const { vertexShader, uniforms } = shaderParcheado()
  expect(vertexShader).toContain('attribute float aCalzada;')
  expect(vertexShader).toContain('float anchoBase = max( aCalzada, uPisoPx * mppV );')
  expect(vertexShader).not.toContain(ANCLA_EXTRUSION_FIN)
  // El piso del pase de ids es el área de acierto generosa de siempre.
  expect(uniforms.uPisoPx?.value).toBe(PICK_WIDTH)
})
```

- [x] **Step 2: Verlo fallar**

Run: `npm test -- src/scene/picking.test.ts`
Expected: FAIL, `aCalzada` ausente.

- [x] **Step 3: Implementar**

Imports en `PickingPass.tsx`:

```ts
import { ANCLA_VERT, ANCLA_FRAG, extrusionGlsl, parcharExtrusion } from './roadsShader'
import { cortePorSegmento, porSegmento, metrosPorPixel } from './roadStyle'
import { anchoCalzada } from './calzada'
```

En `patchPickMaterial`, junto a `uniforms.uMpp`:

```ts
  ;(material as THREE.ShaderMaterial).uniforms.uPisoPx = { value: PICK_WIDTH }
```

y el reemplazo del vertex shader pasa a:

```ts
    shader.vertexShader = parcharExtrusion(
      shader.vertexShader.replace(ANCLA_VERT, `
        attribute float segId;
        attribute float aCorte;
        attribute float aCalzada;
        uniform float uPisoPx;
        varying float vSegId;
        varying float vCorte;
        void main() {
          vSegId = segId;
          vCorte = aCorte;
      `),
      // Misma extrusión que el pase visible (roadsShader.ts): lo que se dibuja
      // se puede tocar, también de cerca. El piso es PICK_WIDTH, no el del
      // nivel: el área de acierto de una vía fina a lo lejos sigue siendo
      // generosa.
      extrusionGlsl(false),
    )
```

En el `useMemo` de la geometría:

```ts
    geometry.setAttribute('aCalzada', new THREE.InstancedBufferAttribute(porSegmento(ways, index, anchoCalzada), 1))
```

Actualizar el comentario de `PICK_WIDTH` (línea ~25): ya no es el `linewidth` del material sino el piso en píxeles de la extrusión; la línea `linewidth: PICK_WIDTH` del constructor se puede quitar (`new LineMaterial({ worldUnits: false })`).

- [x] **Step 4: Verlo pasar**

Run: `npm test -- src/scene/picking.test.ts src/scene/roadsShader.test.ts && npx tsc --noEmit`
Expected: PASS (incluido `'contorno, relleno y picking piden programas distintos'`).

---

### Task 7: Se va la banda por nivel

**Files:**
- Modify: `src/scene/roadStyle.ts:1-94, 130-132, 168-183`
- Test: `src/scene/roadStyle.test.ts:54-155`

**Interfaces:**
- `Nivel` pierde `topePx`; se eliminan `anchoPx` y `anchoCasingPx`. Nadie más los importa después de Task 4 (comprobar con `grep -rn "anchoPx\|topePx" src`).

- [x] **Step 1: Reescribir los tests**

Borrar el bloque `describe('ancho', ...)` entero (líneas 54-155) y poner en su lugar:

```ts
describe('piso', () => {
  it('el piso en píxeles es la jerarquía visible a lo lejos', () => {
    // A vista de estado hasta una troncal de 24 m mide 0,23 px: ahí manda el
    // piso, y es el piso el que dibuja la jerarquía. Lo aplica el vertex
    // shader por vértice (roadsShader.ts); acá solo se fija que crezca con
    // el nivel.
    for (let i = 1; i < NIVELES.length; i++) {
      expect(NIVELES[i].pisoPx).toBeGreaterThan(NIVELES[i - 1].pisoPx)
    }
    for (const n of NIVELES) expect(n.pisoPx).toBeLessThan(5)
  })

  it('el ancho de referencia crece con el nivel', () => {
    for (let i = 1; i < NIVELES.length; i++) {
      expect(NIVELES[i].metros).toBeGreaterThan(NIVELES[i - 1].metros)
    }
  })
})
```

Quitar `anchoPx` y `anchoCasingPx` del import.

- [x] **Step 2: Verlo fallar**

Run: `npm test -- src/scene/roadStyle.test.ts`
Expected: pasa ya (los tests nuevos no dependen de nada nuevo) — es el caso permitido de tests que fijan una propiedad existente; lo que se comprueba en el paso siguiente es que borrar el código no rompe nada.

- [x] **Step 3: Borrar en `roadStyle.ts`**

- Quitar `topePx` de la interfaz `Nivel` (con su docstring) y de las siete filas de `NIVELES`.
- Quitar `anchoPx`, `CASING_MAX`, `CASING_REL` y `anchoCasingPx` (ya viven en `roadsShader.ts`).
- Reescribir el comentario de cabecera del archivo:

```ts
// Jerarquía de dibujo de la red vial. Todo lo que decide cuánto se ve una vía
// vive acá: en qué nivel cae cada clase de OSM, qué piso en píxeles tiene a
// lo lejos y cuánta presencia tiene. Roads.tsx solo aplica los números, y el
// ancho lo extruye el vertex shader (roadsShader.ts):
//
//     ancho = max(calzada de la vía en metros, pisoPx · metrosPorPixel)
//
// evaluado en cada vértice. A vista de estado (~105 m por píxel) hasta una
// troncal de 24 m mide 0,23 px: ahí manda el piso, y es el piso el que dibuja
// la jerarquía. A escala de calle (~1 m por píxel) manda el ancho real, y de
// ahí para abajo la vía crece como crece una carretera al acercarse. No hay
// techo: la que había existía por las tapas de LineSegments2, que ahora salen
// del ancho de la vía por construcción.
```

- Actualizar el docstring de `metros`: "Ancho de referencia del nivel, en metros. Es la cota de `anchoCalzada` (calzada.ts) y lo que se usa donde hace falta un ancho por nivel sin mirar la vía."

- [x] **Step 4: Verlo pasar**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: suite entera en verde, typecheck y build limpios (queda el aviso de tamaño de chunk que ya existía).

---

### Task 8: Verificación en Chrome

**Files:**
- Scratchpad: `cerca.mjs` (ya existe; encuadra la Avenida Libertador y acerca siete veces con capturas) y un `lazo-cerca.mjs` nuevo.

- [x] **Step 1: Capturas del acercamiento**

Run (con `npm run dev` corriendo):

```bash
cd <scratchpad> && node cerca.mjs "$PWD/shots"
```

Mirar `c3.png` (500 m), `c4.png` (250 m), `c5.png` (125 m), `c6.png` (62 m), `c7.png` (31 m) y juzgar contra el spec §7:
- sin sierra ni picos en las juntas de la Libertador;
- las dos calzadas separadas, cada una de dos canales;
- en `c6`/`c7`, el tramo cercano más ancho que el lejano;
- flechas visibles de `c4` para abajo, apuntando en un mismo sentido a lo largo de cada calzada, y ninguna en las vías de doble sentido del entorno;
- sin errores de shader en la consola (el script los lista).

- [x] **Step 2: Vista de estado indistinguible**

Run: `node lod-check.mjs "$PWD/shots"` y comparar `0-estado.png` con la captura previa del mismo nombre: la red estructurante con el mismo grosor y contorno.

- [x] **Step 3: El lazo a 30 m agarra el borde de la avenida**

Escribir `lazo-cerca.mjs` a partir de `lazo-preciso.mjs`: encuadrar la Libertador, cerrar la ficha, acercar siete veces, y trazar un lazo pequeño (60×60 px) sobre el borde de la calzada azul que se ve en `c7.png`, lejos del eje; leer la cabecera "N vías seleccionadas". Esperado: ≥ 1. Repetir con el lazo sobre el terreno entre las dos calzadas: esperado 0.

- [x] **Step 4: Cierre**

`npm test`, `npx tsc --noEmit`, `npm run build` en verde. Reportar a Samuel con las capturas clave y sin commitear.
