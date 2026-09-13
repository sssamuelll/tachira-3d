# Centro Cívico de San Cristóbal

La quinta pieza generada del mapa, y la primera que **reemplaza** obra que OSM ya
tenía. Hasta ahora las piezas se añadían a un sitio vacío; el Obelisco se libró
porque ninguna huella lo contenía. El Centro Cívico sí está en OSM, y hasta que
se vació, el prisma estimado del horneado se dibujaba dentro de las torres.

## DÓNDE ESTÁ Y QUÉ TAN CIERTO ES

`relation/3499128`, multipolígono `building=retail` sobre la Avenida 7ma. Centro
**7.7674716, −72.2326948**. Envolvente de **4.812 m²** —caja de 76 × 84 m— con un
patio interior de **410 m²**.

**Medido:** la envolvente y su patio, bajados de
`api.openstreetmap.org/api/0.6/relation/3499128/full.json` y pasados a metros
locales. Eso es todo lo medido, y está en `scripts/centro-civico.json` bajo
`osm.medido: true`.

**Estimado:** la planta de cada cuerpo, cuántos niveles tiene, la altura de nivel
y la sección de las arcadas. Las plantas se digitalizaron a ojo sobre la imagen
satelital Esri z18, **que tiene paralaje sin corregir**: el techo de una torre
alta aparece desplazado respecto a su base, y ese desplazamiento no se descontó.

**Hipótesis sin confirmar:** que la torre alta sea la del sur y la baja la del
norte. La foto aérea de La Prensa del Táchira da las proporciones —dos torres
octogonales de fachada de arcadas, un cuerpo bajo y un domo de teja— pero no de
qué lado cae cada una. Samuel la aprobó de vista el 11 de septiembre de 2026 sin
haber estado delante del edificio con el modelo al lado; no es una confirmación
de campo.

Fuentes de la volumetría: nota de [La Prensa del
Táchira](https://laprensatachira.com/nota/30291/2022/10/centro-civico-de-icono-de-modernidad-a-simbolo-del-abandono)
—dos edificios, sede y rental, inaugurados el 31 de marzo de 1986, arquitecto
Henry Matheus— y de [La
Nación](https://lanacionweb.com/regional/cambios-para-un-centro-civico-mas-atractivo-al-publico-y-la-inversion/)
—tres torres en el núcleo fundacional, una de catorce pisos—.

## LO QUE QUEDÓ

| Cuerpo | Niveles | Altura |
|---|---|---|
| `torre-sede` | 14 | 47,8 m |
| `torre-rental` | 8 | 26,8 m |
| `domo` (techo piramidal de teja) | 3 | 14,6 m |
| `cuerpo-norte` | 3 | 10,4 m |
| `zocalo` (la envolvente con su patio) | 2 | 6,4 m |

El zócalo de 6,4 m cae a 26 cm de los **6,66 m** que el estimador del horneado ya
le había puesto al bloque genérico. Es coincidencia útil, no una comprobación:
ambas cifras son estimadas y por caminos distintos.

- Generador: [scripts/build-centro-civico.py](../scripts/build-centro-civico.py),
  geometría paramétrica de Blender. Todas las medidas están en el encabezado
  para corregirlas de una.
- Datos: [scripts/centro-civico.json](../scripts/centro-civico.json). Cada cuerpo
  declara en `estimado` qué parte suya es invención.
- Pieza: `public/data/piezas/centro-civico.glb`, **83.668 bytes, 1.983
  triángulos, 5 mallas**. SHA-256:

```text
9bc0ff6732701570dbe7b787c4347a04be35bf4cba6f41950f5e893634a6d553
```

La fachada **no tiene arcos**: en cada nivel la losa vuela 30 cm y el paño se
retranquea 35 cm. A la distancia a la que el visor corta las piezas lee igual que
la arcada real y cuesta 2.000 triángulos en vez de veinte mil.

El arranque de los cuerpos baja 8 m bajo el punto de apoyo. La manzana está en
pendiente y el visor apoya la pieza por un solo punto: sin ese enterramiento, un
borde quedaría al aire.

## LA SUSTITUCIÓN DEL BLOQUE GENÉRICO

`Pieza` gana `sustituye?: CajaSustituida`, una caja ENU donde la pieza reemplaza
a los bloques de OSM. Del Centro Cívico:

```text
X −36544,72 … −36468,39    Z 28093,95 … 28177,45
```

**Por qué una caja y no una lista de ids.** El cliente dibuja un binario fusionado
por tesela y no carga la metadata que traduce id → rango de índices; pedirla solo
para borrar un edificio sería una descarga de 2,3 MB por chunk afectado. La caja
se resuelve contra las posiciones que ya están en memoria.

**Qué cae dentro.** El multipolígono y tres `building=roof` —`way/247780185`,
`way/247780186`, `way/260659190`— que son cubiertas del propio zócalo, ya
modeladas en el GLB. Ninguna otra huella del repo. Eso **no se confía**: lo fija
una prueba que recorre las huellas reales del chunk. Si un re-horneado mete otra
dentro, truena antes de que el mapa borre en silencio el edificio de un vecino.

El vaciado decide **por centroide del triángulo**, no por vértice suelto: vaciar
por vértice abriría agujeros en el edificio que comparte pared con el borde de la
caja.

La construcción de la malla salió de `Buildings` a `geometriaChunk`, que es por
donde pasa el vaciado. Un chunk sin sustitución —que son todos menos uno— no paga
copia ni recorrido: `vaciarSustituidos` devuelve el mismo array.

## QUÉ MIRAR EN CHROME

1. `npm run dev`, sin `edificios=0`.
2. Con el mapa cargado, en la consola:

```js
var recursoFibra = performance.getEntriesByType('resource')
  .find(r => new URL(r.name).pathname.endsWith('/@react-three_fiber.js'));
var { _roots } = await import(recursoFibra.name);
var visor = [..._roots.values()][0].store.getState();
visor.controls.target.set(-36506.55, 680, 28135.70);
visor.camera.position.set(-36380, 780, 28280);
visor.controls.update();
```

3. **Que no haya un prisma plano dentro de las torres.** Ese era el bloque
   genérico de 6,66 m. Los edificios de la acera de enfrente tienen que seguir
   ahí: si desapareció alguno, la caja se pasó.
4. Que la pieza aparezca ya apoyada, sin flotar sobre el terreno provisional ni
   caer después. Si asoma flotando o hundida, el número a mover es `BASE_HONDA`.
5. Orbitar para ver el retranqueo de las arcadas y las sombras entre las dos
   torres.

Nada de esto se comprobó en navegador: no se abrió Chrome durante este trabajo y
no hay medición nueva de FPS.

## VERIFICACIÓN

```text
npx vitest run     70 archivos, 693 tests, 0 fallos
npx tsc --noEmit   sin salida
npm run build      built in 1.45s
```

El build sigue avisando de que el bundle pasa de 500 kB. Ese aviso ya constaba en
`docs/edificaciones-tachira.md`, no lo introduce este cambio y no se tocó el
umbral para taparlo.

No se regeneró `public/data`: solo se añadió un archivo a `public/data/piezas/`.
