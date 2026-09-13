// Teselas del DEM (public/data/dem/{z}/{x}/{y}.png, scripts/lib/dem-tiles.mjs):
// 257×257 píxeles, RGB Terrarium, alpha 255 = dentro del estado.

import { urlGenerado } from '../data/rutas'

export const LADO = 257

export interface Tesela { alturas: Float32Array; dentro: Uint8Array; min: number; max: number }

/**
 * Los bytes RGBA de una tesela, sacados del PNG acá mismo: sin createImageBitmap,
 * sin canvas, sin getImageData.
 *
 * Por qué no el canvas: los navegadores con protección anti-huella (Brave con
 * sus Shields de fábrica, por ejemplo) ALTERAN a propósito los píxeles que
 * devuelve getImageData -- un bit en ~70 píxeles por tesela, en cualquier canal.
 * En una foto no se nota; en Terrarium el canal R vale 256 m, así que cada bit
 * cambiado es una aguja o un cráter de ±256 m con la textura estirada encima.
 * Medido el 2026-09-13 en Brave: 271 de 287 nodos visibles con vértices a ±256 m
 * del PNG; en Chrome, 0. El dato nunca tuvo la culpa.
 *
 * Solo lo que hornea dem-tiles.mjs: RGBA de 8 bits, sin entrelazar, de
 * `lado`×`lado`. Cualquier otra cosa revienta a propósito (el área sola no
 * basta: 66049×1 tiene los mismos píxeles que 257×257). No se comprueban los
 * CRC: un archivo corrupto cae por el tamaño o por el inflado.
 */
export async function pixelesDelPng (png: ArrayBuffer, lado = LADO): Promise<Uint8Array> {
  const b = new Uint8Array(png), v = new DataView(png)
  const FIRMA = [137, 80, 78, 71, 13, 10, 26, 10]
  if (b.length < 8 || FIRMA.some((f, i) => b[i] !== f)) throw new Error('no es un PNG')
  let ancho = 0, alto = 0, fin = false
  const idat: Uint8Array<ArrayBuffer>[] = []
  for (let p = 8; p + 8 <= b.length;) {
    const n = v.getUint32(p)
    if (p + 12 + n > b.length) throw new Error('PNG truncado')
    const tipo = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7])
    if (tipo === 'IHDR') {
      ancho = v.getUint32(p + 8); alto = v.getUint32(p + 12)
      if (b[p + 16] !== 8 || b[p + 17] !== 6 || b[p + 18] !== 0 || b[p + 19] !== 0 || b[p + 20] !== 0) {
        throw new Error('se esperaba un PNG RGBA de 8 bits sin entrelazar')
      }
      if (ancho !== lado || alto !== lado) throw new Error(`tesela de ${ancho}×${alto}, se esperaba ${lado}×${lado}`)
    } else if (tipo === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + n))
    else if (tipo === 'IEND') { fin = true; break }
    p += n + 12
  }
  if (!fin) throw new Error('PNG sin IEND')
  const crudo = new Uint8Array(await new Response(
    new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate')),
  ).arrayBuffer())
  const paso = ancho * 4
  if (crudo.length !== (paso + 1) * alto) throw new Error('PNG truncado')
  const out = new Uint8Array(ancho * alto * 4)
  let q = 0
  for (let y = 0; y < alto; y++) {
    const filtro = crudo[q++]
    if (filtro > 4) throw new Error(`filtro PNG desconocido: ${filtro}`)
    const fila = y * paso
    for (let x = 0; x < paso; x++) {
      const i = fila + x
      const izq = x >= 4 ? out[i - 4] : 0
      const arr = y > 0 ? out[i - paso] : 0
      const diag = x >= 4 && y > 0 ? out[i - paso - 4] : 0
      let pred = 0
      if (filtro === 1) pred = izq
      else if (filtro === 2) pred = arr
      else if (filtro === 3) pred = (izq + arr) >> 1
      else if (filtro === 4) {
        const p = izq + arr - diag
        const pa = Math.abs(p - izq), pb = Math.abs(p - arr), pc = Math.abs(p - diag)
        pred = pa <= pb && pa <= pc ? izq : pb <= pc ? arr : diag
      }
      out[i] = (crudo[q++] + pred) & 255
    }
  }
  return out
}

/** Terrarium: h = r·256 + g + b/256 − 32768. Alpha 255 = dentro del estado;
 *  el pipeline escribe 254 fuera y nunca 0 (viene de cuando esto pasaba por un
 *  canvas, que premultiplica por alpha y con 0 destruye el RGB). */
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

  constructor (private readonly base = urlGenerado('dem'), private readonly max = 400) {}

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
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer() })
      .then(png => pixelesDelPng(png, LADO))
      .then(rgba => {
        this.teselas.set(k, decodificar(rgba))
        while (this.teselas.size > this.max) this.teselas.delete(this.teselas.keys().next().value!)
      })
      .catch(e => console.warn(`tesela ${k}:`, e))
      .finally(() => this.enVuelo.delete(k))
  }
}
