/**
 * El catálogo de capas del mapa: qué se puede prender, y de dónde sale.
 *
 * Hay dos clases. Las FIJAS no salen de un archivo sino de componentes que ya
 * existen desde antes de que hubiera capas -- los edificios horneados, los
 * límites municipales dibujados en el shader del relieve -- y están acá solo
 * para que el panel pueda listarlas junto a las demás. Las del catálogo de
 * archivo llegan en la tanda de hospitales.
 */

export interface CapaFija {
  id: 'edificios' | 'municipios'
  nombre: string
  /** Visible sin ?capas= en la URL. */
  porDefecto: boolean
}

/**
 * `edificios` por defecto porque es lo que el mapa dibujaba antes de que
 * existiera el panel, y prender el panel no puede cambiar lo que ve alguien
 * que abre el enlace de siempre. `municipios` apagado por lo mismo: hoy no se
 * dibuja, así que encenderlo de oficio cambiaría el mapa de todo el mundo.
 */
export const CAPAS_FIJAS: readonly CapaFija[] = [
  { id: 'edificios', nombre: 'Edificaciones', porDefecto: true },
  { id: 'municipios', nombre: 'Municipios', porDefecto: false },
]
