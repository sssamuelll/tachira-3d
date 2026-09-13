# Contribuir

Este mapa se llena entre varios. Cualquier aporte sirve: un hospital que falta,
una vía mal trazada, un edificio que no existe, una corrección de un dato que
está mal.

## Antes de mandar nada

```bash
npm ci
npm run datos:bajar
npx vitest run      # las pruebas
npx tsc --noEmit    # los tipos
npm run build       # el build
```

Los tres tienen que quedar verdes. La Action los corre en cada pull request.
Si alguno sale rojo, arréglalo antes de pedir que se funda: quien mantiene el
repo no funde nada en rojo.

El build avisa de que un trozo del bundle pasa de 500 kB. Ese aviso ya estaba
antes y no es tu culpa. No subas el umbral para taparlo.

**Si desarrollas en Windows con Git Bash**, exporta esto antes de pasarle a un
comando cualquier valor que empiece por barra, `BASE_PATH=/tachira-3d/` entre
ellos:

```bash
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
```

Sin eso, Git Bash lo convierte en una ruta de Windows y el build sale con una
base equivocada sin que nada falle. Se detecta mirando `dist/index.html`: la
primera etiqueta `script` tiene que apuntar a `/tachira-3d/assets/…`.

## La regla que no se negocia

**Lo medido y lo estimado van separados, y se dice cuál es cuál.**

Este mapa mezcla datos reales con geometría inventada, porque de otra forma no
habría mapa. Lo que no se vale es que no se note la diferencia. Si añades algo
estimado, escribe de dónde salió y qué parte te inventaste. Todos los
documentos de `docs/` están hechos así; míralos antes de escribir el tuyo.

## Añadir una pieza 3D

Un monumento, una plaza, un edificio que merezca estar modelado a mano.
El camino completo está en [docs/piezas-3d.md](docs/piezas-3d.md), y el
Centro Cívico es el ejemplo más reciente:
[docs/centro-civico.md](docs/centro-civico.md).

En resumen: un script de Blender que genera el GLB a partir de un JSON de
medidas, el GLB sellado con su procedencia, una entrada en `src/data/piezas.ts`
y un documento que separa lo medido de lo estimado.

## Añadir una capa

Una capa son tres cosas: una entrada en el catálogo, un archivo GeoJSON y, si
sale de OpenStreetMap, una consulta en el registro de semillas.

1. **El catálogo.** Añade una entrada a `CAPAS` en `src/data/capas.ts` con su
   `id`, su `nombre`, su `geometria`, sus `campos`, su `archivo`, su `color`
   y `porDefecto` (booleano: visible sin `?capas=` en la URL). Los campos son lo
   que se puede saber de cada rasgo; un campo de tipo `opcion` declara sus
   valores posibles. Ningún campo puede llamarse `origen`, `osmId` ni `version`:
   esos los pone el sistema. Si uno de tus campos es el nombre del rasgo,
   llámalo `nombre`: el marcador lo usa de etiqueta y la ficha lo muestra como
   título en vez de listarlo con los demás.

2. **El archivo.** `public/data/capas/<id>.geojson`, un `FeatureCollection`
   con `capa: '<id>'`. Cada rasgo lleva un `id` único y estable, su geometría
   en `[lon, lat]` (el estándar, no al revés) y en `properties` los campos de
   la capa más `origen`, `version` y, si viene de OSM, `osmId`.

3. **La semilla, si sale de OSM.** Añade una entrada a `REGISTRO` en
   `scripts/lib/capas-osm.mjs` con su consulta a Overpass y una función
   `traducir(elemento)` que devuelva el rasgo, o `null` para descartarlo.
   Después:

   ```bash
   npm run capa -- <id>
   ```

   Baja de Overpass (con caché en `.cache/`), traduce, y escribe el archivo
   ordenado por id. Lo que alguien haya añadido a mano con `origen:
   'comunidad'` se conserva; lo de OSM se reemplaza.

`validarCapa` en `src/data/capas.ts` es el portero: rechaza rasgos sin `id`,
ids repetidos, geometrías que no corresponden, coordenadas fuera del estado
(el síntoma de haber escrito `[lat, lon]`), campos obligatorios que faltan,
valores fuera de las opciones declaradas, un `origen` que no sea `'osm'` o
`'comunidad'`, un `origen: 'osm'` sin su `osmId`, o uno `'comunidad'` que
todavía trae el `osmId` de la plantilla de la que lo copiaste, y una
`version` que no sea un entero ≥ 1. La prueba de `src/data/capas.test.ts`
lo corre contra el archivo real, así que un GeoJSON roto se ve en el CI y
no en el navegador de un vecino.

**Aviso: hoy solo se dibujan capas de puntos.** `CapaPuntos` es el único
componente de capa que existe. Si añades una capa con `geometria: 'linea'` o
`'poligono'`, pasará la validación, aparecerá en el panel con su color, se
podrá prender y apagar en la URL — pero no dibujará nada, porque no hay
componente que lo haga. Eso no es un error tuyo; la capa quedará lista para
cuando ese componente exista. Dibujar líneas y polígonos es trabajo pendiente,
planeado desde aquí, no algo que hayas olvidado.

## Regenerar los datos base

Solo hace falta si cambias el pipeline.

```bash
npm run data          # vías, terreno, municipios (baja de Overpass, tarda)
npm run edificios     # hornea las edificaciones en teselas
npm run verify        # comprueba lo generado
npm run datos:empaquetar
```

`datos:empaquetar` deja un `datos-base.tar.gz` y te imprime el comando para
crear el Release. Publicarlo lo hace quien mantiene el repo.

## Mandar el cambio

- **Un pull request por cosa.** Una capa nueva y un arreglo de un bug son dos.
- **Di de dónde sacaste el dato.** Si es de OpenStreetMap, el id. Si lo sabes
  porque vives ahí, dilo también: eso vale, y vale más si está escrito.
- **Si rompes una prueba, arréglala de verdad.** Cambiar lo que la prueba
  espera para que pase es peor que dejarla roja.
- Los comentarios y los mensajes de commit van en español, como el resto.

## Reportar sin escribir código

Abre un [issue](https://github.com/sssamuelll/tachira-3d/issues) diciendo qué
está mal y dónde, con coordenadas o con un enlace al mapa si puedes. Eso ya es
una contribución.

## Trato

Este proyecto lo mantiene gente en su tiempo libre, y lo usa gente que no
programa. Se responde con paciencia y se pregunta sin pena. No se le falta el
respeto a nadie por lo que no sabe, ni por de dónde es, ni por cómo piensa. A
quien venga a joder se le saca y ya.
