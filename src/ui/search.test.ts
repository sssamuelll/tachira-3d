import { describe, it, expect } from 'vitest'
import { indexar, buscar, puntaje, porMunicipio } from './search'
import { AttrStore } from '../data/store'
import roadsJson from '../../public/data/roads-meta.json'
import type { RoadsMeta } from '../data/types'

const ways = (roadsJson as RoadsMeta).ways
const idx = indexar(ways)
// Store recién creado: seedFromSurface siembra la rodadura desde `surface`,
// nunca el PCI, así que las 26.712 arrancan sin evaluar. Es el estado real de
// la primera sesión y el que hace comprobables los conteos de abajo.
const store = new AttrStore(ways)
store.seedFromSurface()

const grupo = (q: string, clase: string) => buscar(q, idx, ways, store).find(g => g.clase === clase)

describe('puntaje', () => {
  it('ordena exacto, prefijo, prefijo de palabra, contiene', () => {
    expect(puntaje('Junín', 'junin')).toBe(4)
    expect(puntaje('Junín Alto', 'junin')).toBe(3)
    expect(puntaje('Alto Junín', 'junin')).toBe(2)
    expect(puntaje('Trujunino', 'junin')).toBe(1)
    expect(puntaje('Bolívar', 'junin')).toBe(0)
  })

  it('ignora las tildes en los dos lados', () => {
    expect(puntaje('Ureña', 'urena')).toBe(4)
    expect(puntaje('Ureña', 'ureña')).toBe(4)
  })
})

describe('indexar', () => {
  it('cubre los 29 municipios sin perder ni duplicar vías', () => {
    expect(idx.municipios).toHaveLength(29)
    const suma = idx.municipios.reduce((n, m) => n + m.ids.length, 0)
    expect(suma).toBe(ways.filter(w => w.municipio).length)
    expect(new Set(idx.municipios.flatMap(m => m.ids)).size).toBe(suma)
  })

  it('reparte TODAS las vías entre las rodaduras', () => {
    expect(idx.rodaduras.reduce((n, r) => n + r.ids.length, 0)).toBe(ways.length)
  })

  it('quita el prefijo "Municipio" del nombre visible', () => {
    expect(idx.municipios.every(m => !/^Municipio /.test(m.corto))).toBe(true)
  })

  it('junta el código y el nombre de una carretera en una sola fila', () => {
    // La T-5 sale en roads-meta con name "Carretera Nacional Vía a Los
    // Llanos" y ref "T-5": buscar cualquiera de los dos tiene que dar la
    // misma fila, no dos.
    const porNombre = grupo('Los Llanos', 'via')?.items ?? []
    const porCodigo = grupo('T-5', 'via')?.items ?? []
    expect(porNombre.length).toBeGreaterThan(0)
    expect(porCodigo.length).toBeGreaterThan(0)
    expect(porCodigo[0].ids).toEqual(porNombre[0].ids)
  })
})

describe('buscar', () => {
  it('no devuelve nada con la consulta vacía', () => {
    expect(buscar('', idx, ways, store)).toEqual([])
    expect(buscar('   ', idx, ways, store)).toEqual([])
  })

  it('no devuelve nada cuando no coincide nada', () => {
    expect(buscar('zzzqqq', idx, ways, store)).toEqual([])
  })

  it('pone el municipio de primero cuando se teclea su nombre', () => {
    const g = buscar('junin', idx, ways, store)
    expect(g[0].clase).toBe('municipio')
    expect(g[0].items[0].titulo).toBe('Junín')
  })

  it('encuentra el municipio sin tildes', () => {
    expect(grupo('urena', 'municipio')?.items[0].titulo).toBe('Ureña')
  })

  it('cuenta la rodadura igual que un conteo directo sobre las vías', () => {
    const asfalto = grupo('asfalto', 'rodadura')?.items[0]
    expect(asfalto?.ids.length).toBe(ways.filter(w => w.tipo === 'asfalto').length)
  })

  it('sobre un store sin evaluar, "sin evaluar" son todas y las bandas ninguna', () => {
    const sin = grupo('sin evaluar', 'condicion')?.items.find(i => i.clave === 'pci:sin')
    expect(sin?.ids.length).toBe(ways.length)
    // Ninguna banda ASTM puede tener vías todavía; el grupo entero se cae por
    // el filtro de items vacíos en vez de mostrar filas de cero.
    expect(grupo('colapsado', 'condicion')).toBeUndefined()
  })

  it('sigue al store: al fijar un PCI, la banda aparece y "sin evaluar" baja', () => {
    const s = new AttrStore(ways)
    s.set([0, 1, 2], { pci: 5, fuente: 'medido' })
    const colapsado = buscar('colapsado', idx, ways, s).find(g => g.clase === 'condicion')
    expect(colapsado?.items[0].ids).toEqual([0, 1, 2])
    const sin = buscar('sin evaluar', idx, ways, s)[0].items[0]
    expect(sin.ids.length).toBe(ways.length - 3)
  })

  it('nunca devuelve un grupo con filas de cero vías', () => {
    for (const q of ['a', 'san', 'e', 'o', 'medido', 'tierra', 'bueno']) {
      for (const g of buscar(q, idx, ways, store)) {
        expect(g.items.length).toBeGreaterThan(0)
        for (const it of g.items) expect(it.ids.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('porMunicipio', () => {
  it('reparte la selección por municipio, de mayor a menor kilometraje', () => {
    const junin = grupo('junin', 'municipio')!.items[0]
    const filas = porMunicipio(junin.ids, ways)
    expect(filas).toHaveLength(1)
    expect(filas[0].nombre).toBe('Junín')
    expect(filas[0].n).toBe(junin.ids.length)
  })

  it('ordena descendente por km cuando la selección cruza municipios', () => {
    const ids = [...grupo('junin', 'municipio')!.items[0].ids.slice(0, 40),
      ...grupo('bolivar', 'municipio')!.items[0].ids.slice(0, 400)]
    const filas = porMunicipio(ids, ways)
    expect(filas.length).toBe(2)
    for (let i = 1; i < filas.length; i++) expect(filas[i].km).toBeLessThanOrEqual(filas[i - 1].km)
  })
})
