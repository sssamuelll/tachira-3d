import type { TerrainMeta } from '../data/types'

/**
 * Vuelve a apoyar las vías sobre la malla del relieve que de verdad se dibuja.
 *
 * El pipeline drapea cada punto de vía contra el DEM completo (3584x4352, ~36 m
 * por celda), pero el relieve que se renderiza es la malla de GRID=1024
 * (~130 m). Son dos superficies distintas del mismo terreno, y sobre cualquier
 * ladera cóncava la malla gruesa pasa por encima del punto donde la vía se
 * apoyó: el terreno se come la vía en el test de profundidad.
 *
 * Medido sobre roads-pos.bin real: la MITAD de los 900.522 puntos de vía
 * (50,4%) quedaban por debajo del relieve dibujado. De ahí que las vías se
 * vieran cortadas a trozos por muy gruesas que se dibujaran -- el grosor no
 * arregla que la mitad del trazo esté enterrado. El error tiene media 0,08 m
 * (las dos superficies coinciden en promedio) pero oscila +-10 m, con un peor
 * caso de 89 m.
 *
 * El arreglo no es un sesgo ni un margen: es usar la misma superficie. Después
 * de esto, cada punto de vía está exactamente sobre el triángulo del relieve
 * que se está dibujando debajo. Lo que queda contra el z-fighting -- que es
 * otro problema, de precisión del depth buffer y no de geometría -- lo pone
 * Roads.tsx levantando el objeto según la distancia de cámara.
 */

/**
 * Altura del relieve DIBUJADO en un punto, interpolada dentro del triángulo
 * que lo contiene.
 *
 * Replica la triangulación de Terrain.tsx a propósito, y ese acoplamiento es
 * justo el objetivo: los dos triángulos de cada celda son (a,c,b) y (b,c,d),
 * con a arriba-izquierda y d abajo-derecha, así que la diagonal va de b
 * (arriba-derecha) a c (abajo-izquierda). Interpolar bilinealmente en vez de
 * por triángulo daría, en una celda torcida, varios metros de diferencia con
 * lo que el rasterizador pinta -- suficiente para reintroducir el problema.
 * Si Terrain.tsx cambia el orden de sus índices, esto tiene que cambiar igual;
 * drape.test.ts fija la diagonal para que no se pueda mover de un solo lado.
 */
export function alturaMalla (
  grid: Int16Array, meta: TerrainMeta, lat: number, lon: number,
): number | null {
  const { width: W, height: H, bbox } = meta
  let gy = ((bbox.n - lat) / (bbox.n - bbox.s)) * (H - 1)   // fila 0 = norte
  let gx = ((lon - bbox.w) / (bbox.e - bbox.w)) * (W - 1)
  // Media milésima de celda de tolerancia en el borde. El punto que entra acá
  // salió de invertir su propio ENU, y esa ida y vuelta no es exacta al bit:
  // un punto que el pipeline puso justo sobre el borde del bbox vuelve con un
  // gx de -1e-15 y se descartaría como si estuviera fuera del mapa. Es
  // demasiado pequeño para tapar un fuera de rango de verdad, que se mide en
  // celdas enteras.
  const EPS = 5e-4
  if (!(gx >= -EPS && gy >= -EPS && gx <= W - 1 + EPS && gy <= H - 1 + EPS)) return null
  gx = Math.min(W - 1, Math.max(0, gx))
  gy = Math.min(H - 1, Math.max(0, gy))
  // La última fila y columna no abren celda: un punto justo en el borde cae en
  // la celda anterior con fracción 1.
  const x = Math.min(W - 2, Math.floor(gx))
  const y = Math.min(H - 2, Math.floor(gy))
  const fx = gx - x, fy = gy - y
  const ha = grid[y * W + x], hb = grid[y * W + x + 1]
  const hc = grid[(y + 1) * W + x], hd = grid[(y + 1) * W + x + 1]
  // fx + fy <= 1 es el triángulo (a,c,b); el resto, (b,c,d).
  return fx + fy <= 1
    ? ha + fx * (hb - ha) + fy * (hc - ha)
    : hd + (1 - fx) * (hc - hd) + (1 - fy) * (hb - hd)
}
