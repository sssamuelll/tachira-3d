import type { CSSProperties } from 'react'
import { T } from './theme'

export interface Fila {
  id: string
  nombre: string
  /** El color con que la capa se dibuja en el mapa, si tiene uno propio. Las
   *  fijas no lo tienen: los edificios y los límites ya traen el suyo. */
  color?: string
}

const panel: CSSProperties = {
  background: T.fondo, borderRadius: T.radioChico, boxShadow: T.sombraChica,
  padding: 6, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 168,
}

const fila: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  background: 'transparent', border: 'none', borderRadius: 4,
  padding: '6px 8px', cursor: 'pointer', textAlign: 'left',
  fontFamily: 'inherit', fontSize: 13, lineHeight: 1.2,
}

/**
 * Qué se dibuja en el mapa, una casilla por capa.
 *
 * Sin categorías, sin buscador y sin arrastrar para reordenar: con tres capas
 * eso es interfaz que estorba. El día que pasen de diez se reabre la pregunta.
 */
export function PanelCapas ({ disponibles, visibles, onAlternar }: {
  disponibles: readonly Fila[]
  visibles: Set<string>
  onAlternar: (id: string) => void
}) {
  return (
    <div style={panel} role="group" aria-label="Capas del mapa">
      {disponibles.map(f => {
        const activa = visibles.has(f.id)
        return (
          <button key={f.id} onClick={() => onAlternar(f.id)} aria-pressed={activa}
            style={{ ...fila, color: activa ? T.texto : T.texto3 }}>
            {/* La muestra hace de casilla y de leyenda a la vez: llena cuando
                la capa está prendida, hueca cuando no, y del color con que se
                dibuja en el mapa. Una casilla aparte más un cuadrito de color
                serían dos cosas diciendo lo mismo. */}
            <span aria-hidden style={{
              width: 12, height: 12, borderRadius: 3, flex: '0 0 auto',
              border: `2px solid ${f.color ?? T.texto2}`,
              background: activa ? (f.color ?? T.texto2) : 'transparent',
            }} />
            {f.nombre}
          </button>
        )
      })}
    </div>
  )
}
