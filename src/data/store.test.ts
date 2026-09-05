import { test, expect } from 'vitest'
import { AttrStore } from './store'
import type { Way } from './types'

const ways: Way[] = [
  { osmId: 1, ref: null, name: null, highway: 'residential', surface: 'asphalt', tipo: 'asfalto', municipio: 'Rubio', km: 1, km3d: 1 },
  { osmId: 2, ref: null, name: null, highway: 'track', surface: null, tipo: 'sin_definir', municipio: 'Rubio', km: 2, km3d: 2.1 },
  { osmId: 3, ref: null, name: null, highway: 'primary', surface: null, tipo: 'sin_definir', municipio: 'Junín', km: 3, km3d: 3.2 },
]

test('arranca sin evaluar y sin fuente', () => {
  const s = new AttrStore(ways)
  expect(s.get(0).pci).toBeNull()
  expect(s.get(0).fuente).toBe('sin')
})

// Fix ronda final: sembrar la rodadura NO escribe `fuente`. Ese campo
// describe la procedencia del PCI (fix Task 19) y acá no hay PCI ninguno --
// escribir 'heredado' para marcar que la rodadura venía de OSM metía dos
// significados en un campo, y el filtro de "Procedencia" mezclaba PCI
// aplicados en bloque con vías sin PCI cuya rodadura salió del mapa.
test('seedFromSurface siembra el tipo sin tocar la procedencia, y cuenta cuantas sembro', () => {
  const s = new AttrStore(ways)
  expect(s.seedFromSurface()).toBe(1)
  expect(s.get(0).tipo).toBe('asfalto')
  expect(s.get(0).fuente).toBe('sin')      // no hay PCI: no hay procedencia que declarar
  expect(s.get(1).tipo).toBe('sin_definir')
  expect(s.get(1).fuente).toBe('sin')      // sin surface, no se siembra nada
})

test('set aplica el mismo parche a muchas vias de una', () => {
  const s = new AttrStore(ways)
  s.set([0, 1, 2], { pci: 45, fuente: 'heredado' })
  expect(s.get(0).pci).toBe(45)
  expect(s.get(2).pci).toBe(45)
  expect(s.get(2).fuente).toBe('heredado')
})

// Fix ronda final: useAutosave (persist.ts) distingue con este contador
// "montar y cargar el archivo" de "el usuario ya editó" -- si loadJSON o
// seedFromSurface lo subieran, conectar el archivo dispararía un guardado
// inmediato que reescribe lo que se acaba de leer; si set() no lo subiera,
// las ediciones hechas antes de conectar el archivo no llegarían nunca a
// disco (que era el bug: el indicador decía "guardado" y no había nada).
test('ediciones solo cuenta set(), no el sembrado ni la carga desde disco', () => {
  const s = new AttrStore(ways)
  expect(s.ediciones).toBe(0)
  s.seedFromSurface()
  expect(s.ediciones).toBe(0)
  s.loadJSON({ registros: { '1': { pci: 40, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' } } }, ways)
  expect(s.ediciones).toBe(0)
  s.set([0], { pci: 50, fuente: 'estimado' })
  expect(s.ediciones).toBe(1)
  s.set([1, 2], { tipo: 'tierra' })
  expect(s.ediciones).toBe(2)
})

test('set notifica una sola vez por lote', () => {
  const s = new AttrStore(ways)
  let n = 0
  s.onChange(() => n++)
  s.set([0, 1, 2], { pci: 10, fuente: 'estimado' })
  expect(n).toBe(1)
})

test('set normaliza una fuente invalida y un pci NaN en vez de dejarlos corruptos', () => {
  const s = new AttrStore(ways)
  s.set([0], { fuente: 'medidoo' as any, pci: NaN })
  expect(s.get(0).fuente).toBe('sin')
  expect(s.get(0).pci).toBeNull()
})

test('set normaliza el merge completo, no tumba un campo valido que el patch no toca', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 80, fuente: 'medido' })
  s.set([0], { tipo: 'granzon' })   // este patch no menciona pci ni fuente
  expect(s.get(0).pci).toBe(80)            // sigue el valor previo, no se resetea
  expect(s.get(0).fuente).toBe('medido')   // idem
  expect(s.get(0).tipo).toBe('granzon')    // y el campo que sí tocó el patch se aplica
})

// Escenario destructivo real (fix Task 19, reportado por el coordinador): medir una
// vía en campo (fuente:'medido') y más tarde fijar la rodadura en bloque sobre su
// municipio (fuente:'heredado') no debe degradar en silencio la procedencia del PCI
// ya medido -- eso perdería justo el trabajo de campo, que es el caro. `fuente`
// describe la procedencia del PCI, no de la rodadura: un patch que no toca `pci` no
// escribe `fuente` en NINGÚN índice del lote, tenga o no tenga PCI previo -- la regla
// es sobre el patch (qué operación es esta), no sobre el estado previo de cada vía.
test('set no pisa la fuente de un PCI medido cuando el patch solo trae rodadura', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 90, fuente: 'medido' })          // inspección real con ficha
  s.set([0, 1, 2], { fuente: 'heredado', tipo: 'asfalto' })   // bloque, sin pci
  expect(s.get(0).pci).toBe(90)             // el PCI medido no se toca
  expect(s.get(0).fuente).toBe('medido')    // ni su procedencia -- el caso que destruía trabajo
  expect(s.get(0).tipo).toBe('asfalto')     // pero la rodadura sí se aplica
  expect(s.get(1).fuente).toBe('sin')       // sin PCI previo tampoco toma la fuente...
  expect(s.get(1).tipo).toBe('asfalto')     // ...aunque la rodadura sí se aplica igual
})

// Mismo defecto conceptual, una capa más abajo (fix Task 19 ronda 2): "fecha"
// también describe el PCI, no la rodadura. Medir en enero (fecha explícita para no
// depender del reloj real) y fijar la rodadura en bloque en marzo no debe correr la
// fecha de la medición -- la antigüedad de un dato de campo es tan parte de su
// validez como su procedencia (un PCI de hace tres meses no se lee igual que uno de
// hace tres años).
test('set no actualiza la fecha de un PCI medido cuando el patch solo trae rodadura', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 90, fuente: 'medido', fecha: '2026-01-15' })
  s.set([0, 1, 2], { fuente: 'heredado', tipo: 'asfalto' })   // bloque, sin pci, "en marzo"
  expect(s.get(0).fecha).toBe('2026-01-15')   // la medición sigue fechada en enero
  expect(s.get(0).fuente).toBe('medido')
  expect(s.get(0).tipo).toBe('asfalto')
})

test('set SI aplica la fuente cuando el patch trae pci, aunque sea null', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 90, fuente: 'medido' })
  s.set([0], { pci: null, fuente: 'sin' })   // des-evaluar es una acción real sobre el pci
  expect(s.get(0).pci).toBeNull()
  expect(s.get(0).fuente).toBe('sin')
})

test('la cobertura por municipio cuenta evaluados sobre total', () => {
  const s = new AttrStore(ways)
  s.set([0], { pci: 80, fuente: 'medido' })
  const c = s.coverageByMunicipio()
  expect(c.get('Rubio')).toEqual({ total: 2, evaluados: 1 })
  expect(c.get('Junín')).toEqual({ total: 1, evaluados: 0 })
})

test('loadJSON restaura por osmId y reporta huerfanos sin borrarlos', () => {
  const s = new AttrStore(ways)
  const { orphans, invalid } = s.loadJSON({ version: 1, registros: {
    '2': { pci: 30, fuente: 'medido', tipo: 'tierra', fecha: '2026-09-05', nota: '' },
    '999': { pci: 50, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(1).pci).toBe(30)
  expect(orphans).toEqual(['999'])
  expect(invalid).toEqual([])
})

// CRITICO, fix Task 21 ronda 3: `regs` esta indexado 1:1 contra `ways`, que
// por definicion no tiene el id de un huerfano -- antes, loadJSON() lo
// reportaba y lo descartaba en el mismo `continue`, asi que toJSON() nunca
// podia volver a emitirlo: el proximo autoguardado lo borraba del archivo sin
// que el usuario lo pidiera, exactamente lo que la regla de huerfanos existe
// para impedir. Este test reproduce el recorrido real que encontro el
// revisor: cargar un huerfano, editar OTRA via sin relacion, y comprobar que
// sigue en toJSON() -- intacto, sin que nada lo haya tocado ni interpretado.
test('un huerfano cargado sobrevive a toJSON() despues de editar otra via, sin alterarse', () => {
  const s = new AttrStore(ways)
  const huerfano = { pci: 55, fuente: 'medido' as const, tipo: 'asfalto' as const, fecha: '2026-01-01', nota: 'ficha de campo antigua' }
  const { orphans } = s.loadJSON({ registros: { '999': huerfano } }, ways)
  expect(orphans).toEqual(['999'])
  s.set([0], { pci: 10, fuente: 'estimado' })   // edita OTRA via, sin relacion con el huerfano
  const out = s.toJSON() as any
  expect(out.registros['999']).toEqual(huerfano)   // sigue presente, campo por campo, sin alterarse
})

test('loadJSON normaliza una fuente invalida a sin y reporta el id', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: 50, fuente: 'medidoo' as any, tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(0).fuente).toBe('sin')
  expect(invalid).toEqual(['1'])
})

test('loadJSON normaliza un tipo invalido a sin_definir y reporta el id', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: 50, fuente: 'medido', tipo: 'adoquin' as any, fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(0).tipo).toBe('sin_definir')
  expect(invalid).toEqual(['1'])
})

test('loadJSON normaliza un pci no finito o fuera de 0-100 a null y reporta el id', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: 150, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
    '2': { pci: NaN, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(0).pci).toBeNull()
  expect(s.get(1).pci).toBeNull()
  expect(invalid).toEqual(['1', '2'])
})

test('un pci null (sin evaluar) no cuenta como invalido', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: null, fuente: 'heredado', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(invalid).toEqual([])
})

test('un registro corrupto no impide cargar los sanos', () => {
  const s = new AttrStore(ways)
  const { invalid } = s.loadJSON({ registros: {
    '1': { pci: 999, fuente: 'medido', tipo: 'asfalto', fecha: '2026-09-05', nota: '' },
    '2': { pci: 30, fuente: 'medido', tipo: 'tierra', fecha: '2026-09-05', nota: '' },
  } }, ways)
  expect(s.get(0).pci).toBeNull()   // el corrupto se normaliza, no se descarta el archivo
  expect(s.get(1).pci).toBe(30)     // el sano no se ve afectado
  expect(invalid).toEqual(['1'])
})

test('toJSON solo serializa lo que tiene dato', () => {
  const s = new AttrStore(ways)
  s.set([1], { pci: 30, fuente: 'medido' })
  const out = s.toJSON() as any
  expect(Object.keys(out.registros)).toEqual(['2'])
})

// Fix Task 21: aplicar solo rodadura (sin pci) a una vía que nunca tuvo PCI no
// toca `fuente` (fix Task 19, ver store.set() arriba) -- se queda en 'sin'.
// Antes de este fix, toJSON() no miraba `tipo`, así que ese cambio no se
// serializaba y se perdía en el próximo loadJSON(): pérdida de datos
// silenciosa. Este test fija el comportamiento correcto.
test('toJSON serializa un registro al que solo se le cambio la rodadura, sin pci ni fuente', () => {
  const s = new AttrStore(ways)
  s.set([1], { tipo: 'granzon' })            // ways[1] no tiene surface -- fuente se queda en 'sin'
  expect(s.get(1).fuente).toBe('sin')        // confirma la premisa: este es justo el caso que fallaba
  const out = s.toJSON() as any
  expect(out.registros['2']).toBeDefined()
  expect(out.registros['2'].tipo).toBe('granzon')
})

// Fix Task 21 ronda 2: seedFromSurface() se re-ejecuta identica en cada carga
// de la app (App.tsx la llama sobre el mismo `ways` del build cada vez) --
// persistir un registro cuyo unico contenido es ese sembrado es ruido puro,
// se regenera solo. Los dos tests de abajo distinguen exactamente el caso que
// pidio el coordinador: rodadura sembrada intacta NO se guarda, rodadura que
// el usuario cambio a otra distinta SI se guarda (mismo mecanismo, un nivel
// mas fino que el test de arriba).
test('toJSON NO serializa un registro cuyo unico contenido es el sembrado de seedFromSurface', () => {
  const s = new AttrStore(ways)
  s.seedFromSurface()                        // ways[0] tiene surface -- se siembra tipo:'asfalto'
  expect(s.get(0).fuente).toBe('sin')         // confirma la premisa: sembrar no declara procedencia
  const out = s.toJSON() as any
  expect(out.registros['1']).toBeUndefined()  // nada que el usuario haya tocado -- no se guarda
})

test('toJSON SI serializa cuando el usuario cambia la rodadura sembrada a otra distinta', () => {
  const s = new AttrStore(ways)
  s.seedFromSurface()                         // ways[0]: sembrado a tipo:'asfalto'
  s.set([0], { tipo: 'granzon' })             // el usuario la corrige a mano, sin tocar pci
  expect(s.get(0).fuente).toBe('sin')         // fuente sigue sin tocarse (fix Task 19: set() sin pci no la toca)
  const out = s.toJSON() as any
  expect(out.registros['1']).toBeDefined()    // ya no coincide con ways[0].tipo -- es dato real, se guarda
  expect(out.registros['1'].tipo).toBe('granzon')
})

// El corte del sembrado ahora exige fuente:'sin' (antes 'heredado', que era
// lo que escribia el propio sembrado). Un registro sin PCI pero CON
// procedencia solo puede venir de un JSON escrito a mano: es dato del
// usuario, no ruido regenerable, y no se puede descartar aunque la rodadura
// coincida con la sembrada.
test('toJSON SI serializa un registro sin pci pero con procedencia escrita a mano', () => {
  const s = new AttrStore(ways)
  s.seedFromSurface()
  s.loadJSON({ registros: {
    '1': { pci: null, fuente: 'heredado', tipo: 'asfalto', fecha: '2026-01-10', nota: '' },
  } }, ways)
  expect(s.get(0).tipo).toBe(ways[0].tipo)    // la rodadura coincide con la sembrada
  const out = s.toJSON() as any
  expect(out.registros['1']).toBeDefined()
  expect(out.registros['1'].fuente).toBe('heredado')
})

// Menor, pedido explicito del coordinador: faltaba el caso "solo nota" del
// corte del sembrado. Una nota sobre una via con la rodadura TAL CUAL la
// sembro seedFromSurface (sin cambiarla) es dato real del usuario -- soloSembrado
// exige `!r.nota`, asi que una nota presente basta para que no se excluya,
// aunque tipo/fuente sigan identicos al sembrado.
test('toJSON SI serializa una nota sobre una via con la rodadura sembrada intacta', () => {
  const s = new AttrStore(ways)
  s.seedFromSurface()                         // ways[0]: sembrado a tipo:'asfalto', fuente:'heredado'
  s.set([0], { nota: 'hueco grande cerca del puente' })   // solo nota, tipo no cambia
  expect(s.get(0).tipo).toBe('asfalto')       // la rodadura sigue siendo la sembrada, sin cambiar
  const out = s.toJSON() as any
  expect(out.registros['1']).toBeDefined()    // la nota es dato real -- no se excluye pese a tipo==ways[0].tipo
  expect(out.registros['1'].nota).toBe('hueco grande cerca del puente')
})
