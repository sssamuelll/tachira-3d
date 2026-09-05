import { type CSSProperties } from 'react'
import type { Way, Fuente } from '../data/types'
import type { AttrStore } from '../data/store'
import { FUENTES } from '../data/constants'

export interface Filter {
  municipio: string | null
  highway: string | null
  pciMin: number
  pciMax: number
  fuente: Fuente | null
  soloSinEvaluar: boolean
}

export const EMPTY_FILTER: Filter = {
  municipio: null, highway: null, pciMin: 0, pciMax: 100, fuente: null, soloSinEvaluar: false,
}

// Un byte por vía, mismo índice que `ways` y que AttrStore -- es la forma que
// espera AttrTexture.refresh(visible, selected) (Task 14): 1 = pasa el
// filtro, 0 = discard en el shader (roadsShader.ts, canal B, bit 0). Recorre
// las 26.712 vías con un solo for -- microsegundos, pero el caller (App.tsx)
// tiene que memoizarlo: sin eso correría de nuevo en cada render.
export function applyFilter (ways: Way[], store: AttrStore, f: Filter): Uint8Array {
  const mask = new Uint8Array(ways.length)
  const rangoActivo = f.pciMin > 0 || f.pciMax < 100
  for (let i = 0; i < ways.length; i++) {
    const w = ways[i], r = store.get(i)
    if (f.municipio && w.municipio !== f.municipio) continue
    if (f.highway && w.highway !== f.highway) continue
    if (f.fuente && r.fuente !== f.fuente) continue
    if (f.soloSinEvaluar && r.pci != null) continue
    if (rangoActivo && (r.pci == null || r.pci < f.pciMin || r.pci > f.pciMax)) continue
    mask[i] = 1
  }
  return mask
}

// position:fixed, no relativo a ningún layout: el lazo (LassoOverlay.tsx)
// también es fixed y coincide con el lienzo completo -- si este panel
// empujara el documento (ej. viviendo en flujo normal arriba del Canvas), el
// lazo seguiría anclado al viewport pero el usuario dibujaría corrido contra
// lo que ve. top-right para no superponerse con la barra de botones
// (top:12,left:12, App.tsx), que ya ocupa la esquina opuesta.
const box: CSSProperties = {
  position: 'fixed', top: 12, right: 12, zIndex: 20, width: 240,
  background: 'rgba(14,20,28,0.92)', border: '1px solid #2a3644',
  borderRadius: 6, padding: 12, display: 'grid', gap: 8,
}

// <label> es inline por defecto: texto y control envuelven o no según el
// ancho que ocupe cada uno -- "Municipio" (nombres largos, ej. "Pedro María
// Ureña") bajaba de línea solo, "Tipo de vía" (valores OSM cortos) quedaba
// pegado al <select> en la misma línea. Visto en el navegador, no en el
// predicado. grid fuerza las dos filas siempre, para las tres iguales.
const field: CSSProperties = { display: 'grid', gap: 4 }

export function FilterPanel ({ ways, filter, onChange, count, km }: {
  ways: Way[]
  filter: Filter
  onChange: (f: Filter) => void
  count: number
  km: number
}) {
  // 29 municipios y ~20 highway de OSM salen del dato real, no de una lista
  // escrita a mano: si el pipeline de datos agrega o quita uno, el filtro lo
  // ve solo en la próxima carga, sin tocar este archivo.
  const municipios = [...new Set(ways.map(w => w.municipio).filter(Boolean))].sort() as string[]
  const highways = [...new Set(ways.map(w => w.highway))].sort()
  const set = (p: Partial<Filter>) => onChange({ ...filter, ...p })

  return (
    <div style={box}>
      <strong style={{ fontSize: 13 }}>Filtros</strong>

      <label style={field}>Municipio
        <select value={filter.municipio ?? ''} onChange={e => set({ municipio: e.target.value || null })}>
          <option value="">todos ({municipios.length})</option>
          {municipios.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>

      <label style={field}>Tipo de vía
        <select value={filter.highway ?? ''} onChange={e => set({ highway: e.target.value || null })}>
          <option value="">todos ({highways.length})</option>
          {highways.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </label>

      <label style={field}>Procedencia
        <select value={filter.fuente ?? ''} onChange={e => set({ fuente: (e.target.value || null) as Fuente | null })}>
          <option value="">todas</option>
          {FUENTES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </label>

      <label>PCI {filter.pciMin} a {filter.pciMax}
        <input type="range" min={0} max={100} value={filter.pciMin} aria-label="PCI mínimo"
          onChange={e => set({ pciMin: +e.target.value })} />
        <input type="range" min={0} max={100} value={filter.pciMax} aria-label="PCI máximo"
          onChange={e => set({ pciMax: +e.target.value })} />
      </label>

      <label>
        <input type="checkbox" checked={filter.soloSinEvaluar}
          onChange={e => set({ soloSinEvaluar: e.target.checked })} /> solo sin evaluar
      </label>

      <div style={{ borderTop: '1px solid #2a3644', paddingTop: 8, fontVariantNumeric: 'tabular-nums' }}>
        {count.toLocaleString('es-VE')} segmentos · {km.toFixed(1)} km
      </div>
    </div>
  )
}
