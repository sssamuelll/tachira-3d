import { useEffect, useRef, type RefObject } from 'react'
import type * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { T } from '../ui/theme'
import type { Recuento } from './escena'

// La foto trazada, en dos mitades que no comparten padre en el árbol de React:
// <Foto> vive DENTRO del <Canvas> (necesita scene/camera/gl de useThree) y
// <PanelFoto> vive fuera, en el DOM. El puente entre las dos es un ref que
// sostiene App, igual que el de <Vista> con la barra de escala y el minimapa.
//
// Lo pesado -- el trazador y la escena temporal -- no se importa acá: entra por
// un import() dinámico en el momento del clic (ver `tomar`), así que el mapa
// arranca sin pagar los ~400 kB de three-gpu-pathtracer.

/** Cuántas muestras por píxel. 200 es donde el ruido de una escena a plena luz
 *  deja de leerse como grano y empieza a leerse como textura del monte; de ahí
 *  para arriba la mejora se paga en minutos. Calibrable. */
export const MUESTRAS = 200

export interface EstadoFoto {
  fase: 'armando' | 'compilando' | 'trazando' | 'error'
  muestras: number
  objetivo: number
  /** 0..1 dentro de la fase. */
  progreso: number
  recuento: Recuento | null
  mensaje?: string
}

export interface ApiFoto {
  tomar: () => void
  cancelar: () => void
}

/** Cámara: el cuerpo, el visor y la joroba del disparador. */
export const Camara = (p: { size?: number }) => (
  <svg width={p.size ?? 20} height={p.size ?? 20} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 8.5A1.5 1.5 0 014.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0121 8.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 17.5z" />
    <circle cx="12" cy="13" r="3.6" />
  </svg>
)

export function Foto ({ api, date, onEstado }: {
  api: RefObject<ApiFoto | null>
  /** La misma fecha que le da el sol al cielo de la escena (App.tsx). */
  date: Date
  onEstado: (e: EstadoFoto | null) => void
}) {
  const { scene, camera, gl } = useThree()
  const cancelado = useRef(false)
  const ocupado = useRef(false)

  useEffect(() => {
    api.current = {
      cancelar: () => { cancelado.current = true },
      tomar: async () => {
        // Un segundo clic mientras traza no arranca una segunda foto: son dos
        // contextos WebGL con la escena entera cada uno.
        if (ocupado.current) return
        ocupado.current = true
        cancelado.current = false
        try {
          const { trazar, descargar } = await import('./trazador')
          const foto = await trazar({
            vista: scene,
            camera: camera as THREE.PerspectiveCamera,
            lienzo: gl.domElement,
            date,
            muestras: MUESTRAS,
            onAvance: a => onEstado({ ...a }),
            cancelado: () => cancelado.current,
          })
          onEstado(null)
          if (foto) {
            // Los tiempos van al log a propósito: son el número que se compara
            // entre vistas cuando alguien dice que "la foto tarda mucho".
            console.log(
              `foto trazada: ${MUESTRAS} muestras en ${(foto.ms / 1000).toFixed(1)} s, ` +
              `${foto.ancho}×${foto.alto} px, ${foto.recuento.nodos} nodos de relieve ` +
              `(${foto.recuento.trianguloRelieve.toLocaleString('es-VE')} triángulos), ` +
              `${foto.recuento.tramos.toLocaleString('es-VE')} tramos de vía`)
            descargar(foto)
          }
        } catch (e) {
          console.error('no se pudo trazar la foto', e)
          onEstado({
            fase: 'error', muestras: 0, objetivo: MUESTRAS, progreso: 0, recuento: null,
            mensaje: (e as Error)?.message ?? String(e),
          })
        } finally {
          ocupado.current = false
        }
      },
    }
  }, [api, scene, camera, gl, date, onEstado])

  return null
}

const TEXTO: Record<EstadoFoto['fase'], string> = {
  armando: 'Armando la escena',
  compilando: 'Compilando el trazador',
  trazando: 'Trazando',
  error: 'No se pudo trazar la foto',
}

/**
 * El panel de progreso, encima de todo y cubriendo la pantalla.
 *
 * Cubrir no es decoración: la foto se traza contra la cámara del instante del
 * clic, así que orbitar mientras tanto cambiaría el mapa de abajo y no la
 * foto. El mapa se sigue dibujando debajo (r3f no para su bucle) para que se
 * vea QUÉ se está fotografiando; lo que se bloquea es tocarlo.
 */
export function PanelFoto ({ estado, onCancelar }: {
  estado: EstadoFoto | null
  onCancelar: () => void
}) {
  if (!estado) return null
  const error = estado.fase === 'error'
  const pct = estado.fase === 'trazando'
    ? estado.progreso
    : estado.fase === 'armando' ? estado.progreso * 0.5 : 0.5
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 40, display: 'grid', placeItems: 'center',
      background: 'rgba(31,33,36,.28)', fontFamily: T.fuente,
    }}>
      <div style={{
        background: T.fondo, borderRadius: T.radio, boxShadow: T.sombra,
        padding: '20px 24px', minWidth: 320, display: 'grid', gap: 12,
      }}>
        <strong style={{ fontSize: 15, fontWeight: 600, color: error ? T.aviso : T.texto }}>
          {TEXTO[estado.fase]}
        </strong>

        {error
          ? <span style={{ fontSize: 13, color: T.texto2, maxWidth: 340, lineHeight: 1.45 }}>{estado.mensaje}</span>
          : (
            <>
              <div style={{ height: 6, borderRadius: 3, background: T.fondoSuave, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.round(Math.min(1, pct) * 100)}%`, height: '100%',
                  background: T.acento, transition: 'width 180ms linear',
                }} />
              </div>
              <span style={{ fontSize: 13, color: T.texto2 }}>
                {estado.fase === 'trazando'
                  ? `${estado.muestras} de ${estado.objetivo} muestras`
                  : 'Un momento: el relieve y las vías se rehacen como mallas.'}
              </span>
              {estado.recuento && (
                <span style={{ fontSize: 12, color: T.texto3 }}>
                  {estado.recuento.nodos} nodos de relieve · {estado.recuento.tramos.toLocaleString('es-VE')} tramos
                </span>
              )}
            </>
          )}

        <button onClick={onCancelar} style={{
          justifySelf: 'end', cursor: 'pointer', border: 'none', borderRadius: T.radioChico,
          background: T.fondoSuave, color: T.texto, fontFamily: 'inherit', fontSize: 13,
          padding: '7px 14px',
        }}>
          {error ? 'Cerrar' : 'Cancelar'}
        </button>
      </div>
    </div>
  )
}
