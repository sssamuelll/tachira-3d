import * as THREE from 'three'
import { WebGLPathTracer, GradientEquirectTexture } from 'three-gpu-pathtracer'
import { construirEscena, CIELO_INTENSIDAD, type Recuento } from './escena'

// El trazador de rayos, aislado en su propio módulo para que la aplicación no
// lo cargue nunca hasta que alguien pulse "Foto": three-gpu-pathtracer y
// three-mesh-bvh son ~400 kB de JavaScript y un shader monolítico que tarda
// segundos en compilar. Foto.tsx lo trae con un import() dinámico, así que
// todo esto (y foto/escena.ts con él) vive en un chunk aparte.
//
// Corre en un WebGLRenderer PROPIO, fuera de pantalla, no en el de la
// aplicación. Tres razones, en orden de peso:
//
//  1. El trazador pisa el estado del renderer (render targets, scissor,
//     viewport, autoClear) muchas veces por cuadro. Compartirlo con r3f es
//     pedir un mapa que parpadea.
//  2. La foto puede tener otra resolución que la ventana.
//  3. Si algo revienta a mitad de un trazado -- memoria, contexto perdido --
//     se pierde la foto, no la sesión de trabajo del usuario.
//
// El precio es que la geometría se sube dos veces a la GPU (una por contexto).
// Medido: el pico de memoria de vídeo de una vista de estado no llega a
// duplicarse porque la escena temporal es bastante más chica que la de
// pantalla (un solo pase de vías, sin contorno, sin la mitad de los niveles).

/** Cómo va la foto. `progreso` es 0..1 dentro de la fase que sea. */
export interface Avance {
  fase: 'armando' | 'compilando' | 'trazando'
  muestras: number
  objetivo: number
  progreso: number
  recuento: Recuento | null
}

export interface Foto {
  blob: Blob
  ancho: number
  alto: number
  /** Milisegundos desde el clic hasta la última muestra. */
  ms: number
  recuento: Recuento
}

// Cielo como fuente de luz: un gradiente equirectangular, cenit arriba y una
// banda cálida abajo que hace de rebote del suelo. NO es la atmósfera de
// Bruneton que dibuja <Sky> -- esa vive en un efecto de post-proceso sobre el
// framebuffer y no existe como textura que se pueda muestrear. La diferencia
// se ve en el fondo (un degradado limpio en vez de un horizonte con dispersión
// de Mie) y no se ve en la iluminación, que es lo que importa: lo que aporta
// el cielo a una escena a mediodía es luz azul difusa desde arriba, y eso es
// exactamente lo que da este gradiente.
//
// El sol NO va en el cielo: es el DirectionalLight de escena.ts. Ponerlo
// también acá lo contaría dos veces.
const CIELO_ARRIBA = 0x5f8fc9
const CIELO_ABAJO = 0xd8cbb4

function cielo (): GradientEquirectTexture {
  const t = new GradientEquirectTexture(256)
  t.topColor.set(CIELO_ARRIBA)
  t.bottomColor.set(CIELO_ABAJO)
  // Por debajo de 1 el azul del cenit baja demasiado sobre el horizonte y la
  // escena entera se tiñe. Calibrable.
  t.exponent = 1.6
  t.update()
  return t
}

// Cuántos rebotes sigue cada rayo. 1 sería sol directo y sombras negras; 3 ya
// mete el rebote del monte en la calzada, que es la mitad de por qué esto se
// ve mejor que el mapa. Cada rebote de más cuesta linealmente. Calibrable.
const REBOTES = 4

// El lado mayor de la foto, en píxeles. El lienzo ya viene multiplicado por el
// devicePixelRatio (en una pantalla 2× esto ya ES la foto a 2×), y el trazador
// guarda varios render targets flotantes del tamaño de la imagen: a 4K son
// ~250 MB solo de destinos. Calibrable, con el ojo puesto en la memoria de
// vídeo.
const LADO_MAX = 2880

// Cuánto tiempo se le deja al trazador entre respiro y respiro. Con muestras
// por teselas de 3×3 (el reparto por defecto del PathTracingRenderer), una
// llamada a renderSample() dibuja UNA tesela: a un cuadro de pantalla por
// llamada harían falta 1.800 cuadros para 200 muestras, medio minuto de puro
// vsync. Así que se apura dentro de un presupuesto de tiempo y se devuelve el
// hilo cada 200 ms, que es lo que hace falta para que el botón de cancelar
// responda como un botón.
const PRESUPUESTO_MS = 200

const espera = () => new Promise<void>(r => requestAnimationFrame(() => r()))

/**
 * Traza la vista actual y devuelve un PNG. `null` si se canceló.
 *
 * `vista` y `camera` son los de la aplicación: se leen en el momento de la
 * llamada y no se vuelven a mirar. Mover la cámara mientras traza no cambia la
 * foto -- por eso la interfaz cubre la pantalla mientras tanto (Foto.tsx).
 */
export async function trazar ({ vista, camera, lienzo, date, muestras, onAvance, cancelado }: {
  vista: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** El lienzo de la aplicación: de él salen la resolución y el aspecto. */
  lienzo: HTMLCanvasElement
  date: Date
  muestras: number
  onAvance: (a: Avance) => void
  cancelado: () => boolean
}): Promise<Foto | null> {
  const t0 = performance.now()
  const escala = Math.min(1, LADO_MAX / Math.max(lienzo.width, lienzo.height))
  const ancho = Math.max(1, Math.round(lienzo.width * escala))
  const alto = Math.max(1, Math.round(lienzo.height * escala))

  onAvance({ fase: 'armando', muestras: 0, objetivo: muestras, progreso: 0, recuento: null })
  // Un respiro antes de la parte que bloquea: sin esto el panel de progreso no
  // llega a pintarse y la aplicación parece colgada desde el primer clic.
  await espera()

  const { escena, recuento } = construirEscena(vista, camera, lienzo.height, date)
  escena.environment = cielo()
  escena.background = escena.environment
  escena.environmentIntensity = CIELO_INTENSIDAD

  // preserveDrawingBuffer porque el PNG se lee del lienzo DESPUÉS del último
  // renderSample(), ya en otro turno del bucle de eventos: sin esto el
  // navegador puede haber vaciado el buffer y la foto sale en negro.
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })
  renderer.setSize(ancho, alto, false)
  // El mismo mapeo de tonos que la escena de pantalla (Sky.tsx). El material
  // de salida del trazador aplica toneMapping() del renderer antes de escribir
  // al lienzo, así que basta con pedirlo acá.
  renderer.toneMapping = THREE.AgXToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const cam = camera.clone() as THREE.PerspectiveCamera
  cam.aspect = ancho / alto
  cam.updateProjectionMatrix()
  cam.updateMatrixWorld(true)

  const trazador = new WebGLPathTracer(renderer)
  trazador.bounces = REBOTES
  trazador.renderDelay = 0
  trazador.minSamples = 1
  trazador.fadeDuration = 0
  trazador.dynamicLowRes = false
  // No hay a qué caer: la escena temporal no tiene materiales rasterizables
  // que se parezcan a lo que va a salir, y el usuario ya tiene el mapa normal
  // debajo del panel.
  trazador.rasterizeScene = false
  // Suaviza los reflejos muy especulares para que no salgan puntos blancos
  // sueltos que 200 muestras no alcanzan a promediar. Calibrable.
  trazador.filterGlossyFactor = 0.25

  let foto: Foto | null = null
  try {
    onAvance({ fase: 'armando', muestras: 0, objetivo: muestras, progreso: 0, recuento })
    await trazador.setSceneAsync(escena, cam, {
      onProgress: p => onAvance({ fase: 'armando', muestras: 0, objetivo: muestras, progreso: p, recuento }),
    })
    if (cancelado()) return null

    onAvance({ fase: 'compilando', muestras: 0, objetivo: muestras, progreso: 0, recuento })
    while (!cancelado() && trazador.samples < muestras) {
      const inicio = performance.now()
      do {
        trazador.renderSample()
      } while (trazador.samples < muestras && performance.now() - inicio < PRESUPUESTO_MS)
      onAvance({
        fase: 'trazando',
        muestras: Math.floor(trazador.samples),
        objetivo: muestras,
        progreso: trazador.samples / muestras,
        recuento,
      })
      await espera()
    }
    if (cancelado()) return null

    const blob = await new Promise<Blob | null>(r => renderer.domElement.toBlob(r, 'image/png'))
    if (!blob) throw new Error('el lienzo no devolvió un PNG')
    foto = { blob, ancho, alto, ms: performance.now() - t0, recuento }
  } finally {
    trazador.dispose()
    // Nada de recorrer la escena llamando a dispose(): las mallas del relieve
    // COMPARTEN los BufferAttribute con las que están dibujando en pantalla
    // (escena.ts no los copia, para no duplicar un millón de vértices), y
    // aunque three lleva las memorias de GPU por renderer, tirar del hilo por
    // ahí es la clase de cosa que deja el mapa en blanco sin un solo error.
    // Perder el contexto libera de golpe todo lo que este renderer subió, que
    // es lo único que hay que liberar.
    renderer.forceContextLoss()
    renderer.dispose()
  }
  return foto
}

/** Descarga la foto como `foto-<fecha>.png`. */
export function descargar (foto: Foto): void {
  const ahora = new Date()
  const dosDigitos = (n: number) => String(n).padStart(2, '0')
  const sello = [
    ahora.getFullYear(), dosDigitos(ahora.getMonth() + 1), dosDigitos(ahora.getDate()),
  ].join('-') + '-' + [dosDigitos(ahora.getHours()), dosDigitos(ahora.getMinutes())].join('')
  const url = URL.createObjectURL(foto.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `foto-${sello}.png`
  a.click()
  // El objeto URL se libera en el siguiente turno, no ahora: revocarlo en la
  // misma vuelta que el click() cancela la descarga en Chrome.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
