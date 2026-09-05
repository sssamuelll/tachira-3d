import { useMemo, type CSSProperties } from 'react'
import { SIN_MUNICIPIO, type AttrStore } from '../data/store'

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

// Los 29 nombres de OSM empiezan TODOS por "Municipio " ("Municipio Andrés
// Bello", "Municipio Ayacucho"…): con el ancho de la fila y el recorte por
// elipsis los 29 botones se pintaban como "Municipio…", indistinguibles. El
// prefijo no distingue nada acá -- toda la barra son municipios -- así que se
// quita para pintar, y el nombre completo (el que usa el filtro, y el que
// aparece en municipios.json) va en el title junto al conteo.
const nombreCorto = (name: string) => name.replace(/^Municipio /, '')

// Extraída del componente para poder probar el bucket 'sin municipio' sin
// renderizar JSX -- este repo no tiene @testing-library/react (mismo criterio
// que ya aplicó la Task 19 a EditPanel/FilterPanel: una dependencia nueva
// para un solo test de render no vale la pena). El municipio menos evaluado
// va primero -- esta barra ES la cola de trabajo, no un adorno -- y en caso
// de empate, alfabético: sin esto el desempate sale del orden de inserción
// del Map (el orden en que aparece cada municipio en `ways`), y con los 29
// en 0% al arrancar eso deja la lista entera en un orden arbitrario para
// quien la ve por primera vez.
export function filasCobertura (store: AttrStore) {
  return [...store.coverageByMunicipio()]
    .map(([name, c]) => ({
      name, ...c, pct: c.total ? c.evaluados / c.total : 0,
      corto: nombreCorto(name),
      // 'sin municipio' no tiene geometría propia (no está en
      // municipios.json) ni es un valor que FilterPanel pueda producir --
      // pulsarlo no puede filtrar ni volar a ningún lado. Hoy es un caso
      // inerte (build-data.mjs/verify-data.mjs exigen 0 vías sin municipio
      // en el dato real) pero si alguna vez deja de serlo, prometer un clic
      // que no hace nada es peor que no mostrarlo -- se muestra, sin acción.
      clickable: name !== SIN_MUNICIPIO,
    }))
    .sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name, 'es'))
}

export function CoverageBar (
  { store, version, onPick }: { store: AttrStore; version: number; onPick: (m: string) => void },
) {
  const filas = useMemo(() => {
    void version   // fuerza el recálculo cuando el store notifica un cambio (App.tsx, storeVersion)
    return filasCobertura(store)
  }, [store, version])

  const totalPct = filas.reduce((s, f) => s + f.evaluados, 0) /
                   Math.max(1, filas.reduce((s, f) => s + f.total, 0))

  return (
    <div style={bar}>
      <div style={{ minWidth: 90, fontVariantNumeric: 'tabular-nums' }}>
        <strong>{(totalPct * 100).toFixed(1)}%</strong><br />
        <span style={{ color: '#8b98a8', fontSize: 11 }}>evaluado</span>
      </div>
      {filas.map(f => {
        const contenido = (
          <>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {f.corto}
            </div>
            <div style={{ height: 4, background: '#22303f', borderRadius: 2, marginTop: 3 }}>
              <div style={{
                height: '100%', width: `${f.pct * 100}%`, borderRadius: 2,
                background: f.pct > 0.66 ? '#22a04f' : f.pct > 0.33 ? '#f2d43f' : '#c9422a',
              }} />
            </div>
          </>
        )
        const filaStyle: CSSProperties = {
          minWidth: 74, background: 'none', border: '1px solid #2a3644',
          borderRadius: 4, padding: '4px 6px', color: '#e8eaed',
          textAlign: 'left', fontSize: 11, cursor: f.clickable ? 'pointer' : 'default',
        }
        // El nombre completo va acá: el de la fila viene recortado por el
        // ancho, y antes el title solo traía el conteo -- no había forma de
        // saber qué municipio era ninguno de los 29.
        const conteo = `${f.evaluados.toLocaleString('es-VE')} de ${f.total.toLocaleString('es-VE')}`
        const title = f.clickable
          ? `${f.name} — ${conteo} evaluadas`
          : `${f.name} — ${conteo} evaluadas; sin municipio asignado, no se puede filtrar ni volar a estas vías`
        // No-pulsable como <div> informativo, no <button disabled>: acá no es
        // "esta acción no está disponible ahora", es "esto nunca fue una
        // acción" -- disabled sugeriría lo primero.
        return f.clickable ? (
          <button key={f.name} onClick={() => onPick(f.name)} title={title} style={filaStyle}>
            {contenido}
          </button>
        ) : (
          <div key={f.name} title={title} style={filaStyle}>
            {contenido}
          </div>
        )
      })}
    </div>
  )
}
