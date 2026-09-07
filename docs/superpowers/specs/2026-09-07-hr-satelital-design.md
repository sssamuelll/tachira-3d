# Imagen satelital sobre el relieve (fase B)

Fecha: 2026-09-07. Rama: `hr/satelital`, sobre `feat/vialidad-3d`.
Fase A (el relieve por quadtree): `2026-09-07-relieve-fino-design.md`.

## Problema

El relieve ya es un quadtree de teselas Web Mercator z8..z15 con la superficie
exacta del DEM, pero el color sigue siendo hipsometría: una rampa de verde a
blanco por altura. A 60 m de una avenida de San Cristóbal eso es un plano de
colores, no un sitio. Para decidir sobre una vía hace falta ver la vía: si la
calzada está partida, si hay dos canales o cuatro, si el hombrillo existe.

## Decisión

Cada nodo del quadtree lleva su propia foto satelital. Un nodo ES una tesela
(z, x, y) de Web Mercator, así que le toca la tesela de imagen del MISMO
z/x/y: sin reproyección, sin atlas, sin bordes que casar.

Descartado: una sola ortofoto grande del estado (a 1 m/px serían 150.000 ×
130.000 píxeles), y un servicio de teselas con token (Mapbox, Google): esto
tiene que arrancar sin cuenta de nadie.

## 1. De dónde sale la foto

Esri World Imagery, `https://server.arcgisonline.com/ArcGIS/rest/services/
World_Imagery/MapServer/tile/{z}/{fila}/{columna}`. Verificado: sirve San
Cristóbal hasta z18. Ojo con el orden: la FILA va antes que la COLUMNA, al
revés que la ruta `{z}/{x}/{y}` con la que este repo nombra sus teselas.
Invertirlo no da 404, da una tesela de otro sitio del planeta.

- **z8 a z12: horneadas.** `scripts/bake-img.mjs` baja las teselas de los
  nodos que EXISTEN (las claves de `public/data/dem/errores.json`, no el
  rectángulo del bbox) a `public/data/img/{z}/{x}/{y}.jpg`. Son 217 teselas,
  3,0 MB. Caché en `.cache/img/`, escritura atómica (temporal + rename) y tres
  reintentos, el mismo trato que `scripts/lib/terrarium.mjs` le da al DEM: la
  segunda corrida sale sin red. Con eso, la vista de estado y la de municipio
  se dibujan enteras sin conexión.
- **z13 a z17: en vivo.** `src/scene/imagenTeselas.ts`, mismo patrón que
  `demTiles.ts` (LRU, una petición en vuelo por clave). Son decenas de miles
  de teselas para el estado y solo se miran unas pocas por sesión; hornearlas
  no tiene sentido.

Sin red, la petición en vivo falla y el nodo cae a la tesela del ancestro
horneado (`ancestroCargado`): borroso, nunca un hueco. Sin horneado tampoco,
el material apaga la imagen y queda la hipsometría de siempre.

### Nota legal

Esri permite explícitamente usar World Imagery para trazar y validar datos
propios. Servirla desde una aplicación pública cae bajo su contrato general de
uso, no bajo este permiso. Hoy esto es una herramienta local, de un solo
usuario, que pide las teselas desde su propio navegador; si algún día se
publica, hay que revisar el contrato o cambiar de proveedor. La atribución
exigida —"Esri, Maxar, Earthstar Geographics y la comunidad de usuarios de
GIS"— está en pantalla mientras la capa se muestre y no se puede cerrar
(`Atribucion`, `src/ui/MapControls.tsx`).

## 2. La textura del nodo

`uvImagen` en `nodoTerreno.ts`: (i/32, j/32), fila 0 = norte, la convención de
una tesela Web Mercator y la misma de `uvMascara`. Es idéntico en todos los
nodos, así que se arma una vez y todas las geometrías comparten el mismo
`BufferAttribute`.

Mientras la tesela de un nodo viaja, el nodo dibuja la del **ancestro más
cercano que ya esté**, con el trozo que le toca (`uImgUv` = desplazamiento y
escala). Al refinar, el nodo nuevo aparece con la foto borrosa del padre y se
afina cuando llega la propia, en vez de parpadear en gris.

**Un material por nodo**, con los uniforms comunes compartidos POR REFERENCIA
(`uMin`, `uMax`, `uSun`, `uMascara`, `uGanancia`): escribir `uSun.value` los
cambia todos a la vez. No se usa `material.clone()`, que clona los uniforms y
de paso clonaría la textura de la máscara —800 subidas de 1 MB a la GPU—. La
otra alternativa, un material compartido y cambiar la textura en
`onBeforeRender`, no funciona: three no vuelve a subir los uniforms cuando el
material es el mismo del objeto anterior.

## 3. El albedo en el shader

`terrainShader.ts` gana una función `albedo(t)` y nada más. Todo lo que decide
de qué color es un trozo de suelo vive ahí dentro; lo de fuera es el recorte
al contorno y el sombreado, que MULTIPLICA lo que `albedo` devuelve. **Quien
reescriba la iluminación no toca esa función**: cambia el factor por el que se
multiplica.

    gl_FragColor = vec4(albedo(t) * shade, 1.0);
    // albedo: mix(hypso(t), foto * uGanancia, uImagen)

`uImagen` es por nodo (0 si ese nodo no tiene ninguna tesela cargada), no un
interruptor global.

**Ganancia = 1,0, medida y no supuesta.** La foto se sube con
`colorSpace = SRGBColorSpace`, así que el renderer usa formato interno
`SRGB8_ALPHA8` y la GPU la linealiza al muestrear: al shader llega en lineal,
como el resto de la escena. Después la multiplica el hillshade, le suma
neblina la perspectiva aérea y la mapea el AgX de `Sky.tsx`. Cuatro pasos, y
ninguno se predice de cabeza, así que se midió en Chrome sobre San Cristóbal a
4 km (600×400 px del centro de la pantalla, luminancia Rec.709) contra las
teselas z15 y z16 de esa misma zona decodificadas tal cual:

| | media | sigma |
|---|---|---|
| fuente (sRGB de Esri) | 110,8 | 32,0 |
| **ganancia 1,0** | **108,1** | **33,8** |
| ganancia 1,35 | 119,6 | 33,1 |
| ganancia 1,7 | 128,7 | 32,6 |

Con 1,0 lo que se ve ya tiene el brillo y el contraste de la foto original: lo
que el hillshade quita, la perspectiva aérea y el AgX lo devuelven. No queda
lavada. Subirla solo quema los techos de zinc. El uniform se queda igual
porque es el pomo que hay que volver a medir el día que cambie la iluminación.

## 4. Nivel de detalle: z16 y z17

`ventana()` (`nodoTerreno.ts`) pasa a tener paso fraccionario: 0,5 en z16 y
0,25 en z17. Los vértices caen ENTRE posts de la tesela z12 y se muestrean con
`alturaEnTesela`, que replica la regla de diagonal de `alturaEnPosts`
(`scripts/lib/drape.mjs`): triángulos (a,c,b) y (b,c,d), `fx + fy <= 1` cae en
el primero. `nodoTerreno.test.ts` compara las dos de verdad sobre 200 puntos al
azar, no de palabra: es la regla con la que el pipeline apoyó cada punto de
vía, y si se separan las vías se hunden en el relieve.

La superficie de un nodo z17 es EXACTAMENTE la de z15 —un punto sobre un
triángulo del DEM sigue estando sobre ese triángulo— y por eso su error
geométrico es 0.

Y ahí está el problema: con error 0, el quadtree nunca los dibujaría. La foto
es lo que pide bajar, así que la borrosidad de la foto entra al mismo número:

    errorImagen(n) = ERROR_PX · anchoTesela(n.z) / 256
    errorDe(n)     = max(error geométrico, errorImagen)   // solo con imagen

Con eso, la condición del quadtree `error / mpp > ERROR_PX` se vuelve
exactamente "el texel se ve más grande que un píxel de pantalla". No hay dos
criterios de refinamiento compitiendo, hay uno con dos términos.

`Z_MAX` sube de 15 a 17 solo cuando la imagen está encendida.

## 5. Rendimiento

- **Tope de peticiones a la vez: 8.** No es cortesía con Esri. `TerrainLod`
  pide la tesela de cada nodo visible en cada cuadro, y al refinar de golpe
  eso son cientos de nodos nuevos. Sin tope, Chrome contesta
  `ERR_INSUFFICIENT_RESOURCES` a casi todas —medido: 16 fps y media pantalla
  sin foto— y las que sí llegan se suben a la GPU en el mismo cuadro. Lo que
  no cupo se vuelve a pedir en el cuadro siguiente: la cola es el propio bucle
  de render.
- **LRU de 300 texturas**, ~105 MB de GPU (256×256 RGBA con mipmaps, 350 KB
  cada una). Al desalojar hay que llamar a `dispose()`, si no la GPU no suelta
  nada.
- Anisotropía 8 y `ClampToEdgeWrapping`: en rasante, sin anisotropía la tesela
  se vuelve una franja borrosa; con `REPEAT` el filtro del borde trae el píxel
  del lado opuesto y aparece una costura de un texel entre nodos vecinos.

## 6. Interfaz

- Botón "Imagen satelital" (`aria-label` exacto) arriba de la botonera,
  encendido por defecto: para decidir sobre una vía importa si la calzada de
  la foto está partida, no de qué color pinta la hipsometría esa cota. El
  botón existe para el caso contrario, leer el relieve sin que la foto lo tape.
- Atribución abajo al centro, 11 px sobre pastilla translúcida, sin botón de
  cerrar, visible solo con la capa encendida.

## 7. Lo que no cambia

`roadsShader.ts`, `Roads.tsx`, `Sky.tsx`, `quadtree.ts`, `dem-tiles.mjs`, el
minimapa y el pipeline de vías. `public/data/img` está en `.gitignore` como el
resto de `public/data`: se regenera con `node scripts/bake-img.mjs`.

## 8. Verificación

Tests: `bake-img` (orden fila/columna de Esri, filtrado a z8..z12, ruta de
salida); `imagenTeselas` (URL horneada vs. viva, ancestro con offset y escala,
tope en z8, sin ninguna cargada); `nodoTerreno` (paso 0,5 y 0,25,
`alturaEnTesela` contra `alturaEnPosts` del pipeline, celda torcida, `uvImagen`
compartido y con las esquinas en su sitio). `npm test`, `tsc --noEmit`,
`npm run build`.

Chrome real (`docs/` no lleva capturas; ver el informe de la rama): vista de
estado con el horneado, 5 km, 500 m, 125 m y 60 m sobre San Cristóbal con las
teselas en vivo, la vía dibujada contra la calzada de la foto, y el toggle
apagado.
