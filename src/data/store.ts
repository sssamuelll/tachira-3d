import type { Way, Registro } from './types'

const hoy = () => new Date().toISOString().slice(0, 10)
const vacio = (): Registro => ({ pci: null, fuente: 'sin', tipo: 'sin_definir', fecha: '', nota: '' })

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
   * elemento es la diferencia entre instantáneo y colgado. */
  set (indices: number[], patch: Partial<Registro>) {
    for (const i of indices) {
      this.regs[i] = { ...this.regs[i], ...patch, fecha: patch.fecha ?? hoy() }
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

  /** Solo serializa lo que tiene dato real: un registro vacío no ensucia el JSON. */
  toJSON () {
    const registros: Record<string, Registro> = {}
    for (let i = 0; i < this.regs.length; i++) {
      const r = this.regs[i]
      if (r.pci != null || r.fuente !== 'sin' || r.nota) registros[String(this.ways[i].osmId)] = r
    }
    return { version: 1, actualizado: hoy(), registros }
  }

  /** Restaura por osmId el mismo objeto que produce toJSON(). Ids que ya no
   * existen en la red (una vía partida en OSM) se devuelven, no se borran:
   * el usuario decide qué hacer con ellos. */
  loadJSON (obj: { version?: number; actualizado?: string; registros?: Record<string, Registro> }, ways: Way[]): string[] {
    const porId = new Map(ways.map((w, i) => [String(w.osmId), i]))
    const huerfanos: string[] = []
    for (const [id, reg] of Object.entries(obj.registros ?? {})) {
      const i = porId.get(id)
      if (i == null) huerfanos.push(id)
      else this.regs[i] = { ...vacio(), ...reg }
    }
    this.notify()
    return huerfanos
  }
}
