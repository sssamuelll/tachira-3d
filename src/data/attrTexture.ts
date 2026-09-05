import * as THREE from 'three'
import { ATTR_SIZE, FUENTES } from './constants'
import type { Registro } from './types'
import type { AttrStore } from './store'

// El color de una vía no vive en el buffer de geometría: vive en esta textura
// RGBA de ATTR_SIZE² texels, uno por índice de vía, que el shader indexa por
// id. Repintar miles de tramos es entonces escribir texels y subir una
// textura chica — el equivalente hecho a mano del setFeatureState de MapLibre.
export function encodeAttr (reg: Registro, visible: boolean, selected: boolean):
  [number, number, number, number] {
  return [
    // 255 (no 0) marca "sin evaluar": un PCI de 0 es dato real, el peor
    // escalón de la escala ASTM (pavimento colapsado), no ausencia de dato.
    reg.pci == null ? 255 : Math.max(0, Math.min(100, Math.round(reg.pci))),
    // indexOf da -1 si reg.fuente no está en FUENTES (Partial<Registro> es un
    // tipo que se borra al compilar, no protege en runtime); Math.max(0, ...)
    // lo lleva al índice de 'sin', mismo destino que un valor fuera de
    // dominio en normalizar() de store.ts. Segunda línea de defensa: esta
    // función está exportada y se puede llamar sin pasar por ningún store.
    Math.max(0, FUENTES.indexOf(reg.fuente)),
    (visible ? 1 : 0) | (selected ? 2 : 0),
    0,
  ]
}

export class AttrTexture {
  readonly texture: THREE.DataTexture
  private data: Uint8Array

  constructor (private store: AttrStore) {
    // Uint8Array nace en ceros: los 184 texels sobrantes (164²-26.712) que
    // refresh() nunca visita (el for corre hasta store.length) quedan en
    // (0,0,0,0) para siempre — B=0 decodifica "no visible". Relleno inerte a
    // propósito, no un descuido: ningún segId real de la geometría cae ahí,
    // así que el shader jamás los lee.
    this.data = new Uint8Array(ATTR_SIZE * ATTR_SIZE * 4)
    this.texture = new THREE.DataTexture(
      this.data, ATTR_SIZE, ATTR_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType,
    )
    // Es una tabla de consulta indexada por id, no una imagen: cualquier
    // filtro que interpole mezclaría los atributos de vías vecinas.
    this.texture.magFilter = THREE.NearestFilter
    this.texture.minFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
    this.refresh()
  }

  /** Relee los ATTR_SIZE² texels completos en cada llamada — a este tamaño
   * (26.896) es barato, así que no hace falta rastrear qué texels ensuciaron.
   * `visible` y `selected` son máscaras opcionales de un byte por vía. */
  refresh (visible?: Uint8Array, selected?: Uint8Array) {
    for (let i = 0; i < this.store.length; i++) {
      const [r, g, b, a] = encodeAttr(
        this.store.get(i),
        visible ? visible[i] === 1 : true,
        selected ? selected[i] === 1 : false,
      )
      const o = i * 4
      this.data[o] = r; this.data[o + 1] = g; this.data[o + 2] = b; this.data[o + 3] = a
    }
    this.texture.needsUpdate = true
  }
}
