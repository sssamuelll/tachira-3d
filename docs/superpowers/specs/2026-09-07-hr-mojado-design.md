# Baches con relieve y calzada mojada

Fecha: 2026-09-07. Rama: `hr/mojado`, sobre `feat/vialidad-3d` (9f93b16).

## Problema

`2026-09-07-hr-asfalto-design.md` dejó la calzada con grano, huellas de
rodadura, grietas, parches y baches gobernados por el PCI, y puso dos cosas
explícitamente fuera de alcance (§8): el relieve de los baches y el mojado.

Las dos son el mismo agujero visto desde dos lados. Un bache es una MANCHA de
albedo: a 30 m de cámara la calzada tiene el color de un pavimento roto y la
topografía de una hoja de papel. Y la superficie está siempre seca, con lo cual
el mapa dice el estado de una vía de una sola manera más — el matiz y sus seis
capas de deterioro — cuando la lluvia lo dice de otra que es la más elocuente de
todas: **una vía mala mojada es un rosario de charcos, y una buena es un espejo
parejo.** El agua encuentra los defectos por su cuenta.

## Decisión

**El bache se traza analíticamente contra un cuenco, no con POM.** Un bache ya
es una celda de Voronoi con su centro conocido (asfalto.ts); el cuenco es un
paraboloide, y la intersección de un rayo con un paraboloide es una cuadrática.
Sale en cerrado: **una raíz cuadrada, cero muestras de textura, cero bucles.**
Un POM de dieciséis pasos costaría dieciséis accesos de textura por fragmento de
bache para aproximar lo mismo peor.

**El mojado es el modelo de Lagarde** («Water drop 2b — Dynamic rain and its
effects» / «Water drop 3b — Physically based wet surfaces», 2012-2013): el agua
entra en el poro, el índice de refracción del hueco pasa de 1,0 a 1,33, la luz
que antes rebotaba en el árido se queda dentro, y el albedo se oscurece como una
POTENCIA. El charco es otra cosa: una lámina plana con normal geométrica,
rugosidad de espejo y el Fresnel del agua.

Todo vive en `src/scene/mojado.ts` y se inyecta desde `patchLineMaterial`
(`roadsShader.ts`) solo en el pase de relleno.

## 1. El cuenco, y por qué es cerrado

El cuenco que se TRAZA es un paraboloide de radio `R` y hondura `H`:

    hondura(r) = H (1 - r²/R²)

El rayo de vista entra por el fragmento y baja. A hondura `z`, el punto que de
verdad se ve está corrido `k·z` sobre el plano de la calzada, con
`k = -(V·T, V·B)/(V·Ng)` — metros de corrimiento por metro de hondura. Igualar
`z` con la hondura del punto corrido, `z = H(1 - |a + k z|²/R²)`, es una
cuadrática en `z`:

| | |
|---|---|
| `A` | `H·\|k\|²/R²` |
| `B` | `1 + 2H(a·k)/R²` |
| `C` | `H(\|a\|²/R² - 1)` |

Dentro de la boca es `C < 0`, así que hay **exactamente una raíz positiva**. Y
esa raíz cumple `z > 0 ⟹ |a + k z| < R`: el punto trazado cae siempre dentro del
cuenco, sin comprobarlo. La forma que se usa **no** es `(-B + √disc)/2A`: esa se
cancela catastróficamente cuando `A → 0`, que es justo la vista cenital, que es
donde más se mira este mapa. La equivalente estable es `z = -2C / (B + √disc)`,
que además degenera sola al caso lineal.

**La sombra propia sale de la misma cuadrática y ni siquiera necesita raíz.**
Desde el punto trazado se sube hacia el sol; la diferencia entre la altura del
rayo y la del cuenco es un polinomio de segundo grado que vale cero en el
origen (se arranca sobre la superficie), así que sus dos raíces son 0 y una
sola más: `s* = (1 - 2H(a'·m)/R²) / (H|m|²/R²)`, con `m` la dirección del sol en
el marco tangente. El rayo sale del cuenco si `s* > z` y lo tapa la pared si
`s* < z`. Un producto punto y una división.

**El perfil de SOMBREADO no es el paraboloide que se traza.** Un bache real
tiene fondo plano, pared corta y empinada, y el borde roto levantado. El
paraboloide se queda para el trazado porque es lo que da la cuadrática; el
perfil de sombreado es un `smoothstep` con la pared del 70 % al 100 % del radio
(~47° de pendiente máxima) más una campana para el labio. La diferencia no se
ve: el paralaje desplaza lo mismo — la hondura máxima es la misma — y lo que
dibuja la pared es la normal.

Números: **radio 0,30 m** (60 cm de boca), **hondura 0,065 m** con desgaste
total, labio de 1,4 cm, oclusión al 26 % en el fondo, sombra propia al 18 %.
El contorno se deforma con un ruido de baja frecuencia (±22 % del radio): con el
círculo exacto la calzada salía con una viruela que se leía a la primera como
generada.

## 2. El mojado

| capa | qué hace | número |
|---|---|---|
| albedo | `pow(asf, 1 + porosidad·mojado)` — un exponente, no un factor: el asfalto oscuro se oscurece poco y el claro mucho | porosidad **0,45** |
| rugosidad | la película llena el poro y la superficie va hacia lo especular | ×**0,62** |
| normal | la película llena también la GEOMETRÍA (§4) | 92 % hacia `Ng` |
| charco | lámina plana: `N = Ng`, rugosidad **0,03**, Schlick con **F0 = 0,020** | — |
| reflejo | cielo por `uCielo` con degradado al horizonte + destello del sol normalizado `(n+8)/8π`, topado a 2,0 | — |
| fondo bajo el agua | **0,62**, y ese piso no es óptico: bajo el charco tiene que seguir leyéndose el PCI | — |

**Dónde se embalsa.** `cota` es la altura local de la calzada en metros
relativa a la rasante ideal: el bombeo parabólico `(1 - t²)` levanta el eje, la
huella de rodadura hunde, la grieta hunde poco, el bache hunde mucho. El nivel
del agua sube con `uMojado` de −0,16 m (nada embalsa) a −0,004 m. La rodada y el
bache van con el desgaste, y de ahí sale solo el rosario contra el espejo.

**Bombeo al 50 %, no al 100 %.** Un bombeo real DRENA, no embalsa: decide dónde
se seca antes, no dónde se hace la poza. Con peso 1 la calzada se convertía en
una bañera con el eje como isla. Cuando `hr/seccion` integre su bombeo
geométrico, `BOMBEO` sale de allá y la constante muere.

**El reflejo sale de la rugosidad, no de una constante.** No hay un factor para
el charco y otro para lo húmedo: es la MISMA lámina de agua con otra rugosidad,
y `espejo = (charco + (1-charco)·húmedo·PELÍCULA) · (1 - rugosidad)`. `PELÍCULA`
= 0,45 porque en el asfalto el agua está sobre todo DENTRO del poro, no encima,
y solo el charco tiene lámina de verdad; con 1 la calzada mojada salía más
CLARA que la seca, que es al revés de lo que se ve en la calle.

## 3. Dónde se inyecta

Un punto único y con nombre: `ANCLA_MOJADO` en `asfalto.ts`, **después** de que
`asf`, `rug` y `N` están calculados y **antes** de `ndl`/`H`/`esp`. No es
negociable en ninguna de las dos direcciones: el mojado cambia los tres y la luz
tiene que ver los valores cambiados. Hay test sobre el ancla, sobre su unicidad
y sobre su posición en el shader REAL ya compilado.

La lámina se suma aparte, al final de todo (`MOJADO_LAMINA_GLSL`), **por encima
de la pintura**: una raya de demarcación mate en medio de una calzada que
refleja el cielo se lee como una calcomanía sobre un espejo, y una raya mojada,
en la calle, es la parte que más brilla. Por eso `espMojado` se declara fuera
del `if` del asfalto — las marcas se pintan fuera de ese bloque.

**Control.** Botón «Lluvia» en `MapControls.tsx` (`aria-pressed`, mismo patrón
que «Imagen satelital»), estado en `App.tsx`, `uMojado` alimentado por cuadro
desde el `useFrame` de `Roads.tsx` con una rampa **lineal de 1,5 s**. Lineal y no
exponencial: una exponencial nunca llega y deja el uniform temblando en 0,999
para siempre. El paso de tiempo va topado a 0,25 s porque `requestAnimationFrame`
se para en una pestaña de fondo y al volver el `dt` de ese cuadro es de minutos.

## 4. Cinco cosas que solo se vieron mirando capturas

**El charco salía en bandas rectas de kilómetros.** `cota` era una función de la
coordenada TRANSVERSAL sola — huella de rodadura y bombeo son ambas función de
`t` — así que el nivel del agua la cortaba en franjas perfectamente paralelas al
eje. Es el mismo error que el spec del asfalto documenta en §6 con `vDist`
congelada, por otro camino. Lo arregla que la huella no hunde parejo: hunde por
tramos, donde la base cedió, y ese mapa ya existe (`zona`, el fBm con el que
asfalto.ts reparte grietas y parches). Un `smoothstep(0,44 → 0,60)` lo vuelve
casi binario, y sale un rosario de pozas de unos diez metros. Un fBm propio
costaba doce hashes por fragmento y **20 fps a 125 m**; reusar `zona` cuesta
cero. Un primer intento con `zona` en dos sitios a la vez — modulando y
desplazando — se cancelaba consigo mismo y dejaba la banda igual.

**Sal y pimienta gris por toda la calzada mojada.** Bajar la rugosidad
multiplica por seis y medio la dureza del lóbulo especular que asfalto.ts ya
calcula (`exp2(9 - 7·rug)`), y ese lóbulo se apoya en la normal del mapa, que a
30 m va a dos texels por píxel: justo el límite que `nitidez` protege en seco y
que bajar la rugosidad deshace. Se persiguió primero como un problema del
destello del charco, que no era. El agua tapa el grano, así que aplanar la
normal al 92 % junto con la rugosidad es a la vez el arreglo y la física.

**El bache se leía como un disco negro plano.** La mancha de albedo (×0,30),
heredada de cuando el bache era solo mancha, enterraba la oclusión, la sombra
propia y la normal del cuenco — todo lo que dice que ahí hay un hueco. Ahora se
atenúa al 55 % cuando el relieve está entero y vuelve entera cuando el relieve
no cabe en un píxel. La mancha y el relieve dicen lo mismo, y sumados el relieve
pierde.

**Las grietas mojadas salían PLATEADAS.** Una grieta va con rugosidad 1 y su
lóbulo ancho brilla en más superficie que el estrecho del pavimento sano de al
lado. Se hunden 3 cm y se llenan de agua, como en la calle: una grieta mojada es
una raya negra.

**El espejo de una vía buena no se veía.** Venía de un factor suelto de 0,09
sobre el 2 % del Fresnel a 45°, o sea cero. Ver §2: sale de la rugosidad.

## 5. Nivel de detalle

Todo lo caro se apaga solo, con el mismo criterio de `asfalto.ts`:

- El relieve del bache solo existe dentro de `if (esBache > 0.5)`, y el paralaje
  va escalado por el tamaño de la boca en píxeles (`smoothstep(3, 9)` sobre
  `2R/huellaM`, con `huellaM` la derivada real de la coordenada). A 30 m la boca
  mide 24 px; a 125 m, 6 px; a 500 m, 1,4 px y no se traza nada.
- El filo del charco se antialiasea con `fwidth(cota)`, la derivada REAL en
  pantalla: un charco visto de refilón tiene el borde estirado en un eje y no en
  el otro, y una constante en metros no lo sabe.
- Todo el charco va multiplicado por `nitidez`, la misma variable con la que el
  asfalto apaga su grano.
- El bloque entero del mojado vive dentro de `if (uMojado > 0.002)`: con el
  botón apagado, el pase de relleno cuesta lo que costaba.

## 6. Medido en Chrome

Playwright sobre el Chrome del sistema, 1600×1000, Avenida Libertador de San
Cristóbal, PCI fijado a 20 y a 90 desde la ficha.

- **Vista de estado: idéntica píxel a píxel.** Las 1.580 diferencias entre seco
  y mojado caen todas dentro del recuadro x 1548-1587, y 763-802, que es el
  botón de Lluvia. El resto del lienzo, bit a bit igual.
- **PCI 20 a 30 m, seco**: baches como bocas lobuladas con la pared de arriba en
  sombra, el labio claro abajo y el fondo texturado; red de grietas; flechas.
- **PCI 20 a 30 m, mojado**: pozas en las huellas por tramos (no bandas), agua
  en las grietas (red azul oscura), baches llenos, franja de agua en la orilla.
  **El rojo del PCI se sigue leyendo entero** bajo el agua.
- **PCI 90 a 30 m**: seco, verde vivo con grano nítido; mojado, verde más
  apagado y liso con una veladura del cielo. **Ni un charco**, que es el dato.
- **125 m mojado**: la avenida roja con su red de grietas y los baches como
  puntos; el mojado es sutil a esa distancia y no centellea.
- **¿Titila el charco al orbitar?** No, y se midió: seis cuadros con la cámara
  movida dos píxeles cada vez, sobre el mismo recorte de calzada. El brillo
  medio sube monótono (80,78 → 81,39, +0,75 % en seis cuadros), sin saltos. Y
  el porcentaje de píxeles que cambian más de 40/255 entre cuadros consecutivos
  es **menor mojado (1,1-1,4 %) que seco (1,5-2,0 %)**, con máximos idénticos
  (140-145): lo que se mueve son bordes de geometría contra el terreno, y el
  mojado los reduce porque aplana la normal.

**fps.** Con honestidad sobre lo que se pudo medir: la máquina tenía otros
agentes corriendo y la carga se movía entre minutos, así que los absolutos NO
son comparables con los del spec del asfalto. Lo comparable es seco contra
mojado en la misma sesión. Metodología del spec del asfalto (órbita amplia,
mediana de muestras de 4 s tras dejar cargar el relieve), seis corridas:

| | 30 m | 125 m | 500 m |
|---|---|---|---|
| seco | 164-218 | 83-111 | — |
| **mojado** | **118-161** | **50-55** | — |

El objetivo era ≥ 45 a 125 m y ≥ 100 a 30 m mojado: **se cumple en todas las
corridas**, con el margen más justo a 125 m. El bloque cuesta del orden de la
mitad del pase de relleno en el encuadre desfavorable (calzada llenando la
pantalla de refilón); en el encuadre nominal cae por debajo del ruido de
medición. Tres iteraciones bajaron ese coste: quitar el fBm propio, aplanar la
normal (que es gratis) y meter el relieve de bache dentro de `esBache`.

Tres errores de metodología que hubo que arreglar antes de creerse un número, y
que quedan avisados para quien mida después: una órbita **abierta** saca la
cámara del terreno y devuelve 600-1000 fps de una pantalla casi vacía; medir
**sin arrastre** deja el `rAF` de la página desacoplado del bucle de r3f; y
medir siempre seco antes que mojado, sobre la tendencia creciente que tiene esta
máquina mientras el LOD se asienta, le regala los fps al segundo de los dos — y
hacía salir el mojado más rápido que el seco, que es imposible.

## 7. Lo que se toca de `asfalto.ts`

Seis sitios, todos con su comentario en el archivo:

1. `import { bacheCuerpoGlsl } from './mojado'`.
2. `GRIETA_M` y `BACHE_TASA` pasan a exportarse: el relieve necesita pasar de
   celdas a metros y no puede importarlas (sería un ciclo) ni copiarlas.
3. `voronoi()` gana `out vec2 desdeF1`, el vector del centro de la celda al
   punto. Es una asignación dentro de una rama que ya existía.
4. `vec3 espMojado` declarado fuera del `if`, para que exista donde se pinta la
   demarcación.
5. Las dos líneas de la mancha del bache, sustituidas por `bacheCuerpoGlsl(...)`.
6. `${ANCLA_MOJADO}` entre `N` y `ndl`, más `* somBache` en `ndl` y `* aoBache`
   en `ambiente` — dos multiplicaciones que valen 1,0 fuera de un bache.

## 8. Fuera de alcance

- **Ondas de lluvia.** Harían falta un uniform de tiempo y animación.
- **La pintura mojada se moja pero no se deforma**: el reflejo va encima de la
  demarcación, pero el oscurecimiento de Lagarde y el charco solo afectan al
  asfalto, porque la pintura se compone después y sobrescribe el difuso. Se ve
  bien; hacerlo del todo pide un segundo punto de inyección.
- **El bombeo es una constante propia** (2 %, al 50 % de peso) y no la geometría
  de `hr/seccion`.
- **El color del cielo es un default.** `uCielo` está declarado en los dos
  materiales con valor por defecto, igual que nació `uSol`: `hr/luz` puede
  alimentarlo por cuadro desde el `SkyLight` y entonces el charco refleja el
  atardecer de verdad.
- **El agua no corre.** No hay flujo ni dirección: hay nivel y cota. Un modelo
  de escorrentía pediría un campo de gradiente y no cabe en un fragmento.
- **El paralaje del bache solo desplaza la máscara y el sombreado**, no el
  muestreo de las tres texturas del asfalto. A 24 px de boca la diferencia es el
  grano dentro del hueco, que no se distingue; costaría cuatro accesos de
  textura más por fragmento de bache.
