import { describe, it, expect } from 'vitest'
import { direccionSol, fechaDeEscena, FECHA_POR_DEFECTO } from './sol'

// El Táchira está en UTC-4 y ORIGIN cae en lon -71.9°, así que el mediodía
// solar verdadero ronda las 16:48 UTC. Los dos casos de abajo son el mediodía
// y la madrugada del mismo día, para fijar el signo y el orden de magnitud sin
// depender de una efeméride al segundo.
describe('direccionSol', () => {
  it('a las 17:00Z (13:00 en Venezuela) el sol está casi en el cenit', () => {
    const s = direccionSol(new Date('2026-09-05T17:00:00Z'))
    // 5 de septiembre: declinación ~+6.6°, latitud del origen 8.02° -> el sol
    // pasa a menos de 2° del cenit. y = sin(altura) > 0.8 con margen de sobra.
    expect(s.y).toBeGreaterThan(0.8)
  })

  it('a las 05:00Z (01:00 en Venezuela) el sol está bajo el horizonte', () => {
    const s = direccionSol(new Date('2026-09-05T05:00:00Z'))
    expect(s.y).toBeLessThan(0)
  })

  it('devuelve un vector unitario', () => {
    const s = direccionSol(new Date('2026-09-05T14:00:00Z'))
    expect(s.length()).toBeCloseTo(1, 6)
  })

  it('por la mañana el sol está al este (X positivo)', () => {
    // 12:00Z son las 08:00 de Venezuela: casi cinco horas antes del mediodía
    // solar, el sol todavía sale por el este. X = este en el mundo.
    const s = direccionSol(new Date('2026-09-05T12:00:00Z'))
    expect(s.x).toBeGreaterThan(0)
    expect(s.y).toBeGreaterThan(0)
  })

  it('escribe en el vector que se le pasa, sin reservar uno nuevo', () => {
    const out = direccionSol(new Date('2026-09-05T17:00:00Z'))
    const mismo = direccionSol(new Date('2026-09-05T17:00:00Z'), out)
    expect(mismo).toBe(out)
  })
})

// La hora de la escena decide la exposición de la calzada (asfalto.ts,
// luzVia) y si hay sombra proyectada que ver. Se puede pisar por query string
// para poder mirar las dos cosas sin recompilar.
describe('fechaDeEscena', () => {
  it('sin ?hora= devuelve la fecha por defecto', () => {
    expect(fechaDeEscena('').toISOString()).toBe(new Date(FECHA_POR_DEFECTO).toISOString())
    expect(fechaDeEscena('?imagen=0').toISOString()).toBe(new Date(FECHA_POR_DEFECTO).toISOString())
  })

  it('con ?hora= devuelve esa, y el sol la sigue', () => {
    const d = fechaDeEscena('?hora=2026-09-05T12:00:00Z')
    expect(d.toISOString()).toBe('2026-09-05T12:00:00.000Z')
    // Las 8 de la mañana en el Táchira: el sol bajo y por el este.
    const s = direccionSol(d)
    expect(s.y).toBeLessThan(0.4)
    expect(s.x).toBeGreaterThan(0.8)
  })

  it('una fecha que no se entiende se ignora, no rompe el mapa', () => {
    expect(fechaDeEscena('?hora=ayer').toISOString()).toBe(new Date(FECHA_POR_DEFECTO).toISOString())
  })
})
