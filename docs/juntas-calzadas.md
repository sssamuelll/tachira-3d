# Encuentros entre calzadas

## QUÉ ELEGÍ Y POR QUÉ

**No se regeneró `public/data`.** El arreglo reconstruye vecindad una vez al cargar los binarios existentes y compone el asfalto del encuentro en una pasada local adicional.

1. `src/scene/juntas.ts` agrupa extremos con XYZ idéntico. Un nodo con tres o más brazos distintos recibe una zona de unión. No requiere nombres de vías, redomas, número de canales ni tags de intersección.
2. Las tapas que llegan al nodo se limitan a cero metros. La limitación se propaga por los segmentos anteriores, incluso si son diminutos, cambia la identidad OSM de la vía o se invierte el sentido de sus coordenadas. Una continuidad de grado dos permite esa propagación, pero no origina una junta por sí sola.
3. El cuerpo conserva su llegada al eje compartido. El brocal que se mete en la transversal queda cubierto por la superficie de asfalto de los brazos participantes. Esta pasada conserva color PCI, selección, textura, sombras y mojado; omite brocal, hombrillo y demarcación dentro del encuentro. La sección original sigue completa debajo y se conserva donde no hay otra superficie de asfalto que la cubra.
4. La superficie se dibuja después de las bases de su mayor jerarquía participante y antes de las superiores ajenas. Dentro del grupo, la vía menor precede a la mayor. Cada brazo conserva su propio ancho mínimo y su presencia: agruparlo con una avenida no lo ensancha ni vuelve opaca una calle atenuada.

El radio depende del ancho, la sección y los ángulos entre brazos. La cobertura es completa hasta ese radio y se desvanece hasta 1,5 veces el radio. Se limita a 80 m para que un dato casi paralelo no elimine la demarcación de media carretera.

Descarté ordenar solamente por jerarquía: el visor ya lo hacía y varios de los cruces marcados tienen todos sus brazos en nivel secundaria. Tampoco recorté globalmente la franja de sección: ese fue el intento rechazado que introducía muescas en curvas. Acortar solamente el último segmento habría fallado con los tramos diminutos de la subdivisión. Una unión poligonal horneada exigiría cambiar geometría, atributos y selección; esta corrección conserva los binarios actuales y no introduce búsquedas de vecinos en el shader.

## POR QUÉ NO EMPEORA EL CASO COMÚN

La tapa inicial sigue descartada mediante `if ( vUv.y < -1.0 ) discard;` en contorno, relleno y superficie de junta. El cálculo de sección de `seccion.ts` permanece intacto.

Las pruebas aportan estas comprobaciones:

- Rectas aisladas, curvas y continuidades entre vías de grado dos sin cruces cercanos producen zonas cero y límites neutros de `1e9`. Sus posiciones no se modifican; no entran en la pasada adicional.
- El reparto conserva posiciones, normales, atributos y fase de textura. El subconjunto de juntas usa la misma distancia acumulada por vía, sin reiniciarla al seleccionar segmentos.
- Los shaders de contorno, relleno y picking limitan la misma tapa. Su textura avanza la distancia realmente extruida, evitando comprimirla al acortar el remate.
- En el buffer real, **681.813 de 798.007 segmentos —85,44 %— quedan completamente neutros**. Esto no significa que todas las curvas estén excluidas: las que entran físicamente en un cruce sí participan dentro del alcance local.
- Cinco nodos reales del Obelisco, de grados 3, 3, 4, 5 y 6, tienen límite cero en todos sus brazos. También hay pruebas de T/X/Y sintéticas, alturas diferentes, coordenadas próximas sin conexión, duplicados, segmentos menores de un centímetro y continuidad entre vías con sentidos invertidos.
- La superficie adicional se limita al asfalto. No añade huecos a la sección base. En vías atenuadas se omite esa pasada para evitar acumular opacidad.

Esta es evidencia geométrica y de construcción de los shaders; **la aceptación visual y la compilación GLSL en la GPU quedan pendientes de Chrome**. No abrí navegador.

## COSTE

Medición reproducible, sólo lectura:

```powershell
node scripts/bench-juntas.mjs
```

Tres ejecuciones en Node, Windows x64, sobre los binarios actuales. Tiempos medidos con el código cargado y los archivos ya leídos; no incluyen descarga, lectura de archivos, compilación inicial de módulos ni subida a la GPU.

| Medida | Resultado |
|---|---:|
| Preparación de vecindad, mediana | 470,4 ms |
| Reparto sin juntas, mediana | 69,4 ms |
| Reparto con juntas, mediana | 122,8 ms |
| Preparación + reparto con juntas, mediana | 593,2 ms |
| Nodos corregidos | 28.143 |
| Segmentos dentro de alguna influencia | 116.194 |
| Segmentos en la superficie adicional de asfalto | 95.651 |
| Tandas adicionales | 6 |
| Buffers adicionales de GPU | 20,39 MiB |
| Buffers adicionales retenidos en CPU | 33,32 MiB |
| Índices temporales de preparación | 12,18 MiB |

Las cifras de memoria cuentan arrays tipados y atributos; no son una medición del heap completo ni del overhead del driver. Los percentiles de radio por brazo nodal son 5,48 m / 8,76 m / 25,56 m (p50/p90/p99). Sólo 36 nodos alcanzan el límite de 80 m; ninguno de los cinco nodos comprobados del Obelisco lo alcanza.

**Por cuadro:** no se reconstruye topología, no se recorre la red en JavaScript y no se actualizan buffers. Se actualizan uniforms y visibilidad en un número fijo de tandas. El shader base añade un atributo `vec2` y el cálculo del límite de las tapas; el fragmento base conserva su trabajo anterior. A vista de estado, las seis tandas adicionales quedan apagadas. De cerca añaden 95.651 instancias frente a las 1.596.014 de los dos pases base: aproximadamente **6 % más invocaciones de vértice**, cuando se dibuja toda la red. El trabajo de fragmentos depende del encuadre: dentro de las juntas el asfalto se evalúa una segunda vez; fuera de su zona se descarta antes de los muestreos costosos.

No afirmo que siga a 61/60 fps: esa cifra necesita medirse en tu GPU. No hubo horneado; su coste es cero.

## QUÉ MIRAR EN CHROME

1. Ejecuta `npm run dev` y abre `http://localhost:5173/?hora=2026-09-05T14:00:00Z`. Si Vite anuncia otro puerto, usa ese. Son las 10:00 en Venezuela.
2. Espera a que cargue el mapa. Deja la búsqueda vacía para que las vías estén a plena opacidad. Mantén activa la imagen satelital y comienza sin lluvia.
3. En la consola de Chrome ejecuta este código. Usa las coordenadas del centro de la captura: **7.768641708, −72.214223417**, con una cámara cercana oblicua. El acceso a `_roots` es sólo para la comprobación en el servidor de desarrollo.

```js
var recursoFibra = performance.getEntriesByType('resource')
  .find(r => new URL(r.name).pathname.endsWith('/@react-three_fiber.js'));
var { _roots } = await import(recursoFibra.name);
var visor = [..._roots.values()][0].store.getState();
visor.controls.target.set(-34492.895, 806.86, 28008.261);
visor.camera.position.set(-34422.895, 906.86, 28108.261);
visor.controls.update();
```

4. Orbita alrededor del Obelisco y compara con los círculos verdes: los remates no deben mostrar el dedo redondo, las franjas de brocal no deben atravesar el asfalto de los otros brazos y las curvas exteriores deben seguir cerradas.
5. Para aislar la T inmediatamente al norte, **7.768988598, −72.214222210**, cambia sólo la cámara:

```js
visor.controls.target.set(-34492.734375, 807.2229004, 27969.8925781);
visor.camera.position.set(-34462.734375, 857.2229004, 28019.8925781);
visor.controls.update();
```

6. La siguiente T está unos 14 m más al norte, en **7.769106605, −72.214261586**. Mira también los encuentros este, oeste y sur de la isla: las pruebas cubren sus 4, 6 y 5 brazos respectivamente.
7. Acércate y aléjate atravesando el nacimiento del detalle. Revisa una recta y una curva sin cruces cercanos; sus hombrillos y brocales deben conservarse. Activa lluvia, selecciona una vía y comprueba que la textura no se estire en el remate y que el clic corresponda a la calzada visible.
8. Repite con `?hora=2026-09-05T12:00:00Z` —08:00 en Venezuela—, volviendo a ejecutar la cámara después de recargar. Esa luz ayuda a revisar los bordes.
9. Compara el contador de fps en vista de estado y al ras, con el mismo tamaño de ventana y las mismas capas que usaste para medir 61/60. Revisa la consola por errores de compilación o enlace de shaders. Las pruebas de Node no ejecutan WebGL.

## QUÉ SIGUE FEO O QUEDA LIMITADO

- No se inventan empalmes donde OSM dejó extremos desconectados, ni se corrigen automáticamente remates de grado uno o cambios de anchura de grado dos. Esos pueden conservar tapas o escalones.
- La unión conserva el contorno angular de las cintas. No modela radios de giro, isletas, rampas ni una malla vial continua. Pueden persistir cambios de orientación de textura, brillo o color PCI entre brazos.
- En vías fuera del foco o durante su desvanecimiento se conserva la composición base: ahí pueden reaparecer bordes cruzados. La limitación de tapas continúa funcionando.
- El radio de 80 m es una cota deliberada. Bifurcaciones casi paralelas y curvas complejas pueden dejar solapes fuera de la zona corregida.
- La jerarquía protege una vía superior ajena al encuentro, pero no resuelve pasos elevados de la misma jerarquía. El runtime no conserva `layer/bridge/tunnel`, y las cintas no escriben profundidad. Una vía ajena muy próxima puede seguir entrando en el orden de superposición. Si un mismo segmento conecta dos juntas de distinta jerarquía, su superficie usa la mayor para ambas zonas.
- El apagado de tandas usa la distancia central con margen ×4. Una vista extremadamente rasante cuyo pivote quede lejos del primer plano puede omitir detalle cercano.

## VERIFICACIÓN Y ESTADO DEL ÁRBOL

- `npx vitest run`: **551 pruebas, 58 archivos, todo aprobado**; 27 pruebas más respecto a las 524 del encargo.
- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0. Vite informa del bundle principal mayor de 500 kB; no hubo errores de compilación.
- `public/data`: sin cambios respecto a `2b579fd`.

Durante el trabajo entró el commit paralelo `cee33d5` sobre el centro del monumento. También incorporó versiones iniciales de los archivos de prueba de juntas. No lo creé ni lo reescribí; conservé el cambio ajeno de `src/data/piezas.ts`. El estado final probado es el árbol completo actual, con la implementación de juntas terminada encima.
