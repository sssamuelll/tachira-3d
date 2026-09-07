export const terrainVert = /* glsl */`
attribute float elevation;
attribute vec2 uvMascara;
attribute vec2 uvImagen;
varying float vElev;
varying vec2 vUvM;
varying vec2 vUvImg;
varying vec3 vNormalW;
void main () {
  vUvM = uvMascara;
  // Dónde cae este vértice dentro de la tesela de imagen del nodo. El atributo
  // es (i/32, j/32) y es el mismo en todos los nodos (nodoTerreno.ts); el
  // trozo de tesela que le toca a este nodo lo pone uImgUv, porque mientras la
  // suya carga dibuja la del ancestro.
  vUvImg = uvImagen;
  // NO uses position.y para el color: position.y es el componente "up" de
  // ENU, que incluye la caida por curvatura terrestre (~750 m en las
  // esquinas del bbox, a ~97.5 km del origen). uMin/uMax son elevacion
  // cruda del DEM (terrain.json). Comparar una cosa contra la otra hunde
  // la hipsometria hacia las bandas bajas conforme te alejas del centro,
  // sin que la elevacion real cambie -- un error radialmente simetrico
  // desde ORIGIN, facil de confundir con neblina de AerialPerspective.
  // Por eso la elevacion viaja como atributo propio, ya crudo.
  vElev = elevation;
  // normal de objeto, sin normalMatrix: la malla no tiene rotacion/escala
  // (se construye ya en coordenadas de mundo), asi que normal de objeto ==
  // normal de mundo. normalMatrix es la inversa-transpuesta de
  // modelViewMatrix -- multiplicar por ella da la normal en espacio de
  // CAMARA, que rota con cada frame de OrbitControls. Contra un uSun fijo
  // eso hace que la "luz" gire pegada a la camara en vez de quedarse fija
  // sobre el terreno (el hillshade cambiaria de lado al orbitar).
  vNormalW = normalize(normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

export const terrainFrag = /* glsl */`
uniform float uMin;
uniform float uMax;
uniform vec3 uSun;
uniform sampler2D uMascara;
// --- albedo (foto satelital) -------------------------------------------
uniform sampler2D uImg;
// xy = desplazamiento, z = escala del trozo de tesela que le toca a este nodo.
uniform vec3 uImgUv;
// 0 = solo hipsometria, 1 = solo foto. Es por nodo, no global: un nodo sin
// ninguna tesela cargada (ni la suya ni la de un ancestro) lo deja en 0 y
// dibuja el color de siempre.
uniform float uImagen;
uniform float uGanancia;
// -----------------------------------------------------------------------
varying float vElev;
varying vec2 vUvM;
varying vec2 vUvImg;
varying vec3 vNormalW;

vec3 hypso (float t) {
  if (t < 0.25) return mix(vec3(0.18,0.31,0.22), vec3(0.36,0.44,0.24), t / 0.25);
  if (t < 0.50) return mix(vec3(0.36,0.44,0.24), vec3(0.60,0.53,0.33), (t - 0.25) / 0.25);
  if (t < 0.75) return mix(vec3(0.60,0.53,0.33), vec3(0.62,0.47,0.40), (t - 0.50) / 0.25);
  return mix(vec3(0.62,0.47,0.40), vec3(0.90,0.90,0.92), (t - 0.75) / 0.25);
}

/**
 * EL COLOR BASE DEL TERRENO, SIN LUZ. Todo lo que decide "de que color es este
 * trozo de suelo" vive aca dentro y en ningun otro sitio del fragment; lo que
 * hay fuera es el recorte al contorno y el sombreado, que MULTIPLICA lo que
 * esta funcion devuelve. Si estas reescribiendo la iluminacion, esta funcion
 * no se toca: cambia el factor por el que se multiplica.
 *
 * La foto viene en sRGB y la GPU la linealiza sola al muestrear (la textura se
 * sube con formato interno SRGB8_ALPHA8, ver imagenTeselas.ts), asi que aca
 * llega en lineal, como el resto de la escena. La ganancia compensa lo que el
 * tone mapping AgX de Sky.tsx le come al rango medio: sin ella la foto sale
 * apagada al lado de la hipsometria, que esta escrita con numeros de sRGB
 * usados directamente como lineales y por eso "pega" mas fuerte.
 */
vec3 albedo (float t) {
  vec3 color = hypso(t);
  if (uImagen > 0.0) {
    vec3 foto = texture2D(uImg, vUvImg * uImgUv.z + uImgUv.xy).rgb * uGanancia;
    color = mix(color, foto, uImagen);
  }
  return color;
}

void main () {
  // Recorte al contorno del estado: la mascara de 1024x1024 (stateMask.ts)
  // como textura con filtro lineal, asi que el corte cae a media celda del
  // borde real (~70 m) a cualquier nivel de detalle del relieve. Por vertice
  // no sirve: un nodo grueso tiene celdas de kilometros y el borde saldria
  // en bloques.
  if (texture2D(uMascara, vUvM).r < 0.5) discard;
  float t = clamp((vElev - uMin) / max(1.0, uMax - uMin), 0.0, 1.0);
  float shade = clamp(dot(normalize(vNormalW), normalize(uSun)) * 0.6 + 0.5, 0.15, 1.0);
  gl_FragColor = vec4(albedo(t) * shade, 1.0);
}`
