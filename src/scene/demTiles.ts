// Teselas del DEM (public/data/dem/{z}/{x}/{y}.png, scripts/lib/dem-tiles.mjs):
// 257×257 píxeles, RGB Terrarium, alpha 255 = dentro del estado.

export const LADO = 257

export interface Tesela { alturas: Float32Array; dentro: Uint8Array; min: number; max: number }

/** Terrarium: h = r·256 + g + b/256 − 32768. Alpha 255 = dentro del estado;
 *  el pipeline escribe 254 fuera y nunca 0, porque el canvas premultiplica por
 *  alpha y con 0 destruye el RGB. */
export function decodificar (rgba: Uint8ClampedArray | Uint8Array): Tesela {
  const n = LADO * LADO
  const alturas = new Float32Array(n)
  const dentro = new Uint8Array(n)
  let min = Infinity, max = -Infinity
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const h = rgba[o] * 256 + rgba[o + 1] + rgba[o + 2] / 256 - 32768
    alturas[i] = h
    dentro[i] = rgba[o + 3] === 255 ? 1 : 0
    if (h < min) min = h
    if (h > max) max = h
  }
  return { alturas, dentro, min, max }
}

/** Carga perezosa con LRU. Una petición en vuelo por clave; un fallo de red
 *  se olvida para poder reintentar en el siguiente cuadro que la pida. */
export class CacheTeselas {
  private readonly teselas = new Map<string, Tesela>()
  private readonly enVuelo = new Set<string>()

  constructor (private readonly base = '/data/dem', private readonly max = 400) {}

  get (z: number, x: number, y: number): Tesela | undefined {
    const k = `${z}/${x}/${y}`
    const t = this.teselas.get(k)
    if (t) { this.teselas.delete(k); this.teselas.set(k, t) }   // al final: recién usada
    return t
  }

  pedir (z: number, x: number, y: number): void {
    const k = `${z}/${x}/${y}`
    if (this.teselas.has(k) || this.enVuelo.has(k)) return
    this.enVuelo.add(k)
    fetch(`${this.base}/${k}.png`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob() })
      .then(b => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then(bmp => {
        const cv = new OffscreenCanvas(LADO, LADO)
        const ctx = cv.getContext('2d', { willReadFrequently: true })!
        ctx.drawImage(bmp, 0, 0)
        bmp.close()
        this.teselas.set(k, decodificar(ctx.getImageData(0, 0, LADO, LADO).data))
        while (this.teselas.size > this.max) this.teselas.delete(this.teselas.keys().next().value!)
      })
      .catch(e => console.warn(`tesela ${k}:`, e))
      .finally(() => this.enVuelo.delete(k))
  }
}
