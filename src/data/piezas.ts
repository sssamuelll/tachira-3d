export interface Pieza {
  id: string
  nombre: string
  lat: number
  lon: number
  glb: string
  /** Grados horarios desde el norte (-Z); omitido equivale a 0°.
   * Es la rotación del marco canónico del GLB, no una orientación medida. */
  rumbo?: number
  representación: 'generada'
}

/** Metros, X este / Y arriba / Z -norte; origen en el centro del apoyo.
 * Añadir una entrada incorpora otra pieza sin cambiar el cargador. */
export const PIEZAS: readonly Pieza[] = [
  {
    id: 'node/2958281048',
    nombre: 'Obelisco de los Italianos',
    // El nodo de OSM está mal situado: cae 1,7 km al noroeste (572 m norte,
    // 1.634 m oeste) de donde está el monumento. Estas coordenadas las dio
    // Samuel, que conoce la ciudad, y mandan sobre el dato de OSM.
    lat: 7.76864170796685,
    lon: -72.2142234170396,
    glb: '/data/piezas/obelisco-italianos.glb',
    // SUPUESTO: no conocemos el rumbo real. 0° conserva los ejes del GLB.
    // Afecta a la silueta proyectada de su sombra; no es un dato levantado.
    rumbo: 0,
    representación: 'generada',
  },
]
