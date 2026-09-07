import { nf } from './theme'

/** Lo que dibuja la barra de escala: un número redondo de metros, y cuántos
 * píxeles de pantalla mide ese número aquí y ahora. */
export interface Escala { metros: number; px: number; texto: string }

// 1, 2 y 5 por una potencia de diez -- la serie de las reglas, los ejes de
// gráfico y todas las barras de escala que existen. Son los tres únicos
// repartos de una década que se leen sin dividir mentalmente: la barra dice
// "500 m" y el ojo estima trescientos sin pensarlo. Con 3, 4 o 7 no.
const PASOS = [1, 2, 5]

const etiqueta = (m: number) => (m >= 1000 ? `${nf.format(m / 1000)} km` : `${nf.format(m)} m`)

/**
 * El mayor número redondo de metros que no pase de `objetivoPx` píxeles.
 *
 * La barra nunca mide el objetivo exacto: mide lo que mide el número redondo
 * que cabe. Entre un escalón y el siguiente su ancho baja hasta el 40% del
 * objetivo y vuelve a subir, y ese vaivén es justo la señal de que la barra
 * está midiendo el terreno y no dibujando un adorno de ancho fijo.
 */
export function escalaBonita (mpp: number, objetivoPx: number): Escala {
  // La cámara puede reportar distancia cero en el primer cuadro, antes de que
  // OrbitControls tome su posición: log10(0) es -Infinity y de ahí no se
  // vuelve. El piso es un micrómetro por píxel, ocho órdenes por debajo de
  // cualquier vista real.
  const m = Math.max(mpp, 1e-6)
  const tope = m * objetivoPx
  const base = Math.pow(10, Math.floor(Math.log10(tope)))
  let metros = base
  for (const p of PASOS) if (p * base <= tope) metros = p * base
  // El ancho va en píxeles enteros: es lo que el navegador puede dibujar, y
  // redondear acá hace que "cambió la escala" sea una pregunta con respuesta
  // estable (Camera.tsx solo avisa cuando este número cambia).
  return { metros, px: Math.round(metros / m), texto: etiqueta(metros) }
}
