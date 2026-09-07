# Calzada en metros: las vías como carreteras, no como trazos

Fecha: 2026-09-07. Rama: `feat/vialidad-3d`.

## Problema

De 200 m de cámara para abajo el mapa deja de responder al acercamiento. El
zoom sí llega hasta los 30 m del `minDistance`; lo que no cambia es el dibujo.
Medido en Chrome sobre la Avenida Libertador de San Cristóbal (sentido único,
dos calzadas separadas, sin `lanes` en OSM):

1. **Picos en cada junta.** `LineSegments2` remata cada tramo con una tapa
   redonda del ancho de la *banda del nivel* (`linewidth`, un uniform). El
   fragment shader recorta el cuerpo a la calzada real de la vía, pero la tapa
   conserva el radio de la banda: en una calzada de 3,4 m dentro de una banda
   de 12, la tapa sobresale cuatro veces el ancho de la vía en cada junta. A
   500 m se ven como bultos; a 125 m, como una sierra.
2. **Un solo canal.** Sentido único sin `lanes` se dibuja con la mitad de los
   canales del nivel: 2 / 2 = 1 canal = 3,4 m. Las secundarias y terciarias de
   sentido único que sí traen el dato dicen 2 o más (ver §4).
3. **Ancho de pantalla.** `worldUnits: false`: un tramo a 20 m de la cámara
   sale igual de ancho que uno a 60 m. A 30 m de vista eso se lee como una
   cinta pegada al vidrio y no como una superficie.
4. **Sin sentido.** No hay flechas de circulación; una vía de sentido único
   solo se distingue por la ausencia del eje amarillo.

Lo que NO está roto y se conserva tal cual: la jerarquía por piso de píxeles a
lo lejos, el desvanecimiento por acercamiento y su corte compartido con el pase
de ids, el color por PCI, el contorno por confianza, los bordes, los canales
rayados y la doble amarilla.

## Decisión

Extruir cada vía a su **ancho real en metros, sobre el plano horizontal del
mundo**, en el vertex shader, con el **piso en píxeles calculado por vértice**.
La banda del nivel desaparece: cada vía se dibuja de lo que mide, y el nivel
solo aporta el piso, el orden de dibujo y el desvanecimiento.

Enfoque descartado: seguir en píxeles de pantalla y parchear (escalar las tapas
al recorte, subir el tope, canales, flechas). Deja intacta la causa 3, que es la
que decide si a 30 m se ve una carretera o una cinta.

## 1. Extrusión en metros (`roadsShader.ts`)

Se reemplaza el bloque de desplazamiento en pantalla del vertex shader de
`LineMaterial` (desde `vec2 offset = vec2( dir.y, - dir.x );` hasta
`clip.xy += offset;`, ambos inclusive) por uno propio. Las dos anclas se
comprueban contra el shader real instalado, igual que `ANCLA_VERT` y
`ANCLA_FRAG`, y viven solo en `roadsShader.ts`: el pase de ids las importa.

Por vértice, en espacio de cámara (`start` y `end` ya vienen recortados al
near plane por el código de three que queda arriba):

```
eje      = position.y < 0.5 ? start : end
dirV     = normalize(end - start)            (vec3(1,0,0) si el tramo mide 0)
arribaV  = (viewMatrix * vec4(0,1,0,0)).xyz  (el arriba del mundo, en cámara)
ladoV    = normalize(cross(dirV, arribaV))   (la DERECHA del sentido de marcha)
mppV     = max(-eje.z, 1e-3) * 2 / (projectionMatrix[1][1] * resolution.y)
anchoBase = max(aCalzada, uPisoPx * mppV)    (metros)
anchoM   = anchoBase                                          (relleno, ids)
         = anchoBase + min(10, 0.6 * anchoBase / mppV) * mppV (contorno)
eje     += ladoV * (anchoM / 2) * position.x
eje     -= dirV * anchoM / 2   si position.y < 0
eje     += dirV * anchoM / 2   si position.y > 1
clip     = projectionMatrix * eje
clip.z   = (position.y < 0.5 ? ndcStart : ndcEnd).z * clip.w
```

El orden de la cruz no es estilo: `position.x = +1` va a la derecha del trazo
en el cuadrilátero de `LineSegmentsGeometry`, y así sus triángulos salen
antihorarios vistos desde arriba. Con la izquierda (`cross(arribaV, dirV)`)
el cuadrilátero queda espejado, mira al suelo, y el descarte de caras traseras
se traga la red entera sin ningún error de compilación. Medido en pantalla
durante la implementación; hay test que lo fija.

`mppV` es `metrosPorPixel` evaluado a la profundidad de ESE vértice
(`projectionMatrix[1][1] = 1 / tan(fov/2)`), así que el piso en píxeles se
cumple donde está el vértice y no en el punto que mira la cámara. La última
línea es el mismo ajuste de profundidad del modo `worldUnits` de three: cada
vértice del cuadrilátero toma la z del eje, para que los tramos solapen limpio
en las juntas y el borde exterior no se hunda en una ladera.

El cuadrilátero que sale es un rectángulo plano de `anchoM` de ancho, alargado
`anchoM / 2` en cada extremo. En coordenadas `vUv` (que el modo de pantalla de
three ya rellena) eso es exactamente lo que el test de tapa redonda del
fragment shader de three espera: la tapa queda del ancho de la vía por
construcción. La causa 1 no se arregla, se elimina.

El vertex shader del pase visible deja tres varyings para el fragment:
`vCalzadaPx = anchoBase / mppV`, `vAnchoPx = anchoM / mppV`, `vMpp = mppV`.
Sustituyen a los uniforms `uMpp` y `uBandaPx` y al `vCalzadaPx` que hoy se
calcula a partir de `aCalzada`.

`CASING_MAX` y `CASING_REL` se mudan de `roadStyle.ts` al shader: ahora se
aplican por vértice, no en la CPU.

## 2. Fragment shader (`roadsShader.ts`)

- Desaparece el recorte a la fracción de banda (`fraccion`, `uBandaPx`). La
  coordenada transversal es `t = vUv.x` en los dos pases: cada uno dibuja su
  propia banda entera.
- El antialiasing del borde pasa a cubrir también las tapas:
  `r = |vUv.y| > 1 ? length(vec2(vUv.x, |vUv.y| - 1)) : |vUv.x|`,
  `alpha *= 1 - smoothstep(1 - 2/vAnchoPx, 1, r)`.
- Las marcas cambian `uMpp` por `vMpp`. Nada más cambia en bordes, canales ni
  eje.
- **Flechas de sentido**, dentro del bloque de marcas, solo con `unico`:
  una por canal, centrada en `c_k = -1 + (2k + 1) / canales`, cada 40 m de
  `vDist`, de 5 m de largo: tallo de 3 m por 0,30 m y cabeza triangular de 2 m
  por 1,20 m. La punta va hacia `vDist` creciente, que es el orden de nodos de
  OSM (§4). Se dibujan con el mismo `pintura` y el mismo `detalle` que los
  bordes: aparecen cuando la calzada pasa de 14 px y están completas a 28 px,
  que en una avenida de 6,8 m son ~250 m de cámara. El tallo lleva el mismo
  piso de 1,4 px que el resto de la pintura.

Todas las medidas de flecha son constantes con nombre en `roadsShader.ts`,
calibrables.

## 3. Pase de ids (`PickingPass.tsx`)

Misma extrusión, con `uPisoPx = PICK_WIDTH` (8 px, el área de acierto
generosa de hoy) y `aCalzada` por segmento. Lo que se dibuja se puede tocar
sigue valiendo, ahora también a 30 m: hoy una avenida de 400 px solo se
selecciona por sus 8 px de eje.

`cortePorSegmento` se generaliza a `porSegmento(ways, index, f)`, que expande
un valor por vía a uno por segmento en el orden del buffer; el corte y la
calzada del pase de ids salen de ahí.

## 4. Datos

**Canales por defecto en sentido único** (`calzada.ts`). Del `.cache/vias.json`
de OSM, vías con `oneway=yes` que sí traen `lanes` (enlaces `_link` fundidos
con su clase):

| clase       | 1 canal | 2 | 3 | 4+ | sin dato |
|-------------|--------:|--:|--:|---:|---------:|
| trunk       | 70      | 136 | 6 | 5  | 45       |
| primary     | 25      | 25  | 4 | 16 | 37       |
| secondary   | 3       | 19  | 7 | 5  | 210      |
| tertiary    | 0       | 13  | 8 | 12 | 170      |
| residential | 3       | 10  | 8 | 2  | 844      |
| service     | 7       | 0   | 0 | 0  | 361      |

Regla nueva: sentido único sin `lanes` dibuja **2 canales de terciaria hacia
arriba, 1 en local, rústica y peatonal**. Sustituye a "la mitad del nivel", que
daba 1 a todo menos a la troncal. La tabla `CANALES_POR_NIVEL` gana una
columna para sentido único. El tope de `anchoCalzada` a `NIVELES[n].metros` se
conserva: ya no sostiene el dibujo, pero sigue evitando que una residencial de
seis canales salga de 20 m.

**Sentido de los nodos** (`scripts/`). `normalizeOneway` funde `-1` en `true`
y pierde la dirección. Nueva regla en el pipeline: una vía con `oneway=-1`
invierte sus coordenadas antes de empaquetarse, así que en el frontend
`oneway: true` significa siempre "circula en el orden de los nodos". Helper
`orientar(coords, oneway)` en `scripts/lib/road-meta.mjs`, con test. Hoy el
dataset tiene 0 vías con `-1`; no hace falta regenerar `public/data`.

## 5. Lo que se va

- `Nivel.topePx` y `anchoPx`: el tope existía por las tapas; ya no hay tapas
  que se disparen. `anchoCasingPx` se muda al shader.
- `uBandaPx`, `uMpp` y el `linewidth` por cuadro de `Roads.tsx`. El bucle por
  cuadro se queda con la visibilidad, la opacidad, `uPisoPx` y la alza.
- `worldUnits: false` se queda como está en los materiales: el modo
  `worldUnits` de three orienta la cinta hacia la cámara y mide la distancia
  en 3D, que es otra cosa; lo nuestro sustituye su bloque de pantalla, no
  activa el suyo.

## 6. Fuera de alcance

- Grano de asfalto. El color de la calzada es el PCI.
- El relieve a 30 m es un plano: la malla es de 130 m. Otra tarea.
- Etiquetas de nombre sobre la vía.

## 7. Verificación

Tests (`vitest`): anclas de extrusión contra el `LineMaterial` instalado y
ausentes del shader parcheado; presencia de `ladoV`, `mppV` y la flecha en el
GLSL del pase visible y de la extrusión en el de ids; `carrilesDe` con la tabla
nueva; `porSegmento` sobre un CSR sintético y sobre el dataset real;
`orientar`. Los tests de `anchoPx`, `anchoCasingPx` y `topePx` se borran con
sus funciones. `tsc --noEmit` y `npm run build` limpios.

En Chrome (Playwright sobre el Chrome del sistema, script en el scratchpad):
la Libertador encuadrada y siete acercamientos hasta 30 m, capturas y m/px
medido de la barra. Se juzga a ojo: sin sierra en las juntas, dos calzadas
separadas, la cercana más ancha que la lejana, flechas de 250 m para abajo, y
la vista de estado indistinguible de la actual. Un lazo a 30 m sobre el borde
de la avenida la selecciona.
