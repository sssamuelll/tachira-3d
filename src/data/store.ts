import { FUENTES, TIPOS } from './constants'
import type { Way, Registro } from './types'

const hoy = () => new Date().toISOString().slice(0, 10)
const vacio = (): Registro => ({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '' })

// El JSON de entrada de loadJSON puede traer texto escrito a mano por una
// persona (el spec versiona pci-tachira.json en git para que el usuario
// resuelva huérfanos en el diff) — pci/fuente/tipo se normalizan al valor
// "sin dato" de su campo en vez de propagar un valor fuera de dominio, que
// silenciosamente se vería mal en la data texture (ej. pci:150 se recortaría
// a 100 = "Bueno" en vez de avisar que el dato está corrupto).
function normalizar (reg: Registro): { reg: Registro; corrupto: boolean } {
  const fuenteOk = FUENTES.includes(reg.fuente)
  const tipoOk = TIPOS.includes(reg.tipo)
  const pciOk = reg.pci == null || (Number.isFinite(reg.pci) && reg.pci >= 0 && reg.pci <= 100)
  if (fuenteOk && tipoOk && pciOk) return { reg, corrupto: false }
  return {
    reg: {
      ...reg,
      fuente: fuenteOk ? reg.fuente : 'sin',
      tipo: tipoOk ? reg.tipo : 'sin_definir',
      pci: pciOk ? reg.pci : null,
    },
    corrupto: true,
  }
}

// Store de atributos de las vías, fuera de React a propósito: 26.712 registros
// no pasan por useState — la escena los lee de una data texture (Task 14) que
// se refresca con onChange, no por re-render de componentes.
export class AttrStore {
  private regs: Registro[]
  private listeners: Array<() => void> = []

  constructor (private ways: Way[]) {
    this.regs = ways.map(vacio)
  }

  get length (): number { return this.regs.length }

  /** Referencia viva, no copia: mutarla directamente salta la fecha y el
   * onChange que garantiza set(). Para editar, usar siempre set(). */
  get (i: number): Registro { return this.regs[i] }

  onChange (cb: () => void) { this.listeners.push(cb) }
  private notify () { for (const cb of this.listeners) cb() }

  /** Un solo notify por lote: con selecciones de miles de vías, notificar por
   * elemento es la diferencia entre instantáneo y colgado.
   *
   * `Partial<Registro>` es un tipo de TypeScript, se borra al compilar: no
   * protege contra un <select> mal tipado ni un `as any` de la UI. Se
   * normaliza el registro resultante del merge (no el patch suelto, para no
   * tumbar un campo válido que el patch no menciona) con el mismo criterio
   * que ya usa loadJSON() — un pci corrupto (NaN, fuera de 0-100) no debe
   * poder llegar a la data texture como 0 = "Colapsado".
   *
   * `fuente` describe la procedencia del PCI, no de la rodadura (fix Task
   * 19): un patch que no trae la clave `pci` no debe pisar la fuente de un
   * registro ya medido solo porque de paso cambia el tipo o la nota — si no,
   * fijar la rodadura en bloque sobre un municipio degrada en silencio el
   * trabajo de campo de cualquier vía ya inspeccionada que caiga en el lote.
   * `'pci' in patch` (no `patch.pci != null`) es la prueba correcta: un
   * `pci: null` explícito SÍ es tocar el campo (des-evaluar a propósito),
   * omitir la clave es no tocarlo.
   *
   * `fecha` sigue el mismo criterio, por el mismo motivo (fix Task 19 ronda
   * 2): fijar la rodadura en bloque tampoco debe reescribir cuándo se midió
   * un PCI que nadie repitió — la antigüedad de una medición decide si
   * todavía vale tanto como su procedencia. */
  set (indices: number[], patch: Partial<Registro>) {
    const tocaPci = 'pci' in patch
    const { fuente, fecha, ...resto } = patch
    const p = tocaPci ? patch : resto
    for (const i of indices) {
      const merged = { ...this.regs[i], ...p, fecha: tocaPci ? (fecha ?? hoy()) : this.regs[i].fecha }
      this.regs[i] = normalizar(merged).reg
    }
    this.notify()
  }

  /** El surface de OSM (ya resuelto a tipo por el pipeline) siembra el tipo
   * de rodadura con procedencia heredado. Devuelve cuántas vías sembró. */
  seedFromSurface (): number {
    let n = 0
    for (let i = 0; i < this.ways.length; i++) {
      const t = this.ways[i].tipo
      if (t !== 'sin_definir') {
        this.regs[i] = { ...this.regs[i], tipo: t, fuente: 'heredado', fecha: hoy() }
        n++
      }
    }
    this.notify()
    return n
  }

  coverageByMunicipio (): Map<string, { total: number; evaluados: number }> {
    const out = new Map<string, { total: number; evaluados: number }>()
    for (let i = 0; i < this.ways.length; i++) {
      const m = this.ways[i].municipio ?? 'sin municipio'
      const e = out.get(m) ?? { total: 0, evaluados: 0 }
      e.total++
      if (this.regs[i].pci != null) e.evaluados++
      out.set(m, e)
    }
    return out
  }

  /** Solo serializa lo que tiene dato real: un registro vacío no ensucia el JSON.
   * Incluye `tipo` en la condición, no solo pci/fuente/nota: desde el fix de
   * Task 19 (arriba, en set()), aplicar solo rodadura a una vía que nunca
   * tuvo PCI ya no toca `fuente` -- se queda en 'sin'. Sin `tipo` acá, ese
   * cambio no entraba en el JSON y se perdía en el próximo loadJSON(): pérdida
   * de datos silenciosa, no un registro vacío de verdad. */
  toJSON () {
    const registros: Record<string, Registro> = {}
    for (let i = 0; i < this.regs.length; i++) {
      const r = this.regs[i]
      if (r.pci != null || r.fuente !== 'sin' || r.tipo !== 'sin_definir' || r.nota) {
        registros[String(this.ways[i].osmId)] = r
      }
    }
    return { version: 1, actualizado: hoy(), registros }
  }

  /** Restaura por osmId el mismo objeto que produce toJSON(). Nunca descarta
   * en silencio, en dos frentes distintos:
   *  - orphans: ids que ya no existen en la red (una vía partida en OSM) —
   *    el registro no se toca, el usuario decide qué hacer con él.
   *  - invalid: ids cuyo fuente/tipo/pci está fuera de dominio (JSON editado
   *    a mano) — se normalizan al "sin dato" de su campo y se cargan igual;
   *    un registro corrupto no le cuesta el archivo entero a los otros. */
  loadJSON (obj: { version?: number; actualizado?: string; registros?: Record<string, Registro> }, ways: Way[]): { orphans: string[]; invalid: string[] } {
    const porId = new Map(ways.map((w, i) => [String(w.osmId), i]))
    const orphans: string[] = []
    const invalid: string[] = []
    for (const [id, reg] of Object.entries(obj.registros ?? {})) {
      const i = porId.get(id)
      if (i == null) { orphans.push(id); continue }
      const { reg: limpio, corrupto } = normalizar(reg)
      if (corrupto) invalid.push(id)
      this.regs[i] = { ...vacio(), ...limpio }
    }
    this.notify()
    return { orphans, invalid }
  }
}
