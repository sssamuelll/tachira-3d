import type { CSSProperties, ReactNode } from 'react'
import { T } from './theme'
import { Encuadre, Lazo, Archivo, Mas, Menos } from './icons'
import { Camara } from '../foto/Foto'
import type { Escala } from './escala'

const botonera: CSSProperties = {
  position: 'fixed', right: 12, bottom: 12, zIndex: 20,
  display: 'flex', flexDirection: 'column', gap: 8, fontFamily: T.fuente,
}

function Boton ({ activo, titulo, onClick, estilo, children }: {
  activo?: boolean; titulo: string; onClick: () => void
  /** Para los que van dentro de un grupo, que traen su propia pastilla. */
  estilo?: CSSProperties
  children: ReactNode
}) {
  return (
    <button onClick={onClick} title={titulo} aria-label={titulo} aria-pressed={activo}
      style={{
        width: 40, height: 40, display: 'grid', placeItems: 'center', cursor: 'pointer',
        borderRadius: T.radioChico, border: 'none', boxShadow: T.sombraChica,
        background: activo ? T.acento : T.fondo,
        color: activo ? '#fff' : T.texto2,
        ...estilo,
      }}>
      {children}
    </button>
  )
}

// Los dos botones del zoom no son dos pastillas sueltas sino una partida por
// la mitad: son una sola pregunta ("¿más cerca o más lejos?") y se leen como
// un par. Es la forma que tienen en Maps, y la mano ya la conoce.
const suelto: CSSProperties = { background: 'transparent', boxShadow: 'none', borderRadius: 0 }
const par: CSSProperties = {
  background: T.fondo, borderRadius: T.radioChico, boxShadow: T.sombraChica, overflow: 'hidden',
}

export function MapControls ({ lazo, onLazo, onEncuadrar, onAcercar, onAlejar, onFoto }: {
  lazo: boolean
  onLazo: () => void
  onEncuadrar: () => void
  onAcercar: () => void
  onAlejar: () => void
  onFoto: () => void
}) {
  return (
    <div style={botonera}>
      {/* Arriba del todo y separado del resto: no es una herramienta de
          navegar, es la que produce algo que sale de la aplicación. */}
      <Boton titulo="Foto trazada" onClick={onFoto}><Camara /></Boton>
      <Boton titulo="Encuadrar el estado" onClick={onEncuadrar}><Encuadre /></Boton>
      <Boton titulo={lazo ? 'Salir del lazo' : 'Seleccionar por lazo'} activo={lazo} onClick={onLazo}>
        <Lazo />
      </Boton>
      {/* El zoom, abajo del todo: es lo que más se toca y lo que la mano
          busca sin mirar, así que va donde está el pulgar. */}
      <div style={par}>
        <Boton titulo="Acercar" onClick={onAcercar} estilo={suelto}><Mas /></Boton>
        <div style={{ height: 1, background: T.linea, margin: '0 8px' }} />
        <Boton titulo="Alejar" onClick={onAlejar} estilo={suelto}><Menos /></Boton>
      </div>
    </div>
  )
}

/**
 * A qué distancia estás mirando la superficie, dicho en terreno y no en
 * altura de cámara: cuánto mide de verdad ese trozo de pantalla.
 *
 * Va a la izquierda de la botonera, en la misma pastilla blanca que el resto
 * de la interfaz. Google la deja tenue sobre el mapa porque es un adorno de
 * esquina; acá es un dato de trabajo -- si estás a 50 m o a 2 km cambia lo
 * que puedes decidir sobre una vía -- y por eso tiene fondo, sombra y un
 * número en negrita, del mismo tamaño que el resto de las cifras de la app.
 */
export function BarraEscala ({ escala }: { escala: Escala | null }) {
  if (!escala) return null
  return (
    <div title="Lo que mide ese tramo sobre el terreno, en el punto que estás mirando"
      style={{
        position: 'fixed', right: 64, bottom: 12, zIndex: 20, fontFamily: T.fuente,
        background: T.fondo, borderRadius: T.radioChico, boxShadow: T.sombraChica,
        padding: '5px 10px 7px', display: 'grid', justifyItems: 'center', gap: 3,
        userSelect: 'none',
      }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: T.texto, lineHeight: 1.2 }}>
        {escala.texto}
      </span>
      {/* Una U: la línea que mide, y las dos patas que marcan dónde empieza y
          dónde termina. Sin las patas no se sabe si el ancho llega hasta el
          borde de la pastilla o se queda antes. */}
      <div style={{
        boxSizing: 'border-box', width: escala.px, height: 6,
        borderLeft: `2px solid ${T.texto2}`, borderRight: `2px solid ${T.texto2}`,
        borderBottom: `2px solid ${T.texto2}`,
        // El ancho salta de escalón en escalón; sin esto, la barra parpadea
        // en cada paso del zoom en vez de acompañarlo.
        transition: 'width 140ms ease-out',
      }} />
    </div>
  )
}

/** Estado del archivo en disco, abajo a la izquierda. Es la única señal de si
 * lo que acabas de escribir ya está guardado: el color de una vía cambia al
 * instante en memoria y el disco va detrás, con dos segundos de retardo. */
export function BarraArchivo ({ nombre, estado, pendiente, avisar, onElegir, onReconectar }: {
  nombre: string | null
  estado: 'pendiente' | 'guardando' | 'guardado' | null
  pendiente: string | null
  /** Texto de un problema al cargar el archivo, si lo hubo. */
  avisar: string | null
  onElegir: () => void
  onReconectar: () => void
}) {
  const texto = estado === 'guardando' ? 'guardando' : estado === 'pendiente' ? 'cambios sin guardar' : 'guardado'
  return (
    <div style={{
      position: 'fixed', left: 12, bottom: 12, zIndex: 20, fontFamily: T.fuente,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8,
      maxWidth: T.riel,
    }}>
      {avisar && (
        <div style={{
          background: T.avisoFondo, border: `1px solid ${T.avisoLinea}`, color: T.aviso,
          borderRadius: T.radioChico, padding: '8px 12px', fontSize: 12, lineHeight: 1.45,
          boxShadow: T.sombraChica,
        }}>
          {avisar}
        </div>
      )}
      {pendiente && (
        <button onClick={onReconectar}
          title="El navegador olvidó el permiso de este archivo. Un clic para volver a autorizarlo"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
            background: T.fondo, border: 'none', borderRadius: T.radioChico,
            boxShadow: T.sombraChica, padding: '8px 12px', fontSize: 13,
            color: T.acento, fontFamily: 'inherit', fontWeight: 600,
          }}>
          Reconectar {pendiente}
        </button>
      )}
      <button onClick={onElegir} title={nombre
        ? 'Cambiar el archivo donde se guarda'
        : 'Elegir el pci-tachira.json donde se guarda cada evaluación'}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          background: T.fondo, border: 'none', borderRadius: T.radioChico,
          boxShadow: T.sombraChica, padding: '8px 12px', fontSize: 13,
          color: T.texto, fontFamily: 'inherit',
        }}>
        <span style={{ color: T.texto3, display: 'grid' }}><Archivo size={16} /></span>
        {nombre ?? 'Conectar archivo'}
        {nombre && (
          <span style={{ color: estado === 'guardado' ? T.texto3 : T.aviso, fontSize: 12 }}>· {texto}</span>
        )}
      </button>
    </div>
  )
}
