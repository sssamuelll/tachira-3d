# Sombra: la calzada dentro de la sombra del relieve, y la exposición atada al sol real

Rama `hr/sombra`, sobre `b971241` de `feat/vialidad-3d`. Punto 8 del programa de
hiperrealismo, y el único que no añade nada nuevo: cose dos costuras que quedaron
entre la luz real (punto 1) y el shader de la calzada (puntos 2 a 4).

Lo que entra: la calzada consulta el shadow map de la cascada más cercana antes
de iluminarse, y la exposición del asfalto de cerca se normaliza contra la altura
del sol de la hora que se esté mirando en vez de contra una constante inventada.

## Qué se ve distinto

Antes, el asfalto se iluminaba con `dot(N, uSol)` a secas. `uSol` es el sol real
de la fecha de la escena -- lo escribe `Roads.tsx` cada cuadro desde
`direccionSol` -- pero el LineMaterial no pasa por `lights_fragment_begin` ni por
el chunk de CSM, así que **el sol de la vía nunca sabía si algo se lo tapaba**. La
sombra propia sí era coherente (`vTerrW` es la normal del relieve); faltaba la
proyectada: al pie de una pared, el relieve caía a 0,2 de su nivel y la cinta de
encima seguía a 0,65 del suyo, con el especular y el destello del charco
encendidos. La vía se leía pegada por encima del terreno, no apoyada en él.

Y el reparto ambiente/sol estaba calibrado a mano contra `SOL_POR_DEFECTO`, que
no llega a la pantalla. Medido sobre San Cristóbal el 2026-09-05, lo que la
calzada de cerca promediaba respecto del color plano de lejos:

| hora local | altura del sol | antes | ahora |
|---|---|---|---|
| 8:00  | 19,1° | 0,45 | 0,70 |
| 10:00 (la fecha de `App.tsx`) | 48,8° | 0,65 | 0,70 |
| 12:00 | 78,4° | 0,76 | 0,70 |
| 16:00 | 41,9° | 0,61 | 0,70 |
| de noche | -46° | 0,29 | 0,49 |

`NIVEL_CERCA` es 0,70 y ése es el punto: el fundido `smoothstep(12, 26)` de
`cerca` mezcla asfalto iluminado con color plano SIN luz, y si el promedio del
primero no es 0,70 hay un escalón de exposición al cruzar los ~500 m. A las 8 de
la mañana la calzada se oscurecía a la mitad al cruzarlo; a mediodía salía más
clara que el color plano.

## Decisiones

### 1. Un tap de la cascada 0, sin PCF propio

`sombraSol(posW, n)` en `ASFALTO_GLSL`. Un `texture()` sobre un
`sampler2DShadow` y ya.

Con `shadows="percentage"` (`App.tsx`) three crea el shadow map como
`DepthTexture` con `compareFunction = LessEqualCompare` y filtro **lineal**
(`WebGLShadowMap.js:254-271`), así que la comparación la hace el hardware y lo
que vuelve es el promedio bilineal de cuatro téxeles **ya comparados**: PCF 2×2
gratis. Los cinco taps de Vogel con que three sombrea el relieve
(`shadowmap_pars_fragment.glsl.js`) son para radios más grandes que el filo que
aquí hay que dibujar, y costarían cinco muestras por fragmento de calzada.

Se muestrea **solo la cascada 0**, la de menos alcance. Con `near` 10, `maxFar`
5.000 y el reparto `practical` (lambda 0,5) llega a ~876 m de la cámara, y el
asfalto empieza a existir a los ~500 (12 px de calzada en la Libertador). Fuera
de ella la coordenada cae fuera de [0,1] y se devuelve 1: la vía queda como
estaba, dibujada con su color plano.

Los dos sesgos son **los mismos con los que se sombrea el relieve**, leídos de la
propia luz: `shadow.normalBias` (doce téxeles de la cascada, `TerrainLod.tsx`) y
`shadow.bias`, que se **suma** a la profundidad con el mismo signo con que lo
suma three. Si la calzada usara otros, el filo de la sombra se partiría justo en
el borde de la vía.

`texture()` y no `texture2D()`: three compila estos shaders como
`#version 300 es` y declara `precision highp sampler2DShadow` en el preámbulo del
fragment (`WebGLProgram.js:314, 805`), así que la comparación en hardware está
disponible tal cual, sin extensión ni define.

### 2. Cómo llega el mapa a la calzada

`TerrainLod.tsx` es dueño del CSM. Le pone `name` a `csm.lights[0]` con la
constante `CASCADA_CERCA`, y `Roads.tsx` la busca una vez con
`scene.getObjectByName` -- el mismo patrón con el que `TerrainLod` busca el
`<SunLight>` de takram, y sin que ninguno de los dos componentes importe al otro.
La constante vive en `sol.ts`, que ya es el sitio de la luz de la escena: es lo
que impide que el nombre se cambie de un lado y el otro deje de encontrar la luz
en silencio.

Por cuadro, `Roads.tsx` copia a los uniforms de los dos materiales de cada nivel:

| uniform | de dónde | ojo |
|---|---|---|
| `uSombraMapa` | `shadow.map.depthTexture` | **no** `shadow.map.texture`: el DepthTexture es el que tiene `compareFunction` |
| `uSombraMat` | `shadow.matrix` | por **referencia**: es la misma `Matrix4` que three reescribe en cada pase de sombra |
| `uSombraNormalBias`, `uSombraSesgo` | `shadow.normalBias`, `shadow.bias` | |
| `uSombraOn` | 1 cuando existe el mapa | |

El orden dentro del cuadro sale solo: three renderiza los shadow maps al
principio de `renderer.render()`, antes de dibujar la escena, así que la matriz
que la vía lee es la de este cuadro.

### 3. El primer cuadro: un texel de profundidad de relleno

`shadow.map` es `null` hasta el primer pase de sombra. Dejar el uniform en `null`
**no** es seguro, y se midió en Chrome: la textura vacía que three liga para un
`SAMPLER_2D_SHADOW` (`WebGLUniforms.js:573-576`) nace con `version` 0, así que
`WebGLTextures` nunca la sube y nunca le pone `TEXTURE_COMPARE_MODE`. WebGL valida
la pareja sampler/textura **al dibujar**, no dentro del shader, así que el
`if (uSombraOn < 0.5) return 1.0;` no salva: salían tres
`GL_INVALID_OPERATION: Mismatch between texture format and sampler type` y las
tres llamadas de dibujo de ese cuadro se descartaban.

De ahí `SOMBRA_VACIA` en `roadsShader.ts`: un `DepthTexture` de 1×1 con su
`compareFunction` y `needsUpdate`. No se muestrea nunca -- mientras está ligada,
`uSombraOn` vale 0 -- solo existe para que el sampler apunte a algo válido. Es el
mismo criterio de `uAsfaltoOn` con los tres JPG del asfalto.

### 4. `luzVia()`: la exposición se normaliza en un solo sitio

```glsl
float luzVia (float ndl, float cielo, float ao) {
  float norma = max(AMBIENTE + SOL_DIF * max(uSol.y, 0.0), PISO_NORMA);
  return (AMBIENTE * mix(AMB_SUELO, 1.0, cielo) * ao + SOL_DIF * ndl) / norma * NIVEL_CERCA;
}
```

`norma` es la irradiancia que recibe una calzada horizontal con el sol de ESTE
cuadro. Dividir por ella deja el promedio en `NIVEL_CERCA` a cualquier hora,
que es exactamente lo que el fundido de `cerca` necesita, y de paso deja la
calibración en una división legible en vez de en una pareja de constantes que
solo cuadraban para un sol concreto.

`PISO_NORMA = 0,60` topa la amplificación. Sin él pasan dos cosas absurdas: de
noche (`uSol.y <= 0`) la norma valdría `AMBIENTE` y la calzada nocturna saldría
exactamente igual de clara que a mediodía; y con el sol rasante un grano de árido
encarado al sol se iría a 2,6 veces el nivel del color plano. Con 0,60 la calzada
de noche queda en 0,49 -- más oscura que de día, como debe ser -- y ese grano
topa en 1,84.

`ao` multiplica **solo** el término ambiente, como antes: la oclusión del cuenco
de un bache es cuánto cielo le llega al fondo, y al directo ya lo ocluye
`somBache`.

La franja de hombrillo o brocal (`seccion.ts`) llama a la MISMA función y hace su
propio tap: está pegada a la calzada, y si una se oscurece dentro de la sombra y
la otra no, el filo se parte en el borde de la vía. Son dos taps por fragmento en
las vías que llegan a enseñar franja; subirlo fuera de los dos `if` costaría el
tap también a vista de estado, con las 26.712 vías en pantalla.

### 5. `?hora=` para poder mirar

`fechaDeEscena(location.search)` en `sol.ts`. De la altura del sol dependen la
exposición de la calzada y si hay sombra proyectada que ver, y las dos cosas solo
se juzgan mirándolas: sin esto, cada comprobación pedía recompilar con otra
constante escrita a mano. `?hora=2026-09-05T12:00:00Z` son las 8 de la mañana en
el Táchira. Una fecha que no se entiende se ignora en silencio -- es un parámetro
de inspección, no un dato del mapa.

## Medido en Chrome

Chrome real (`channel: 'chrome'`, headed), 1440×900, con el servidor del worktree
en el 5190. Capturas en el scratchpad, carpeta `sombra/`.

**Vista de estado, antes contra después: diferencia EXACTAMENTE cero** en el
cuadro entero (`fps-antes/estado.png` contra `fps-despues/estado.png`). Todo lo
nuevo vive dentro de `if (cerca > 0.08)` y de `if (abs(vBordeM) > 0.0)`.

**La exposición.** Diferencia antes/después con la Libertador a barra de 5 m: la
calzada sube +3,0 de luminancia a la hora por defecto (48,8° de sol; el escalón
va de 0,654 a 0,700) y +18 a las 8 de la mañana (de 0,451 a 0,700). Nada más del
cuadro cambia: el mapa de diferencias es verde sobre las calzadas y negro sobre
el relieve. Efecto lateral esperado y correcto: con el asfalto más claro, la
demarcación cruza el umbral de contraste de `MARCAS_CUERPO_GLSL` y pasa de blanca
a gris, que es lo que esa regla existe para hacer.

**El tap lee el mapa donde debe.** Prueba positiva, que es la que vale: poniendo
`shadow.bias` y `shadow.normalBias` a cero desde la consola, la calzada se
auto-sombrea entera contra el relieve que tiene 25 cm debajo (`sombra` cae de
1,00 a ~0,02 en toda la vía, `sonda-sesgo0/sesgo0.png`). O sea: la matriz mapea
la posición de la vía al téxel correcto, la comparación lee profundidad de
oclusor de verdad, y con los sesgos calibrados lo que devuelve es "iluminado"
porque la vía **está** iluminada.

**Honestidad sobre lo que no se pudo capturar.** No se encontró un encuadre
natural con una calzada de más de 12 px DENTRO de la sombra proyectada del
relieve. Se buscó en San Cristóbal (8:00, 10:00, 16:00, 17:30) y en el cañón del
Uribante camino de Pregonero, y se comprobó a qué se debe con una prueba A/B
limpia: poniendo `shadow.intensity = 0` en las tres cascadas (que quita el
término de sombra sin recompilar el material -- apagar `castShadow` NO sirve,
saca las luces de la lista de sombras y triplica el sol) el relieve no cambia ni
un nivel en los encuadres de San Cristóbal, y sí cambia hasta 24 en el cañón del
Uribante. La conclusión es que **con el sol real y este LOD, la sombra proyectada
vive en las laderas de 40° y los fondos de cañón, y las vías anchas que llegan a
dibujar asfalto van por bancos de camino, crestas y valles abiertos, que están iluminados**.
El hallazgo es real y el arreglo es correcto; lo que la revisión sobreestimó es
la frecuencia con que se ve. Queda como límite conocido para quien vuelva.

**fps**, mediana de tres muestras de 4 s orbitando de verdad:

| | antes | después |
|---|---|---|
| 125 m (barra 20 m) | 50,1 | 50,3 |
| 30 m (barra 5 m) | 51,1 | 50,9 |

Menos del 0,5 %, dentro del ruido. Pero el bucle está topado en ~51 fps en esta
máquina a las dos distancias, así que esta medida **no puede resolver** un coste
pequeño: lo que se puede decir es que el tap no baja del tope. Lo que cuesta es
una muestra de textura por fragmento del pase de relleno, dos donde se dibuja la
franja.

**La Libertador a 30 m, seca y mojada** (`lluvia-despues/`): el charco enciende
donde debe, la vía está a pleno sol y el destello no se apaga; sin artefactos ni
parpadeos en el primer cuadro (consola limpia, cero errores de WebGL).

## Fuera de alcance

- **PCF propio sobre el tap.** El filtrado bilineal en hardware de un
  `sampler2DShadow` ya da 2×2 téxeles. Si algún día el filo de la sombra sobre la
  calzada se ve escalonado a barra de 5 m, los cinco taps de Vogel de three son
  el siguiente paso, y son cinco muestras por fragmento.
- **Cascadas 1 y 2.** No hacen falta: donde la vía tiene asfalto, siempre está en
  la 0. Más allá se dibuja con el color plano, que no tiene luz que sombrear.
- **Que las vías PROYECTEN sombra.** Sigue sin hacerse, y por lo mismo que decía
  `TerrainLod.tsx`: la sombra de una cinta pegada al terreno es la del propio
  asfalto sobre sí mismo, y meter cientos de miles de segmentos en tres pases de
  sombra por cuadro no compra nada.
- **El escalón nocturno.** Con el sol bajo el horizonte, la calzada de cerca
  queda en 0,49 contra 0,70 del color plano de lejos: hay un escalón del 30 % al
  cruzar el fundido. Es deliberado (`PISO_NORMA`) y hoy no se ve, porque la fecha
  de la escena es de día. El día que la hora tenga un control en la interfaz hay
  que decidir si de noche el mapa se lee con luz de mapa o con luz de noche, y esa
  es una decisión de producto, no de shader.
