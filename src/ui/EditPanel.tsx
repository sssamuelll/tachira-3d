import { useState, type CSSProperties } from 'react'
import { pciRange, TIPOS } from '../data/constants'
import type { Fuente, Tipo } from '../data/types'

// Hijo del contenedor flex fixed que arma App.tsx abajo (junto a
// CoverageBar, Task 20 fix round 1) -- este panel ya no fija su propia
// posición. Arriba siguen la barra de botones (top:12,left:12) y el
// FilterPanel (Task 18, top:12,right:12), así que "abajo" sigue siendo la
// única franja libre, pero el reparto de ancho con CoverageBar ahora lo
// resuelve el flex del padre, no un left/right calculado a mano: ese cálculo
// fue justo lo que causó el solape invisible del fix round 1 (EditPanel y
// CoverageBar se desincronizaban en silencio si cualquiera cambiaba de
// tamaño). width fijo + flexShrink:0 para que sea CoverageBar (flex:1) quien
// ceda espacio, nunca al revés. pointerEvents:'auto' porque el contenedor
// padre es pointerEvents:'none' (deja pasar el lazo/clic por los huecos
// entre paneles) -- sin esto este panel tampoco respondería a clics.
const box: CSSProperties = {
  width: 260, flexShrink: 0, pointerEvents: 'auto',
  background: 'rgba(14,20,28,0.92)', border: '1px solid #2a3644',
  borderRadius: 6, padding: 12, display: 'grid', gap: 8,
}

export function EditPanel ({ selection, visibleCount, filteredCount, onApply, onSelectAllFiltered }: {
  selection: number[]
  visibleCount: number
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
  // Fix hallazgo PRINCIPAL (re-revisión final): `n` es cuánto hay
  // seleccionado, `visibleCount` es cuánto de eso el filtro vigente sigue
  // mostrando -- App.tsx intersecta contra la máscara antes de aplicar
  // (visibleSelection, FilterPanel.tsx), así que una selección hecha con un
  // filtro más permisivo puede traer vías que el filtro de ahora oculta.
  // Ambos números se ven abajo para que "aplicar a N" nunca contradiga en
  // silencio al contador de selección -- si difieren, hay un aviso explícito.
  const oculto = n - visibleCount
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

          {/* Fix hallazgo PRINCIPAL (re-revisión final): visible solo cuando
              el filtro oculta parte de la selección -- si no, es ruido en el
              caso normal (selección hecha bajo el filtro vigente, los dos
              números siempre coinciden). Explica por qué el botón de abajo
              va a decir un número distinto al de esta línea, en vez de
              dejar que el usuario lo descubra solo. */}
          {oculto > 0 && (
            <div style={{ color: '#f2d43f', fontSize: 12 }}>
              el filtro oculta {oculto.toLocaleString('es-VE')} de la selección
              {visibleCount === 0
                ? ' -- ninguna aplicable: cambia el filtro o la selección'
                : ` -- aplicar solo tocará las ${visibleCount.toLocaleString('es-VE')} visibles`}
            </div>
          )}

          <label>
            {/* Al destildar se limpia la fuente elegida: con el selector ya
                deshabilitado (abajo) un valor previo seguía a la vista como
                si fuera a aplicarse, aunque store.set() ya lo descarta --
                inerte de verdad, no solo protegido. */}
            <input type="checkbox" checked={aplicaPci}
              onChange={e => { setAplicaPci(e.target.checked); if (!e.target.checked) setFuente('') }} />
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
            disabled={visibleCount === 0 || (aplicaPci && !fuente)}
            title={
              visibleCount === 0 ? 'el filtro oculta toda la selección -- nada que aplicar'
                : aplicaPci && !fuente ? 'Elige la procedencia antes de aplicar' : ''
            }
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
            aplicar a {visibleCount.toLocaleString('es-VE')}
          </button>
        </>
      )}
    </div>
  )
}
