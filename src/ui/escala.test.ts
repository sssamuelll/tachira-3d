import { describe, it, expect } from 'vitest'
import { escalaBonita } from './escala'

const OBJETIVO = 104

// Barrido geométrico de metros por píxel, del zoom máximo (una calle llena la
// pantalla) a la vista del estado entero: 0,01 m/px son ~9 m de ancho de
// pantalla; 200 m/px, ~190 km. Paso del 7%, ~150 muestras, y ninguna cae en
// una potencia de diez exacta por casualidad.
const MPPS: number[] = []
for (let m = 0.01; m < 200; m *= 1.07) MPPS.push(m)

describe('escalaBonita', () => {
  it('siempre mide un 1, 2 o 5 por una potencia de diez', () => {
    for (const mpp of MPPS) {
      const { metros } = escalaBonita(mpp, OBJETIVO)
      const base = Math.pow(10, Math.floor(Math.log10(metros)))
      expect([1, 2, 5]).toContain(Math.round(metros / base))
    }
  })

  it('nunca pasa del ancho objetivo, y nunca baja del 40%', () => {
    // El 40% es el peor caso de la serie 1-2-5, no una tolerancia: ocurre
    // cuando caben 4,99 unidades y solo se pueden dibujar 2. Si alguien mete
    // un 3 en PASOS, este número sube y el test lo dice.
    for (const mpp of MPPS) {
      const { px } = escalaBonita(mpp, OBJETIVO)
      expect(px).toBeLessThanOrEqual(OBJETIVO)
      expect(px / OBJETIVO).toBeGreaterThan(0.39)
    }
  })

  it('lo que dice el número es lo que mide la barra', () => {
    for (const mpp of MPPS) {
      const { metros, px } = escalaBonita(mpp, OBJETIVO)
      // Hasta un píxel de diferencia: el ancho se redondea a entero.
      expect(Math.abs(px * mpp - metros)).toBeLessThan(mpp)
    }
  })

  it('pasa a kilómetros a partir de mil metros, y en la serie siempre son enteros', () => {
    expect(escalaBonita(500 / OBJETIVO, OBJETIVO).texto).toBe('500 m')
    expect(escalaBonita(1000 / OBJETIVO, OBJETIVO).texto).toBe('1 km')
    expect(escalaBonita(2000 / OBJETIVO, OBJETIVO).texto).toBe('2 km')
    expect(escalaBonita(50000 / OBJETIVO, OBJETIVO).texto).toBe('50 km')
    for (const mpp of MPPS) {
      const { texto } = escalaBonita(mpp, OBJETIVO)
      expect(texto).toMatch(/^\d+ (m|km)$/)
    }
  })

  it('sobrevive a una cámara que todavía no se ha colocado', () => {
    const e = escalaBonita(0, OBJETIVO)
    expect(Number.isFinite(e.metros)).toBe(true)
    expect(Number.isFinite(e.px)).toBe(true)
  })
})
