# Luz: sol real, sombras del relieve y oclusión ambiental

Rama `hr/luz`, sobre `ed4fc44` de `feat/vialidad-3d`. Punto 1 del programa de
hiperrealismo. Lo que entra: la dirección real del sol para la fecha de la
escena, el relieve iluminado por ese sol con relleno de cielo y auto-sombreado
por cascadas, oclusión ambiental, y la calzada alimentada con la misma
dirección de sol para cuando el shader del asfalto la pida.

## Qué se ve distinto

Antes, el relieve se sombreaba con `dot(normal, uSun)` contra un `uSun` fijo
inventado `(0.4, 0.8, 0.3)`, sin relación con la fecha ni con el cielo que
dibuja `@takram/three-atmosphere` justo detrás. El resultado a vista de estado
era un beige plano con un relieve apenas legible. Ahora la luz que ilumina el
terreno es la misma que pinta el cielo: misma dirección (misma efeméride) y
mismo color (la transmitancia de la atmósfera para esa posición y esa hora).

## Decisiones

### 1. El material del relieve pasa a `MeshStandardMaterial` parcheado

Era un `ShaderMaterial` de veinte líneas. La alternativa era conservarlo y
copiar a mano el muestreo de las shadow maps, el PCF y el probe de irradiancia
del cielo. Se descartó por una razón de mantenimiento, no de rendimiento: CSM y
`SkyLightProbe` están escritos contra la cadena de chunks estándar de three
(`lights_fragment_begin`, `shadowmap_pars_fragment`, `lights_pars_begin`), y
copiarlos significa volver a copiarlos en cada subida de versión de three.

`terrainShader.ts` ya no exporta GLSL suelto sino `materialRelieve(opciones)`,
que crea el material y le engancha un `onBeforeCompile` en cinco puntos:

| gancho | qué mete |
|---|---|
| vertex `#include <common>` | `attribute float elevation`, `attribute vec2 uvMascara` y sus varyings |
| vertex `#include <begin_vertex>` | copia de los atributos a los varyings |
| fragment `#include <common>` | uniforms, la rampa hipsométrica y `albedoRelieve()` |
| fragment `#include <clipping_planes_fragment>` | el `discard` por la máscara del estado |
| fragment `#include <color_fragment>` | `diffuseColor.rgb = albedoRelieve();` |

Lo que se conserva entero: la hipsometría, el recorte por `uMascara`, y que la
elevación cruda viaje como atributo propio (no `position.y`, que arrastra la
caída por curvatura terrestre; ver el comentario largo del archivo).

Con `roughness: 1` y `metalness: 0` el modelo estándar se reduce a Lambert, así
que la ecuación de luz que queda es exactamente la pedida:

```
albedo/PI * (irradiancia_del_sol * sombra  +  irradiancia_del_cielo)
```

`albedoRelieve()` existe para que el agente satelital sustituya su cuerpo por
un muestreo de foto y declare su sampler arriba. Ni la sombra ni el cielo ni el
recorte del estado se enteran.

`materialRelieve` recibe las cascadas como opción en vez de que el llamador
haga `csm.setupMaterial(material)` por su cuenta: `setupMaterial` **pisa**
`onBeforeCompile` en vez de encadenarlo, así que si corriera después del
nuestro la hipsometría y el recorte desaparecerían sin un solo error en
consola. Metiéndolo dentro, el orden no puede quedar al azar. Hay un test que
lo fija.

`shadowSide = FrontSide`: three, por defecto, mete las caras **traseras** de un
material `FrontSide` en el shadow map (truco para sólidos cerrados). El relieve
es una superficie abierta de grosor cero, y ahí ese truco deja el mapa lleno de
agujeros justo donde hay que proyectar — la ladera que mira al sol es cara
delantera y se descartaría.

### 2. La dirección del sol, `src/scene/sol.ts`

`direccionSol(date)` devuelve el vector unitario **hacia** el sol en ejes del
mundo (X este, Y arriba, Z sur). Sale de `getSunDirectionECEF` de
`@takram/three-atmosphere` — la misma función que usa `<Atmosphere>` para
colocar el disco solar, así que el sol dibujado y el sol que ilumina no pueden
desalinearse — proyectada sobre la base este/arriba/sur del ENU local. La base
es ortonormal: su inversa es su transpuesta, y multiplicar por la transpuesta
es proyectar sobre cada columna, o sea tres productos punto. Como direcciones,
sin la traslación del origen.

`worldToEcefMatrix()` se mudó de `Sky.tsx` a `sol.ts` para que el cielo y la luz
compartan una sola base.

Comprobado contra la efeméride del 5 de septiembre de 2026 en ORIGIN
(8,02° N, 71,90° O): sale 10:20Z, mediodía solar 16:50Z a 86° de altura, se pone
22:50Z; azimut al este por la mañana y al oeste por la tarde. La fecha de la
escena, 14:00Z, son las 10:00 de Venezuela con el sol a 48,8° y azimut 89°.

### 3. La luz direccional son las cascadas, no `<SunLight>`

CSM fabrica una luz direccional **por cascada** y el fragment estándar solo deja
contribuir a la que corresponde a la profundidad del píxel. Dejar además el
`<SunLight>` de takram sumaría un cuarto sol, sin sombra, doblando la
iluminación.

Pero `<SunLight>` sigue montado, con `visible={false}` y `name="sol"`: su
`useFrame` llama a `SunDirectionalLight.update()` sin mirar `visible`, y eso es
lo que calcula el color del sol contra la transmitancia (`getSunLightColor`)
para esa fecha y esa posición. `TerrainLod` lo busca por nombre — el mismo
truco con el que `PickingPass` busca al grupo del relieve por el suyo — y copia
`color` e `intensity` a las cascadas cada cuadro. Ese color es **luminancia**,
no un color en [0,1]: la magnitud entera del sol vive ahí y la `intensity` se
queda en 1 (takram sacó las opciones fotométricas en 0.13.0; ahora solo emite
luminancia). Copiarlo tal cual es lo que deja el relieve en la misma escala que
el cielo antes del AgX.

El relleno de sombra es `<SkyLight>` (un `LightProbe` con la irradiancia del
cielo), que no compite con CSM y se queda tal cual estaba.

`AerialPerspective` sigue **sin** `sunLight`/`skyLight`: es lo que manda el
README de takram cuando la escena se ilumina con `SunDirectionalLight` +
`SkyLightProbe` en vez de en post-proceso ("Don't enable `sunLight` or
`skyLight` [...] unless correctly masked using `LightingMaskPass`").

### 4. Las cascadas

`three/examples/jsm/csm/CSM.js`, 3 cascadas, `maxFar` 5 km, shadow maps de
1024², `lightMargin` 6 km, `lightFar` 18 km.

- **Tres y no cuatro.** Con 5 km de alcance la tercera ya cubre 7,6 km de lado
  (7,4 m por téxel); una cuarta cuesta un pase entero de sombra por cuadro para
  ganar detalle donde una ladera mide unos pocos píxeles.
- **5 km de alcance.** Cubre el valle de San Cristóbal con sus montañas desde
  cualquier altura de trabajo. A vista de estado ese tramo del frustum cae en
  aire vacío y los shadow maps salen en blanco.
- **1024 y no 2048.** A 125 m la primera cascada abarca unos 200 m: 20 cm por
  téxel, más detalle del que tiene la sombra de una loma. Bajar devolvió unos
  4 fps sin diferencia visible.
- **`lightMargin` 6 km.** El Táchira llega a ~4.000 m y sus valles bajan a
  ~150 m; con menos margen el plano near de la cámara de sombra recortaría la
  montaña que proyecta.

**Sesgo.** `normalBias` en **téxeles** de la cascada que le toca, no en metros:
un téxel mide un par de metros en la primera y 7,4 m en la última, así que un
sesgo en téxeles se traduce en aproximadamente el mismo error en pantalla a
cualquier distancia. Barrido sobre la Carretera La Grita - Pregonero (Uribante,
laderas de 40°) a rasante, con el sol real y con el sol bajado a mano a 15° para
tener sombras proyectadas de verdad que juzgar:

| téxeles | qué se ve |
|---|---|
| 0 | acné a rayas por toda la ladera, más bandas negras anchas en las crestas |
| 1,5 | se van las rayas, la banda de la cresta se queda |
| 4 | queda una línea negra fina pegada a cada cresta |
| **12** | **limpio; a 15° de sol las sombras nacen al pie de la cresta** |
| 40 | también limpio, pero son 300 m de sesgo en la última cascada |

Acompañado de un sesgo de profundidad constante de −0,0008: en la cresta la
normal apunta casi perpendicular a la luz y desplazarse a lo largo de ella no
aleja nada del plano de comparación.

`PCFShadowMap` (`shadows="percentage"`). No es sabor: three 0.185 deprecó
`PCFSoftShadowMap` y lo degrada a PCF igual, así que pedir `"soft"` solo añadía
un aviso por cuadro. VSM tampoco sirve: con VSM todo receptor de sombra pasa a
ser también emisor, y eso anula el corte por distancia del punto siguiente.

### 5. Oclusión ambiental: `<N8AO>`

Va antes de `<AerialPerspective>` en el `EffectComposer`: la oclusión oscurece
la luz que llega del cielo a los pliegues del relieve, y eso pasa en el terreno,
antes de que la neblina se sume por delante.

Dos ajustes que no son cosméticos:

- **`transparencyAware` apagado.** N8AO enciende solo ese modo en cuanto ve un
  material transparente en la escena, y las 16 capas de vías lo son todas
  (`LineMaterial` con `transparent: true`). Encendido hace tres recorridos
  completos del grafo y **dos renders extra de la escena entera** por cuadro:
  50 fps → 13 sobre el valle. Se apaga con un ref de *callback*, porque cuando
  corren los efectos de `<Sky>` el pase todavía no está enganchado.
- **`screenSpaceRadius`, con `aoRadius` en píxeles.** Empezó en 60 m de mundo
  (el orden de una quebrada) y era insostenible: a 125 m de altura la pantalla
  entera mide 150 m, así que cada muestra iba a buscar un téxel al otro extremo
  del buffer de profundidad. En píxeles el coste no depende del zoom.

### 6. El corte por distancia del emisor de sombra

`frustumCulled` está en `false` en todas las mallas del relieve (el quadtree ya
recorta por su caja), así que three no tiene con qué descartarlas del pase de
sombra: entraban en los tres shadow maps aunque cayeran fuera de su cámara
ortográfica. A vista de estado eran ~600 draw calls que no pintaban un solo
téxel. Ahora `castShadow` se decide cada cuadro por distancia a la cámara, en el
mismo bucle que ya decide `visible`. `receiveShadow` no se toca: es parte de la
clave de programa de three y alternarlo entre mallas del mismo material
compilaría dos shaders.

### 7. La calzada

`Roads.tsx` alimenta `u.uSol` con la misma dirección, **si** el material lo
declara. Hoy no lo declara: lo hará la rama del asfalto (`roadsShader.ts`, que
no se toca desde aquí). El `if` no es defensivo de más, es el contrato entre las
dos ramas.

La calzada **no recibe** las sombras del relieve. `LineMaterial` es un
`ShaderMaterial` sin cadena de luces, así que ni el chunk de CSM ni el de
shadowmap se le aplican. Lo que haría falta está en el reporte.

## Medidas

Chrome real, 1440×900, orbitando 2 s con `requestAnimationFrame`:

| vista | fps |
|---|---|
| estado (cámara a ~114 km) | 60 |
| 125 m sobre San Cristóbal | 54 |
| a rasante a 125 m | 55 |
| valle a ~1 km | 53 |

Objetivos: ≥ 45 a 125 m y ≥ 55 a vista de estado. Los dos se cumplen.

Aviso para quien vuelva a medir: entre sesiones la deriva de esta máquina es de
±25 % (otro Chrome abierto, procesos de Playwright que quedaron colgados de una
corrida que falló, temperatura). Las cifras de arriba y todas las comparaciones
de este documento salen de encender y apagar cada cosa **dentro de la misma
sesión y el mismo encuadre**. Comparar dos corridas distintas no dice nada.

## Lo que no entró

- **Sombras sobre la calzada.** Ver el reporte.
- **La máscara del estado no se aplica al shadow map.** El relieve de fuera del
  Táchira, que se descarta al dibujarlo, sí proyecta sombra hacia adentro. Es
  físicamente correcto (una montaña justo al otro lado de la frontera sí da
  sombra), así que se deja.
- **El faldón de los nodos también proyecta.** Cuelga recto hacia abajo desde el
  borde del nodo, así que su sombra cae debajo del propio relieve. No se vio en
  ninguna captura.
