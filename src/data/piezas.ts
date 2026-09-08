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
    // Samuel, que conoce el sitio: el fuste va unos 10° girado a la izquierda,
    // ortogonal a las direcciones de la avenida. Horario desde el norte, así que
    // a la izquierda es negativo. Sigue sin ser un rumbo levantado en campo.
    rumbo: -10,
    representación: 'generada',
  },
  {
    id: 'obelisco/ovalo',
    nombre: 'Óvalo de protección y fuentes del Obelisco',
    // Mismo emplazamiento que el monumento: rodea su base.
    lat: 7.76865841602524,
    lon: -72.21417741143414,
    glb: '/data/piezas/obelisco-ovalo.glb',
    // Samuel: el óvalo va 90° girado respecto al fuste. El monumento conserva su
    // dirección; la isla cruza. De ahí -10 + 90.
    rumbo: 80,
    representación: 'generada',
  },
]
