import { useMemo, type CSSProperties } from 'react'
import type { AttrStore } from '../data/store'

// position:fixed, abajo-derecha del EditPanel: la esquina superior-izquierda
// ya la ocupa la barra de botones (top:12,left:12, App.tsx), la
// superior-derecha el FilterPanel (Task 18, top:12,right:12,ancho 240) y
// abajo-izquierda el EditPanel (Task 19, bottom:16,left:16,ancho 260) -- las
// tres esquinas ya están tomadas. left:318, no 292: sin reset de box-sizing
// (index.html no trae uno, box-sizing:content-box es el default del
// navegador) el ancho renderizado de EditPanel no es sus 260px de `width` --
// suma padding (12+12) y borde (1+1) encima, 286px reales, borde derecho en
// left:16 + 286 = 302. left:292 (16+260, el cálculo "de papel" que ignora
// padding/borde) dejaba 10px de solape real con EditPanel, medido con
// getBoundingClientRect() en el navegador -- no se ve a simple vista porque
// ambos fondos son el mismo rgba(14,20,28,0.92) casi opaco, un panel tapa
// literalmente el borde del otro. left:318 = 302 + 16 (misma separación que
// EditPanel guarda de los bordes de la ventana). Mismo bottom:16 para alinear
// el borde inferior con él; ninguno de los dos paneles crece hacia abajo
// (EditPanel crece hacia arriba con la selección, este hacia los lados con
// overflowX), así que no se pisan pase lo que pase con su contenido.
const bar: CSSProperties = {
  position: 'fixed', left: 318, right: 16, bottom: 16, zIndex: 20,
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
