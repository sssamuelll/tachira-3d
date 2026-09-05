import { useMemo, type CSSProperties } from 'react'
import type { AttrStore } from '../data/store'

// Hijo del contenedor flex fixed que arma App.tsx abajo, junto a EditPanel
// (Task 20 fix round 1). Antes tenía su propio `left` calculado a mano (16 +
// ancho de EditPanel + separación) para no solaparlo -- un cálculo "de papel"
// que ignoraba que sin reset de box-sizing (index.html no trae uno) el ancho
// renderizado de EditPanel suma padding y borde por fuera de su `width`, lo
// que dejaba 10px de solape real e invisible (mismo fondo casi opaco en los
// dos paneles -- apareció midiendo con getBoundingClientRect(), no a ojo).
// flex:1 elimina el número: EditPanel se queda con su ancho fijo
// (flexShrink:0, ver EditPanel.tsx) y esta barra toma todo lo que sobra, se
// reparta como se reparta -- si EditPanel cambia de ancho algún día, nada
// que actualizar acá. minWidth:0 es necesario: sin él, un flex item con
// overflow-x:auto adentro no se encoge por debajo del ancho de su contenido
// (los 29 botones en fila) y desborda el contenedor en vez de activar su
// propio scroll interno. pointerEvents:'auto' porque el contenedor padre es
// pointerEvents:'none'.
const bar: CSSProperties = {
  flex: 1, minWidth: 0, pointerEvents: 'auto',
  background: 'rgba(14,20,28,0.92)', border: '1px solid #2a3644',
  borderRadius: 6, padding: '8px 12px', display: 'flex', gap: 6, overflowX: 'auto',
}

export function CoverageBar (
  { store, version, onPick }: { store: AttrStore; version: number; onPick: (m: string) => void },
) {
  // El municipio menos evaluado va primero: con 26.712 vías y una sola persona
  // cargándolas, esta barra ES la cola de trabajo, no un adorno -- ordenar por
  // nombre o por total dejaría lo que falta enterrado en medio de la lista.
  const filas = useMemo(() => {
    void version   // fuerza el recálculo cuando el store notifica un cambio (App.tsx, storeVersion)
    return [...store.coverageByMunicipio()]
      .map(([name, c]) => ({ name, ...c, pct: c.total ? c.evaluados / c.total : 0 }))
      .sort((a, b) => a.pct - b.pct)
  }, [store, version])

  const totalPct = filas.reduce((s, f) => s + f.evaluados, 0) /
                   Math.max(1, filas.reduce((s, f) => s + f.total, 0))

  return (
    <div style={bar}>
      <div style={{ minWidth: 90, fontVariantNumeric: 'tabular-nums' }}>
        <strong>{(totalPct * 100).toFixed(1)}%</strong><br />
        <span style={{ color: '#8b98a8', fontSize: 11 }}>evaluado</span>
      </div>
      {filas.map(f => (
        <button key={f.name} onClick={() => onPick(f.name)}
          title={`${f.evaluados.toLocaleString('es-VE')} de ${f.total.toLocaleString('es-VE')}`}
          style={{
            minWidth: 74, background: 'none', border: '1px solid #2a3644',
            borderRadius: 4, padding: '4px 6px', color: '#e8eaed', cursor: 'pointer',
            textAlign: 'left', fontSize: 11,
          }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {f.name}
          </div>
          <div style={{ height: 4, background: '#22303f', borderRadius: 2, marginTop: 3 }}>
            <div style={{
              height: '100%', width: `${f.pct * 100}%`, borderRadius: 2,
              background: f.pct > 0.66 ? '#22a04f' : f.pct > 0.33 ? '#f2d43f' : '#c9422a',
            }} />
          </div>
        </button>
      ))}
    </div>
  )
}
