// La MISMA rampa hipsométrica que pinta el relieve en pantalla (hypso() en
// scene/terrainShader.ts), pero en TypeScript.
//
// Hace falta porque el trazador de rayos no ejecuta nuestro ShaderMaterial:
// come mallas con MeshStandardMaterial, así que el albedo de cada vértice hay
// que calcularlo en CPU y subirlo como color por vértice (foto/escena.ts).
//
// Es un duplicado, y este repo ya vio duplicados desincronizarse en silencio
// (la paleta ASTM, las anclas del LineMaterial). Acá el original vive en GLSL
// y no se puede importar, así que se copia -- pero foto/hypso.test.ts LEE el
// texto del shader, reconstruye la cascada de mix() que ejecutaría la GPU y la
// compara contra esta tabla en cien puntos. Si alguien retoca un color en
// terrainShader.ts, la suite se pone roja acá y no en el navegador tres
// semanas después.
//
// Ojo con lo que NO va acá: el shader multiplica hypso(t) por `shade`, un
// hillshade falso contra un uSun fijo. En una foto trazada la luz la pone el
// sol de verdad (foto/escena.ts), así que lo que entra al MeshStandardMaterial
// es el color plano -- multiplicarlo por el hillshade sombrearía dos veces.

/** Las cinco paradas de la rampa, equiespaciadas en t ∈ [0, 1]: verde monte,
 *  verde seco, ocre, tierra rosada, nieve. Copia literal de terrainShader.ts. */
export const PARADAS: readonly (readonly [number, number, number])[] = [
  [0.18, 0.31, 0.22],
  [0.36, 0.44, 0.24],
  [0.60, 0.53, 0.33],
  [0.62, 0.47, 0.40],
  [0.90, 0.90, 0.92],
] as const

/** Color lineal de la rampa en `t`. El shader recibe `t` ya recortado a
 *  [0, 1] por su llamador (clamp() en el main del fragment); acá se recorta
 *  también, porque el llamador de CPU lee elevaciones crudas del DEM y un
 *  nodo puede traer un vértice fuera del [uMin, uMax] del terreno completo. */
export function hypso (t: number): [number, number, number] {
  const n = PARADAS.length - 1
  const u = Math.min(Math.max(t, 0), 1) * n
  // El último tramo se cierra en i = n - 1: en t = 1 exacto, floor(u) daría n
  // y PARADAS[n + 1] no existe.
  const i = Math.min(Math.floor(u), n - 1)
  const f = u - i
  const a = PARADAS[i]
  const b = PARADAS[i + 1]
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ]
}
