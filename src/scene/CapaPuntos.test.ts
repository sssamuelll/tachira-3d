import { describe, it, expect } from 'vitest'
import { escalaSprite } from './CapaPuntos'

/**
 * `sizeAttenuation: false` NO quiere decir "la escala son píxeles".
 *
 * El shader de sprites de three hace justo lo contrario de lo que el nombre
 * sugiere: cuando USE_SIZEATTENUATION *no* está definido, multiplica la escala
 * por la profundidad (`scale *= -mvPosition.z`) para que la división por w la
 * cancele después. El tamaño queda constante en pantalla, sí, pero su valor
 * sale de la proyección, no de la escala en crudo.
 *
 * Con la escala de 14 que tenía esto, el marcador medía trece mil píxeles.
 * Estas pruebas fijan la ida y la vuelta de esa cuenta.
 */

/** El alto en píxeles que el shader produce para una escala dada -- el camino
 *  inverso, escrito aparte para que la prueba no repita la implementación. */
function altoEnPantalla (escala: number, fovGrados: number, altoPx: number): number {
  const f = 1 / Math.tan((fovGrados * Math.PI) / 360)
  return (f * escala * altoPx) / 2
}

describe('escalaSprite', () => {
  it('devuelve la escala que produce el alto en píxeles pedido', () => {
    for (const [px, fov, alto] of [[28, 45, 800], [16, 60, 1080], [40, 30, 720]]) {
      expect(altoEnPantalla(escalaSprite(px, fov, alto), fov, alto)).toBeCloseTo(px, 6)
    }
  })

  // El defecto, escrito como número: la escala vieja era 14 a secas.
  it('deja constancia de que la escala vieja medía miles de píxeles', () => {
    expect(altoEnPantalla(14, 45, 768)).toBeGreaterThan(12_000)
  })

  it('el doble de píxeles pide el doble de escala', () => {
    expect(escalaSprite(40, 45, 800)).toBeCloseTo(2 * escalaSprite(20, 45, 800), 12)
  })

  // El mismo marcador tiene que medir lo mismo en una ventana alta que en una
  // baja, así que la escala compensa el alto del viewport.
  it('una ventana el doble de alta pide la mitad de escala', () => {
    expect(escalaSprite(28, 45, 1600)).toBeCloseTo(escalaSprite(28, 45, 800) / 2, 12)
  })

  it('un campo de visión más cerrado pide menos escala', () => {
    expect(escalaSprite(28, 30, 800)).toBeLessThan(escalaSprite(28, 60, 800))
  })

  // Al montar, y en el primer cuadro tras un resize, el alto puede llegar en 0.
  // Sin el piso esto devolvía Infinity y el marcador desaparecía de la escena.
  it('no devuelve Infinity con un viewport de alto cero', () => {
    expect(Number.isFinite(escalaSprite(28, 45, 0))).toBe(true)
  })
})
