# Cota propia de puentes y tratamiento de túneles

Implementado en `feat/vialidad-3d`, partiendo de `5530e66`. La rasante ya se hornea por puente completo. **La expectativa de ver toda la calzada encima de los GLB actuales queda pendiente:** las piezas y las cotas obtenidas del DEM son incompatibles en ambos viaductos, como cuantifica la comprobación cruzada.

## CÓMO DAS COTA AL PUENTE

`scripts/lib/structures.mjs` captura los IDs de nodos de OSM antes de invertir `oneway=-1` o insertar puntos. Construye componentes por nodos compartidos y `layer`; recorre cada cadena abierta de extremo a extremo, invirtiendo los ways necesarios para recorrerla. Los sentidos originales de circulación se conservan al devolver las alturas a sus coordenadas definitivas. Ni compartir nombre ni cruzarse en planta une dos puentes. Las calzadas paralelas tienen nodos distintos y, por tanto, cadenas y rasantes independientes.

Después de tallar las vías de suelo, consulta la altura de los dos extremos externos en el **DEM tallado**, la misma superficie de los accesos. Para distancia acumulada `s`, longitud completa `L` y alturas extremas `h0`, `h1`, calcula `h(s) = h0 + (h1 − h0) × s / L`. La distancia sigue todas las curvas; no depende del número de nodos ni de la cuerda entre los estribos. Las juntas internas reciben la altura de esta única rasante, aunque estén en el fondo de la garganta. El puente mantiene la subdivisión de hasta 30 m y omite `apoyar`, que lo volvería a bisecar contra el valle.

Las normales se calculan por extremo de **cada segmento**, usando su pendiente longitudinal y la vertical geodésica local. Así el ancho queda horizontal incluso en curvas con pendiente. Los dos tramos de una curva pueden tener normales distintas en su vértice compartido. Se escriben en los seis bytes Int8 por segmento que ya existían; no se incorpora ningún atributo GPU.

`layer` separa componentes. Si falta, se asume 1 para encadenar un puente, manteniendo la ausencia en metadata. **No se convierte `layer` en metros ni garantiza por sí solo el orden visual de todos los pasos a distinto nivel.** Los cruces sin cotas suficientes siguen pendientes de medición; no se inventa un gálibo.

Ramificaciones, anillos, conexiones al interior de otro way, nodos repetidos, ausencia de IDs y longitudes o cotas inválidas se declaran como exclusiones; no se escoge un recorrido arbitrario. En los datos actuales no aparece ninguno de esos conflictos. No se enlazan automáticamente los ways sin `bridge` del Nuevo.

## CUÁNTOS PUENTES CAMBIAN

Los **451 son ways con etiqueta positiva de puente**, no 451 estructuras físicas independientes. Se interpolan **450 ways en 441 cadenas**. Seis cadenas contienen varios ways: tres de dos y tres de tres; las 435 restantes contienen uno. El caso restante, `way/724733388`, está marcado `bridge=low_water_crossing`: es un paso bajo sobre agua y conserva el drapeado.

La auditoría muestrea el eje, incluidos puntos entre vértices, a pasos de hasta 5 m: **6.168 muestras**. Una penetración de hasta 0,20 m entra en la tolerancia del drapeado existente. La clasificación se hace antes del alza visual del shader y no ajusta el perfil para aprobarla.

| Resultado sobre los 451 ways | Cantidad | Interpretación |
| --- | ---: | --- |
| Rasante continua sin penetración del eje mayor de 0,20 m | 368 | Pasan la comprobación contra el DEM; no equivale a validar físicamente el puente. |
| Rasante continua que todavía atraviesa el DEM más de 0,20 m | 82 | La cuerda de los estribos queda bajo algún punto del relieve. Siguen pendientes. |
| Paso bajo `low_water_crossing` | 1 | Excluido deliberadamente de la elevación. |

Entre los 82 pendientes, 35 penetran entre 0,20 y 0,50 m; 24 entre 0,50 y 1 m; 22 entre 1 y 5 m; uno supera 5 m. El peor es `way/876201404`, con **14,009 m**. El informe generado `public/data/roads-structures.json` incluye cada ID, sus cotas de extremo y su holgura mínima/máxima, incluidos los 82. No se puede distinguir solo con este DEM si falla la posición del estribo OSM, la elevación del terreno, o ambas. Elevar la cuerda hasta librar el relieve rompería el empalme con los accesos; seguir el relieve reintroduciría el defecto original.

Además, **236 de los 368** que pasan tienen holgura máxima menor o igual a 0,20 m: en ellos la resolución del DEM no representa una garganta apreciable. No se acredita que exista espacio para una vía o cauce inferior. Los seis ways de los dos viaductos pasan el control del eje contra terreno, pero fallan la comparación con sus GLB descrita a continuación.

## LA COMPROBACIÓN CRUZADA

La comparación se reproduce con `node scripts/audit-viaducts.mjs`. Lee las posiciones y normales horneadas, los índices de las vías, el DEM y los GLB existentes; escribe `.cache/viaduct-comparison.json`. La altura de apoyo de cada pieza se calcula contra los mismos triángulos ENU Float32 de z15 que dibuja el visor, iterando la corrección geodésica de XZ que utiliza `Piezas.tsx`. No modifica las piezas ni usa sus alturas para calcular las vías.

Las cotas **649,8 y 753,2 m** del encargo pertenecen al eje **Y ENU del visor**. No son la altura geodésica del DEM: los estribos del Viejo están aproximadamente a 819 m en el DEM, que se convierten en unos 648–650 m en Y ENU por la curvatura respecto al origen del proyecto. Todas las comparaciones con las piezas usan Y ENU.

Resultado medido en los binarios regenerados. «Centro» es la mitad del recorrido horizontal de cada way; las cifras no incluyen el alza del shader:

| Viaducto / way | Rango de calzada Y ENU | Centro | Centro − tablero del encargo |
| --- | ---: | ---: | ---: |
| Viejo `1203013290` | 648,398–650,313 m | 649,342 m | −0,458 m |
| Viejo paralelo `1203013292` | 647,902–650,075 m | 648,972 m | −0,828 m |
| Nuevo norte `74534876` | 736,758–752,305 m | 744,556 m | −8,644 m |
| Nuevo norte paralelo `1211907172` | 737,296–752,446 m | 744,897 m | −8,303 m |
| Nuevo sur `1223380938` | 736,354–737,530 m | 736,942 m | −16,258 m |
| Nuevo sur paralelo `1223380940` | 736,470–738,492 m | 737,481 m | −15,719 m |

El Viejo confirma la cota aproximada de 649,8 m: sus dos ejes centrales quedan a menos de un metro. Antes bajaban a unos 619,241 y 618,405 m en el centro; ahora cruzan a 649,342 y 648,972 m. El Nuevo **no confirma** el tablero plano a 753,2 m: sus estribos norte/sur difieren hasta 15,55 m y sus vanos del sur están alrededor de 737 m. Una única plataforma plana a 753,2 m no puede conectar con esos accesos. Las cotas de la pieza son las que resultan incompatibles con esta reconstrucción del DEM; no se conoce la rasante real levantada para decidir cuánto error adicional tiene el propio DEM.

Los GLB actuales tienen tableros planos: el Viejo a 32 m sobre su ancla, el Nuevo a 16 m; ambos añaden 0,06 m de rodadura. El apoyo fino del Viejo resulta **619,041 m**, por lo que su tablero está a **651,041 m** y su rodadura a **651,101 m**. El apoyo del Nuevo resulta **737,279 m**: tablero a **753,279 m**, rodadura a **753,339 m**.

La referencia del Viejo difiere **1,241 m** de la pieza colocada sobre el DEM fino. Un rayo vertical sin corregir XZ sobre la geometría gruesa z12 produce un tablero a **649,824 m**, prácticamente el dato recibido. Es una explicación compatible con aquella medición, no una reconstrucción comprobada de cómo se obtuvo. El cargador actual exige z15 antes de mostrar la pieza; la comparación válida con el GLB actual es 651,041 m. En el Nuevo, la referencia recibida y el tablero fino difieren solo **0,079 m**.

El Nuevo incluye cuatro ways `bridge=yes`, dos por calzada, separados por vías sobre terreno:

| Calzada | Ways intermedios sin `bridge` ni `layer` | Longitud total |
| --- | --- | ---: |
| Norte → sur | `1223380942` + `1223380941` | 121,99 m |
| Sur → norte | `1223380939` + `1223380943` | 125,41 m |

El DEM intermedio está aproximadamente entre **736,76 y 739,04 m Y ENU**. Eso es compatible con dos vanos separados por suelo y no autoriza a inventar un puente continuo a través de esas vías. La resolución de unos 38 m tampoco permite certificar si falta alguna etiqueta OSM. Cada calzada mantiene sus propios estribos.

El shader levanta el eje al menos **0,25 m según su normal**. La auditoría incluye ese desplazamiento usando las normales empaquetadas, además de las alturas sin alza. A mayor distancia, el alza depende de la escala en pantalla. Un resultado negativo en `minimumLiftMinusActualPavement` indica que, aun con el alza mínima, la calzada queda por debajo de la rodadura del GLB; no demuestra que la pieza y la vía estén alineadas visualmente.

| Way | Eje con alza mínima − rodadura efectiva del GLB |
| --- | ---: |
| Viejo `1203013290` | −2,453 a −0,538 m |
| Viejo paralelo `1203013292` | −2,949 a −0,776 m |
| Nuevo norte `74534876` | −16,333 a −0,785 m |
| Nuevo norte paralelo `1211907172` | −15,794 a −0,644 m |
| Nuevo sur `1223380938` | −16,735 a −15,559 m |
| Nuevo sur paralelo `1223380940` | −16,619 a −14,597 m |

Por tanto, **la carretera deja de bajar por la garganta, pero las piezas intactas todavía no coinciden con ella**. Incluso el Viejo queda bajo su GLB actual con el alza mínima. Esta discrepancia se conserva y se cuantifica; no se modifican los GLB ni se elevan los extremos para disimularla.

## TÚNELES

Los **17 ways con túnel** se omiten de la geometría visible. El DEM no contiene la excavación y no hay cotas de portales ni geometría interior suficientes para reconstruirla: drapearlos sobre la montaña mostraría una carretera exterior inexistente. Ocultarlos es una decisión explícita de representación.

Se conservan sus IDs, etiquetas, metadatos y longitudes para mantener la red y las evaluaciones existentes. Su `km3d` sigue siendo una estimación obtenida del DEM; no representa la longitud levantada del trazado subterráneo. No se inventan cotas de túnel, portales ni una vista interior. Como no tienen segmentos visibles, tampoco se pueden seleccionar pulsando una calzada en el mapa.

El inventario contiene 14 `tunnel=yes`, dos `building_passage` y un `culvert`; se aplica la misma decisión a los 17. El CSR conserva una entrada vacía por vía y no desplaza sus IDs ni evaluaciones. Siguen presentes en búsqueda e inventario, pero una selección compuesta únicamente por túneles no puede encuadrarse porque carece de geometría. Desaparecen **1.125 segmentos** de la representación; no se calcula una condición de visibilidad por cuadro.

## COSTE

El último `npm run data` tardó **31,484 s** con toda la fuente en caché. Se ejecutaron tres horneados durante el trabajo: 26,655 s, 26,141 s y 31,484 s, **84,280 s acumulados**. El segundo incorporó la corrección de normales por segmento; el tercero evitó enviar campos estructurales nulos en todas las vías. Son tiempos de esta máquina y caché, no una promesa para una descarga nueva.

En el horneado final, construir la topología tomó **11,091 ms**; interpolar y auditar, **6,490 ms**: **17,581 ms** entre ambos pasos. El cálculo de normales se integra en el paso de geometría; un microbenchmark separado sobre los 450 ways y sus 1.513 vértices, con 100 repeticiones y entradas ya preparadas, dio **0,404 ms de mediana**, 1,051 ms de p95. No se confunde ese microbenchmark con el tiempo total de `npm run data`.

La topología recorre las 26.712 vías una vez para seleccionar puentes y luego solo sus nodos. La rasante y las 6.168 muestras de auditoría se calculan únicamente sobre puentes. La selección del perfil añade una consulta a `Map` por **vía durante el horneado**, no por segmento ni por cuadro. Se aprovechan los binarios y normales existentes.

| Recurso | Antes | Después |
| --- | ---: | ---: |
| Segmentos visibles | 798.007 | 796.390 |
| Segmentos de los 450 puentes interpolados | 1.555 | 1.063 |
| Segmentos de los 17 túneles | 1.125 | 0 |
| Bytes de los cuatro binarios de vías | 27.239.090 | 27.184.112 |

Se eliminan **1.617 segmentos** y **54.978 bytes** de binarios. El vado mantiene sus dos segmentos. Las etiquetas estructurales presentes añaden **11.760 bytes** al JSON sin comprimir; omitir los `null` evita 1.082.569 bytes innecesarios. El informe de auditoría mide 295.831 bytes y **no lo descarga el visor**.

**Por cuadro: cero cálculos, atributos, buffers o llamadas de dibujo añadidos.** No se modificó el código de renderizado ni el shader. Los segmentos se reducen un 0,203 %; no se presenta eso como una mejora medida de FPS. La carga inicial recibe los metadatos adicionales y menos geometría, usando las mismas rutas de carga y preparación de juntas.

## VERIFICACIÓN

- `npx vitest run`: **583 pruebas en 60 archivos**, todas verdes; eran 551, se añadieron 32 regresiones.
- `npx tsc --noEmit`: salida 0, sin errores.
- `npm run build`: salida 0. Vite emite el aviso por un chunk minificado de **1.810,97 kB**, mayor al umbral de 500 kB; no es una compilación sin avisos. No se cambió la configuración para ocultarlo.
- `npm run verify`: salida 0 sobre la última regeneración. Comprueba binarios/CSR/IDs, finitud, cobertura de todos los puentes, túneles vacíos y rasante continua leída del binario, incluidos vértices interiores. Error vertical máximo **0,0008 m**, separación máxima de juntas/estribos **0,0026 m**. Pendiente p99 de red estructurante **21,0 %**.
- `node scripts/audit-viaducts.mjs`: salida 0 sobre los binarios finales; comparación cruzada reproducible.
- El SHA-256 de `terrain.bin` y de los cuatro GLB permanece idéntico al inicial. No se tocó `vectorizer`, el manifiesto de piezas ni los modelos. No se ejecutó `npm run img` ni se abrió navegador.

Las pruebas cubren fragmentación e inversión de ways, distancia acumulada en curvas, paralelas, `layer`, puentes separados por suelo, ramas, anillos, conexiones interiores, vados, cotas inválidas, penetración entre nodos, normales en curvas con pendiente, túneles ocultos sin perder IDs y regresiones de empaquetado. El verificador detecta un puente redrapeado aunque sus estribos sigan correctos, y rampas quebradas aunque las cotas individuales del informe copien ese error.

Los archivos de `public/data` están regenerados en este workspace y continúan bajo la regla existente de `.gitignore`; se entregan los cambios de código y las instrucciones para reproducirlos, sin cambiar esa política de versionado.

## QUÉ MIRAR EN CHROME

No se abrió navegador durante este trabajo. Estas instrucciones están preparadas a partir del código instalado; la comprobación visual corresponde al usuario.

1. Ejecuta `npm run dev` y abre `http://localhost:5173/?hora=2026-09-08T14:00:00Z`, usando el puerto que indique Vite. Son las **10:00 en Venezuela**. No agregues `edificios=0`: ocultaría las piezas.
2. Después de cargar el mapa, ejecuta este bloque en la consola de Chrome para obtener la cámara existente:

```js
var recursoFibra = performance.getEntriesByType('resource')
  .find(r => new URL(r.name).pathname.endsWith('/@react-three_fiber.js'));
var { _roots } = await import(recursoFibra.name);
var visor = [..._roots.values()][0].store.getState();
```

3. **Viaducto Viejo: 7.76271285, −72.23427815.** Este encuadre mira desde el este, algo elevado, hacia el centro del tablero:

```js
visor.controls.target.set(-36704.843255, 651.041325, 28661.534170);
visor.camera.position.set(-36444.843255, 741.041325, 28781.534170);
visor.controls.update();
```

4. **Viaducto Nuevo: 7.76432975, −72.2206145.** Ejecuta este segundo bloque para cambiar de viaducto:

```js
visor.controls.target.set(-35197.963857, 753.279041, 28484.379560);
visor.camera.position.set(-34937.963857, 843.279041, 28604.379560);
visor.controls.update();
```

5. Espera el terreno fino y la aparición de la pieza. Acércate y orbita hasta una vista lateral: sigue cada calzada desde el estribo de entrada hasta el de salida. Comprueba que el eje ya no copia el fondo de la garganta, que no aparecen rampas independientes en un empalme de ways y que las calzadas paralelas mantienen sus recorridos. En el Nuevo, mira por separado los vanos norte y sur, junto con las vías de suelo intermedias.
6. Comprueba específicamente la diferencia respecto al GLB. **No se da por cumplida la expectativa de ver toda la calzada por encima de la pieza**: los tableros planos existentes pueden ocultarla o atravesarla. Contrasta esa vista con los rangos de la auditoría; el desacuerdo no se corrige levantando artificialmente los estribos.
7. Repite con `?hora=2026-09-08T20:00:00Z`, **16:00 en Venezuela**, para cambiar la iluminación y las sombras. La hora se lee al cargar; después de cambiarla vuelve a ejecutar los bloques de consola. La cota de las vías debe permanecer igual.
8. Aleja hasta vista de estado y vuelve. Comprueba continuidad en los accesos, ausencia de errores de carga/shader en consola y respuesta correcta de los archivos `roads-*.bin` y de ambos GLB en Network. No se han medido FPS ni aspecto GPU durante este trabajo.

## QUÉ SIGUE MAL

- **Los GLB no están alineados verticalmente con las calzadas.** Los dos viaductos quedan bajo sus piezas a corta distancia. El Viejo coincide aproximadamente con la referencia del encargo, pero su pieza actual está más alta; el Nuevo tiene un tablero plano incompatible con el desnivel de sus accesos. No se conoce una rasante levantada para certificar el error absoluto del DEM.
- **82 ways aún atraviesan el terreno.** El diagnóstico los enumera; no se levantan sus extremos, se talla un relleno ficticio ni se vuelve a drapear para aprobar la auditoría. La resolución del DEM y la posición real de los estribos limitan esta reconstrucción.
- **El control estatal es del eje contra el DEM**, no de toda la anchura contra mallas 3D, barandas, bordes o vías inferiores. Los 368 que pasan no son 368 puentes físicamente certificados. Tampoco se ha verificado visualmente la transición de pendiente transversal en todos los accesos.
- **`layer` no aporta altura métrica.** Se respeta al encadenar, pero el orden de cruces sin separación geométrica suficiente sigue sin garantía. No se han construido pilas ni tableros para los otros puentes.
- **Los túneles desaparecen también del picking y del encuadre individual.** Sus longitudes 3D siguen siendo estimaciones del DEM y los portales no están representados.
- **La comprobación visual y los FPS quedan pendientes de Chrome.** Un alza mayor al alejarse puede ocultar parte de las discrepancias de las piezas; la inspección debe incluir acercamiento y vista lateral.
