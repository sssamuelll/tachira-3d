import type { Way, Tipo, Fuente } from '../data/types'
import { SIN_MUNICIPIO, type AttrStore } from '../data/store'
import { PCI_RANGES, SIN_EVALUAR, TIPOS, FUENTES } from '../data/constants'
import { norm, cortoMunicipio, nf, km1 } from './theme'

export type Clase = 'municipio' | 'via' | 'condicion' | 'rodadura' | 'procedencia'

export interface Resultado {
  clave: string
  clase: Clase
  titulo: string
  detalle: string
  /** Índices de vía, mismo índice que `ways` y que AttrStore. */
  ids: number[]
  /** Punto de color, solo donde el color significa algo (la banda ASTM). */
  color?: readonly [number, number, number]
}

export interface Grupo { clase: Clase; titulo: string; items: Resultado[] }

/** Lo que se recorre en cada tecla. Se arma una vez por carga de datos: las
 * 26.712 vías se agrupan en 29 municipios, unos miles de nombres y 6
 * rodaduras, y a partir de ahí buscar es comparar contra esa lista corta. */
export interface Indice {
  municipios: Array<{ nombre: string; corto: string; ids: number[]; km: number }>
  vias: Array<{ clave: string; titulo: string; refs: string[]; municipios: string[]; ids: number[]; km: number }>
  rodaduras: Array<{ tipo: Tipo; ids: number[]; km: number }>
}

const PROCEDENCIAS: Record<Fuente, string> = {
  sin: 'sin procedencia', heredado: 'heredado', estimado: 'estimado', medido: 'medido',
}

const RODADURAS: Record<Tipo, string> = {
  sin_definir: 'sin definir', asfalto: 'asfalto', concreto: 'concreto',
  granzon: 'granzón', tierra: 'tierra', empedrado: 'empedrado',
}

export const SIN_EVALUAR_ETIQUETA = 'sin evaluar'

/** Lo que ofrece el buscador cuando todavía no has escrito nada. No es
 * decoración: un campo que acepta cinco clases distintas de término y no
 * nombra ninguna se usa para una sola. */
export const SUGERENCIAS = ['sin evaluar', 'asfalto', 'colapsado', 'medido'] as const

export function indexar (ways: Way[]): Indice {
  const muni = new Map<string, { nombre: string; corto: string; ids: number[]; km: number }>()
  // Clave por nombre, no por `ref`: OSM parte una carretera en decenas de
  // tramos y uno la busca por el nombre que dice en voz alta. El `ref` (T-5,
  // A-1) entra como alias del mismo grupo, no como grupo aparte: si no,
  // "Troncal 5" y "T-5" darían dos filas para una sola carretera.
  const via = new Map<string, {
    clave: string; titulo: string; refs: Set<string>; municipios: Set<string>; ids: number[]; km: number
  }>()
  const rod = new Map<Tipo, { tipo: Tipo; ids: number[]; km: number }>()

  for (let i = 0; i < ways.length; i++) {
    const w = ways[i]
    if (w.municipio) {
      let m = muni.get(w.municipio)
      if (!m) muni.set(w.municipio, m = { nombre: w.municipio, corto: cortoMunicipio(w.municipio), ids: [], km: 0 })
      m.ids.push(i); m.km += w.km
    }
    // Sin nombre ni código no hay nada que teclear para encontrarla: esas
    // vías se seleccionan en el mapa, no acá. Agruparlas todas bajo "sin
    // nombre" daría una fila de 20.000 tramos que nadie quiere abrir.
    const nombre = w.name ?? w.ref
    if (nombre) {
      let v = via.get(nombre)
      if (!v) via.set(nombre, v = { clave: nombre, titulo: nombre, refs: new Set(), municipios: new Set(), ids: [], km: 0 })
      if (w.ref) v.refs.add(w.ref)
      if (w.municipio) v.municipios.add(cortoMunicipio(w.municipio))
      v.ids.push(i); v.km += w.km
    }
    let r = rod.get(w.tipo)
    if (!r) rod.set(w.tipo, r = { tipo: w.tipo, ids: [], km: 0 })
    r.ids.push(i); r.km += w.km
  }

  return {
    municipios: [...muni.values()].sort((a, b) => a.corto.localeCompare(b.corto, 'es')),
    vias: [...via.values()].map(v => ({
      clave: v.clave, titulo: v.titulo, refs: [...v.refs],
      municipios: [...v.municipios].sort((a, b) => a.localeCompare(b, 'es')),
      ids: v.ids, km: v.km,
    })),
    rodaduras: TIPOS.map(t => rod.get(t)).filter(Boolean) as Indice['rodaduras'],
  }
}

/** 4 exacto, 3 empieza igual, 2 alguna palabra empieza igual, 1 lo contiene,
 * 0 no coincide. Ordena dentro de un grupo y decide qué grupo va primero:
 * teclear "junin" pone Municipios arriba sin que ese orden esté escrito a
 * mano en ningún lado. */
export function puntaje (texto: string, consulta: string): number {
  // Los dos lados se normalizan acá. buscar() ya normaliza su consulta una
  // vez, así que esto es trabajo repetido para él -- pero `puntaje` está
  // exportada y norm() es idempotente: la alternativa es una función pública
  // que devuelve 0 en silencio si quien la llama olvidó normalizar, que es
  // justo la clase de trampa que este repo ya pagó dos veces.
  const t = norm(texto)
  const q = norm(consulta)
  if (!q) return 0
  if (t === q) return 4
  if (t.startsWith(q)) return 3
  if (t.split(/[\s,./-]+/).some(p => p.startsWith(q))) return 2
  return t.includes(q) ? 1 : 0
}

// Cuántas vías caben antes de que la lista deje de ser una respuesta y pase a
// ser un volcado. Municipios (29) y rodaduras (6) no se recortan: caben
// enteras.
const TOPE_VIAS = 8

// Desempate cuando dos grupos puntúan igual: de lo más específico que se
// puede pedir a lo más amplio.
const ORDEN: Clase[] = ['municipio', 'via', 'condicion', 'rodadura', 'procedencia']

function detalleIds (ids: number[], ways: Way[]): string {
  let km = 0
  for (const i of ids) km += ways[i].km
  return `${nf.format(ids.length)} vías · ${km1(km)}`
}

export function buscar (consulta: string, idx: Indice, ways: Way[], store: AttrStore): Grupo[] {
  const q = norm(consulta.trim())
  if (!q) return []
  const grupos: Grupo[] = []

  const municipios = idx.municipios
    .map(m => ({ m, p: Math.max(puntaje(m.corto, q), puntaje(m.nombre, q)) }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || b.m.ids.length - a.m.ids.length)
  if (municipios.length) {
    grupos.push({
      clase: 'municipio',
      titulo: 'Municipios',
      items: municipios.map(({ m }) => {
        const evaluados = m.ids.reduce((n, i) => n + (store.get(i).pci != null ? 1 : 0), 0)
        return {
          clave: `mun:${m.nombre}`,
          clase: 'municipio' as const,
          titulo: m.corto,
          ids: m.ids,
          detalle: `${nf.format(m.ids.length)} vías · ${km1(m.km)} · ${Math.round(100 * evaluados / m.ids.length)}% evaluado`,
        }
      }),
    })
  }

  const vias = idx.vias
    .map(v => ({ v, p: Math.max(puntaje(v.titulo, q), ...v.refs.map(r => puntaje(r, q))) }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || b.v.km - a.v.km)
    .slice(0, TOPE_VIAS)
  if (vias.length) {
    grupos.push({
      clase: 'via',
      titulo: 'Vías',
      items: vias.map(({ v }) => ({
        clave: `via:${v.clave}`,
        clase: 'via' as const,
        titulo: v.titulo,
        ids: v.ids,
        // Los municipios que cruza importan más que el conteo de tramos: es
        // lo que distingue dos calles homónimas en pueblos distintos, y OSM
        // las tiene a montones ("Calle 5", "Avenida Bolívar").
        detalle: [
          `${nf.format(v.ids.length)} tramo${v.ids.length === 1 ? '' : 's'}`,
          km1(v.km),
          v.municipios.slice(0, 3).join(', ') + (v.municipios.length > 3 ? ` y ${v.municipios.length - 3} más` : ''),
        ].filter(Boolean).join(' · '),
      })),
    })
  }

  // Condición y procedencia salen del store, no de `ways`: cambian con cada
  // edición, así que no pueden vivir en el índice.
  const condiciones: Resultado[] = []
  for (const r of PCI_RANGES) {
    if (!puntaje(r.label, q)) continue
    const ids: number[] = []
    for (let i = 0; i < ways.length; i++) {
      const pci = store.get(i).pci
      if (pci != null && pci >= r.min && pci <= r.max) ids.push(i)
    }
    condiciones.push({
      clave: `pci:${r.label}`,
      clase: 'condicion',
      titulo: `${r.label} (PCI ${r.min} a ${r.max})`,
      ids,
      color: r.color,
      detalle: detalleIds(ids, ways),
    })
  }
  if (puntaje(SIN_EVALUAR_ETIQUETA, q)) {
    const ids: number[] = []
    for (let i = 0; i < ways.length; i++) if (store.get(i).pci == null) ids.push(i)
    condiciones.push({
      clave: 'pci:sin',
      clase: 'condicion',
      titulo: 'Sin evaluar',
      ids,
      color: SIN_EVALUAR,
      detalle: detalleIds(ids, ways),
    })
  }
  if (condiciones.length) grupos.push({ clase: 'condicion', titulo: 'Condición', items: condiciones })

  const rodaduras = idx.rodaduras
    .map(r => ({ r, p: puntaje(RODADURAS[r.tipo], q) }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p || b.r.ids.length - a.r.ids.length)
  if (rodaduras.length) {
    grupos.push({
      clase: 'rodadura',
      titulo: 'Rodadura',
      items: rodaduras.map(({ r }) => ({
        clave: `rod:${r.tipo}`,
        clase: 'rodadura' as const,
        titulo: RODADURAS[r.tipo],
        ids: r.ids,
        detalle: `${nf.format(r.ids.length)} vías · ${km1(r.km)}`,
      })),
    })
  }

  const procedencias: Resultado[] = []
  for (const f of FUENTES) {
    if (!puntaje(PROCEDENCIAS[f], q)) continue
    const ids: number[] = []
    for (let i = 0; i < ways.length; i++) if (store.get(i).fuente === f) ids.push(i)
    procedencias.push({
      clave: `fue:${f}`,
      clase: 'procedencia',
      titulo: PROCEDENCIAS[f],
      ids,
      detalle: detalleIds(ids, ways),
    })
  }
  if (procedencias.length) grupos.push({ clase: 'procedencia', titulo: 'Procedencia', items: procedencias })

  // Un grupo vale lo que vale su mejor coincidencia. Sin esto, teclear
  // "medido" pondría arriba un municipio que apenas lo contiene por dentro.
  const mejor = (g: Grupo) => Math.max(...g.items.map(it => puntaje(it.titulo, q)))
  return grupos
    .map(g => ({ ...g, items: g.items.filter(it => it.ids.length > 0) }))
    .filter(g => g.items.length > 0)
    .sort((a, b) => mejor(b) - mejor(a) || ORDEN.indexOf(a.clase) - ORDEN.indexOf(b.clase))
}

/** Resumen por municipio de una selección, para la ficha de varias vías.
 * Ordenado por peso: primero lo que domina, al final lo que se coló. Es el
 * orden en que uno quiere revisar lo que agarró el lazo. */
export function porMunicipio (ids: number[], ways: Way[]): Array<{ nombre: string; n: number; km: number }> {
  const m = new Map<string, { nombre: string; n: number; km: number }>()
  for (const i of ids) {
    const w = ways[i]
    const nombre = w.municipio ? cortoMunicipio(w.municipio) : SIN_MUNICIPIO
    let e = m.get(nombre)
    if (!e) m.set(nombre, e = { nombre, n: 0, km: 0 })
    e.n++; e.km += w.km
  }
  return [...m.values()].sort((a, b) => b.km - a.km)
}
