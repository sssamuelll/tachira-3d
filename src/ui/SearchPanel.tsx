import { useState, type CSSProperties, type ReactNode } from 'react'
import { T, css3 } from './theme'
import { Lupa, Equis, Territorio, Via, Capa, Sello } from './icons'
import { SUGERENCIAS, type Grupo, type Resultado } from './search'

// El riel entero no intercepta el puntero; cada tarjeta sí. Debajo hay un
// lienzo WebGL que recibe clics, órbitas y el lazo: si el riel capturara los
// eventos, la franja izquierda del mapa dejaría de responder aunque se vea
// vacía.
const riel: CSSProperties = {
  position: 'fixed', top: 12, left: 12, zIndex: 20,
  width: T.riel, maxWidth: 'calc(100vw - 24px)',
  display: 'flex', flexDirection: 'column', gap: 8,
  pointerEvents: 'none', fontFamily: T.fuente,
}

const tarjeta: CSSProperties = {
  pointerEvents: 'auto', background: T.fondo, borderRadius: T.radio, boxShadow: T.sombra,
}

const filaResultado: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
  padding: '10px 16px', border: 'none', background: 'transparent',
  textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
}

function IconoDe ({ r }: { r: Resultado }) {
  if (r.color) {
    return (
      <span aria-hidden style={{
        width: 14, height: 14, borderRadius: 999, flexShrink: 0,
        background: css3(r.color), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)',
      }} />
    )
  }
  const C = r.clase === 'municipio' ? Territorio : r.clase === 'via' ? Via : r.clase === 'rodadura' ? Capa : Sello
  return <span style={{ color: T.texto3, flexShrink: 0, display: 'grid' }}><C /></span>
}

export function SearchPanel ({ q, onQ, grupos, activa, onElegir, ficha }: {
  q: string
  onQ: (s: string) => void
  grupos: Grupo[]
  /** Clave del resultado sobre el que está puesto el foco del mapa. */
  activa: string | null
  onElegir: (r: Resultado) => void
  /** La ficha de la selección. Cuando hay algo seleccionado manda sobre la
   * lista: es lo que el usuario acaba de tocar. */
  ficha: ReactNode | null
}) {
  const [enfocado, setEnfocado] = useState(false)
  const hayConsulta = q.trim().length > 0
  const primero = grupos[0]?.items[0]

  const cuerpo: ReactNode =
    ficha ??
    (hayConsulta
      ? (grupos.length ? <Resultados grupos={grupos} activa={activa} onElegir={onElegir} /> : <SinResultados q={q} />)
      : (enfocado ? <Sugerencias onElegir={onQ} /> : null))

  return (
    <div style={riel}>
      <div style={{
        ...tarjeta, display: 'flex', alignItems: 'center', gap: 10,
        height: 48, padding: '0 8px 0 14px',
      }}>
        <span style={{ color: T.texto2, display: 'grid' }}><Lupa /></span>
        <input
          value={q}
          onChange={e => onQ(e.target.value)}
          onFocus={() => setEnfocado(true)}
          // El desenfoque se retrasa un cuadro: un clic sobre una sugerencia
          // dispara blur ANTES que click, y sin la espera el panel se cierra
          // debajo del dedo y el clic no llega a ningún lado.
          onBlur={() => setTimeout(() => setEnfocado(false), 150)}
          onKeyDown={e => {
            if (e.key === 'Escape') { onQ(''); (e.target as HTMLInputElement).blur() }
            if (e.key === 'Enter' && primero) onElegir(primero)
          }}
          placeholder="Busca en la red vial del Táchira"
          aria-label="Buscar"
          style={{
            flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 15, color: T.texto, fontFamily: 'inherit',
          }}
        />
        {hayConsulta && (
          <button onClick={() => onQ('')} title="Borrar la búsqueda" aria-label="Borrar la búsqueda"
            style={{
              border: 'none', background: 'transparent', color: T.texto2, cursor: 'pointer',
              padding: 6, borderRadius: 999, display: 'grid', placeItems: 'center',
            }}>
            <Equis />
          </button>
        )}
      </div>

      {cuerpo && (
        <div style={{ ...tarjeta, overflow: 'hidden', maxHeight: 'calc(100vh - 84px)', overflowY: 'auto' }}>
          {cuerpo}
        </div>
      )}
    </div>
  )
}

function Resultados ({ grupos, activa, onElegir }: {
  grupos: Grupo[]; activa: string | null; onElegir: (r: Resultado) => void
}) {
  return (
    <div style={{ padding: '6px 0' }}>
      {grupos.map((g, i) => (
        <section key={g.clase}>
          <h3 style={{
            margin: 0, padding: i === 0 ? '8px 16px 4px' : '14px 16px 4px',
            fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: T.texto3,
          }}>
            {g.titulo}
          </h3>
          {g.items.map(r => (
            <button key={r.clave} onClick={() => onElegir(r)}
              style={{ ...filaResultado, background: activa === r.clave ? T.acentoSuave : 'transparent' }}>
              <IconoDe r={r} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontSize: 14, color: T.texto,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {r.titulo}
                </span>
                <span style={{
                  display: 'block', fontSize: 12, color: T.texto2, marginTop: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {r.detalle}
                </span>
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

// Un estado vacío que solo dice "sin resultados" deja al usuario adivinando
// qué clase de palabra acepta el campo. Este enumera las cinco y da un
// ejemplo de cada una, que es la única forma de aprender un buscador que no
// tiene filtros a la vista.
function SinResultados ({ q }: { q: string }) {
  return (
    <div style={{ padding: '16px', display: 'grid', gap: 8 }}>
      <span style={{ fontSize: 14, color: T.texto }}>
        Nada coincide con «{q.trim()}».
      </span>
      <span style={{ fontSize: 13, color: T.texto2, lineHeight: 1.5 }}>
        Se puede buscar un municipio (Junín), el nombre o el código de una vía
        (T-5), una rodadura (asfalto, granzón) o una condición
        (sin evaluar, colapsado, bueno).
      </span>
    </div>
  )
}

function Sugerencias ({ onElegir }: { onElegir: (q: string) => void }) {
  return (
    <div style={{ padding: '14px 16px', display: 'grid', gap: 10 }}>
      <span style={{ fontSize: 12, color: T.texto3 }}>Prueba con</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {SUGERENCIAS.map(s => (
          // onMouseDown y no onClick: el blur del campo se dispara antes que
          // el click y el retardo de 150 ms de arriba es la red, no el plan.
          <button key={s} onMouseDown={e => { e.preventDefault(); onElegir(s) }}
            style={{
              padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${T.lineaFuerte}`, background: T.fondo,
              color: T.texto, fontSize: 13, fontFamily: 'inherit',
            }}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}
