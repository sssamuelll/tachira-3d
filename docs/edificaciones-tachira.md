# Edificaciones del Táchira — informe de implementación

Fecha: 8 de septiembre de 2026. Base: `34b5813`, rama `feat/vialidad-3d`.

## MODELO

45.596 entidades OSM únicas producen **45.593 edificios renderizables**, 45.597 polígonos y 167 patios. Se excluyen dos entidades subterráneas y una vía que ya forma parte de una relación. No hubo anillos inválidos ni rechazos de triangulación o DEM.

Cada edificio conserva:

- `id` (`way/…` o `relation/…`), `osmId`, `osmType` y todos los `tags` originales. El tipo impide colisiones entre ids de vías y relaciones.
- `polygons`: exteriores y patios en ENU del proyecto, con coordenadas `[este, arriba, sur]` y apoyo por vértice.
- `altura`: `metros`, `niveles`, `fuente` y `evidencia`. Las fuentes son `osm-height`, `osm-levels` y `estimada`; un tag OSM declarado no se presenta como medición verificada por el Colegio.
- `evidencia`: área, elongación, compacidad, vecinos efectivos, densidad, jerarquía vial influyente, distancia a esa vía, intensidad vial, contexto y perfil morfológico.
- `techo`: RGB sRGB, fuente, zoom y cantidad de muestras. El binario lleva el color convertido a lineal para PBR.
- `baseY`, `roofY` y `apoyo`: origen del DEM, desnivel, cimentación máxima y señal `revisar`.
- `geometry`: inicio y cantidad de vértices e índices dentro del bloque. Permite relacionar un futuro `faceIndex * 3` con el id OSM sin crear un objeto por edificio.

Los metadatos están separados de la geometría: el visor descarga el manifest y los binarios cercanos. Los aproximadamente 50,17 MB de registros detallados quedan disponibles para la futura edición, sin descargarse para dibujar.

Entradas: copia intacta de los 25 JSON en `.cache/edificios/osm`; copia de 917 JPG z18 útiles en `.cache/edificios/satelite`. Salida nueva: `public/data/edificios/index.json` y 564 pares `.bin`/`.json`. No se regeneraron ni modificaron los assets previos. Como el resto de los datos de este repo, estas carpetas permanecen ignoradas por Git.

Reproducir localmente: `npm run edificios`. También admite `-- --input <directorio> --sat-cache <directorio>`. No requiere volver a ejecutar `npm run data`. La imagen satelital ya no se hornea: el mapa la pide en vivo al servidor de Esri.

## LA ESTIMACIÓN

Modelo versionado: **`morfologia-tachira-v2`**. Es una hipótesis de masa, no un levantamiento de alturas ni una clasificación catastral. La densidad mide las huellas disponibles en OSM; una zona poco cartografiada puede parecer menos urbana.

**Densidad:** vecinos ponderados dentro de 260 m, con kernel `max(0, 1 − (d/260)²)²`. Se excluye el propio edificio. Para `n` vecinos efectivos:

`D = 1 − exp(−max(0, n − 4)/180)`.

El radio comparte contexto entre varias manzanas. Los cuatro vecinos iniciales no bastan para declarar un casco urbano; 180 fija una escala equivalente a unas 2.540 huellas/km² bajo ese kernel. La respuesta no tiene un techo duro: los datos reales tienen mediana 123 y p90 323 vecinos efectivos. Truncar en 120 hacía que media ciudad recibiera la misma densidad.

**Vías:** influencia máxima `peso × max(0, 1 − distancia/radio)²` entre los segmentos cercanos. Se mide distancia al segmento, no a sus extremos. Tomar el máximo evita que subdividir una vía la vuelva artificialmente más influyente y permite reconocer una avenida aunque una calle local quede unos metros más cerca.

| Jerarquía | Peso | Radio |
|---|---:|---:|
| Primaria | 1,00 | 160 m |
| Troncal | 0,95 | 160 m |
| Secundaria | 0,80 | 140 m |
| Terciaria | 0,60 | 110 m |
| Residencial | 0,22 | 60 m |
| Servicio | 0,10 | 40 m |
| Autopista | 0,35 | 100 m |

La autopista pesa menos que una avenida porque no implica frente edificable. Las conexiones y otras categorías tienen bandas intermedias documentadas en `scripts/lib/building-morphology.mjs`.

**Contexto:** `C = 0,58 D + 0,24 V + 0,18 F`. El 82 % viene de señales observables. `F` es un campo determinista y continuo compartido en una rejilla de 220 m: representa variación de barrio que los tags ausentes no describen. No es una manzana catastral reconstruida ni una medición de centralidad. El centro se infiere de densidad y vías, sin imponer un círculo alrededor de San Cristóbal.

**Huella:** la capacidad de ganar plantas aumenta gradualmente entre 180 y 900 m², en escala logarítmica. Compacidad `4πA/P²` entre 0,25 y 0,72 y elongación entre 1,8 y 4 reducen esa capacidad en huellas largas o irregulares. La elongación usa una caja orientada por aristas, para no confundir un galpón diagonal con una planta compacta.

Plantas continuas: `1 + 2,35 smoothstep(C) + 4,4 capacidad C^1,65`. Luego se redondea con una variación por id de ±0,14 plantas. La altura doméstica usa 3,05 m/planta, 0,55 m de remate y ±0,18 m por id. Una huella grande y alargada transita hacia nave de `5 + 2,5 C ±0,25` metros; los tags industriales explícitos refuerzan ese perfil. El área sola no inventa torres rurales.

**OSM manda:** `height` válido tiene prioridad absoluta, admite metros, pies y pies/pulgadas y no se recorta a la banda estimada. Después viene `building:levels`, convertido explícitamente a 3 m/planta. Se conservan los tags originales y la fuente diferente porque niveles no es una medición en metros. Valores ambiguos o inválidos no se hacen pasar por datos reales.

Resultado: **88 `osm-height`, 277 `osm-levels`, 45.228 estimadas**. Las casas estimadas se reparten en 10.841 de una planta (26,22 %), 22.835 de dos (55,24 %) y 7.663 de tres (18,54 %). Alturas estimadas: mediana 6,61 m, p90 9,73 m y máximo 15,97 m. El máximo global, procedente de OSM, es 50 m.

La suite verifica precedencia, unidades, procedencia, determinismo con entradas reordenadas, respuesta a las señales y dispersión dentro de barrios comparables menor que entre barrios diferentes. Dos horneados completos produjeron manifest, geometría y metadatos idénticos.

SHA256 agregado de geometrías y metadatos: `c1257e61bd4ac87479eb6e80f4b40c22bade1286500b77f53eb25bb97fbecbff`.

## APOYO AL DEM

Se leen los PNG Terrarium z12 finales de `public/data/dem`, de 257×257 posts, ya tallados bajo las vías. Se reutilizan la triangulación NE–SW de `scripts/lib/drape.mjs` y la proyección ENU del proyecto. `terrain.bin`, reducido para el minimapa, no participa.

Las paredes se dividen al cruzar líneas de posts y diagonales de triángulos. Se muestrea también el terreno interior de huellas grandes para no dejar una cima atravesando la cubierta. El techo es horizontal; el plano de planta parte del máximo del terreno y la cimentación baja hasta cada punto del perímetro. El borde inferior entra 3 cm en el suelo para cerrar fisuras numéricas.

El render solicita terreno exacto hasta z15, incluso para emisores cercanos fuera del encuadre. Un bloque espera hasta que todas sus teselas estén cubiertas por z15 o por la totalidad de sus hojas más finas. Los padres provisionales durante la carga no cuentan como listos.

Comprobación independiente sobre **1.000 edificios**, 15.960 vértices inferiores y 7.980 puntos medios, hasta 87,19 km del origen: error máximo de **2,95 mm** contra los planos ENU Float32 del terreno z15 y 2,01 mm contra z17, descontando los 3 cm intencionales. Ningún punto flotante en la muestra.

**Limitación material:** resolver geométricamente el contacto no reconstruye terrazas o sótanos reales. Hay **1.921 edificios (4,21 %) con cimentación mayor de 5 m**, 268 mayores de 10 m y 25 mayores de 20 m. Se marcan `apoyo.revisar=true`. El extremo es `way/1504268731`, huella de 73.248 m² y cimentación de 79,10 m: esa masa requiere revisión humana, y no debe interpretarse como un edificio real de esa altura.

## SOMBRA Y LUZ

Material opaco `MeshStandardMaterial`, colores lineales, rugosidad 0,9, metalicidad cero y misma ganancia fotométrica 2,6 del relieve. CSM se instala antes del parche propio. Los meshes proyectan y reciben sombra; N8AO y la perspectiva atmosférica existentes actúan sobre su profundidad.

Se reutilizan las tres cascadas actuales y `CASCADA_CERCA`, cuyo valor real en este commit es `cascada-cerca`. Sus sesgos están ajustados para montañas: 12 texels de normal y −0,0008 de profundidad pueden borrar sombras de casas. Para conservar ese ajuste se añadió **un pase de profundidad exclusivo de edificios**, sin dibujar relieve/vías ni agregar otro sol a CSM.

El mapa de contacto mide 1024²; cubre entre 160 y 2.200 m según la distancia de cámara, estabilizado por texel. Usa cuatro comparaciones con corrección del plano receptor y fundido en el borde. Modula solo luz directa y especular del relieve/edificios y la sombra del asfalto antes del mojado; no apaga el ambiente. Las vías siguen sin proyectar sombra. A vista lejana no se ejecuta el pase y el shader sale por una condición uniforme antes de muestrear.

**Techos:** 7.760 medianas sRGB medidas con píxeles z18 interiores, excluyendo patios. Los otros 37.833 llevan color estimado, con contexto satelital z12 limitado a tonos de cubierta. La imagen horneada de este repo solo llega a z12, unos 38 m/píxel: no permite afirmar que esos colores sean medidas de techos individuales.

La compilación real de shaders en GPU, el aspecto del contacto y la respuesta visual del AO quedan para Chrome: no se abrió navegador.

## RENDIMIENTO

- Total almacenado: **1.716.461 vértices, 885.191 triángulos y 564 bloques z15**. Cada bloque es un solo mesh con una sola geometría indexada, sin grupos de materiales.
- **Un draw call por bloque y por pase** cuando su cámara lo intersecta. El límite de selección es 96 bloques; techo conservador de 480 llamadas entre color, tres cascadas y contacto antes del recorte individual. No se dibujan los 564 bloques juntos.
- Vista de estado: **cero draw calls de edificios y de su mapa de contacto**. Entran al llegar a ≤3 m/píxel y salen a ≥6 m/píxel; la histéresis evita titileo. Hay aparición opaca del bloque, no fundido transparente.
- Halo de emisores de 5 km. Dos descargas/buffers como máximo y una validación/construcción por cuadro. LRU de 128 bloques y 96 MiB. Los metadatos detallados no se descargan al dibujar.
- Muestra de candidatos alrededor de San Cristóbal (7,766; −72,225): 40 bloques, 8.246 edificios, 200.486 triángulos, 41 teselas DEM y 9,37 MB de geometría, antes del frustum de cada pase. Techo conservador de 200 llamadas y aproximadamente un millón de triángulos sumando los cinco pases si todos intersectaran; normalmente el recorte reduce ese trabajo.
- Binarios totales: **41.527.816 bytes**; metadatos: **50.173.931 bytes**. El mapa de contacto tiene aproximadamente 8 MiB de attachments de color/profundidad y sus proxies comparten buffers.

Estimación de coste: el incremento viene de la geometría urbana visible, el pase adicional de profundidad y hasta cuatro comparaciones por fragmento dentro del área de contacto, además del refinamiento DEM solicitado. No hay medición de milisegundos GPU ni de FPS nueva; los 61/60/48 fps de partida deben compararse en Chrome con los mismos encuadres, resolución y hora. Diagnóstico interno: `scene.userData.edificiosStats` y `edificiosShadowStats`.

## LO QUE RECORTÉ

Fachadas procedurales, ventanas, tipos de cubierta e interiores. Tampoco se extendió la exportación existente de Foto trazada: este trabajo integra la capa en el visor interactivo. UI de edición y persistencia siguen fuera de alcance.

No se descargó satélite nuevo para completar los techos fuera de la caché z18. No se reconstruyeron plataformas reales para corregir las cimentaciones extremas. No se afirma equivalencia visual con Unreal sin inspección visual.

## QUÉ MIRAR EN CHROME

1. Abrir `http://localhost:5173/?hora=2026-09-05T12:00:00Z`. Son las 8:00 en Táchira, con sol a **19,09°**. Buscar **Avenida Libertador** y acercarse en San Cristóbal hasta una barra de 50–100 m. En suelo plano, una masa de 6,6 m debería proyectar unos **19,1 m hacia el oeste**, ligeramente hacia el sur. Buscar sombra sobre calzada y terreno, sin separación visible en el pie.
2. Repetir con `?hora=2026-09-05T14:00:00Z`: sol a **48,76°**, sombra de unos **5,79 m** para esa misma altura. A las `20:00:00Z` la sombra debe cambiar hacia el este. Girar la cámara y comprobar que permanece fija respecto al mundo.
3. Panear por **Táriba**, barrios residenciales y periferia: comparar continuidad de alturas, casas frente a grandes huellas, y patios abiertos. Orbitar al ras y observar contacto en las laderas. Revisar por separado los casos `apoyo.revisar`.
4. Mirar muros y esquinas a contraluz: AO sin flotación, techos sin rayas de acné ni manchas que se muevan con la cámara. Comprobar la unión de sombra al cruzar relieve/calzada, también con lluvia.
5. Alejar hasta vista de estado y volver: comprobar corte LOD, carga por bloques y ausencia de edificios sobre terreno provisional. Panear rápido y regresar; no deberían quedar geometrías de la zona anterior visibles ni peticiones que se repitan en cada cuadro tras fallar.
6. Comparar contra `http://localhost:5173/?hora=2026-09-05T12:00:00Z&edificios=0`, que desactiva capa y pase de contacto. Repetir las tres escalas originales con la misma resolución, encuadre y tiempo de asentamiento. Usar el monitor de rendimiento y la consola; no deberían aparecer errores de shader, sampler o descarga.

Los parámetros de hora se toman al cargar la página. La herramienta Foto trazada no sirve para esta comprobación de la capa nueva.

## VERIFICACIÓN

Ejecución final, sin navegador:

```text
npx vitest run
 Test Files  54 passed (54)
      Tests  505 passed (505)
   Duration  4.05s
exit_code: 0

npx tsc --noEmit
(sin salida)
exit_code: 0

npm run build
vite v8.2.2 building client environment for production...
✓ 775 modules transformed.
dist/index.html                       0.44 kB │ gzip:   0.34 kB
dist/assets/trazador-FsY7KKCd.js    210.35 kB │ gzip:  61.30 kB
dist/assets/index-CuzKhk1Y.js     1,757.14 kB │ gzip: 536.19 kB
✓ built in 1.28s
(!) Some chunks are larger than 500 kB after minification.
exit_code: 0
```

Se mantienen las 411 pruebas de partida y se añaden 94. Incluyen ejecución del pase de contacto con escenas Three reales y renderer simulado: restaura render target y estados incluso si falla el render, comparte la geometría y libera sus propios recursos sin liberar buffers ajenos.

Los registros de comandos y mediciones quedan en `.cache/edificios/`. Se verificaron además todos los binarios, sus índices/rangos, los 45.593 ids únicos, las cajas (desviación Float32 máxima 3,56 mm), las dependencias DEM y la identidad entre dos horneados completos.

El build termina correctamente y conserva el aviso de Vite sobre el bundle principal mayor de 500 kB. No se ocultó ese aviso ni se cambió el límite para declarar una salida limpia.
