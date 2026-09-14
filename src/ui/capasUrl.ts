/**
 * El conjunto de capas visibles, ida y vuelta con el query string.
 *
 * Que la vista quepa en un enlace es el punto: alguien comparte "los
 * hospitales del Táchira" y el que lo abre ve eso y no otra cosa.
 *
 * La URL escribe el conjunto salvo cuando coincide EXACTAMENTE con los valores
 * de fábrica, y entonces omite el parámetro. Esa es la regla, y tiene un precio
 * que conviene tener escrito: un enlace sin `?capas=` no significa "estas
 * capas" sino "las de fábrica, las que sean". El día que una capa nueva pase a
 * `porDefecto: true`, los enlaces que hoy no llevan parámetro mostrarán también
 * la nueva.
 *
 * Se eligió así -- y no guardar siempre el conjunto exacto -- porque el enlace
 * de siempre, el que ya circula, no lleva `?capas=` y tiene que seguir
 * abriendo el mapa de siempre. Cambiar los valores de fábrica es entonces un
 * cambio deliberado del mapa para todo el mundo, que es justo lo que la
 * spec §4 pide que sea.
 *
 * No importa el catálogo: lo recibe. Así la prueba arma el suyo y esto no se
 * rompe cada vez que el mapa gana una capa.
 */

export interface Disponible { id: string; porDefecto: boolean }

/** El centinela del conjunto vacío. `?capas=` a secas es indistinguible de
 *  `?capas` ausente una vez que URLSearchParams lo normaliza a '', y "ninguna
 *  capa" tiene que poder escribirse.
 *
 *  Se exporta para que el catálogo pueda comprobar que ninguna capa se llama
 *  así: una con este id haría que "ninguna capa visible" y "solo esa capa" se
 *  escribieran igual. El tripwire está en src/data/capas.test.ts. */
export const NINGUNA = 'ninguna'

export function capasDesdeUrl (search: string, disponibles: readonly Disponible[]): Set<string> {
  const p = new URLSearchParams(search)
  const ids = new Set(disponibles.map(d => d.id))
  const pedidas = p.get('capas')
  const visibles = pedidas === null
    ? new Set(disponibles.filter(d => d.porDefecto).map(d => d.id))
    : new Set(pedidas.split(',').filter(id => ids.has(id)))
  // Alias heredado de antes del panel. Va DESPUÉS de ?capas= a propósito: es
  // más específico, así que gana.
  if (p.get('edificios') === '0') visibles.delete('edificios')
  return visibles
}

export function capasAUrl (visibles: Set<string>, disponibles: readonly Disponible[]): string {
  const porDefecto = disponibles.filter(d => d.porDefecto).map(d => d.id)
  const enOrden = disponibles.filter(d => visibles.has(d.id)).map(d => d.id)
  if (enOrden.length === porDefecto.length && enOrden.every((id, i) => id === porDefecto[i])) return ''
  return `capas=${enOrden.length > 0 ? enOrden.join(',') : NINGUNA}`
}
