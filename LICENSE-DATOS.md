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

## Imagen satelital — ni se guarda ni se reparte

La imagen de fondo es Esri World Imagery y se pide en vivo al servidor de
Esri cuando el mapa la muestra. Este repositorio **no contiene ni distribuye
ninguna tesela de imagen**, y no hay ningún dato derivado de ella por medios
automáticos.
