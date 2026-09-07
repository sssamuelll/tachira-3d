# Asfalto físico manejado por el PCI

Fecha: 2026-09-07. Rama: `hr/asfalto`, sobre `feat/vialidad-3d` (ed4fc44).

## Problema

`2026-09-07-calzada-en-metros-design.md` dejó la calzada con su ancho real en
metros y sus marcas viales, y puso el grano del asfalto explícitamente fuera de
alcance (§6: «El color de la calzada es el PCI»). A 30 m de cámara el resultado
es una cinta de color plano, perfectamente antialiaseada y perfectamente
irreal: la vía tiene la forma de una carretera y la superficie de una etiqueta.

Y el PCI, que es EL dato de la aplicación, solo se dice de una manera: el matiz.
Un pavimento real dice su estado de otras seis: grietas, parches, baches,
huellas de rodadura, pintura comida, brillo.

## Decisión

Textura PBR real (CC0) muestreada en **coordenadas de calzada en metros**, con
el color de PCI aplicado **multiplicando** y el desgaste gobernado por
`1 - PCI/100`. Todo por encima de un umbral de píxeles, con transición continua
al color plano que ya existe.

El GLSL vive en `src/scene/asfalto.ts` y se inyecta desde `patchLineMaterial`
(`roadsShader.ts`) solo en el pase de relleno. El contorno y el pase de ids no
lo llevan: no hay superficie que texturizar en un borde de tres píxeles.

## 1. Texturas

ambientCG **Asphalt006**, CC0, paquete `Asphalt006_1K-JPG.zip`. Tres mapas en
`public/texturas/asfalto/`, recomprimidos con ffmpeg (`-q:v 4`, y el de
rugosidad en escala de grises): albedo 273 KB, normal 1,15 MB, rugosidad
138 KB. El normal original pesaba 2,76 MB. Procedencia y tratamiento en el
`LICENSE.md` de esa carpeta, con un test que comprueba que los tres archivos
existen, pesan menos de 2 MB y que la licencia nombra CC0, ambientCG y el id.

Se cargan una vez para toda la red (tres subidas a GPU, no veintiuna): albedo en
sRGB, normal y rugosidad lineales, `RepeatWrapping`, anisotropía 8 (ver §6).
Un uniform compartido `uAsfaltoOn` vale 0 hasta que los tres están arriba: un
sampler sin textura devuelve NEGRO en WebGL, sin error.

## 2. Coordenadas y escalas

`u = vDist` (metros recorridos), `v = t · calzadaM / 2` (metros al eje), con
`calzadaM = vCalzadaPx · vMpp`. Así el grano mide lo mismo en una troncal de
24 m y en una calle de 5, y no se estira en las curvas.

**Las escalas del brief (30 y 2 m) no funcionaron y la diferencia se midió.**
Un tile de 2 m sobre 1024 px son 2 mm por texel; a 30 m de cámara un píxel
cubre 1,4 cm, o sea trece texels por píxel. El mipmap los promedia y lo que
sale es gris liso: la calzada se veía de yeso, sin un solo grano. Y 30 m de
macro sobre una calzada de 6,8 m cubre 0,23 de su ancho, así que el manchado se
lee como vetas longitudinales.

Las cifras que quedan: **micro 12 m** (1,2 cm por texel, ~1 texel por píxel a
30 m: el grano se ve) y **macro 40 m** con sesgo de mipmap +1,2 (manchado de
baja frecuencia, que es lo que sobrevive a 125 m). El precio es que el árido de
la foto sale ampliado seis veces y ya no es árido de 5 mm sino manchado de
5 cm — que es, de todas formas, lo que el ojo distingue a 30 m de distancia.
El test fija la CUENTA (texels por píxel a 30 m < 3), no la cifra.

**Anti-repetición** (Heitz y Neyret 2018) en la macro: rejilla triangular,
tres muestras desplazadas por el hash de cada vértice, mezcla que preserva la
varianza. Se documenta la diferencia con el paper: la versión completa
gaussianiza la textura fuera de línea y deshace la gaussianización con una LUT,
preservando el histograma entero; acá se preserva solo la varianza. Para
asfalto — histograma casi gaussiano, contraste bajo — no se distingue. Con una
textura de adoquín o grava gruesa sí se distinguiría y habría que traer la LUT.

La micro va lisa: su repetición a 12 m queda enmascarada por la macro y por las
cuatro capas procedurales, que no repiten nunca.

El hash NO es el clásico `fract(sin(dot(p,k))·43758.5)`: con `vDist` llegando a
10 km el argumento del seno pasa de 10⁶ y un float32 se queda sin dígitos para
su parte fraccionaria. Se usa el de Hoskins, que no tiene ese acantilado.

## 3. El PCI: tinte y desgaste

**Tinte.** `base` ya trae `pciColor()` (o el azul de selección) cuando el bloque
corre, y se MULTIPLICA por el grano normalizado a ~1,0. Multiplicar es la única
operación que conserva el matiz exacto de la rampa ASTM. `TINTE_PCI = 0,85`
mezcla ese resultado con el gris real del asfalto; es el pomo que decide si
esto es un mapa de datos con textura o una foto donde el dato se perdió.

`NIVEL_CERCA = 0,7`: la calzada de cerca va más oscura que el color plano. Sin
esto, una vía sin evaluar (0,96, casi blanca, y son las 26.712 al abrir) se lee
como una losa de concreto. Un pavimento real refleja del orden de la mitad.

**Desgaste** = `1 - PCI/100`, con el centinela 255 («sin evaluar») dibujado como
PCI 70: una vía que nadie inspeccionó no es una vía nueva, ni una ruina.

| capa | forma | cómo entra el desgaste |
|---|---|---|
| huellas de rodadura | gaussiana sobre la distancia al centro del canal, a 0,90 m de semitrocha; el valor absoluto pinta las dos bandas de una vez | oscurece proporcional; el pulido (rugosidad) es del tráfico y no del PCI |
| grietas | Voronoi de 1,1 m, distancia al borde por F2−F1 | ancho al CUADRADO, contraste lineal, y una máscara de zona (fBm) |
| parches | fBm de 9 m con umbral móvil | umbral de 0,80 a 0,42 |
| baches | celdas sueltas del MISMO Voronoi (un bache es piel de cocodrilo desprendida) | al CUBO: 1% de las celdas a PCI 70, 22% a PCI 10 |
| pintura | las marcas existentes, atenuadas por manchas de ruido | se come hasta dejar el 20% |

El desgaste entra al cuadrado y al cubo a propósito: la curva de deterioro de un
pavimento real no es lineal. La primera versión, con el ancho de grieta como
único factor, dibujaba la piel de cocodrilo entera a pleno contraste sobre una
vía «Bueno» a PCI 70 y se leía como un enlosado.

## 4. Iluminación

`uniform vec3 uSol` (unitaria, HACIA el sol, ejes del mundo), con default
`normalize(0.4, 0.8, 0.3)` declarado en `patchLineMaterial` para los dos pases.
**Este agente no lo alimenta**: lo hará el agente de luz desde `Roads.tsx` vía
`userData.uniforms.uSol`.

El marco tangente de la calzada sale del **colofón** de `extrusionGlsl` (solo
pase visible; el bloque compartido con el pase de ids no puede ganar varyings):
`vDirW`, `vTerrW` y `vPosW`, pasados de cámara a mundo con `v * mat3(viewMatrix)`
— en GLSL eso es `Mᵀ·v`, y para una cámara sin escala la traspuesta ES la
inversa. La posición además se destraslada con `viewMatrix[3].xyz`. El lado se
calcula en el fragment con un `cross`, que sale más barato que un varying.

Difuso N·L con la normal perturbada, Blinn-Phong con la rugosidad del mapa, y
ambiente de hemisferio que nunca llega a cero (una ladera en sombra tiene que
seguir enseñando su PCI). `AMBIENTE + 0,848·SOL_DIF = 1,0` a propósito: el
asfalto de cerca promedia el mismo brillo que el color plano de lejos, así que
no hay salto de exposición al acercarse.

## 5. Nivel de detalle

`cerca = smoothstep(12, 26, vCalzadaPx)`, y el bloque entero dentro de un `if`.
A vista de estado no se ejecuta ni una muestra de textura. El corte temprano es
0,08 y no 0: por debajo de eso el bloque aportaría menos del 8% de un color que
ya es prácticamente el plano.

## 6. Dos bugs que costaron la mitad del tiempo

**Las tapas de tramo congelan `vDist`.** El cuadrilátero de
`LineSegmentsGeometry` tiene `position.y` en {-1, 0, 1, 2}: el cuerpo es [0,1] y
las tapas redondas [-1,0] y [1,2]. Los dos vértices de una tapa caen del mismo
lado de la prueba `position.y < 0.5` con que se elige `d0` o `d1`, así que
`vDist` sale CONSTANTE en toda la tapa — media calzada de largo, 3,4 m en una
avenida. Con la coordenada a lo largo congelada, TODO lo que se calcula sobre
ella (asfalto, Voronoi, fBm) se degenera en una función de la transversal sola:
en pantalla, vetas paralelas a la vía en bandas de 130 m, con el borde redondo
de la tapa. Se persiguió primero como un problema de filtrado de textura, que no
era. Un `vDist += hw * (...)` en el colofón lo arregla, y de paso las marcas
viales dejan de congelarse en las juntas. Hay test.

**El detalle que no cabe en un píxel hay que apagarlo, no dibujarlo.** La huella
de un píxel sobre la calzada no es `vMpp`: `vMpp` mide perpendicular al rayo de
vista, y una calzada de refilón la estira en UN eje, el de la marcha. El
filtrado anisotrópico está topado (16 por defecto; se bajó a 8) y pasada esa
relación el eje corto queda sin promediar. Se probaron `vMpp` a secas y
`vMpp / cos(incidencia)`; las dos rayaban. Lo que funciona es `fwidth()` de la
propia coordenada — la derivada real en pantalla, la única que no hay que
aproximar — y desvanecer micro, normal y macro (cada una con su resolución
efectiva) hacia su media por encima de 2,5 texels por píxel. Desvanecer hacia la
media ES promediar: es prefiltrado honesto, no una rendición.

## 7. Medido en Chrome

Playwright sobre el Chrome del sistema, 1600×1000, Avenida Libertador de San
Cristóbal (6,8 m de calzada, sentido único, dos calzadas).

- **Tinte a 250 m**: PCI 20 `rgb(152,124,117)`, PCI 90 `rgb(131,158,139)`. Rojo
  y verde inequívocos, y los dos claramente distintos del gris de las vías sin
  evaluar de alrededor. El desgaste también se lee a esa distancia: la vía roja
  enseña su red de grietas, la verde está lisa.
- **30 m**: grano visible, huellas de rodadura, grietas, baches y pintura
  comida en PCI 20; superficie limpia con solo grano y huellas en PCI 90.
- **fps orbitando** (mediana de tres muestras de 4 s, tras dejar que el relieve
  termine de cargar): 125 m → **130** con asfalto contra 277 sin él; 30 m →
  **184** contra 419; 500 m → 44 contra 112. El objetivo era ≥ 45 a 125 m.
  El asfalto cuesta aproximadamente la mitad del presupuesto de fragmento del
  pase de relleno; los otros agentes que vengan encima de este material tienen
  que contar con eso.
- **Vista de estado**: idéntica. El bloque no se ejecuta.

## 8. Fuera de alcance

- Relieve de verdad (parallax de baches y juntas): de otro agente.
- Mojado, charcos y reflexión especular de la carretera: de otro agente, encima
  de este material. `rug`, `N` y `V` ya están calculados donde hacen falta.
- La LUT de histograma de Heitz y Neyret (§2).
- Los arcos de mipmap que quedan en el primer metro de calzada delante de la
  cámara, con la superficie casi de canto. Se atenuaron mucho con el
  desvanecimiento de la macro; lo que queda es un caso extremo de cualquier
  shader de suelo y ocupa la franja inferior de la pantalla.
