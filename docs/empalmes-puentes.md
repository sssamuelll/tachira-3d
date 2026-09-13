# Empalmes de puentes: medición sin hornear

Rama `feat/vialidad-3d`, sobre `7d0f265`. Código preparado y probado; **no se ejecutó `npm run data`**. La imagen satelital ya no se hornea: el mapa la pide en vivo. Tampoco se abrió un navegador ni se modificaron `vectorizer` o los GLB.

El p99 del quiebre en los estribos baja **34,1 %**, de **24,81199 a 16,35279 puntos porcentuales**. No queda una red universalmente suave: persisten casos inviables y quiebres al terminar algunos acuerdos.

## EL QUIEBRE DE PENDIENTE

| Medida | Antes | Después, simulación del código final |
|---|---:|---:|
| Máximo | 128,731794 pp | 51,610426 pp |
| Mediana | 2,043666 pp | 0,000891 pp |
| p99 | 24,811992 pp | 16,352791 pp |

Se revisan las **441 cadenas y sus 882 estribos**. Hay **852 medibles y 30 sin acceso conectado visible**; esos 30 aparecen como `null`, identificados por cadena, lado, nodo y coordenadas. No tienen dos pendientes que comparar y no se rellenan con ceros. Son exactamente los mismos 852 antes y después. En los 26 estribos con varias ramas se toma la peor, sin elegir la avenida que dé mejor resultado.

Se mide el primer segmento real a cada lado de la junta, después de redondear las posiciones al Float32 del empaquetado. Las alturas se convierten de ENU a altura geodésica. El quiebre es `abs(pendiente_hacia_dentro_del_puente + pendiente_hacia_fuera_del_acceso) * 100`; las dos pendientes están orientadas desde el estribo. Una rampa recta da cero. El p99 usa rango más próximo, `ceil(0.99 * N)`; la mediana promedia los dos centrales cuando corresponde.

Evidencia completa: [referencia original](empalmes-puentes-baseline.json) y [simulación, incluidos los 882 registros](empalmes-puentes-simulacion.json).

## EL ESCALÓN DE COTA

**No había escalón en los 852 empalmes medibles: máximo, mediana y p99 eran 0 m. Siguen en 0 m** después del empaquetado simulado. Esto mide alturas, no certifica por sí solo el borde completo de la cinta ni su pendiente transversal.

## CÓMO LO SUAVIZAS

La topología se captura antes de orientar y subdividir. Los recorridos siguen nodos OSM compartidos y atraviesan particiones de grado dos; paran en cruces o a unos 150–300 m. El índice conserva solo nodos a distancia compatible con ese alcance. No crea conexiones por cercanía entre calzadas paralelas.

Se reutilizan `perfil`, `VENTANA_M` y `desvanecer` de `scripts/lib/carving.mjs`. `perfil` conserva su acotador por envolventes, sin relajación iterativa; se le añaden anclas de cota y detección de incompatibilidad. El perfil objetivo mezcla las tangentes con el mismo smoothstep del carving. Reserva hasta 20 m de tangente cerca del estribo, sin esconder el quiebre en un segmento diminuto. Si las anclas no permiten la tangente solicitada, la recorta al límite admisible; si no permiten ni conectar las cotas, declara el acceso inviable.

**También se reutiliza la banda transversal por clase de vía**, mediante `tallar` con alturas ya resueltas y pesos longitudinales que apagan el acuerdo. No basta con aplicar directamente la banda original: esa banda actúa hacia los lados del corredor, y el perfil original sin anclas puede mover las cotas de sus extremos. Ninguna de esas dos operaciones fija por sí sola la tangente del tablero.

Los accesos resueltos conservan altura propia, sin volver a drapearlos. Una copia estable del DEM anterior conserva la geometría y las normales del resto. Se compararon las posiciones: **847 ways cambian y 25.865 permanecen idénticos**. La modificación del terreno queda dentro de la influencia de los corredores.

## LOS 82

**Quedan 54 ways con penetración mayor de 20 cm**, frente a 82. Los 368 que pasaban siguen pasando; ahora pasan **396 de los 450 interpolados**. Hay **cero penetraciones nuevas y cero empeoramientos**, también entre los que siguen penetrando. La penetración máxima restante es **4,269 m**.

Se conserva el protocolo anterior: eje de cada puente, muestras cada 5 m, incluidos interiores de los segmentos, y comparación individual de los 450 mínimos de holgura. La lista de los 54, con valores antes y después, está en `clearance.remainingPenetratingWays` del JSON. Un way excluido de interpolación sigue excluido.

El tablero solo puede subir. El tallado de accesos no puede elevar los cuatro posts que soportan cada muestra del puente. El horneado aborta si detecta un empeoramiento de holgura mayor de `1e-7 m`.

## PENDIENTE MÁXIMA

No se encontraron segmentos nuevos de acceso que excedan su límite: **8 %** en primaria/troncal, **10 %** en secundaria, **12 %** en terciaria/residencial y **20 %** en servicio/trocha. Se comprueban todos los segmentos propios, también los de menos de 5 m. La auditoría de Float32 tampoco encuentra excesos mayores de 0,1 puntos porcentuales atribuibles al empaquetado. El nivel peatonal no tiene un límite físico definido en la tabla original.

**La garantía global de clase no queda resuelta:** todavía hay **16 cadenas de tablero con pendiente heredada superior a su límite**, enumeradas en `gradeConstraints.bridgeSlopeLimitResiduals`. Los accesos disponibles no permiten corregirlas todas conservando las otras cotas. No se ocultan bajo el percentil de la red.

| Red estructurante, fórmula de `verify` | p99 | Segmentos considerados |
|---|---:|---:|
| Referencia original | 20,992385 % | 38.182 |
| `npm run verify`, archivos actuales | 21,096601 % | 36.744 |
| Código final, simulación | 21,096601 % | 36.630 |

**Sube 0,104216 puntos porcentuales** respecto a la referencia; sigue por debajo del umbral del 30 %. El tamaño de la muestra cambia porque `verify` excluye segmentos con distancia horizontal menor de 5 m. Por eso se añade el control por clase sobre todos los segmentos nuevos, sin ese filtro.

## SI SE MOVIÓ LA RASANTE DEL TABLERO

| Viaducto | Extremos | Centro de cada cadena | Terreno que apoya la pieza |
|---|---:|---:|---:|
| Viejo, ambas calzadas | 0 m | 0 m | 0 m |
| Nuevo, cuatro ways | 0 m | 0 m | 0 m |

No hay desplazamiento hacia arriba ni hacia abajo en ninguno de los dos. **Este cambio no requiere reconstruir sus GLB**. Se conservan los ocho posts de apoyo de sus centros.

En el resto de la red hay 72 correcciones de extremos bajos, solo hacia arriba, detalladas en `approaches.deckChanges`. El límite del tablero incluye todas las clases de la cadena, también sus ways interiores.

## CÓMO SE MIDIÓ SIN REGENERAR

El directorio ya contenía cambios y resultados de intentos anteriores. La referencia con los 82 casos está en `.cache/bridge-joins/before`; los archivos actuales no son esa referencia. Su auditoría da p99 de quiebre 18,20776 pp y su informe de estructuras declara 69 penetraciones. Esos valores se conservan como `currentOnDisk`, separados del resultado final simulado.

La auditoría reconstruye el DEM original desde los PNG de `.cache/dem`, **solo por bloques consultados alrededor de los puentes y sus accesos**. Para cada bloque selecciona todos los contribuyentes y calcula sus perfiles completos, con el mismo orden y acumulación Float32 del horneado. No recorta un perfil de carretera para alterar artificialmente el resultado, ni densifica la red entera.

La reconstrucción coincide con la referencia con **error exactamente 0 en las 882 cotas de extremo y los 450 mínimos de holgura**. Después ejecuta las mismas funciones de empalme y tallado de accesos que `build-data.mjs`, y empaqueta únicamente los ways afectados. Los demás se leen de los binarios originales.

La ejecución final tardó **24,5 s**, con **576,7 MiB de pico RSS** y heap limitado a 384 MiB. Preparó 1.801 ways y 84.449 vértices para los recorridos; las cachés retienen como máximo 128 bloques y ocho PNG. No escribió dentro de `public/data`.

Comando reproducible, desde la raíz del proyecto:

```powershell
node --max-old-space-size=384 scripts/simulate-bridge-joins.mjs --output docs/empalmes-puentes-simulacion.json
```

Requiere el snapshot indicado, `.cache/vias.json` y los PNG originales de `.cache/dem`; no descarga datos. Si la reconstrucción deja de coincidir con la referencia, aborta en vez de publicar una comparación engañosa.

## VERIFICACIÓN Y HORNEADO PENDIENTE

Pasaron **623 tests en 66 archivos** con `npx vitest run --maxWorkers=1 --no-file-parallelism`, además de `npx tsc --noEmit`, `npm run build` y `npm run verify`. Las pruebas añadidas usan fixtures sintéticos: **ninguna necesita datos regenerados ni queda deliberadamente fallando hasta el horneado**. Build conserva el aviso existente de chunks mayores de 500 kB. `verify` pasó sobre los archivos existentes; la simulación es la comprobación del cambio pendiente de hornear.

Para regenerar los datos y verificarlos, en ese orden y deteniéndose si falla un paso, ejecuta desde la raíz del repo:

```powershell
cmd /c "npm run data && npm run verify"
```

La imagen satelital no entra en esa cadena: ya no se hornea, se pide en vivo.

Después puedes contrastar los binarios realmente escritos contra la misma referencia:

```powershell
node --max-old-space-size=384 scripts/audit-bridge-joins.mjs --before .cache/bridge-joins/before --output docs/empalmes-puentes-horneado.json
```

## QUÉ MIRAR EN CHROME

Después de regenerar, ejecuta `npm run dev` y abre `http://localhost:5173/?hora=2026-09-08T14:00:00Z`, usando el puerto que indique Vite. Recarga sin caché y deja visibles las piezas.

- **Viejo:** latitud **7.76271285**, longitud **−72.23427815**. Mira lateralmente las dos calzadas y ambos estribos.
- **Nuevo:** latitud **7.76432975**, longitud **−72.2206145**. Revisa por separado los vanos y las conexiones con los tramos de suelo intermedios.

Para encuadrarlos en desarrollo desde la consola, este bloque usa la cota del tablero efectivamente cargado:

```js
var recursoFibra = performance.getEntriesByType('resource')
  .find(r => new URL(r.name).pathname.endsWith('/@react-three_fiber.js'));
var { _roots } = await import(recursoFibra.name);
var visor = [..._roots.values()][0].store.getState();
var terreno = await fetch('/data/terrain.json').then(r => r.json());
var estructuras = await fetch('/data/roads-structures.json').then(r => r.json());
var { makeEnuFrame, geodeticToEnu } = await import('/scripts/lib/enu.mjs');
var marco = makeEnuFrame(terreno.origin.lat, terreno.origin.lon, terreno.origin.h);
var mirarEmpalme = (lat, lon, osmId) => {
  var cadena = estructuras.chains.find(c => c.wayIds.includes(osmId));
  var [e, n, u] = geodeticToEnu(marco, lat, lon, cadena.heightMidM);
  visor.controls.target.set(e, u, -n);
  visor.camera.position.set(e + 260, u + 55, -n + 120);
  visor.controls.update();
};
mirarEmpalme(7.76271285, -72.23427815, 1203013290);
// Para cambiar al Nuevo:
// mirarEmpalme(7.76432975, -72.2206145, 74534876);
```

Acércate y baja hasta ver el perfil. Sigue cada acceso durante 150–300 m: comprueba tanto la junta con el tablero como el punto donde termina la transición. Busca quiebres residuales, calzada enterrada o flotante y cambios de inclinación transversal. El tablero debe conservar su encaje con el GLB. Repite con `?hora=2026-09-08T20:00:00Z`; cambia la iluminación, no la geometría. Este encuadre queda escrito para revisión humana: no se ejecutó en navegador durante esta sesión.

## QUÉ SIGUE ÁSPERO

- **30 estribos sin acceso medible**, nueve recorridos demasiado cortos y 36 con cotas incompatibles dentro del alcance disponible. Los descartes son recorridos, no necesariamente estribos únicos.
- **16 cadenas de tablero aún exceden su límite de clase**, aunque no se hayan creado excesos nuevos en los acuerdos.
- En **20.645 juntas internas** de los acuerdos, el quiebre final tiene mediana **0,13256 pp**, p99 **6,03284 pp** y máximo **40,47811 pp**. En **1.194 juntas exteriores y ramas de cruce**, mediana **1,03080 pp**, p99 **21,48460 pp** y máximo **44,93343 pp**. Estas cifras miden la geometría real; no son la métrica interna `endBreak` del algoritmo. No se afirma mejora antes/después en esas poblaciones, que son distintas de los 882 estribos.
- El terreno sigue limitando algunos accesos: **10.259 de 42.966 muestras** quedan más de 20 cm bajo el DEM, con un peor caso de **5,597 m**. También hay separaciones positivas de hasta **42,107 m**. El corredor de un DEM de unos 38 m no reproduce perfectamente cada rasante propia; proteger puentes y centros de piezas impide algunos rellenos. La mejora del p99 en estribos no certifica visibilidad continua de toda la calzada.
- Los **54 puentes que aún penetran**, los bordes de las cintas y su pendiente transversal requieren atención. No se certificaron aspecto visual ni FPS.

El código reduce claramente el quiebre pedido y conserva la cota de las juntas, pero estas limitaciones impiden afirmar que toda la carretera haya quedado suave o que todos los límites de clase estén resueltos.
