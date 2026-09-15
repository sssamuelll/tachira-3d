import type { CSSProperties, ReactNode } from 'react'
import { T } from './theme'
import { Encuadre, Lazo, Archivo, Foto, Lluvia, Mas, Menos, Tema } from './icons'
import { Camara } from '../foto/Foto'
import type { Escala } from './escala'
import { PanelCapas, type Fila } from './PanelCapas'

const botonera: CSSProperties = {
  position: 'fixed', right: 12, bottom: 12, zIndex: 20,
  display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
  fontFamily: T.fuente,
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
        color: activo ? T.sobreAcento : T.texto2,
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

export function MapControls ({
  capas, visibles, onCapa,
  lazo, onLazo, imagen, onImagen, oscuro, onTema, lluvia, onLluvia, onEncuadrar, onAcercar, onAlejar, onFoto,
}: {
  capas: readonly Fila[]
  visibles: Set<string>
  onCapa: (id: string) => void
  lazo: boolean
  onLazo: () => void
  imagen: boolean
  onImagen: () => void
  oscuro: boolean
  onTema: () => void
  lluvia: boolean
  onLluvia: () => void
  onEncuadrar: () => void
  onAcercar: () => void
  onAlejar: () => void
  onFoto: () => void
}) {
  return (
    <div style={botonera}>
      {/* Las capas arriba del todo: dicen QUÉ se está mirando, y eso se
          decide antes que cómo se navega. Alineadas a la derecha con el resto
          de la columna, que ya es donde la mano busca los controles. */}
      <PanelCapas disponibles={capas} visibles={visibles} onAlternar={onCapa} />
      {/* Arriba del todo y separado del resto: no es una herramienta de
          navegar, es la que produce algo que sale de la aplicación. */}
      <Boton titulo="Foto trazada" onClick={onFoto}><Camara /></Boton>
      {/* El título no cambia con el estado, a diferencia del lazo: el botón no
          entra en un modo del que haya que salir, prende y apaga una capa, y
          aria-pressed ya dice cuál de las dos. */}
      <Boton titulo="Imagen satelital" activo={imagen} onClick={onImagen}><Foto /></Boton>
      {/* Mismo patrón: prende y apaga, así que el título no cambia y
          aria-pressed dice cuál de las dos. El icono sí cambia -- sol o
          luna -- porque acá lo que se representa es justo el estado. */}
      <Boton titulo="Tema oscuro" activo={oscuro} onClick={onTema}><Tema oscuro={oscuro} /></Boton>
      {/* Moja la calzada. Mismo patrón que el satelital: prende y apaga una
          capa, así que el título no cambia y aria-pressed dice cuál de las
          dos. Un pavimento mojado enseña su estado mejor que uno seco -- los
          charcos caen en las huellas de rodadura y en los baches -- así que
          esto no es un adorno de clima, es otra manera de leer el PCI. */}
      <Boton titulo="Lluvia" activo={lluvia} onClick={onLluvia}><Lluvia /></Boton>
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

/** Los créditos de las fuentes de datos, abajo y al centro.
 *
 * La línea de OSM es PERMANENTE: ODbL exige atribuir siempre que se muestren
 * sus datos, y las vías, los edificios y los municipios se ven con la imagen
 * apagada. La de Esri solo aparece cuando su imagen está en pantalla, que es
 * cuando aplica. */
export function Atribucion ({ imagen }: { imagen: boolean }) {
  return (
    <div style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 12, zIndex: 20,
      fontFamily: T.fuente, fontSize: 11, lineHeight: 1.3, color: T.texto2,
      background: 'rgba(255,255,255,.72)', borderRadius: 4, padding: '3px 8px',
      pointerEvents: 'none', userSelect: 'none', textAlign: 'center',
      // Sin recorte: ODbL exige el crédito y uno cortado no cumple. En una
      // pantalla angosta la línea se parte en dos, que es feo pero legal.
      maxWidth: '90vw',
    }}>
      © colaboradores de OpenStreetMap (ODbL) · Terreno: Terrarium / AWS Open Data
      {imagen && ' · Imagen: Esri, Maxar, Earthstar Geographics y la comunidad de usuarios de GIS'}
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
