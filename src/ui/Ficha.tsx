import { useEffect, useState, type CSSProperties } from 'react'
import { pciRange, TIPOS } from '../data/constants'
import type { Fuente, Registro, Tipo, Way } from '../data/types'
import { T, css3, nf, km1, etiquetaVia, cortoMunicipio } from './theme'
import { porMunicipio } from './search'
import { Equis } from './icons'

// Cuántos municipios se listan antes de resumir el resto. Seis filas es lo
// que cabe sin empujar el editor fuera de la pantalla en un portátil.
const TOPE_MUNICIPIOS = 6

const FUENTE_QUE_ES: Record<Exclude<Fuente, 'sin'>, string> = {
  medido: 'inspección en sitio con ficha',
  estimado: 'a ojo, o leído de una imagen',
  heredado: 'aplicado en bloque, sin ver la vía',
}

const RODADURA: Record<Tipo, string> = {
  sin_definir: 'sin definir', asfalto: 'asfalto', concreto: 'concreto',
  granzon: 'granzón', tierra: 'tierra', empedrado: 'empedrado',
}

const fechaCorta = (iso: string) => {
  const [a, m, d] = iso.split('-')
  return d ? `${+d}/${+m}/${a}` : iso
}

/** Texto legible sobre el color de una banda ASTM. Las bandas van del verde
 * medio al vino tinto: a ojo, la de "Regular" (amarillo) es la única que pide
 * texto oscuro, pero fijarlo a mano se rompe en cuanto alguien retoque la
 * paleta en constants.ts. La luminancia lo decide sola. */
const textoSobre = (c: readonly [number, number, number]) =>
  0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.6 ? '#1f2124' : '#ffffff'

function Insignia ({ pci }: { pci: number | null }) {
  const r = pciRange(pci)
  const fondo = r ? css3(r.color) : T.fondoSuave
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px',
      borderRadius: 999, background: fondo, border: r ? 'none' : `1px solid ${T.linea}`,
      color: r ? textoSobre(r.color) : T.texto2, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {r ? `${pci} · ${r.label}` : 'Sin evaluar'}
    </span>
  )
}

function Dato ({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 10, alignItems: 'baseline' }}>
      <span style={{ color: T.texto3, fontSize: 12 }}>{etiqueta}</span>
      <span style={{ color: T.texto, fontSize: 13 }}>{children}</span>
    </div>
  )
}

const seccion: CSSProperties = { borderTop: `1px solid ${T.linea}`, padding: '14px 16px', display: 'grid', gap: 10 }
const rotulo: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: T.texto3 }

export function Ficha ({ ways, seleccion, registro, onCerrar, onAplicar }: {
  ways: Way[]
  seleccion: number[]
  /** El registro vivo cuando hay exactamente una vía seleccionada, null si
   * hay varias o ninguna. Lo resuelve App contra el store: acá adentro no se
   * lee el store por índice, así que la ficha no necesita saber que existe
   * una versión que sube en cada edición. */
  registro: Registro | null
  onCerrar: () => void
  onAplicar: (patch: Partial<Registro>) => void
}) {
  const [pci, setPci] = useState(50)
  const [fijaPci, setFijaPci] = useState(true)
  const [fuente, setFuente] = useState<Fuente | ''>('')
  const [tipo, setTipo] = useState<Tipo | ''>('')
  const [nota, setNota] = useState('')

  const n = seleccion.length
  const unica = n === 1 ? ways[seleccion[0]] : null

  // Al abrir otra vía, el deslizador arranca en su PCI actual en vez de en un
  // 50 que no dice nada: casi siempre se corrige un valor, no se inventa uno.
  // La clave es la selección completa, no `n`: pasar de una vía a otra
  // (n sigue en 1) también tiene que recargar.
  const clave = seleccion.join(',')
  useEffect(() => {
    setFuente(''); setNota('')
    setPci(registro?.pci ?? 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const rango = pciRange(pci)
  const puedeGuardar = n > 0 && (!fijaPci || !!fuente) && (fijaPci || !!fuente || !!tipo || !!nota)

  let km = 0
  for (const i of seleccion) km += ways[i].km
  const filas = n > 1 ? porMunicipio(seleccion, ways) : []

  return (
    <>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '14px 12px 14px 16px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{
            margin: 0, fontSize: 19, fontWeight: 500, color: T.texto, lineHeight: 1.25,
            overflowWrap: 'anywhere',
          }}>
            {unica
              ? (unica.name ?? unica.ref ?? 'Vía sin nombre')
              : `${nf.format(n)} vías seleccionadas`}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: T.texto2 }}>
            {unica
              ? [etiquetaVia(unica.highway), unica.municipio && cortoMunicipio(unica.municipio)]
                .filter(Boolean).join(' · ')
              : `${km1(km)} en ${filas.length} municipio${filas.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button onClick={onCerrar} title="Quitar la selección" aria-label="Quitar la selección"
          style={{
            border: 'none', background: 'transparent', color: T.texto2, cursor: 'pointer',
            padding: 6, borderRadius: 999, display: 'grid', placeItems: 'center',
          }}>
          <Equis />
        </button>
      </header>

      {unica && registro && (
        <div style={seccion}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Insignia pci={registro.pci} />
            <span style={{ fontSize: 13, color: T.texto2 }}>{km1(unica.km)}</span>
          </div>
          <Dato etiqueta="Rodadura">{RODADURA[registro.tipo]}</Dato>
          <Dato etiqueta="Procedencia">
            {registro.fuente === 'sin'
              ? <span style={{ color: T.texto3 }}>sin declarar</span>
              : <>{registro.fuente}{registro.fecha ? ` · ${fechaCorta(registro.fecha)}` : ''}</>}
          </Dato>
          {unica.ref && <Dato etiqueta="Código">{unica.ref}</Dato>}
          {registro.nota && <Dato etiqueta="Nota">{registro.nota}</Dato>}
        </div>
      )}

      {n > 1 && (
        <div style={{ ...seccion, gap: 6 }}>
          <span style={rotulo}>Reparto</span>
          {filas.slice(0, TOPE_MUNICIPIOS).map(f => (
            <div key={f.nombre} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
              <span style={{ color: T.texto, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.nombre}
              </span>
              <span style={{ color: T.texto2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {nf.format(f.n)} · {km1(f.km)}
              </span>
            </div>
          ))}
          {filas.length > TOPE_MUNICIPIOS && (
            <span style={{ fontSize: 12, color: T.texto3 }}>
              y {filas.length - TOPE_MUNICIPIOS} municipio{filas.length - TOPE_MUNICIPIOS === 1 ? '' : 's'} más
            </span>
          )}
        </div>
      )}

      <div style={seccion}>
        <span style={rotulo}>Evaluación</span>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          {/* Al destildar se limpia la procedencia elegida: el selector queda
              deshabilitado abajo y un valor previo seguiría a la vista como si
              fuera a guardarse, aunque store.set() ya lo descarta. */}
          <input type="checkbox" checked={fijaPci}
            onChange={e => { setFijaPci(e.target.checked); if (!e.target.checked) setFuente('') }} />
          Fijar el PCI de {n === 1 ? 'esta vía' : `las ${nf.format(n)}`}
        </label>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: fijaPci ? 1 : 0.45 }}>
          {/* step=1: la escala ASTM D6433 es de enteros. Un 85,5 caería justo
              en el borde de dos bandas y pciRange() solo entiende enteros. */}
          <input type="range" min={0} max={100} step={1} value={pci} disabled={!fijaPci}
            aria-label="PCI" onChange={e => setPci(+e.target.value)}
            style={{ flex: 1, accentColor: rango ? css3(rango.color) : T.acento }} />
          <Insignia pci={pci} />
        </div>

        <div style={{ display: 'grid', gap: 6, opacity: fijaPci ? 1 : 0.45 }}>
          <span style={{ fontSize: 12, color: T.texto2 }}>
            De dónde sale el número{fijaPci ? ' (obligatorio)' : ''}
          </span>
          {/* Tres botones y no un <select>: la procedencia es la regla que
              sostiene el dato (un PCI estimado presentado como medido es un
              número inventado con cara de rigor), y un desplegable la esconde
              detrás de un clic con "elegir…" como valor por defecto. */}
          <div style={{ display: 'flex', gap: 6 }}>
            {(['medido', 'estimado', 'heredado'] as const).map(f => (
              <button key={f} disabled={!fijaPci} onClick={() => setFuente(f)}
                style={{
                  flex: 1, padding: '7px 4px', fontSize: 13, cursor: fijaPci ? 'pointer' : 'default',
                  borderRadius: T.radioChico, textTransform: 'capitalize',
                  border: `1px solid ${fuente === f ? T.acento : T.lineaFuerte}`,
                  background: fuente === f ? T.acento : T.fondo,
                  color: fuente === f ? '#fff' : T.texto,
                  fontWeight: fuente === f ? 600 : 400,
                }}>
                {f}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 12, color: T.texto3, minHeight: 16 }}>
            {fuente ? FUENTE_QUE_ES[fuente as Exclude<Fuente, 'sin'>] : ''}
          </span>
        </div>

        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: T.texto2 }}>
          Rodadura
          <select value={tipo} onChange={e => setTipo(e.target.value as Tipo | '')}
            style={{ padding: '7px 8px', fontSize: 13, borderRadius: T.radioChico, border: `1px solid ${T.lineaFuerte}`, background: T.fondo, color: T.texto }}>
            <option value="">sin cambiar</option>
            {TIPOS.map(t => <option key={t} value={t}>{RODADURA[t]}</option>)}
          </select>
        </label>

        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: T.texto2 }}>
          Nota
          <input value={nota} onChange={e => setNota(e.target.value)} placeholder="opcional"
            style={{ padding: '7px 8px', fontSize: 13, borderRadius: T.radioChico, border: `1px solid ${T.lineaFuerte}`, background: T.fondo, color: T.texto }} />
        </label>

        <button
          disabled={!puedeGuardar}
          title={
            fijaPci && !fuente ? 'Elige de dónde sale el número antes de guardar'
              : !puedeGuardar ? 'No hay ningún cambio que guardar'
                : ''
          }
          onClick={() => {
            onAplicar({
              ...(fijaPci ? { pci } : {}),
              ...(fuente ? { fuente } : {}),
              ...(tipo ? { tipo } : {}),
              ...(nota ? { nota } : {}),
            })
            setNota('')
          }}
          style={{
            marginTop: 2, padding: '10px 12px', fontSize: 14, fontWeight: 600,
            borderRadius: T.radioChico, border: 'none',
            background: puedeGuardar ? T.acento : T.fondoSuave,
            color: puedeGuardar ? '#fff' : T.texto3,
            cursor: puedeGuardar ? 'pointer' : 'default',
          }}>
          {n === 1 ? 'Guardar en esta vía' : `Guardar en ${nf.format(n)} vías`}
        </button>
      </div>
    </>
  )
}
