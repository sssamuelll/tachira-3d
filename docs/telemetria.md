# Telemetría de lo que se dibuja

**Qué es medido y qué es estimado:** todo lo de este documento es medido. Las
cifras salen de `scripts/perf-baseline.mjs` corrido contra el build de
producción (`--preview`) en Brave, el 2026-09-20, en la máquina de desarrollo.
Nada aquí es una estimación.

## Para qué

Los fps y los draw calls no distinguen un mapa quieto de uno que titila: los
dos números salen iguales parpadee o no. Lo que lo delata es el **churn**,
cuántas claves entran y salen del conjunto dibujado en cada cuadro, y sobre
todo cuántas salieron y volvieron enseguida.

`src/scene/telemetria.ts` es un anillo de 600 cuadros (10 s a 60 fps) donde
cada parte de la escena deja lo que hizo. Apagada no guarda nada ni reserva
nada: cada método sale en su primera línea. La enciende el puente de
diagnóstico de `App.tsx`, o sea el modo desarrollo y `?diagnostico=1`, igual
que `window.__escena`.

## Cómo se mira

En la consola del navegador, con el mapa abierto en `?diagnostico=1`:

```js
__telemetria.resumen()     // promedio por cuadro, máximo y total de cada clave
__telemetria.resumen().peor   // el cuadro más lento entero, clave por clave
__telemetria.cuadros()     // el anillo crudo
__telemetria.reiniciar()   // vaciarlo antes de reproducir algo
```

Y en la sonda, que lo vacía al empezar cada muestra y lo vuelca en el JSON:

```bash
node scripts/perf-baseline.mjs --preview --brave > corrida.json
```

La sonda imprime además una línea de churn por muestra.

## Qué registra

| Clave | Qué dice |
|---|---|
| `terreno.nodos` / `.entra` / `.sale` / `.parpadeo` | hojas del quadtree dibujadas, y las que entran, salen o vuelven al cuadro siguiente de haberse ido |
| `terreno.hueco_cupo` / `.hueco_tesela` | nodos que no se dibujan Y cuyo padre tampoco: un agujero en el relieve durante ese cuadro |
| `terreno.armados` / `.desalojo` / `.mallas` / `.sin_cupo` | mallas nuevas, desalojos de la LRU, tamaño, y si se agotó el presupuesto del cuadro |
| `terreno.zN` | cuántas hojas por nivel |
| `terreno.suelo.*` | cobertura z15 que los edificios usan de suelo (`coberturaEdificios`) |
| `imagen.nivel` / `.sube` / `.baja` | el z de la foto que usa cada nodo; `.baja` es un nodo que se volvió borroso |
| `imagen.*` / `dem.*` | peticiones, llegadas, fallos, desalojos y tamaño de las dos cachés de teselas |
| `edificios.chunks.*` / `edificios.sin_suelo` | manzanas dibujadas y las que se apagan porque su suelo no está |
| `piezas.*` | lo mismo para las piezas GLB |
| `*.ms` | cuánto tardó cada parte del cuadro (terreno, edificios, piezas, vías, contacto) |
| `gl.*` | draw calls, triángulos, geometrías, texturas y programas vivos |

Dos trampas conocidas, las dos comentadas en el código:

- `cuadro.dt` es el tiempo desde el cuadro **dibujado** anterior. Con
  `frameloop="demand"` un valor enorme casi siempre es el mapa en reposo, no
  un tirón.
- `gl.*` sale en cero mientras corre la sonda: ella apaga el `autoReset` de
  `renderer.info` y lleva la cuenta por su lado.

## El parpadeo del relieve (2026-09-20)

Lo primero que encontró la telemetría. Al orbitar sobre la ciudad se veían
teselas apagarse y volver. La causa no era la caché de fotos ni la de teselas
(`imagen.nivel.baja` salió en 0 en todas las muestras: ningún nodo se volvía
borroso), sino el presupuesto de mallas nuevas por cuadro:

`seleccionar()` (quadtree.ts) bajaba a un cuarteto de hijos preguntando a cada
uno si estaba listo. Con `NODOS_POR_CUADRO = 2`, los cuatro contestaban que sí
-- queda cupo -- y al visitarlos el cupo se acababa en el segundo. Los otros
dos no se dibujaban, y el padre tampoco, porque ya se había descartado:
**un agujero de un cuadro**, relleno al siguiente. Eso es lo que titilaba.

El arreglo son dos cosas:

1. `Datos.listoJuntos(hermanos)` en el quadtree: solo se baja al cuarteto si
   se puede armar **entero** en este cuadro. Si no, se dibuja el padre un
   cuadro más.
2. `listoJuntos` en TerrainLod arma de una vez los hermanos que faltan, sin
   dibujarlos. Sin eso pasaban dos cosas: un cuarteto que no cabe en el cupo
   no se armaría nunca (nadie pide sus mallas), y el primer hermano bajaba a
   sus propios hijos y se llevaba el cupo del hermano que todavía no se había
   visitado.

El presupuesto se queda en 2, que es el valor medido en su día.

### Medido, mismas muestras, misma máquina

Huecos por cuadro (`terreno.hueco_cupo`):

| muestra | antes | después |
|---|---|---|
| B3 estado orbitando | 0,22 | 0 |
| D1 ciudad orbitando | 1,45 | 0 |
| D2 ciudad orbitando | 0,05 | 0 |
| E2 calle orbitando | 0,04 | 0 |
| H vuelo por el estado | 3,99 | 0 |

De paso, `edificios.chunks.parpadeo` pasó de 0,08-0,15 por cuadro a 0 en todas
las muestras: las manzanas se apagaban porque la cobertura del suelo oscilaba
con los mismos agujeros.

Los fps y los percentiles no se mueven (56 fps, p95 de 18 ms, iguales dentro
del ruido) y `terreno.armados` se queda donde estaba (1,8-1,9 por cuadro): el
presupuesto sigue mandando.

### Lo que sí costó, y no está explicado

Con los agujeros en cero aparece una tarea larga del hilo principal de
**117 ms orbitando a pie de calle** y de 136-160 ms en el vuelo, una por
ventana de muestra, reproducida en cuatro corridas del build de producción.
Sin el arreglo no aparece en ninguna de las tres corridas de referencia.

Lo que se sabe de ella, medido:

- No está en nuestro JavaScript: ninguna parte del cuadro pasa de 5 ms en su
  peor cuadro (`terreno.ms` 4,6; `edificios.ms` 4,9; el resto por debajo de 1).
- No está dentro del cuadro: la sonda mide 0,3 ms de p95 entre el inicio del
  `requestAnimationFrame` y el final del render, con `ms_max` de 118.
- El perfil de CPU de cuatro segundos orbitando a pie de calle no la ve: el
  hilo está 82 % ocioso y lo más caro es `needsUpdate` de three con un 2 %.
- No reproduce contra el servidor de desarrollo, solo contra el build.

La hipótesis pendiente es una parada del lado del driver al dibujar por
primera vez un cuarteto completo con sus sombras. **No está comprobada.**
