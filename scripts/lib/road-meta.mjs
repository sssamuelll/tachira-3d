// OSM admite texto libre: "2;3" no significa que podamos afirmar dos carriles.
export function normalizeLanes (value) {
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value.trim())) return null
    value = Number(value.trim())
  }
  return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null
}

/** Deja los nodos en el sentido de circulación. OSM escribe oneway=-1 para
 *  "sentido único, contra el orden de los nodos", y normalizeOneway lo funde
 *  en true: la dirección tiene que quedar en la geometría, porque el shader
 *  dibuja las flechas hacia el final de la vía (roadsShader.ts). Devuelve el
 *  mismo array si no hay nada que invertir, y una copia si lo hay. */
export function orientar (coords, oneway) {
  const v = typeof oneway === 'string' ? oneway.trim() : oneway
  return v === '-1' || v === -1 ? coords.slice().reverse() : coords
}

export function normalizeOneway (value) {
  if (value === true || value === 1 || value === -1) return true
  if (value === false || value === 0) return false
  if (typeof value !== 'string') return null
  switch (value.trim().toLowerCase()) {
    case 'yes': case 'true': case '1': case '-1': return true
    case 'no': case 'false': case '0': return false
    // Ausencia y valores como reversible no equivalen a doble sentido explícito.
    default: return null
  }
}
