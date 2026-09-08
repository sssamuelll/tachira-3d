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
    lat: 7.77382,
    lon: -72.22917,
    glb: '/data/piezas/obelisco-italianos.glb',
    // SUPUESTO: no conocemos el rumbo real. 0° conserva los ejes del GLB.
    // Afecta a la silueta proyectada de su sombra; no es un dato levantado.
    rumbo: 0,
    representación: 'generada',
  },
]
