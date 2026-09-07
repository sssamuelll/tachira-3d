import * as THREE from 'three'
import type { Nodo } from './quadtree'

/**
 * La foto satelital que se cuelga de cada nodo del relieve. Un nodo del
 * quadtree ES una tesela (z, x, y) de Web Mercator, así que le toca la tesela
 * de imagen del MISMO z/x/y: no hay reproyección, ni bordes, ni un atlas.
 *
 * De dónde sale cada nivel:
 *  - z8 a z12: del horneado propio (public/data/img, scripts/bake-img.mjs).
 *    217 teselas, 3 MB. La vista de estado y la de municipio se dibujan sin
 *    red.
 *  - z13 a z17: de Esri al vuelo. Son decenas de miles de teselas para el
 *    estado entero y solo se miran unas pocas por sesión, así que hornearlas
 *    no tiene sentido.
 *
 * Sin red, la petición en vivo falla y el nodo cae a la tesela del ancestro
 * horneado (ancestroCargado): borroso, pero nunca un hueco gris. Sin horneado
 * tampoco, el material apaga la imagen y queda la hipsometría de siempre.
 */

// Hasta acá llega el horneado; de aquí para arriba se pide en vivo.
export const Z_HORNEADO = 12

// Nivel más fino que se pide. Esri sirve San Cristóbal hasta z18, pero z17 ya
// da 0,30 m por texel y es donde TerrainLod corta el quadtree.
export const Z_MAX_IMG = 17

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'

// Intentos antes de dar por perdida una tesela para el resto de la sesión.
const INTENTOS = 2

/** Esri sirve /tile/{z}/{fila}/{columna}: la y ANTES que la x, al revés que
 *  la ruta {z}/{x}/{y} de nuestras teselas. Invertirlo no da 404, da una
 *  tesela de otro sitio del planeta. */
export const urlImagen = (z: number, x: number, y: number): string =>
  z <= Z_HORNEADO ? `/data/img/${z}/${x}/${y}.jpg` : `${ESRI}/${z}/${y}/${x}`

export interface Ventana {
  z: number; x: number; y: number
  /** Dónde cae el nodo dentro de esa tesela: uv · esc + (ox, oy). */
  ox: number; oy: number; esc: number
}

/**
 * La tesela cargada que le sirve al nodo: la suya si está, y si no la del
 * ancestro más cercano que sí, con el trozo que le toca.
 *
 * Es lo que evita el parpadeo gris al refinar: mientras la tesela z17 viaja,
 * el nodo dibuja el cuarto de la z16 que ya tenía, o el 1/512 de la z8. Como
 * el padre siempre se cargó antes que el hijo (el quadtree no baja sin datos),
 * en la práctica siempre hay alguna.
 */
export function ancestroCargado (n: Nodo, tiene: (z: number, x: number, y: number) => boolean): Ventana | null {
  for (let z = n.z; z >= 8; z--) {
    const d = n.z - z
    const x = n.x >> d, y = n.y >> d
    if (!tiene(z, x, y)) continue
    const esc = 1 / 2 ** d
    return { z, x, y, ox: (n.x & ((1 << d) - 1)) * esc, oy: (n.y & ((1 << d) - 1)) * esc, esc }
  }
  return null
}

/**
 * Caché de texturas con LRU y una petición en vuelo por clave, el mismo patrón
 * de CacheTeselas (demTiles.ts). La diferencia es que acá lo que se guarda es
 * una THREE.Texture viva: cada una ocupa 256×256×4 más mipmaps, ~350 KB, así
 * que el tope es bastante más bajo que el de las teselas del DEM y hay que
 * llamar a dispose() al desalojar (si no, la memoria de la GPU no se suelta).
 */
export class CacheImagenes {
  private readonly texturas = new Map<string, THREE.Texture>()
  private readonly enVuelo = new Set<string>()
  // Cuántas veces falló cada tesela. A los INTENTOS fallos se deja de pedir en
  // toda la sesión: sin red, el ancestro horneado ya la cubre, y reintentar en
  // cada cuadro serían cientos de peticiones por segundo contra Esri. Dos
  // intentos y no uno porque el primer fallo suele ser el propio atasco de la
  // ráfaga inicial, no que la tesela no exista. ponytail: sin reintento
  // diferido; si molesta que una caída de un segundo deje un nodo borroso toda
  // la sesión, guardar el instante del fallo y reintentar pasado un minuto.
  private readonly fallos = new Map<string, number>()

  constructor (
    private readonly max = 300,
    private readonly anisotropia = 8,
    /**
     * Peticiones a la vez. No es cortesía con Esri, es lo que hace que esto
     * funcione: TerrainLod pide la tesela de cada nodo visible en CADA cuadro,
     * y al refinar de golpe (una vuelta de zoom sobre la ciudad) eso son
     * cientos de nodos nuevos a la vez. Sin tope, Chrome contesta
     * ERR_INSUFFICIENT_RESOURCES a casi todas -- medido: 16 fps y la mitad de
     * las teselas marcadas como fallidas -- y encima las 300 texturas que sí
     * llegan se suben a la GPU en el mismo cuadro. Con el tope, lo que no cupo
     * se vuelve a pedir en el cuadro siguiente: la cola es el propio bucle de
     * render, sin estructura que mantener.
     */
    private readonly enVueloMax = 8,
  ) {}

  private clave = (z: number, x: number, y: number) => `${z}/${x}/${y}`

  tiene = (z: number, x: number, y: number): boolean => this.texturas.has(this.clave(z, x, y))

  get (z: number, x: number, y: number): THREE.Texture | undefined {
    const k = this.clave(z, x, y)
    const t = this.texturas.get(k)
    if (t) { this.texturas.delete(k); this.texturas.set(k, t) }   // al final: recién usada
    return t
  }

  /** La textura que le toca al nodo y dónde muestrearla. Marca la tesela como
   *  recién usada para que la LRU no la desaloje mientras se está viendo. */
  mejor (n: Nodo): { tex: THREE.Texture; ox: number; oy: number; esc: number } | null {
    const v = ancestroCargado(n, this.tiene)
    if (!v) return null
    return { tex: this.get(v.z, v.x, v.y)!, ox: v.ox, oy: v.oy, esc: v.esc }
  }

  pedir (z: number, x: number, y: number): void {
    if (z > Z_MAX_IMG || this.enVuelo.size >= this.enVueloMax) return
    const k = this.clave(z, x, y)
    if (this.texturas.has(k) || this.enVuelo.has(k) || (this.fallos.get(k) ?? 0) >= INTENTOS) return
    this.enVuelo.add(k)
    fetch(urlImagen(z, x, y))
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then(b => createImageBitmap(b))
      .then(bmp => {
        const tex = new THREE.Texture(bmp as unknown as HTMLImageElement)
        // colorSpace sRGB no es cosmético: hace que el renderer suba el JPEG
        // con formato interno SRGB8_ALPHA8 y la GPU lo linealice al muestrear.
        // Sin esto la foto entra al shader con valores de sRGB tratados como
        // lineales y sale lavada, con las sombras muy claras.
        tex.colorSpace = THREE.SRGBColorSpace
        // flipY = false: la fila 0 del JPEG es el norte de la tesela, y
        // uvImagen (nodoTerreno.ts) tiene v = 0 en el norte. La misma
        // convención de uvMascara.
        tex.flipY = false
        tex.generateMipmaps = true
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.magFilter = THREE.LinearFilter
        // Sin esto, una tesela vista en rasante (que es como se ve el relieve
        // casi siempre) se convierte en una franja borrosa: el mip que elige
        // la GPU lo manda el eje más comprimido.
        tex.anisotropy = this.anisotropia
        // El borde: la tesela vecina continúa la foto, pero cada nodo dibuja
        // solo la suya. Con REPEAT (el defecto) el filtro del borde trae el
        // píxel del lado opuesto y aparece una costura de un texel.
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
        tex.needsUpdate = true
        this.texturas.set(k, tex)
        while (this.texturas.size > this.max) {
          const vieja = this.texturas.keys().next().value!
          this.texturas.get(vieja)!.dispose()
          this.texturas.delete(vieja)
        }
      })
      .catch(e => {
        const n = (this.fallos.get(k) ?? 0) + 1
        this.fallos.set(k, n)
        if (n >= INTENTOS) console.warn(`imagen ${k}: ${e}`)
      })
      .finally(() => this.enVuelo.delete(k))
  }

  dispose (): void {
    for (const t of this.texturas.values()) t.dispose()
    this.texturas.clear()
  }
}
