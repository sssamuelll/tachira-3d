# Primera pieza 3D: Obelisco de los Italianos

Integrada en las coordenadas solicitadas: **7.77382, −72.22917**, identificador `node/2958281048`.

**Discrepancia de ubicación:** las vías existentes en el repo sitúan este punto cerca de Carrera 9, Carrera 10 y Calle 14. El tramo más cercano llamado Avenida 19 de Abril está a aproximadamente **1.264,96 m**. Se conservó la latitud/longitud explícita del pedido; no se afirma que el punto coincida con la redoma descrita. Esa correspondencia geográfica queda pendiente de confirmación visual del dueño.

## DÓNDE QUEDÓ LA PIEZA

- Archivo: [public/data/piezas/obelisco-italianos.glb](../public/data/piezas/obelisco-italianos.glb), **192.204 bytes**.
- Manifiesto: [src/data/piezas.ts](../src/data/piezas.ts). Una entrada con id OSM, nombre, latitud, longitud, ruta GLB, rumbo y `representación: 'generada'`. Añadir otra entrada basta para cargar otra pieza con el mismo contrato.
- Cargador: [src/scene/Piezas.tsx](../src/scene/Piezas.tsx), montado desde `App.tsx` con la capa de edificios. `?edificios=0` también desactiva las piezas.
- Materiales: [src/scene/piezasShader.ts](../src/scene/piezasShader.ts). Integraciones pequeñas en `TerrainLod.tsx` y `SombrasEdificios.tsx`.
- `.gitignore` permite versionar `public/data/piezas/` y mantiene excluidos los demás datos masivos.

El GLB se copió sin modificar sus bytes. SHA-256 de origen, copia y archivo distribuido en `dist/data/piezas/`:

```text
cf2a71ac3e0f4fe2907cc8de1fc57bc65deef429851093b651433010054be67c
```

Se conservan metros, X este / Y arriba / Z −norte, origen en el centro del apoyo, altura 28 m, 324 triángulos, materiales y metadatos embebidos. La procedencia generada permanece tanto en el GLB como en el manifiesto y en `userData` del ancla. No es un levantamiento.

## APOYO AL TERRENO

La pieza solicita su tesela DEM `15/9809/15674` mediante `scene.userData.piezasDem`. `TerrainLod` une esa demanda con la de los edificios. Antes de mostrarla se exige cobertura completa z15 o superior en `terrainReady`, usando `sueloEdificiosListo`, igual que `Buildings`. Un impacto en un padre provisional no permite mostrarla.

Solo entonces se consulta **`alturaTerreno`**. Sus filtros existentes descartan las hojas ocultas de la caché. La pieza permanece invisible mientras el GLB, el CSM o el suelo definitivo no estén disponibles; aparece ya apoyada. Si pierde cobertura, se oculta e invalida su cota hasta recuperarla. Los niveles z16/17 usan la misma superficie DEM con más detalle de imagen.

También se conserva la latitud/longitud al incorporar altura: en el ENU del proyecto, subir solo Y desde `enuOf(lat, lon, 0)` habría desplazado el Obelisco **6,08 m**. El apoyo avanza por la recta geodésica obtenida con `enuOf`, ajustando XZ junto con Y. Se exige convergencia del apoyo por debajo de 1 mm; no se cambia la geometría ni se escala el GLB.

**Coste:** máximo cuatro llamadas a `alturaTerreno` por intento de apoyo; en la prueba plana necesita dos. Los intentos fallidos se limitan a cinco por segundo y la pieza sigue oculta. **Cero raycasts de apoyo en cuadros estables.** La medición central de metros por píxel comparte la caché de `distanciaVista` con cámara, edificios y vías. Por cuadro queda una pasada sencilla sobre el manifiesto, sin `setState`.

Se reutilizan el halo de 5 km y el corte con histéresis: entra a ≤3 m/píxel, sale a ≥6. Los emisores cercanos fuera de pantalla se conservan para que el renderer evalúe su sombra en cada cascada.

## SOMBRA

Cada malla GLB tiene `castShadow=true`, `receiveShadow=true` y recorte por frustum. Sus materiales PBR se clonan, conservando color, tintes de vértice, normal map, rugosidad, metalicidad y texturas; reciben el mismo CSM y parche de contacto de los edificios. No se les aplica la ganancia de color de los bloques genéricos.

El pase existente de `SombrasEdificios` recoge también el grupo `piezas`: sus proxies comparten geometría y usan matrices mundiales, incluido el rumbo. La pieza proyecta sobre relieve, vías y edificios, y recibe las sombras CSM y de contacto. N8AO usa el mismo pase de profundidad de la escena opaca; no se añade otro pase de AO, luz ni mapa de sombra.

Las pruebas ejecutan CSM real, verifican sus uniformes y la conservación PBR, y ejecutan el pase de contacto con renderer simulado, incluyendo jerarquías transformadas, ancestros ocultos y retirada de proxies. Se cubren recreación de CSM, liberación de registros/materiales/texturas y finalización de parseo después de desmontar. El aspecto de los shaders y los FPS quedan para Chrome: no se abrió navegador ni se midió rendimiento GPU.

## EL RUMBO

**0° por defecto**, grados horarios desde el norte canónico −Z del GLB. La rotación THREE en Y es el negativo de esos grados; 90° lleva −Z hacia +X/este. El manifiesto declara expresamente **SUPUESTO**: no conocemos la orientación real. Cambia la silueta de la sombra; su dirección de proyección la determina el sol de la escena. No se presenta como rumbo medido ni como frente geográfico verificado.

## EL BLOQUE GENÉRICO

Se leyeron los polígonos `outer` y `holes` de **45.593 edificios en 564 chunks**, sin regenerarlos. Se comprobó inclusión y distancia horizontal a todos sus segmentos.

Para el centro corregido por el DEM —aproximadamente `X=−36140.733083, Y=691.199014, Z=27433.731183`— ninguna huella contiene el punto. La más cercana es **`way/269909726`**, en `public/data/edificios/15-9809-15674.json`, a **12,2114 m**. La silueta completa del GLB cabe en un radio conservador de **5,7517 m**: queda una holgura mínima de **6,4597 m**, con cualquier rumbo. **No se oculta ningún edificio.**

## QUÉ MIRAR EN CHROME

1. Ejecuta `npm run dev` y abre `http://localhost:5173/?hora=2026-09-05T12:00:00Z` —08:00 en Venezuela— usando el puerto que imprima Vite si 5173 está ocupado. No añadas `edificios=0`.
2. Para ir exactamente al punto, espera a que el mapa termine de cargar y ejecuta este bloque en la consola de Chrome. Usa el módulo R3F ya cargado por Vite y solo mueve la cámara; no agrega una función de navegación al producto. El bloque está preparado a partir del código instalado, sin ejecución en navegador durante este trabajo.

```js
var recursoFibra = performance.getEntriesByType('resource')
  .find(r => new URL(r.name).pathname.endsWith('/@react-three_fiber.js'));
var { _roots } = await import(recursoFibra.name);
var visor = [..._roots.values()][0].store.getState();
visor.controls.target.set(-36140.733083, 705.199014, 27433.731183);
visor.camera.position.set(-36000.733083, 855.199014, 27613.731183);
visor.controls.update();
```

3. Espera la cobertura fina. La pieza debe aparecer ya apoyada, sin flotar sobre el terreno provisional ni caer después. Acércate y orbita para comprobar base, materiales y contacto. La cota se toma en el centro de la base; no se aplana el terreno ni se inclina el monumento para adaptar toda la base a una pendiente.
4. A `12:00:00Z`, espera una sombra larga hacia el oeste, ligeramente hacia el sur: referencia de unos **81 m** para 28 m de altura sobre plano horizontal. Repite con `?hora=2026-09-05T14:00:00Z` —10:00 local—: unos **24,5 m** sobre plano. A `?hora=2026-09-05T20:00:00Z` —16:00 local— debe proyectarse hacia el este. La pendiente y silueta afectan a la forma real. La hora se lee al cargar; tras cambiarla, repite el bloque de cámara.
5. Comprueba que la sombra toca el pie y continúa entre relieve/calzada; las caras opuestas al sol y los encuentros deben conservar volumen con AO. Orbita: la sombra permanece fija respecto al mundo. Aleja hasta vista de estado y vuelve: corte por escala, sin sombras de piezas ocultas ni saltos desde un suelo provisional.
6. En Network debe existir una respuesta correcta para `/data/piezas/obelisco-italianos.glb`; la consola no debe mostrar errores de carga, shader o sampler. Compara los FPS con los 61/60 de partida usando el mismo encuadre, resolución y hora. No hay medición nueva de FPS en este informe.

También puedes buscar **Avenida 19 de Abril**, pero no es un destino exacto para las coordenadas recibidas: hay la discrepancia de ubicación indicada al inicio. En el encuadre inicial de esa búsqueda, el punto está aproximadamente 618 m al oeste y 407 m al norte del centro. El buscador actual indexa vías; no se añadió búsqueda por nombre de pieza.

## VERIFICACIÓN

Salida real de los tres comandos finales:

```text
npx vitest run
 RUN  v5.0.0 D:/Desktop/projects/vialidad-tachira
 Test Files  57 passed (57)
      Tests  524 passed (524)
   Start at  16:33:28
   Duration  5.52s (transform 72%, import 17%, tests 10%, worker 1%)
exit_code: 0

npx tsc --noEmit
(sin salida)
exit_code: 0

npm run build
> vialidad-tachira@1.0.0 build
> vite build
vite v8.2.2 building client environment for production...
transforming...
✓ 781 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                       0.44 kB │ gzip:   0.34 kB
dist/assets/trazador-B3hUziQV.js    210.35 kB │ gzip:  61.30 kB
dist/assets/index-CuCeYWb9.js     1,804.77 kB │ gzip: 550.83 kB
✓ built in 2.97s
[plugin builtin:vite-reporter]
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
exit_code: 0
```

Se mantienen las 505 pruebas anteriores y se añaden 19. Vitest también emitió una sugerencia informativa para cachear transformaciones. **El build pasa con el aviso de tamaño de bundle que ya constaba en `docs/edificaciones-tachira.md`; no es una salida libre de avisos.** No se cambió el umbral para ocultarlo.

No se regeneró `public/data`: solo se añadió su carpeta `piezas`. `vectorizer` se usó exclusivamente para leer/copiar el GLB. La verificación visual está pendiente del dueño.
