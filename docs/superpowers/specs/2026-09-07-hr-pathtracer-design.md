# Fotos fijas con trazado de rayos

Punto 7 del programa de hiperrealismo. Un botón "Foto trazada" que renderiza la
vista actual con iluminación global y descarga un PNG. No es para navegar: es
para láminas de presentación.

## Qué se entrega

- `src/foto/hypso.ts` — la rampa hipsométrica del relieve, en TypeScript.
- `src/foto/cuadros.ts` — la extrusión de la calzada del vertex shader, en CPU.
- `src/foto/escena.ts` — la escena temporal (relieve + vías + sol).
- `src/foto/trazador.ts` — el trazador, en un renderer propio fuera de pantalla.
- `src/foto/Foto.tsx` — el puente con la escena, el panel de progreso, el ícono.
- `MapControls.tsx` — un botón, `aria-label="Foto trazada"`.
- `App.tsx` — el cableado del ref y del panel.
- `Sky.tsx` — `worldToEcefMatrix` pasa de privada a exportada. Nada más.

Paquetes: `three-gpu-pathtracer@0.0.24` (pide `three >= 0.180`; tenemos
0.185.1), `three-mesh-bvh@0.9.14`, `xatlas-web` (peer del primero, no se usa).
WebGL2, sin backend WebGPU.

## Por qué una escena temporal y no la de pantalla

El trazador solo entiende mallas con materiales estándar, y esta aplicación no
dibuja ninguna:

- el relieve es un `ShaderMaterial` con hipsometría por elevación y descarte por
  máscara del estado;
- las vías son `LineSegments2` cuyo ancho real lo calcula el vertex shader;
- el cielo es un efecto de post-proceso sobre el framebuffer, no geometría.

Así que en el clic se arma una escena aparte a partir de lo que hay dibujado en
ese instante. Se lee del grafo de escena, sin tocar `Roads.tsx` ni
`TerrainLod.tsx`:

- el relieve, por el nombre del grupo (`"terrain"`, que ya existía para el pase
  de picking) y el flag `visible` de cada nodo;
- las vías, por `isLineSegments2` más la clave de caché de programa que
  `patchLineMaterial` ya le pone a cada material (`'vias:relleno'` /
  `'vias:contorno'`). Es el único discriminante que ya existía.

Los buffers de posición y normal del relieve se **comparten**, no se copian: son
un millón de vértices y duplicarlos por foto no tiene sentido. El precio es que
las geometrías temporales no se pueden `dispose()` a mano; se libera todo
perdiendo el contexto del renderer temporal.

## Decisiones

**Renderer propio, fuera de pantalla.** El trazador pisa el estado del renderer
muchas veces por cuadro (render targets, scissor, viewport, autoClear);
compartirlo con r3f sería un mapa que parpadea. Además deja la resolución de la
foto independiente de la ventana, y un fallo a mitad de trazado pierde la foto y
no la sesión.

**La pantalla se congela por interfaz, no por código.** El panel de progreso
cubre el lienzo y bloquea el ratón. El mapa se sigue dibujando debajo (r3f no
para su bucle) para que se vea qué se está fotografiando, pero no se puede
mover: la foto va contra la cámara del instante del clic, y dejar orbitar
mientras tanto sería mentir sobre lo que va a salir.

**Resolución = la del lienzo**, que en una pantalla 2× ya viene multiplicada por
el `devicePixelRatio` (o sea, ya es la foto a 2×). Tope de 2.880 px en el lado
mayor: el trazador guarda varios render targets flotantes del tamaño de la
imagen.

**Tone mapping AgX**, el mismo de la escena de pantalla. El material de salida
del trazador aplica el `toneMapping` del renderer antes de escribir al lienzo,
así que basta con pedírselo al renderer temporal.

**`setScene` y no `setSceneAsync`.** La versión asíncrona de
three-gpu-pathtracer exige un worker de BVH (`setBVHWorker`, o revienta con
*"must be called before generateAsync"*), y montarlo con Vite es otra pieza de
build para ahorrar uno o dos segundos de congelón que el panel ya anuncia. Si el
relieve crece, el camino es `ParallelMeshBVHWorker` de `three-mesh-bvh/worker`.

**200 muestras** con teselas de 3×3 (el reparto por defecto del
`PathTracingRenderer`). Una llamada a `renderSample()` dibuja UNA tesela: a un
cuadro de pantalla por llamada harían falta 1.800 cuadros, medio minuto de puro
vsync. Se apura dentro de un presupuesto de 200 ms por cuadro y se devuelve el
hilo, que es lo que hace falta para que cancelar responda como un botón.

**La luz.** El sol es un `DirectionalLight` con la dirección real:
`getSunDirectionECEF()` de `@takram/three-atmosphere` a la fecha de `App.tsx`,
llevada a los ejes del mundo (X este, Y arriba, Z −norte) con la MISMA base que
`<Sky>` le escribe a la atmósfera — de ahí que `worldToEcefMatrix` tuviera que
exportarse. Hay un test que comprueba que a las 10:00 locales el sol está alto y
al este, porque una escena iluminada desde el oeste se ve perfectamente bien y
solo está mintiendo.

El cielo es un `GradientEquirectTexture` como `scene.environment` y
`scene.background`. NO es la atmósfera de Bruneton de `<Sky>`: esa vive en un
efecto de post-proceso y no existe como textura muestreable. La diferencia se ve
en el fondo (un degradado limpio en vez de un horizonte con dispersión de Mie) y
no se ve en la iluminación, que es lo que importa. El sol no va en el cielo, o
se contaría dos veces.

`SOL_INTENSIDAD` (5,5) y `CIELO_INTENSIDAD` (0,55) son la exposición de la
lámina, no unidades físicas: los dos suben y bajan lo mismo, lo que reparten es
cuánto contraste hay entre lo que da el sol y lo que da el cielo. Calibrados a
ojo contra las dos vistas de abajo.

**La máscara del estado se aplica por triángulo**, no por fragmento: se conserva
el que tenga al menos un vértice dentro. Deja el borde con hasta un triángulo de
sobra en vez de con un mordisco — en una lámina, un contorno que sobresale se
lee como orilla y uno que falta se lee como error.

**El color del relieve va SIN el hillshade** del shader (`hypso(t) * shade`). Ese
`shade` es un falso sombreado contra un `uSun` fijo; acá la sombra la pone el sol
de verdad, y multiplicar por los dos sombrearía dos veces.

## Lo que no se reconstruye

- **El contorno de las vías** (el pase `casing`). Es un trazo casi negro debajo
  del color, y existe para que una vía fina se lea contra el relieve en un mapa
  plano. Bajo iluminación global la calzada ya tiene sombra y borde propios; un
  halo negro encima parecería suciedad. No se pierde ningún tramo: los dos pases
  comparten geometría.
- **Las marcas viales** (bordes, eje amarillo, flechas de sentido). Viven enteras
  en el fragment shader, sobre una coordenada transversal que esta
  reconstrucción no genera. En una versión futura serían una textura procedural
  por vía.
- **Las tapas redondas** de los extremos de tramo. Rematan la junta entre dos
  tramos en una curva y miden medio ancho de calzada.
- **La atenuación por foco de búsqueda.** En pantalla baja la opacidad; una
  calzada semitransparente en una escena trazada no se lee como "esto importa
  menos", se lee como vidrio. La selección sí se respeta (el azul de `SELECCION`).
- **La textura satelital.** Todavía no existe. El camino está escrito y comentado
  al final de `escena.ts`: leer el `map` del material del nodo y pasárselo al
  `MeshStandardMaterial` con las uv de la tesela. Ojo: hoy el material del
  relieve es UNO compartido por todos los nodos; con textura pasa a ser uno por
  tesela.

## Tope

`MAX_TRAMOS = 250.000`. A vista de estado solo hay tres niveles encendidos y no
se llega ni a la mitad; a escala de calle el frustum recorta casi todo. Existe
por si una vista rara los deja pasar a todos: 450.261 tramos son 1,8 millones de
triángulos y el BVH de eso cuelga el navegador un minuto largo sin poder
cancelar.

## Medido

Chrome 1280×820 (ventana de Playwright, `devicePixelRatio` 1), 200 muestras,
4 rebotes:

| vista | escena | 200 muestras |
|---|---|---|
| estado (cámara a ~114 km, barra de 10 km) | 128 nodos de relieve, 266.741 triángulos, 67.012 tramos | **93,1 s** |
| San Cristóbal, Avenida Libertador (~125 m, barra de 50 m) | 5 nodos, 11.520 triángulos, 949 tramos | **92,9 s** |

Los dos tiempos coinciden porque el coste manda por píxeles y rebotes, no por
tamaño de escena: el BVH de 267.000 triángulos se recorre en log. Lo que cambia
con la escena es el armado (unos segundos a vista de estado, casi nada a vista de
calle).

## Pendiente

- Marcas viales y contorno, si alguna lámina los pide.
- El cielo real de Bruneton como equirect: `@takram/three-atmosphere` no expone
  una utilidad para hornearlo, habría que renderizar el `SkyMaterial` a un
  render target equirectangular.
- BVH en worker, si el relieve fino hace que el congelón del armado moleste.
- Un tope de muestras configurable desde la interfaz (hoy es una constante).
