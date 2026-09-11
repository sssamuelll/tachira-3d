# Licencia de los datos

El código de este repositorio va bajo [MIT](LICENSE). Los datos no: casi todos
derivan de OpenStreetMap, y ODbL se hereda.

## Datos derivados de OpenStreetMap — ODbL 1.0

Vías, edificios, municipios, las capas y todo lo que la comunidad aporte al
mapa, tanto en `public/data/` como lo que produzcan los scripts de `scripts/`.

Licencia: [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).

Atribución obligatoria al reutilizarlos:

> © colaboradores de OpenStreetMap

Las contribuciones de la comunidad a este mapa van bajo ODbL a propósito: es
lo que deja abierta la puerta a subirlas a OpenStreetMap el día que se pueda.

## Relieve — Terrarium

El modelo de elevación sale de las teselas Terrarium de
[AWS Open Data](https://registry.opendata.aws/terrain-tiles/), que combinan
SRTM, GMTED2010 y otras fuentes públicas. Sus términos y la lista completa de
fuentes están en ese registro.

## Piezas 3D — CC BY 4.0

Los modelos de `public/data/piezas/` están generados para este proyecto, no
levantados en campo. Cada uno documenta en `docs/` qué parte suya está medida
y qué parte es estimada.

Licencia: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Van en CC BY y no en ODbL porque un modelo 3D generado a partir de una huella
es una *Produced Work* en el vocabulario de ODbL, no una base de datos
derivada: la licencia le exige atribución, no herencia. Es la misma figura por
la que una imagen renderizada de un mapa de OpenStreetMap no obliga a poner
esa imagen en ODbL. La atribución a OpenStreetMap sigue siendo obligatoria y
está arriba.

## Imagen satelital — Esri World Imagery

La imagen de fondo se pide en vivo al servidor de Esri cuando el mapa la
muestra. **Este repositorio no contiene ni distribuye ninguna tesela de
imagen**: no hay ninguna en git ni en el paquete de datos.

**Lo que sí deriva de esa imagen, y hay que decirlo:** el color de techo de las
edificaciones. El horneado muestrea píxeles de Esri para los 45.593 edificios:
en 7.760 toma la mediana de los que caen dentro de la huella a z18, y en los
otros 37.833, donde esa muestra no existe, toma un solo píxel de contexto a
z12, que no resuelve el techo y solo tiñe. En los dos casos se guarda un valor
RGB por edificio. El manifiesto lo declara en `sources.roof` y el detalle de
cada edificio dice cuál de los dos caminos siguió.

Ese muestreo se retira en la siguiente tanda de trabajo, que sustituye el
color por una paleta sembrada a partir de la clase del edificio, sin tocar
ninguna imagen.
