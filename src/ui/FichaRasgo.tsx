import { T } from './theme'
import type { Capa, Rasgo } from '../data/capas'

/** Cómo se dice cada valor en pantalla. Un booleano en crudo ("true") es
 *  lenguaje de máquina en una ficha que lee un vecino, y lo mismo el guion
 *  bajo de un token de opción ("sin_dato" es el valor de 122 de los 127
 *  hospitales): se cambia por espacio para cualquier texto, sin tocar
 *  `opciones` en el catálogo -- eso es el dato, esto es solo cómo se muestra. */
function texto (valor: unknown): string {
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  if (typeof valor === 'string') return valor.replace(/_/g, ' ')
  return String(valor)
}

/**
 * Lo que se sabe de un rasgo, al hacerle clic.
 *
 * Solo los campos que el rasgo TRAE: uno ausente se omite en vez de salir
 * vacío o como "No". En OSM la mayoría de los centros no dice si tiene
 * emergencias, y "no lo sabemos" no es "no tiene".
 */
export function FichaRasgo ({ capa, rasgo, onCerrar }: {
  capa: Capa
  rasgo: Rasgo
  onCerrar: () => void
}) {
  const p = rasgo.properties
  const nombre = String(p.nombre ?? '') || `Sin nombre · ${capa.nombre}`
  return (
    <div style={{
      background: T.fondo, borderRadius: T.radioChico, boxShadow: T.sombraChica,
      padding: '12px 14px', fontFamily: T.fuente, fontSize: 13, color: T.texto,
      display: 'grid', gap: 8, minWidth: 220,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span aria-hidden style={{
          width: 10, height: 10, borderRadius: 5, background: capa.color, flex: '0 0 auto',
        }} />
        <strong style={{ flex: 1 }}>{nombre}</strong>
        <button onClick={onCerrar} aria-label="Cerrar"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: T.texto3 }}>
          ×
        </button>
      </div>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px' }}>
        {capa.campos
          .filter(c => c.clave !== 'nombre' && p[c.clave] !== undefined)
          .map(c => (
            <div key={c.clave} style={{ display: 'contents' }}>
              <dt style={{ color: T.texto3 }}>{c.nombre}</dt>
              <dd style={{ margin: 0 }}>{texto(p[c.clave])}</dd>
            </div>
          ))}
        <dt style={{ color: T.texto3 }}>Origen</dt>
        <dd style={{ margin: 0 }}>
          {p.origen === 'osm'
            ? <a href={`https://www.openstreetmap.org/${p.osmId}`} target="_blank" rel="noreferrer"
                style={{ color: T.acento }}>OpenStreetMap</a>
            : 'la comunidad'}
        </dd>
      </dl>
    </div>
  )
}
