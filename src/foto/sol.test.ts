import { test, expect } from 'vitest'
import { direccionDelSol } from './escena'

// El sol es lo único de la foto que no se puede juzgar mirándola: una escena
// iluminada desde el oeste a las diez de la mañana se ve perfectamente bien,
// solo que miente. Y es fácil equivocarse por 180°, porque la traducción va de
// ECEF a un mundo con Z = -NORTE.
//
// La fecha es la que App.tsx le pasa al cielo: 2026-09-05T14:00:00Z. El
// Táchira está en UTC-4, así que son las 10:00 de la mañana, y a esa hora en
// una latitud de 8° N el sol está alto y al ESTE.

const SOL = direccionDelSol(new Date('2026-09-05T14:00:00Z'))

test('el sol está sobre el horizonte, alto', () => {
  const elevacion = Math.asin(SOL.y) * 180 / Math.PI
  expect(elevacion).toBeGreaterThan(30)
  expect(elevacion).toBeLessThan(60)
})

test('a las diez de la mañana el sol está al este', () => {
  // Azimut desde el norte, hacia el este. Norte = -Z, este = +X.
  const azimut = (Math.atan2(SOL.x, -SOL.z) * 180 / Math.PI + 360) % 360
  expect(azimut).toBeGreaterThan(60)
  expect(azimut).toBeLessThan(110)
})

test('es un vector unitario', () => {
  expect(SOL.length()).toBeCloseTo(1, 9)
})
