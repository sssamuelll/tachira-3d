/**
 * El conjunto de capas visibles, ida y vuelta con el query string.
 *
 * Que la vista quepa en un enlace es el punto: alguien comparte "los
 * hospitales del Táchira" y el que lo abre ve eso y no otra cosa. Por eso la
 * URL guarda el conjunto EXACTO y no un diff contra los valores de fábrica:
 * si mañana `porDefecto` cambia, un enlace viejo tiene que seguir mostrando lo
 * que mostraba.
 *
 * No importa el catálogo: lo recibe. Así la prueba arma el suyo y esto no se
 * rompe cada vez que el mapa gana una capa.
 */

export interface Disponible { id: string; porDefecto: boolean }

/** El centinela del conjunto vacío. `?capas=` a secas es indistinguible de
 *  `?capas` ausente una vez que URLSearchParams lo normaliza a '', y "ninguna
 *  capa" tiene que poder escribirse. */
const NINGUNA = 'ninguna'

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
