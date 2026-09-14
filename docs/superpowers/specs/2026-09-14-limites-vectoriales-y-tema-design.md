# Límites vectoriales y tema conmutable — diseño

**Fecha:** 2026-09-14
**Tanda:** A de tres. Ver §7 para las otras dos.

## 1. Qué construye esto

Dos cosas que no se parecen entre sí pero comparten una razón para ir juntas:
las dos son la base visual sobre la que se apoya el resto del rediseño, y las
dos son autocontenidas.

1. **Los límites municipales dejan el shader y pasan a línea vectorial**
   drapeada sobre el relieve, con ancho constante en pantalla. Es lo que hace
   que los de Google se vean finos y limpios a cualquier zoom, y lo que los
   nuestros no pueden ser mientras vivan en una textura.
2. **`theme.ts` deja de ser un objeto de literales y pasa a variables CSS**,
   con una paleta clara y una oscura y un interruptor entre las dos.

No entra nada más. El armazón acoplado y los paneles con poder son las tandas
B y C, y este documento no los diseña.

## 2. Por qué el shader no puede dar lo que se pidió

Hoy la línea se dibuja dentro de `albedoRelieve()` comparando el índice de un
téxel con el de su vecino, sobre una textura `indiceMunicipios` de 2048×2048
con filtro `NEAREST` (`stateMask.ts`, `terrainShader.ts`, `TerrainLod.tsx`).
De ahí salen tres defectos que no son de calibración sino de forma:

- **El ancho está en metros, no en píxeles.** Un téxel de esa textura mide
  unos 80 m sobre el terreno. De lejos la línea desaparece bajo un píxel; de
  cerca es una banda de ochenta metros. Google mantiene la suya en 1–2 px a
  cualquier altura, y eso una textura no lo puede hacer.
- **Escalona.** `NEAREST` sobre una rejilla regular da exactamente los
  escalones de una diagonal rasterizada. No hay filtro que lo arregle sin
  emborronar el límite.
- **La frontera no existe como objeto.** Es un efecto de borde entre dos
  regiones, así que no se le puede dar color propio, ni opacidad, ni grosor
  por tipo, ni hacerle nada que una capa de verdad permita.

La rejilla de 2048² tampoco es gratis: son 4 MiB de textura que se construyen
al montar aunque nadie prenda la capa.

## 3. Los límites como geometría

### 3.1 El dato que hay

Medido sobre `public/data/municipios.json` (2026-09-14):

| | |
|---|---|
| Municipios | 29 |
| Anillos | 29 |
| Vértices | 132.165 |
| **Aristas únicas** | **81.599** |
| **Aristas compartidas por dos municipios** | **50.566 (62 %)** |
| Perímetro total | 3.242 km |
| Largo de arista: mediana / p90 / p99 / máx | 15,5 m / 40,8 m / 152 m / 5.564 m |
| Aristas > 100 m | 2.668 |

### 3.2 Deduplicar no es una optimización

El 62 % de las aristas pertenece a dos municipios a la vez: son las fronteras
interiores, y cada una aparece una vez en el anillo de cada vecino. Dibujar
los 29 anillos tal cual pinta esas aristas **dos veces**, superpuestas.

Con `transparent: true` eso no es invisible: las dos pasadas se acumulan, así
que toda frontera interior sale al doble de opacidad que el contorno exterior
del estado —que solo tiene un dueño— y con z-fighting entre las dos copias.
El resultado sería un mapa donde los límites interiores se ven más fuertes que
el borde del estado, que es justo al revés de como debe leerse.

Así que la deduplicación es lo que decide si esto se parece a Google o no:

```
clave(a, b) = las dos coordenadas redondeadas a 7 decimales,
              ordenadas alfabéticamente entre sí
```

El orden alfabético hace la clave independiente del sentido en que cada
municipio recorra su anillo. Siete decimales son ~1 cm: los nodos compartidos
en OSM son el mismo nodo, así que coinciden exactamente; siete decimales
absorben el ruido de la serialización a JSON sin llegar a fundir dos nodos
distintos.

Salida: 81.599 aristas, un 38 % menos que dibujando los anillos.

**Los nodos que OSM no comparte exactamente no se funden y se dibujarán dos
veces.** Eso es aceptable —son los pinchazos que `stateMask` ya trata como
ruido del dato— pero el conteo de aristas deduplicadas va en un test, para que
si algún día el dato empeora se vea en el número y no en la pantalla.

### 3.3 El drapeado va en el pipeline

El relieve que se dibuja saca sus alturas de la pirámide del DEM
(`demTiles.ts`, `nodoTerreno.ts`), y `alturaEnTesela` sigue *la misma regla*
que `alturaEnPosts` de `scripts/lib/drape.mjs`. Por eso las vías, drapeadas en
el pipeline con esa función, encajan sobre la malla sin hundirse.

`terrain.bin` **no sirve** para esto: es el grid grueso del minimapa y del
disco. Son 1024×1024 celdas sobre un bbox de 136×164 km, o sea **132 m de
celda en X y 160 m en Y**, mientras la malla que se dibuja a z15 tiene celdas
de ~36 m. Una línea drapeada contra el grid grueso se hundiría en cada cresta
que el relieve fino tiene y el grueso no.

(`App.tsx:522` dice que el bbox mide «~147×129 km». Medido sobre
`terrain.json` da 136×164, y encima al revés: el estado es más alto que ancho.
No se corrige aquí —queda fuera de esta tanda— pero el número bueno es el de
arriba.)

Por eso el drapeado va donde ya está resuelto: en `scripts/build-data.mjs`,
con `drape.mjs` y `subdividir.mjs`, exactamente como las vías.

Como la arista mediana mide 15,5 m, casi nada necesita subdividirse: solo las
2.668 aristas de más de 100 m, y `apoyar()` decide dónde partir midiendo el
error real contra el DEM en vez de trocear a ciegas.

### 3.4 Archivos que aparecen

- `public/data/limites-pos.bin` — `Float32Array` con 6 floats por segmento
  (x,y,z del inicio y del fin en ENU), el mismo formato que `roads-pos.bin`
  espera `LineSegmentsGeometry.setPositions`.
- La entrada correspondiente en la lista `ARCHIVOS` de
  `scripts/datos-empaquetar.mjs`, para que entre en el Release.
- Una carga más en `load.ts`, junto a las que ya hay.

### 3.5 Cómo se dibuja

Componente nuevo `src/scene/LimitesMunicipales.tsx`, con el patrón de `Roads`:

```ts
const material = new LineMaterial({
  worldUnits: false,      // el ancho va en PÍXELES -- es el punto de todo esto
  transparent: true,
  depthWrite: false,      // igual que las vías: no tapa lo que viene detrás
})
material.resolution.set(size.width, size.height)   // por cuadro, como Roads
```

`worldUnits: false` es lo que da el ancho constante en pantalla. `resolution`
hay que mantenerla al día con el tamaño del canvas, y `Roads.tsx` ya lo hace
cada cuadro: se copia ese bucle.

Los vértices se alzan `ALZA_MIN_M` (0,25 m, `roadsShader.ts`) sobre el
terreno, que es el mismo margen con el que se apoyan las vías.

`renderOrder` por debajo de las vías: un límite administrativo nunca debe
taparle una calle al que está evaluando el pavimento.

### 3.6 El estilo, que es lo que se pidió

Google no dibuja los límites en negro ni en el color de acento: usa un gris
tirando a violeta, fino y tenue, que se lee sobre el mapa sin competir con
nada. Los valores de partida:

| | Claro | Oscuro |
|---|---|---|
| Color | `#9aa0a6` | `#7c828a` |
| Ancho | 1,3 px | 1,3 px |
| Opacidad | 0,85 | 0,75 |

Son el punto de partida, no el resultado: el ancho y la opacidad se calibran
mirando el mapa sobre relieve hipsométrico **y** sobre foto satelital, que es
el caso difícil. Quedan como constantes nombradas en un solo sitio, con el
comentario de que se calibraron a ojo sobre las dos bases y no de una tabla.

### 3.7 Lo que se borra

Al pasar a geometría, esto deja de tener dueño y sale:

- `indiceMunicipios()` en `stateMask.ts`, con sus tests.
- En `terrainShader.ts`: los uniformes `uIndices`, `uTexelIdx`, `uLimites`,
  la constante `LIMITE`, la función `difiere()` y el bloque de dibujo dentro
  de `albedoRelieve()`.
- En `TerrainLod.tsx`: la constante `INDICES`, el `useMemo` que arma la
  `DataTexture` de 2048², su `dispose`, el prop `limites` y las dos líneas que
  escriben los uniformes por nodo.
- En `OpcionesRelieve`: los campos `indices` y `texelIndices`.

Se recuperan 4 MiB de textura que hoy se construyen siempre.

## 4. El tema

### 4.1 La línea que no se cruza

`theme.ts` mezcla hoy dos cosas que ahora hay que separar, porque una cambia
con el tema y la otra **jamás puede cambiar**:

- **Chrome** — fondo, textos, líneas, acento, avisos, sombras. Cambia.
- **Dato** — la rampa del PCI (`PCI_RANGES`), la hipsometría del relieve, el
  color de cada capa (`#e0453a` de hospitales), el color de las vías por
  nivel. **No cambia nunca.** Un verde que significa "pavimento bueno" tiene
  que ser el mismo verde de día y de noche, o el mapa miente.

`css3()` convierte colores de dato a CSS y por eso se queda exactamente donde
está, sin tocarlo.

Esa frontera va escrita en el propio `theme.ts` como comentario de cabecera,
porque es la regla que hay que respetar al añadir cualquier color futuro.

### 4.2 De objeto a variables

Hoy `T.fondo` es la cadena `'#ffffff'` incrustada en estilos en línea de una
decena de componentes. Pasa a ser `'var(--fondo)'`: **la forma de usarlo no
cambia** —sigue siendo `style={{ background: T.fondo }}`— pero el valor lo
resuelve el navegador, así que cambiar de tema no re-renderiza nada.

Las dos paletas se declaran una sola vez, en un `<style>` que la app inyecta:

```css
:root            { --fondo: #ffffff; --texto: #1f2124; --acento: #15607a; … }
:root[data-tema="oscuro"] { --fondo: #11161c; --texto: #e6ebf2; --acento: #4aa8c9; … }
```

El interruptor es `document.documentElement.dataset.tema = 'oscuro' | 'claro'`.

### 4.3 La paleta oscura

| Token | Claro | Oscuro | Por qué |
|---|---|---|---|
| `fondo` | `#ffffff` | `#11161c` | Azulado, no gris neutro: el neutro puro sobre el verde-ocre del terreno se ve sucio, y eso vale en los dos temas |
| `fondoSuave` | `#f5f6f7` | `#1a212a` | |
| `texto` | `#1f2124` | `#e6ebf2` | |
| `texto2` | `#5b6169` | `#a7b0bb` | |
| `texto3` | `#868c94` | `#79838f` | |
| `linea` | `#e4e6e9` | `#232c36` | |
| `lineaFuerte` | `#d0d4d9` | `#33404e` | |
| `acento` | `#15607a` | `#4aa8c9` | El petróleo original es ilegible sobre fondo oscuro; el claro conserva el matiz y sigue sin competir con la rampa verde→rojo |
| `acentoHover` | `#0f4b60` | `#68bcd9` | |
| `acentoSuave` | `#e8f1f4` | `#15303c` | |
| `aviso` | `#7a5200` | `#e0b050` | |
| `avisoFondo` | `#fff4dc` | `#2e2410` | |
| `avisoLinea` | `#f0dcae` | `#4d3d18` | |
| `sombra` | dos capas oscuras | dos capas más opacas | En oscuro la sombra no separa: se refuerza con un borde de `linea` |

### 4.4 Elegir, recordar y no imponer

- Sin elección previa, manda `prefers-color-scheme` del sistema.
- La elección explícita se guarda en `localStorage` y gana sobre el sistema.
- Toda lectura y escritura de `localStorage` va en `try/catch`: en una ventana
  privada el acceso lanza, y el mapa tiene que abrir igual.
- El botón vive en la botonera de `MapControls`, junto a los demás
  interruptores de capa, con `aria-pressed` como ellos.

### 4.5 Lo que hay que comprobar, no suponer

El chrome oscuro cambia el contraste de **todo lo que se dibuja encima**. Antes
de dar esto por bueno hay que mirar, en oscuro:

- La rampa del PCI en la ficha de vías y en la leyenda: el verde de "bueno" y
  el rojo de "malo" tienen que seguir distinguiéndose entre sí y del fondo.
- El texto de las etiquetas de hospital, que va sobre un fondo blanco
  semitransparente fijo (`rgba(255,255,255,.82)`, `CapaPuntos.tsx`) — ese es
  chrome disfrazado de dato y hay que pasarlo a token.
- La atribución de OSM y Esri, que es obligación legal y no puede quedar
  ilegible en ningún tema.

## 5. Cómo se prueba

**Unitario, donde hay lógica:**

- `aristasUnicas()`: dos municipios que comparten una frontera producen esa
  arista una sola vez; el sentido del recorrido no importa; el conteo sobre el
  dato real es 81.599.
- El drapeado del pipeline: una arista sobre terreno conocido sale con la
  altura que `alturaTriangulo` da en esos puntos.
- `temaDe(guardado, prefiereOscuro)`: la elección explícita gana; sin ella
  manda el sistema; un `localStorage` que lanza no rompe nada.

**e2e, sobre la escena dibujada** (`e2e/capas.spec.ts` ya tiene el andamiaje):

- Al prender Municipios aparece un objeto `limites` en la escena con más de
  80.000 segmentos, y al apagarla desaparece.
- `material.resolution` coincide con el tamaño del canvas tras un cambio de
  tamaño de ventana — si no, el ancho en píxeles deja de ser el pedido.
- Cambiar de tema cambia el color de fondo calculado del panel de capas, y el
  color de la rampa del PCI **no** cambia.

**Lo que solo pueden juzgar los ojos de Samuel**, y por eso no lleva test: si
el ancho y la opacidad de la línea están bien sobre hipsometría y sobre foto
satelital, y si la paleta oscura se ve como él quiere.

## 6. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Los 81.599 segmentos en un solo `LineSegments2` pueden pesar al dibujar | Medir con GPU real antes de optimizar. Si pesa, el corte natural es por municipio y recortar por frustum, no bajar la calidad de la línea |
| La línea se hunde donde el DEM del pipeline y la malla dibujada no coinciden exactamente | Es el mismo riesgo que ya corren las vías, con el mismo margen (`ALZA_MIN_M`). Si aparece, se sube ese margen para los límites, que toleran más paralaje que una calzada |
| Borrar los uniformes del shader toca `albedoRelieve()`, que dibuja todo el relieve | Los tests de `terrainShader` existen y se corren; el e2e del relieve (`relieve.spec.ts`) es la red de verdad y hay que correrlo entero antes de cerrar |
| El tema oscuro deja algún color ilegible que nadie mira | §4.5 lo lista explícitamente; además el e2e comprueba que la rampa del PCI no cambia |

## 7. Las otras dos tandas

Fuera de este documento, y en este orden:

- **B — El armazón.** La rejilla de aplicación: barra de menús, riel izquierdo
  con pestañas, panel derecho contextual, barra de estado con
  coordenadas/zoom/rumbo/inclinación. Mover las diez piezas que hoy flotan con
  `position: fixed`. El riesgo vive aquí: el canvas deja de ser la ventana, y
  la foto trazada, el lazo y el minimapa dan por hecho que lo es.
- **C — Los paneles con poder.** Un modelo único de capas: hoy las vías, la
  foto satelital y la lluvia no están en el catálogo, viven como booleanos
  sueltos en `App.tsx`. Encima de eso, opacidad por capa, leyenda, zoom a capa
  y el orden de las superpuestas.
