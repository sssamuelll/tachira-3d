# La vía conformada al terreno: tallado del DEM en el pipeline

Fecha: 2026-09-07. Rama: `hr/carving`, sobre `feat/vialidad-3d`. Punto 4 del
programa de hiperrealismo de vías.

## Problema

Una carretera real corta el cerro y rellena la vaguada. La nuestra es una
cinta apoyada sobre un DEM Terrarium de ~37,8 m por post que no sabe que la
vía existe, así que hereda cada serrucho de la malla. Medido sobre
`roads-pos.bin` antes de esto, en la red estructurante (`motorway`, `trunk`,
`primary` y sus `_link`), tramos de más de 5 m en horizontal:

| pendiente | antes |
|---|---:|
| p50 | 4,8 % |
| p90 | 16,2 % |
| p99 | 35,5 % |
| máxima | 112,3 % |
| tramos sobre 15 % | 11,7 % |

Una troncal venezolana no pasa del 8 %. En ladera eso se ve como una calzada
que sube y baja escalonada, y en la ciudad como calles que flotan o se hunden
de una celda a la siguiente.

## Decisión

Un paso nuevo del pipeline, `scripts/lib/carving.mjs`, que modifica
`dem.data` EN SITIO antes de apoyar las vías y antes de la pirámide. Para cada
vía calcula un **perfil** (la altura del DEM a lo largo del eje, suavizada y
con la pendiente acotada a lo que su clase permite) y rasteriza un
**corredor** a su alrededor: dentro, la altura del DEM pasa a ser la del
perfil; en una banda de transición hacia afuera se funde de vuelta al DEM
original; más allá, intacto.

Los perfiles se calculan TODOS contra el DEM original —la mezcla va a unos
acumuladores aparte y se aplica al final—, así que el resultado no depende del
orden de las vías.

### Perfil (`perfil(h, s, pend, ventanaM)`)

1. **Media móvil** de `VENTANA_M = 150` m a lo largo de la vía, **centrada y
   simétrica**: cerca de los extremos la ventana se encoge en vez de
   truncarse. Dos consecuencias que se buscaron: una rampa recta sale intacta
   (una ventana truncada la levantaría en la punta), y el primer y el último
   punto conservan su altura del DEM — OSM parte las vías en los cruces, y dos
   trozos que comparten un nodo tienen que tallar la misma altura ahí.
2. **Acotado de pendiente** sin iterar: `lo` es la mayor función que cumple el
   límite por debajo del suavizado y `hi` la menor por encima (dos pasadas
   cada una, ida y vuelta, O(n)); el perfil es su media, que cumple el límite
   por ser media de dos funciones que lo cumplen, y queda centrada en vez de
   pegada a un lado.

Como el perfil no depende de la distancia al eje, el corredor sale **nivelado
de lado a lado**. El bombeo lo dibuja el shader.

### Corredor

Medio ancho = `anchoCalzada / 2 + HOMBRILLO_M`, banda = `TRANSICION_M[nivel]`,
**con un piso en posts** (ver más abajo). El peso vale 1 dentro del corredor y
cae a 0 al final de la banda con un `smoothstep` (derivada nula en los dos
extremos, sin arista en el empalme).

`anchoCalzada` se replica en `.mjs` (`anchoCalzadaTags`) porque
`src/scene/calzada.ts` es TypeScript y el pipeline corre en node a pelo. Hay
test de equivalencia contra la función real sobre una matriz de 16 clases × 8
`lanes` × 5 `oneway`.

### Solape de corredores

Por post se acumulan `Σ w·k`, `Σ w·k·h` y `max w`, con `k = PESO_NIVEL[nivel]`,
y al final

```
altura = lerp(DEM original, Σ w·k·h / Σ w·k, max w)
```

Es continua en todas partes: donde una vía se apaga, su `w` se apaga con ella.
De ahí que no haga falta decidir "quién gana" con un `if`, que es lo que
dejaría el escalón. Con `k = 2^nivel` una troncal pesa 16 veces lo que una
calle: en el cruce manda ella. Dos vías del mismo nivel dan la media exacta.

### El piso en posts: lo que se aprendió midiendo

La primera versión usaba el corredor solo del ancho de la calzada. **Empeoró
el problema**: la p99 subió de 35,5 % a 45,2 % y los tramos pasaron de 835.052
a 911.544 porque `apoyar` tuvo que bisecar más.

La razón: una calzada real mide menos que una celda del DEM. Si el corredor
pleno no cubre los posts que rodean al eje, esos posts se quedan a medio
camino entre la plataforma y el terreno, y esa mezcla cambia de un post al
siguiente según por dónde cruce la vía la rejilla. El resultado no es una vía
menos tallada: es una vía **más serruchada** que antes.

`MIN_POSTS_CORREDOR = MIN_POSTS_BANDA = 0,75` posts (~28 m cada uno) resuelve
eso: los vértices del triángulo que pisa el eje caen dentro del corredor pleno
o al principio de la banda, y lo que se dibuja a lo largo del eje ES el
perfil. Un DEM de 38 m no puede representar una plataforma más angosta que su
propia celda; pedírselo es pedirle ruido.

## Constantes calibrables (`scripts/lib/carving.mjs`)

| constante | valor | qué es |
|---|---|---|
| `HOMBRILLO_M` | 1,5 | hombrillo a cada lado de la calzada |
| `TRANSICION_M` | `[0,10,12,15,18,22,25]` | banda de transición por nivel; una troncal mueve más tierra que una calle |
| `PENDIENTE_MAX` | `[0, 0.20, 0.12, 0.12, 0.10, 0.08, 0.08]` | pendiente longitudinal máxima por nivel: 8 % troncal y principal, 10-12 % del resto, 20 % la trocha |
| `VENTANA_M` | 150 | ventana de la media móvil, ~4 posts a cada lado |
| `PESO_NIVEL` | `2^nivel` | cuánto tira cada nivel en un solape |
| `MIN_POSTS_CORREDOR` | 0,75 | piso del corredor, en posts de la rejilla |
| `MIN_POSTS_BANDA` | 0,75 | piso de la banda |

Los índices son el nivel de `src/scene/roadStyle.ts` (0 peatonal … 6 troncal).

## Qué NO talla, y por qué

- **Puentes y túneles** (`bridge` o `tunnel` en OSM, salvo el valor `no`
  explícito). Un puente no aplana el río y un túnel no abre una zanja en la
  cima. Se quedan exactamente como están: apoyados sobre el relieve, igual que
  hoy. Efecto secundario asumido: como sus vecinos sí quedan tallados, un
  puente sobre una garganta se nota más que antes. Darle cota propia (pilas,
  gálibo) es otra tarea.
- **Nivel 0, peatonal** (`footway`, `steps`, `path`, `cycleway`, `pedestrian`…).
  Una acera o una escalera no mueven tierra, y además ahorra decidir qué
  pendiente le toca a un `highway=steps`.

De 26.712 vías, **24.749 tallan**.

## Orden en `build-data.mjs`

`3b/9 tallado` va entre el DEM (3/9) y el municipio (4/9). A partir de ahí
TODO lo que sale del DEM sale del DEM tallado: el drapeado y las normales
(5/9), el relieve del minimapa (8/9) y la pirámide con `errores.json` (8b/9).

Que el **minimapa** use el DEM tallado es deliberado y es cosmético: es la
misma malla de 1024² (~130 m por celda) remuestreada por vecino más próximo, y
un post movido unos metros no cambia un disco de 148 px. Tener dos DEM en
memoria para que uno de ellos no se entere sí costaría 62 MB.

## Rendimiento

Se rasteriza **por tramo con un bbox local**, no recorriendo la rejilla por
vía: con 664.531 tramos sobre 15,6 M de posts, un radio de influencia de ~57 m
son unos 20 posts por tramo. Tres acumuladores `Float32Array` de 15,6 M (187
MB) que se sueltan al terminar el paso.

- Tallado: **0,5 s**. 739.294 posts movidos, el 4,7 % de la rejilla.
- `npm run data` completo con la caché caliente: **42 s**.

## Resultado

| pendiente de la red estructurante | antes | después |
|---|---:|---:|
| p50 | 4,8 % | 3,6 % |
| p90 | 16,2 % | 8,9 % |
| p99 | 35,5 % | 22,4 % |
| máxima | 112,3 % | 111,5 % |
| tramos sobre 15 % | 11,7 % | 2,7 % |
| tramos sobre 25 % | 1.477 | 269 |

Los tramos de 30 m bajaron de 835.052 a **798.007**: el DEM tallado es más
liso a lo largo de las vías, así que `apoyar` biseca menos. La máxima no baja
porque son puentes, que a propósito no tallan.

## Verificación

- `scripts/test/carving.test.mjs` (17 casos) sobre una ladera sintética de
  48×48 posts: el corredor queda plano de lado a lado, la banda de transición
  es monótona y llega a cero, un `bridge=yes` y un `tunnel=yes` no tocan un
  solo post, una acera tampoco, la pendiente del DEM tallado a lo largo del
  eje respeta el límite, en un cruce manda la de más jerarquía, dos del mismo
  nivel dan la media, el corredor nunca baja del piso en posts, y `perfil`
  acota la pendiente sin mover una rampa que ya cumple ni los extremos.
- `scripts/verify-data.mjs`: chequeo nuevo, la p99 de la red estructurante
  `<= 30 %` (medido 22,4 %; antes del tallado, 35,5 %). El umbral deja sitio a
  los puentes.
- `npm test` (274), `npx tsc --noEmit`, `npm run build` y `npm run verify` en
  verde.
- Chrome (Playwright sobre el Chrome del sistema, capturas en el scratchpad,
  mismos clics antes y después): la Trasandina La Grita-Tovar a 100 m enseña
  la banca de la carretera tallada en la ladera donde antes había un talud
  liso; la misma vía a ~110 m y a ~60 m sale sin el serrucho de antes; la
  Avenida Libertador a ~110 m queda igual (valle plano, nada que tallar) y los
  cerros del fondo con sus vías asentadas; la vista de estado, indistinguible.

## Fuera de alcance

Puentes y túneles con cota propia. Taludes con talud real (ángulo de reposo)
en vez de un `smoothstep`. Terraplenes anchos en las autopistas. Calibrar
`PENDIENTE_MAX` contra el perfil real de cada carretera.
