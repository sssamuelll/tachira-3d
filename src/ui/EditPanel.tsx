import { useState, type CSSProperties } from 'react'
import { pciRange, TIPOS } from '../data/constants'
import type { Fuente, Tipo } from '../data/types'

// position:fixed, abajo-izquierda: la esquina superior-izquierda ya la ocupa
// la barra de botones (top:12,left:12, App.tsx) y la superior-derecha el
// FilterPanel (Task 18, top:12,right:12, ancho 240) -- top:16,right:16 (como
// proponía el brief de esta task) habría quedado encimado sobre el panel de
// filtros, ambos peleando la misma esquina. Abajo-izquierda es la única
// esquina libre y no depende de la altura variable del panel de filtros
// (la lista de municipios puede crecer). Visto encimado en el navegador, no
// en el predicado -- ningún test cubre layout.
const box: CSSProperties = {
  position: 'fixed', bottom: 16, left: 16, zIndex: 20, width: 260,
  background: 'rgba(14,20,28,0.92)', border: '1px solid #2a3644',
  borderRadius: 6, padding: 12, display: 'grid', gap: 8,
}

export function EditPanel ({ selection, filteredCount, onApply, onSelectAllFiltered }: {
  selection: number[]
  filteredCount: number
  onApply: (patch: { pci?: number; fuente?: Fuente; tipo?: Tipo; nota?: string }) => void
  onSelectAllFiltered: () => void
}) {
  const [pci, setPci] = useState(50)
  const [fuente, setFuente] = useState<Fuente | ''>('')
  const [tipo, setTipo] = useState<Tipo | ''>('')
  const [nota, setNota] = useState('')
  const [aplicaPci, setAplicaPci] = useState(true)

  const n = selection.length
  // pciRange (constants.ts) ya resuelve el tramo ASTM -- reimplementar el
  // predicado `pci >= min && pci <= max` acá es justo la duplicación que se
  // eliminó en una task anterior (ver roadsShader.ts, que genera su GLSL
  // desde la misma tabla en vez de repetirla).
  const rango = pciRange(pci)

  return (
    <div style={box}>
      <strong style={{ fontSize: 13 }}>Edición</strong>

      {n === 0 ? (
        <div style={{ color: '#8b98a8' }}>
          Nada seleccionado. Haz clic sobre una vía, usa el lazo, o
          <button style={{ marginTop: 6, width: '100%' }} onClick={onSelectAllFiltered}>
            seleccionar las {filteredCount.toLocaleString('es-VE')} filtradas
          </button>
        </div>
      ) : (
        <>
          <div>{n.toLocaleString('es-VE')} seleccionada{n === 1 ? '' : 's'}</div>

          <label>
            <input type="checkbox" checked={aplicaPci} onChange={e => setAplicaPci(e.target.checked)} />
            {' '}PCI {pci} — {rango?.label}
          </label>
          {/* step=1: la escala ASTM es de enteros -- un valor fraccionario en
              el borde entre dos tramos (ej. 85.5) se vería confuso frente a
              pciRange(), que solo entiende enteros. type=range ya redondea a
              enteros por defecto sin step, pero se deja explícito porque acá
              es un requisito del dominio, no un detalle de implementación. */}
          <input type="range" min={0} max={100} step={1} value={pci} disabled={!aplicaPci}
            onChange={e => setPci(+e.target.value)} />

          {/* Obligatoria solo si se va a aplicar PCI: la fuente describe la
              procedencia del PCI, no de la rodadura (fix Task 19) -- una
              vía ya medida en campo no debe perder ese dato solo porque
              después se le fija la rodadura en bloque. Con aplicaPci
              destildado el selector se deshabilita (no hay PCI que proteger
              acá) y el botón de aplicar deja de exigirlo; con aplicaPci
              marcado sigue siendo la regla que sostiene la integridad del
              dato (spec §3.1): un PCI estimado presentado como medido es un
              número inventado con apariencia de rigor. */}
          <label>Procedencia{aplicaPci ? ' (obligatoria)' : ''}
            <select value={fuente} disabled={!aplicaPci} onChange={e => setFuente(e.target.value as Fuente | '')}>
              <option value="">elegir…</option>
              <option value="medido">medido — inspección con ficha</option>
              <option value="estimado">estimado — a ojo o desde imagen</option>
              <option value="heredado">heredado — aplicado en bloque</option>
            </select>
          </label>

          <label>Rodadura
            <select value={tipo} onChange={e => setTipo(e.target.value as Tipo | '')}>
              <option value="">no cambiar</option>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>

          <label>Nota
            <input value={nota} onChange={e => setNota(e.target.value)} placeholder="opcional" />
          </label>

          <button
            disabled={aplicaPci && !fuente}
            title={aplicaPci && !fuente ? 'Elige la procedencia antes de aplicar' : ''}
            onClick={() => {
              onApply({
                ...(aplicaPci ? { pci } : {}),
                ...(fuente ? { fuente } : {}),
                ...(tipo ? { tipo: tipo as Tipo } : {}),
                ...(nota ? { nota } : {}),
              })
              setNota('')
            }}
          >
            aplicar a {n.toLocaleString('es-VE')}
          </button>
        </>
      )}
    </div>
  )
}
