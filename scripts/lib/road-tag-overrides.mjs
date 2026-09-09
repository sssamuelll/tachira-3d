// Samuel, dueño del proyecto y conocedor del sitio, confirmó que el Viaducto
// Nuevo es continuo y que la Av. Fortunato Gómez pasa por debajo. OSM omite
// bridge/layer justo en estos cuatro ways centrales. La corrección es por ID:
// ni el nombre ni un cruce en planta bastan para convertir otra vía en puente.
const PUENTES_CONFIRMADOS_LOCALMENTE = new Set([
  1223380942, 1223380941, 1223380939, 1223380943,
])

/** Devuelve los tags efectivos del pipeline sin modificar la respuesta OSM. */
export function tagsViales (way) {
  const tags = way.tags ?? {}
  return PUENTES_CONFIRMADOS_LOCALMENTE.has(way.id)
    ? { ...tags, bridge: 'yes', layer: '1' }
    : tags
}
