import { test, expect } from 'vitest'
import { crearAutoguardado, type EstadoGuardado } from './persist'

// Fix Task 21 ronda 4: dos escrituras solapadas -- la primera resolviendo
// DESPUÉS de que la segunda edición ya armó su propio guardado -- no deben
// dejar que la resolución vieja declare 'guardado' antes de tiempo. El
// estado tiene que quedarse en 'pendiente' (por la edición más nueva) hasta
// que la escritura de la SEGUNDA edición sea la que de verdad termine.
test('con dos escrituras solapadas, la resolucion tardia de la primera no adelanta el guardado', async () => {
  const estados: EstadoGuardado[] = []
  const auto = crearAutoguardado(e => estados.push(e), 10)   // debounce corto: no es lo que se prueba

  let resolverA!: () => void
  const escrituraA = new Promise<void>(res => { resolverA = res })
  let resolverB!: () => void
  const escrituraB = new Promise<void>(res => { resolverB = res })

  // Edición A: el debounce dispara y arranca la escritura, todavía sin resolver.
  auto.editar(() => escrituraA)
  await new Promise(r => setTimeout(r, 20))
  expect(estados.at(-1)).toBe('guardando')

  // Edición B llega MIENTRAS la escritura de A sigue en vuelo.
  auto.editar(() => escrituraB)
  expect(estados.at(-1)).toBe('pendiente')

  // A resuelve tarde -- ya no es la escritura más reciente. Sin la guarda de
  // generación, esto pisaría 'pendiente' con un 'guardado' prematuro.
  resolverA()
  await Promise.resolve(); await Promise.resolve()
  expect(estados.at(-1)).toBe('pendiente')   // sigue pendiente: la edición B todavía no se guardó

  // El debounce de B dispara y su escritura arranca.
  await new Promise(r => setTimeout(r, 20))
  expect(estados.at(-1)).toBe('guardando')

  // B resuelve -- esta sí es la más reciente, ahora sí declara 'guardado'.
  resolverB()
  await Promise.resolve(); await Promise.resolve()
  expect(estados.at(-1)).toBe('guardado')
})
