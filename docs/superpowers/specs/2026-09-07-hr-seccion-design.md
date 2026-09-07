# La sección transversal de la calzada: bombeo, hombrillo y brocal

Fecha: 2026-09-07. Rama: `hr/seccion`, sobre `feat/vialidad-3d` (9f93b16).

## Problema

`2026-09-07-hr-asfalto-design.md` le puso a la calzada grano, grietas y huellas
de rodadura. Lo que sigue faltando es más viejo: la vía **termina en un borde de
tinta**. Es una cinta plana de ancho correcto que se acaba de golpe contra el
relieve, con la misma normal que el terreno de debajo en todo su ancho.

Una carretera real tiene sección. Tres cosas, en orden de cuánto se ven:

1. **Brocal** — el bordillo de concreto de una calle urbana, 15 a 25 cm, con su
   sombra al pie. Es lo que separa una calle de un terreno baldío.
2. **Hombrillo** — la franja de grava o tierra a cada lado de una carretera
   rural, de un metro largo. Es lo que hace que una troncal no parezca una cinta
   pegada al monte.
3. **Bombeo** — la corona: la calzada cae ~2 % del eje a los bordes para que el
   agua escurra. No se ve como geometría (7 cm en 7 m), se ve como que **la luz
   cae distinto en cada mitad**.

## Decisión

El cuadrilátero del pase de relleno se **ensancha** a calzada + 2 · borde, la
coordenada transversal se **remapea** para que la calzada siga ocupando
`[-1, 1]`, y la franja de afuera la pinta `src/scene/seccion.ts` después de las
marcas viales. El bombeo NO es geometría: es una función que inclina la normal
del marco (`Ng`) del asfalto.

Todo bajo el mismo umbral de píxeles que el asfalto (`ASFALTO_DESDE_PX` = 12,
`ASFALTO_HASTA_PX` = 26): a vista de estado el cuadrilátero es exactamente el de
antes, byte por byte, y no se ejecuta una sola línea de este bloque.

## 1. Qué vía lleva qué

No hay dato de "urbano" en `roads-meta.json` (los campos son `highway`,
`surface`, `lanes`, `oneway`, `name`, `ref`, `tipo`, `municipio`, `km`). La
regla se arma con los que hay, en este orden:

```
peatonal (footway, steps, path, bridleway, cycleway, pedestrian, …) → ninguna
urbano y con pavimento                                              → brocal
resto                                                               → hombrillo
```

`urbano` sale del NOMBRE cuando lo hay, y de la clase cuando no:

| señal | resultado | por qué |
|---|---|---|
| `^(Avenida\|Av\.\|Calle\|Carrera\|Vereda\|Transversal\|Pasaje\|Prolongación\|Redoma\|Bulevar)` | urbano | el nomenclátor venezolano de ciudad |
| `^(Carretera\|Vía\|Troncal\|Autopista\|Ramal\|Variante\|Distribuidor\|Viaducto\|Puente\|Peaje\|Acceso\|Camino)` | rural | el nomenclátor de carretera |
| sin nombre: `residential`, `living_street`, `service` | urbano | OSM define `residential` como calle de zona edificada |
| sin nombre: el resto (`trunk`, `primary`, `secondary`, `tertiary`, `unclassified`, `track`…) | rural | `unclassified` es, por definición de OSM, la vía menor **entre** poblados |

El nombre manda sobre la clase, y por eso funciona el caso que importa: la
**Avenida Libertador de San Cristóbal está tageada `secondary`** — por clase
sería carretera y llevaría hombrillo; por nombre es una avenida y lleva brocal.
Al revés, una `residential` llamada "Carretera vieja a…" sale con hombrillo.

Cobertura real del nombre: 4.351 de 26.712 vías, pero **427 de las 1.502 vías de
jerarquía alta** empiezan por "Avenida" y 483 por "Carretera" — que es
exactamente donde la clase sola se equivoca y donde el usuario mira de cerca.

"Con pavimento" es `marcasPermitidas()` (`calzada.ts`), que ya existe y ya
resuelve esto: excluye `surface` sin pavimentar explícita, `track` sin pavimento
declarado, obras y circuitos. Un `service` de tierra en un caserío no lleva
brocal; lleva el mismo borde de tierra que una carretera.

**Límite conocido, deliberado**: una calle `residential` de un caserío rural sin
`surface` sale con brocal y no lo tiene. Corregirlo bien pide densidad local de
la red (cuántas `residential` hay en 250 m), que es un recorrido espacial de
26.712 vías al cargar. No se hizo: el error se ve solo con la cámara metida en
un caserío, y el precio es una estructura de datos nueva.

## 2. Anchos

| franja | metros por lado | de dónde |
|---|---|---|
| hombrillo, red estructurante (nivel ≥ secundaria) | 1,5 | límite alto del rango del brief; el hombrillo de proyecto de una troncal venezolana es más (1,8–2,4), pero 1,5 ya lee y no come el doble de fragmentos |
| hombrillo, resto | 1,0 | límite bajo: una terciaria rural tiene borde, no berma de proyecto |
| brocal | 0,20 | cara superior de un brocal de concreto (15–20 cm) más el filo |

A 30 m de cámara (0,0276 m/px) el brocal mide 7 px y el hombrillo de una troncal
54 px. Por debajo de píxel y medio la franja **se apaga**, no se aliasea (mismo
criterio que `nitidez` en `asfalto.ts`).

Lo que NO entra: la **acera** detrás del brocal y la **cuneta** de concreto al
pie. Las dos ensancharían la cinta otro metro largo por lado, y a esa altura dos
calles paralelas de una urbanización empiezan a solaparse entre ellas.

## 3. Cómo se ensancha, y por qué así

El ancho lo decide el vertex shader por vértice, así que la franja tiene que
entrar ahí. Tres opciones y por qué esta:

- **uniform por material y nivel** — no sirve: el pase de ids dibuja la red
  ENTERA en un solo objeto (`PickingPass.tsx`), no uno por nivel, y no hay
  uniform que pueda decir cosas distintas de dos vías del mismo draw call. El
  clic dejaría de caer donde se ve la vía, que es el invariante que este
  proyecto ya rompió una vez.
- **sumarlo a `aCalzada`** — no sirve: `vCalzadaPx` sale de ahí y es la
  referencia de las marcas viales y del asfalto. Un eje amarillo pintado sobre
  el centro de "calzada + hombrillos" no está en el centro de la calzada.
- **atributo propio `aBorde`** (lo que se hizo) — un float por segmento, con
  **el signo diciendo qué es**: `> 0` hombrillo, `< 0` brocal, `0` nada. Es el
  mismo idioma que ya usa `aCanales` para el sentido de circulación. 450.261
  floats = 1,8 MB, la misma cuenta que `aCanales`.

Dentro del bloque de extrusión COMPARTIDO (`extrusionGlsl`, el que también
ejecuta el pase de ids):

```glsl
float anchoBase = max( aCalzada, uPisoPx * mppV );          // la calzada
float bordeM    = aBorde * smoothstep( 12.0, 26.0, anchoBase / mppV );
float anchoTot  = anchoBase + 2.0 * abs( bordeM );
float anchoM    = anchoTot ( + el contorno, si es el pase de contorno );
```

Tres consecuencias que hay que ver juntas:

- el **contorno** sigue envolviendo el total, porque se calcula sobre `anchoTot`;
- el **pase de ids** ensancha idéntico, porque es el mismo bloque: el clic sobre
  el hombrillo selecciona la vía;
- el `smoothstep` es el fundido. Cuando vale 0, `anchoTot == anchoBase` y la
  geometría es **la de antes exactamente**. Y como la franja nace de ancho cero
  y crece, no hay popping que suavizar aparte.

`frustumCulled` está en `false` en los dos pases (el bbox de una geometría
instanciada no es fiable), así que ensanchar no puede hacer desaparecer un tramo
en el borde de pantalla: no hay esfera envolvente que se quede corta. Verificado
en pantalla igual, con la cámara a 30 m y la vía saliendo por el borde.

## 4. El remapeo de `t`

`vUv.x` va de −1 a +1 sobre lo que se extruyó, que ahora es calzada + bordes. El
asfalto y las marcas están escritos sobre una calzada en `[-1, 1]` y no se
tocan. Una línea en el fragment, antes de todo lo demás:

```glsl
float t = vUv.x * (1.0 + 2.0 * abs(vBordeM) / max(vCalzadaPx * vMpp, 1e-6));
```

`|t| ≤ 1` es calzada; `1 < |t| ≤ total/calzada` es la franja. Los metros al filo
de la calzada salen de `(|t| - 1) · calzadaM / 2`, y ese es el sistema de
coordenadas en el que están escritos el brocal y el hombrillo: **metros, no
píxeles**.

`vBordeM` viaja como varying del pase visible (lo rellena el `colofon` de
`patchLineMaterial`, no el bloque compartido: el pase de ids no puede ganar
varyings). Lleva el ancho ya fundido y con su signo, así que el fragment sabe
exactamente qué geometría le llegó, sin recalcular el `smoothstep` y sin
arriesgarse a que vertex y fragment no coincidan.

## 5. Bombeo: una normal, no una geometría

7 cm de peralte en 7 m de calzada a 30 m de cámara son 2,5 px de flecha. No se
modela. Lo que sí se ve es la luz:

```glsl
vec3 normalSeccion (terrW, dirW, t, calzadaM, bordeM)
```

devuelve `normalize(Ng + s · derecha)`, con `s` la pendiente transversal firmada:
2 % dentro de la calzada (con la corona redondeada sobre 0,6 m, porque un vértice
vivo en el eje es una arista de un píxel que titila), 6 % en el hombrillo, 0 en
la cara superior del brocal. Es la normal exacta de una superficie con esa
pendiente: `(Ng + s·D) · (D − s·Ng) = 0`.

**Honestidad sobre lo que aporta: hoy, solo, NO se ve. Medido.**

Se capturó la Avenida Libertador a 30 m con `BOMBEO = 0.02` y con `BOMBEO = 0`
y se comparó el brillo medio de la mitad izquierda contra la derecha de la
calzada (canal rojo, ~23.000 píxeles por mitad, con el contorno localizado por
color para acotar la calzada):

| vista | sol | con bombeo | sin bombeo | **lo que aporta** |
|---|---|---|---|---|
| cenital | por defecto (alto) | 4,05 | 3,30 | **0,75** de 255 |
| oblicua | por defecto | −2,46 | −3,05 | **0,59** |
| cenital | bajo (0,9 0,18 0,3) | 6,19 | 5,29 | **0,90** |
| oblicua | bajo | −1,90 | −2,72 | **0,82** |

(La asimetría que queda sin bombeo es de la vista: las dos mitades no están a
la misma distancia de la cámara.)

Un nivel de 255 — 0,35 % — está por debajo del ruido del propio grano. Y la
razón es física, no un error: 2 % inclina la normal 1,15°, el difuso cambia
±1 %, y el especular, que sería quien lo delatara, está casi apagado sobre
pavimento seco (`ESPECULAR = 0.35` por `1 - rug`, con `rug` de asfalto entre
0,7 y 1,0). **Una carretera seca y áspera a mediodía tampoco enseña su
bombeo**; se ve cuando está mojada.

Se deja igualmente, y no por completitud:

- es la normal CORRECTA, y `hr/mojado` — que pone una película especular sobre
  la calzada — la convierte en el brillo asimétrico que sí se ve;
- la misma función da la pendiente del HOMBRILLO, 6 %, tres veces mayor, y esa
  sí separa la franja de grava de la calzada como dos planos distintos;
- cuesta seis instrucciones por fragmento dentro de un bloque que ya muestrea
  tres texturas.

Lo que NO se hizo fue subir la cifra hasta que se viera: 2 % es el bombeo de
proyecto, y una calzada dibujada con 8 % de peralte para que se note es una
calzada que miente sobre el terreno.

El marco se mantiene ortonormal solo: `cross(T, Ng + s·B) = B − s·Ng`, que es
justo la tangente transversal de la superficie inclinada. Por eso el cambio en
`asfalto.ts` es UNA línea y no toca la construcción de `B` ni la de `N`.

## 6. Los dos materiales

Procedurales, sin texturas nuevas: son franjas de un metro, y tres samplers más
por fragmento para pintar tierra no se pagan. Los dos usan `fbm()`, `ruido()` y
`hash1()`, que ya están en el preámbulo del pase de relleno (`asfalto.ts`), y la
misma iluminación difusa del asfalto (`AMBIENTE`, `SOL_DIF`, `AMB_SUELO`,
`NIVEL_CERCA`, ahora exportadas) **sin especular**: ni la grava ni el concreto
seco tienen lustre.

**Hombrillo**: tinte pardo, manchado fBm de 0,7 m, moteado por hash de **9 cm**
que se desvanece cuando la celda baja de dos píxeles, y un oscurecimiento en los
primeros 15 cm contra el asfalto (el filo comido de la calzada, donde se acumula
la tierra). Los 9 cm no son el canto rodado del granzón, que son dos o tres: con
la celda en 5 cm caía en 1,1 px a 30 m y en pantalla no se leía como grava sino
como tramado de un bit. Es el tamaño del GRUMO que se distingue a esa distancia.

**Brocal**: concreto claro con un grano fino, una **línea oscura de oclusión al
pie**, del lado de la calzada, con caída exponencial sobre 12 cm — es lo que
dice "esto tiene 20 cm de alto" sin modelar la cara vertical — y el **filo
superior de afuera más claro** sobre 5 cm, que es la arista que agarra el cielo.
Los dos, con piso de un píxel: nunca más finos que eso.

La fuerza de esa oclusión, 0,70, tampoco es la de una oclusión física, y la
razón se midió: la calzada de una vía SIN EVALUAR se pinta casi blanca (0,96 en
`constants.ts`, y son 20.484 de las 26.712), o sea que sale por la parte plana
de la curva de tono. Con 0,45 el escalón en luz lineal se comprimía a **dos
niveles de gris en pantalla** — perfil medido cruzando el borde de la
Libertador: 168 contra 170 — y la sombra sencillamente no estaba. Con 0,70 se
ve, y sobre una vía con PCI de verdad, más oscura, tampoco exagera.

Lo seleccionado tiñe la franja también (`mix(tinte, SELECCION, selected)`): es
la misma vía, y una calzada azul con su brocal gris se lee como dos objetos.

## 7. Lo que NO se hizo

- **La foto trazada (`src/foto/cuadros.ts`) se queda sin sección.** Rehace la
  extrusión en CPU para el trazador de rayos, pero no tiene fragment shader: si
  se ensancha el cuadrilátero, la franja sale pintada de asfalto y la vía queda
  un 30 % más ancha de lo que es. Una vía sin hombrillo es un error más chico
  que una vía demasiado ancha. Queda anotado ahí y en el reporte.
- **Geometría del brocal.** 20 cm de alto a 30 m son 7 px de paralaje en vista
  oblicua, y sí se notarían. Pero son vértices nuevos en un `LineSegments2` que
  hoy dibuja 450.261 tramos con cuatro vértices cada uno.
- **Acera y cuneta** (§2).
- **Bombeo mayor en vías malas.** Se pensó (un pavimento asentado tiene el
  peralte deformado) y se descartó: lo que de verdad deforma la sección de una
  vía mala es el ahuellamiento, y eso es relieve — es de `hr/mojado`.
