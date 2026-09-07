export const terrainVert = /* glsl */`
attribute float elevation;
attribute vec2 uvMascara;
varying float vElev;
varying vec2 vUvM;
varying vec3 vNormalW;
void main () {
  vUvM = uvMascara;
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
varying float vElev;
varying vec2 vUvM;
varying vec3 vNormalW;

vec3 hypso (float t) {
  if (t < 0.25) return mix(vec3(0.18,0.31,0.22), vec3(0.36,0.44,0.24), t / 0.25);
  if (t < 0.50) return mix(vec3(0.36,0.44,0.24), vec3(0.60,0.53,0.33), (t - 0.25) / 0.25);
  if (t < 0.75) return mix(vec3(0.60,0.53,0.33), vec3(0.62,0.47,0.40), (t - 0.50) / 0.25);
  return mix(vec3(0.62,0.47,0.40), vec3(0.90,0.90,0.92), (t - 0.75) / 0.25);
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
  gl_FragColor = vec4(hypso(t) * shade, 1.0);
}`
