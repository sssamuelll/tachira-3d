import { test, expect } from 'vitest'
import { crearAutoguardado, readJSON, type EstadoGuardado } from './persist'

// Fix ronda final: "archivo recién creado, vacío" y "JSON roto" caían en el
// mismo catch. El segundo conectaba el handle igual, el store quedaba solo
// con la siembra, y la primera edición escribía {"registros":{}} encima:
// todo el trabajo, borrado. Y editar este archivo a mano es un flujo
// documentado en el spec -- una coma de más es el caso previsto.
const conTexto = (texto: string) =>
  ({ getFile: async () => ({ text: async () => texto }) }) as unknown as FileSystemFileHandle

test('readJSON devuelve null si el archivo esta vacio y lanza si es ilegible', async () => {
  expect(await readJSON(conTexto(''))).toBeNull()             // recién creado por showSaveFilePicker
  expect(await readJSON(conTexto('   \n  '))).toBeNull()      // solo espacios: tampoco hay nada que cargar
  expect(await readJSON(conTexto('{"registros":{}}'))).toEqual({ registros: {} })
  await expect(readJSON(conTexto('{"registros":,}'))).rejects.toThrow()   // la coma de más
})

// Fix hallazgo menor (re-revisión final): parsea sin problema no es lo mismo
// que "es nuestro esquema". Antes de este fix, loadJSON() leía cero registros
// de estos cuatro sin ningún aviso, el handle se conectaba igual, y la
// primera edición sobrescribía el archivo entero.
test('readJSON lanza si el valor parseado no es un objeto', async () => {
  await expect(readJSON(conTexto('42'))).rejects.toThrow()
  await expect(readJSON(conTexto('"hola"'))).rejects.toThrow()
  await expect(readJSON(conTexto('true'))).rejects.toThrow()
  await expect(readJSON(conTexto('null'))).rejects.toThrow()
  await expect(readJSON(conTexto('[]'))).rejects.toThrow()
  await expect(readJSON(conTexto('[1,2,3]'))).rejects.toThrow()
})

// El caso concreto peor que motivó el fix: `registros` del tipo equivocado.
// Object.entries("algo") no da cero entradas -- da una por caracter
// (['0','a'],['1','l'],...), que loadJSON() no distingue de ids reales: se
// guardan como huérfanos y toJSON() los re-emite, plantados en el archivo.
test('readJSON lanza si "registros" viene pero no es un objeto', async () => {
  await expect(readJSON(conTexto('{"registros":"algo"}'))).rejects.toThrow()
  await expect(readJSON(conTexto('{"registros":42}'))).rejects.toThrow()
  await expect(readJSON(conTexto('{"registros":[1,2,3]}'))).rejects.toThrow()
})

// Límite deliberado del chequeo -- "forma MÍNIMA", no el esquema completo.
// {} no trae `registros`, así que no hay nada que validar en él (se comporta
// como un archivo con cero registros, no como uno roto); y una clave mal
// escrita (`registro` en vez de `registros`) tampoco se detecta -- adivinar
// nombres de clave es un problema sin fondo que no se pidió resolver. Ambos
// se documentan con un test, no se dejan como un olvido silencioso.
test('readJSON acepta un objeto sin la clave "registros" -- fuera del alcance del chequeo minimo', async () => {
  expect(await readJSON(conTexto('{}'))).toEqual({})
  expect(await readJSON(conTexto('{"registro":{"1":{"pci":50}}}'))).toEqual({ registro: { 1: { pci: 50 } } })
})

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
