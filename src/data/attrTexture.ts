import * as THREE from 'three'
import { ATTR_SIZE, FUENTES, TIER_MENOR, tierLiberty } from './constants'
import type { Registro } from './types'
import type { AttrStore } from './store'

// El color de una vía no vive en el buffer de geometría: vive en esta textura
// RGBA de ATTR_SIZE² texels, uno por índice de vía, que el shader indexa por
// id. Repintar miles de tramos es entonces escribir texels y subir una
// textura chica — el equivalente hecho a mano del setFeatureState de MapLibre.
export function encodeAttr (
  reg: Registro, enfocado: boolean, selected: boolean, tier: number = TIER_MENOR,
): [number, number, number, number] {
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
    // Bit 0: en foco. Bit 1: seleccionado. "En foco" NO es "visible": lo que
    // queda fuera se sigue dibujando, más tenue (roadsShader.ts). Nada en esta
    // aplicación esconde una vía del mapa, y de eso depende que el pase de
    // picking pueda dibujarlas todas sin mentir.
    (enfocado ? 1 : 0) | (selected ? 2 : 0),
    // El tier de Liberty (constants.ts): qué color le toca a la vía cuando la
    // capa de PCI está apagada, o sea en el estado normal del mapa. Este canal
    // estaba fijo en 0 y no lo leía nadie. Va acá y no en un atributo de
    // vértice porque es un valor POR VÍA, que es justo lo que esta textura
    // indexa, y porque la geometría de vías ya roza el tope de atributos.
    tier,
  ]
}

export class AttrTexture {
  readonly texture: THREE.DataTexture
  private data: Uint8Array

  constructor (private store: AttrStore) {
    // Uint8Array nace en ceros: los 184 texels sobrantes (164²-26.712) que
    // refresh() nunca visita (el for corre hasta store.length) quedan en
    // (0,0,0,0) para siempre. Relleno inerte a propósito, no un descuido:
    // ningún segId real de la geometría cae ahí, así que el shader jamás los
    // lee.
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
   * `enfocado` y `selected` son máscaras opcionales de un byte por vía;
   * ausentes valen "todo en foco, nada seleccionado". */
  refresh (enfocado?: Uint8Array, selected?: Uint8Array) {
    for (let i = 0; i < this.store.length; i++) {
      const [r, g, b, a] = encodeAttr(
        this.store.get(i),
        enfocado ? enfocado[i] === 1 : true,
        selected ? selected[i] === 1 : false,
        tierLiberty(this.store.highway(i)),
      )
      const o = i * 4
      this.data[o] = r; this.data[o + 1] = g; this.data[o + 2] = b; this.data[o + 3] = a
    }
    this.texture.needsUpdate = true
  }
}
