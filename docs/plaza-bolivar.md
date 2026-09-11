# Plaza Bolívar de San Cristóbal

La manzana pegada al norte del [Centro Cívico](centro-civico.md). Es la primera
pieza del mapa en la que **casi todo está medido**: el Centro Cívico hubo que
inventarle la volumetría entera sobre una envolvente, y aquí OSM trae el trazado
interno completo.

## DÓNDE ESTÁ Y QUÉ TAN CIERTO ES

`way/1326164631`, `place=square`. Origen de la pieza en el **centroide de sus
vértices**, 7.7679729, −72.232404 — que es el origen con el que se exportó el
GLB. 6.660 m², manzana de 96 × 94 m.

**Medido**, bajado de Overpass y no retocado:

| Qué | Cuánto |
|---|---|
| Perímetro | 8 vértices |
| Jardineras (`barrier=hedge`, `wall`, `block`) | 12 tramos, **864 m** |
| Hileras de árboles (`natural=tree_row`) | 6 tramos, **240 m** |

**Estimado:** las alturas y anchos de sección —brocal de 45 cm, seto de 80,
muros de 1,10—, y **cada árbol concreto**: OSM da la línea, no los individuos.
Se planta uno cada 6 m sobre la hilera medida, y salen 42.

**Sin ningún respaldo de OSM: el monumento.** No está mapeado. Su posición se
leyó del objeto claro con sombra que se ve en la explanada en la imagen satelital
Esri z18, a 6 cm por píxel: **X +11,5 / Y +3,5** en metros locales. Las medidas
—pedestal de 2,40 m de lado y 3,20 de alto, figura de 3,40— son inventadas. La
figura es un volumen sobrio, no un retrato: de El Libertador no hay aquí más dato
que su presencia, y modelarle la cara sería inventar con detalle.

Un primer intento lo puso en la explanada sur y quedó tapado por una hilera de
árboles; se corrigió mirando la satelital con más aumento.

## LO QUE QUEDÓ

- Generador: [scripts/build-plaza-bolivar.py](../scripts/build-plaza-bolivar.py).
- Datos: [scripts/plaza-bolivar.json](../scripts/plaza-bolivar.json), con
  `osm.medido: true` y la nota de qué queda fuera de eso.
- Pieza: `public/data/piezas/plaza-bolivar.glb`, **155.136 bytes, 2.629
  triángulos, 6 mallas** —`plataforma`, `jardineras`, `setos`, `arboles`,
  `pedestal`, `figura`—. SHA-256:

```text
214d84481c69417bb8c7852eb6f003bd608974b5d14708254da1fd77e73d8936
```

**Sin `sustituye`**: dentro del perímetro no hay una sola huella de OSM que
pisar. Los vecinos —Casa Steinvorth, C.C. Mauxil, C.C. La Pirámide— están todos
fuera. Eso no se confía: una prueba recorre las huellas del chunk con
punto-en-polígono de verdad, no por caja. Si algún día aparece un edificio ahí
dentro, truena y habrá que decidir si se sustituye o si el modelo estaba mal.

Dos decisiones de geometría que conviene conocer antes de tocar el script:

**La losa monta 25 cm sobre el bordillo** (`ALZA`). A cota cero quedaba coplanar
con el terreno del visor y parpadeaba. Una plaza va sobre bordillo de todas
formas, así que el arreglo del z-fighting coincide con lo correcto.

**Las jardineras vienen en OSM como dos setos concéntricos**, el de fuera y el de
dentro. Rellenar los dos de verde dejaría dos tapas a la misma cota peleándose
por el z-buffer, así que se rellena el mayor de cada grupo y el pequeño se dibuja
encima: macizo con borde, que es lo que se ve en el sitio.

## LO QUE DELIBERADAMENTE NO ESTÁ

**Las cinco escaleras de OSM, 59 m en total.** La plataforma es horizontal, y
sobre una plataforma horizontal serían peldaños que no suben a ninguna parte.

El terreno de la manzana cae unos 7 m de este a oeste —**651,72 m** en la Casa
Steinvorth contra **659,09 m** en el C.C. Mauxil, según el `baseY` que el
horneado de edificios ya calculó para cada uno—, y la plaza real salva eso con
escaleras. Aquí se apoya en un punto y se le da un faldón de 8 m, que es lo que
hace una plaza en ladera: a ras arriba y con muro de contención abajo.

Las escaleras entran el día que un script muestree el DEM tallado y la losa deje
de ser plana, como ya hace `build-viaducto.py` con su campo `alturas`. Queda
marcado como `ponytail:` en el script, con esa condición de entrada escrita.

## QUÉ MIRAR EN CHROME

1. `npm run dev`, sin `edificios=0`.
2. Con el mapa cargado, en la consola:

```js
var recursoFibra = performance.getEntriesByType('resource')
  .find(r => new URL(r.name).pathname.endsWith('/@react-three_fiber.js'));
var { _roots } = await import(recursoFibra.name);
var visor = [..._roots.values()][0].store.getState();
visor.controls.target.set(-36500, 660, 28060);
visor.camera.position.set(-36400, 730, 28200);
visor.controls.update();
```

3. Que la losa **no parpadee** contra el terreno. Si lo hace, la `ALZA` de 25 cm
   se quedó corta para la pendiente de ese punto.
4. Por dónde queda el faldón al aire y cuánto. Es la medida de cuánto miente la
   plataforma horizontal, y decide si toca meter el muestreo del DEM.
5. Que el monumento esté despejado en la explanada y no bajo una copa.
6. Al fondo, el Centro Cívico.

Nada de esto se comprobó en navegador: no se abrió Chrome durante este trabajo y
no hay medición nueva de FPS.

## VERIFICACIÓN

```text
npx vitest run     70 archivos, 695 tests, 0 fallos
npx tsc --noEmit   sin salida
npm run build      built in 3.02s
```

Se mantiene el aviso de tamaño de bundle que ya constaba antes de este trabajo.
No se regeneró `public/data`: solo se añadió un archivo a `public/data/piezas/`.
