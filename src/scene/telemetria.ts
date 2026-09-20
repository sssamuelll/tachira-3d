/**
 * Qué se dibujó en cada cuadro, y sobre todo qué CAMBIÓ respecto al anterior.
 *
 * El mapa no tiene un "bug de un cuadro": tiene cosas que entran y salen de la
 * pantalla solas -- una tesela que se afina y vuelve a la del padre, un chunk
 * de edificios que se apaga porque su suelo dejó de estar listo. Eso no se ve
 * en fps ni en draw calls: los dos números salen iguales parpadee o no. Lo que
 * lo delata es el CHURN: cuántas claves entran y salen del conjunto dibujado
 * por cuadro, y cuántas de esas salieron y volvieron enseguida (`parpadeo`).
 *
 * Apagada no guarda nada ni reserva nada: cada método sale en la primera
 * línea. La enciende el puente de diagnóstico (App.tsx), o sea `?diagnostico=1`
 * y el modo desarrollo, igual que `window.__escena`. Quien la alimenta debe
 * envolver en `if (telemetria.activa)` cualquier estructura que arme solo para
 * ella -- los Set y Map que ya existen para dibujar se pasan tal cual.
 *
 * Se lee desde la consola o desde la sonda (scripts/perf-baseline.mjs):
 *
 *     __telemetria.resumen()        // promedio por cuadro, máximo y total
 *     __telemetria.cuadros()        // el anillo crudo, cuadro a cuadro
 */

// Cuadros que se conservan: 10 s a 60 fps. Un anillo de 600 objetos planos son
// unos pocos cientos de kB y cubre de sobra un gesto de órbita o de zoom.
const CUADROS_MAX = 600

// Claves de ejemplo que se guardan de cada conjunto que cambia, para poder
// mirar QUÉ nodo parpadeó y no solo cuántos. Tres bastan para reconocer el
// patrón (mismo z, misma esquina) sin llenar el anillo de cadenas.
const EJEMPLOS = 3

export type Cuadro = Record<string, number>

class Telemetria {
  activa = false
  private anillo: Cuadro[] = []
  private actual: Cuadro = {}
  private ejemplos: Record<string, string[]> = {}
  // Los dos cuadros anteriores de cada conjunto: el penúltimo es lo que
  // permite distinguir "salió" de "salió y volvió" (parpadeo).
  private previo = new Map<string, Set<string>>()
  private anterior = new Map<string, Set<string>>()
  private niveles = new Map<string, Map<string, number>>()

  /** Un evento suelto del cuadro en curso: nodos armados, teselas desalojadas,
   *  cupo agotado. Se suma; el nombre lleva grupo delante (`terreno.armados`). */
  sube (clave: string, n = 1): void {
    if (!this.activa) return
    this.actual[clave] = (this.actual[clave] ?? 0) + n
  }

  /** Un valor que no se suma sino que ES el del cuadro (tamaño de una caché). */
  pone (clave: string, n: number): void {
    if (!this.activa) return
    this.actual[clave] = n
  }

  /**
   * Un conjunto de claves dibujadas este cuadro. Deja `<nombre>` (cuántas),
   * `.entra`, `.sale` y `.parpadeo` (las que habían salido el cuadro anterior
   * y volvieron ahora: la firma exacta de lo que se ve titilar).
   */
  conjunto (nombre: string, actual: Set<string>): void {
    if (!this.activa) return
    this.actual[nombre] = actual.size
    const previo = this.previo.get(nombre)
    if (previo) {
      const anterior = this.anterior.get(nombre)
      let entra = 0, sale = 0, parpadeo = 0
      const muestra: string[] = []
      for (const k of actual) {
        if (previo.has(k)) continue
        entra++
        if (anterior?.has(k)) { parpadeo++; if (muestra.length < EJEMPLOS) muestra.push(k) }
      }
      for (const k of previo) if (!actual.has(k)) sale++
      if (entra) this.actual[nombre + '.entra'] = entra
      if (sale) this.actual[nombre + '.sale'] = sale
      if (parpadeo) {
        this.actual[nombre + '.parpadeo'] = parpadeo
        this.ejemplos[nombre + '.parpadeo'] = muestra
      }
    }
    this.anterior.set(nombre, previo ?? new Set())
    this.previo.set(nombre, new Set(actual))
  }

  /**
   * Un nivel por clave (el z de la foto que está usando cada nodo, el LOD de
   * una capa). Deja `.sube` cuando el nivel mejora y `.baja` cuando empeora:
   * una tesela que cae al padre borroso y vuelve es el parpadeo que se ve sin
   * que el nodo deje de dibujarse un solo cuadro.
   */
  mapa (nombre: string, actual: Map<string, number>): void {
    if (!this.activa) return
    this.actual[nombre] = actual.size
    const previo = this.niveles.get(nombre)
    if (previo) {
      let sube = 0, baja = 0
      const muestra: string[] = []
      for (const [k, v] of actual) {
        const antes = previo.get(k)
        if (antes === undefined || antes === v) continue
        if (v > antes) sube++
        else { baja++; if (muestra.length < EJEMPLOS) muestra.push(`${k}:${antes}->${v}`) }
      }
      if (sube) this.actual[nombre + '.sube'] = sube
      if (baja) { this.actual[nombre + '.baja'] = baja; this.ejemplos[nombre + '.baja'] = muestra }
    }
    this.niveles.set(nombre, new Map(actual))
  }

  /** Cuánto tardó una parte del cuadro, en ms. Se mide con performance.now()
   *  y solo con la telemetría encendida: el reloj cuesta más que varias de
   *  las cuentas de arriba. El `max` del resumen es lo que nombra al culpable
   *  de una tarea larga del hilo principal. */
  mide<T> (clave: string, fn: () => T): T {
    if (!this.activa) return fn()
    const t0 = performance.now()
    try { return fn() } finally { this.sube(clave, +(performance.now() - t0).toFixed(2)) }
  }

  /** Cierra el cuadro en curso y lo mete en el anillo. Lo llama UN solo sitio
   *  (el useFrame de más baja prioridad), no cada componente. */
  cerrarCuadro (): void {
    if (!this.activa) return
    this.anillo.push(this.actual)
    if (this.anillo.length > CUADROS_MAX) this.anillo.shift()
    this.actual = {}
  }

  cuadros (): readonly Cuadro[] { return this.anillo }

  /** Promedio por cuadro, máximo y total de cada clave del anillo, ordenado
   *  por total. `ejemplos` trae las últimas claves que parpadearon. */
  resumen (): Record<string, { cuadro: number; max: number; total: number }> & {
    cuadros: number; ejemplos: Record<string, string[]>; peor: Cuadro
  } {
    // El cuadro más lento entero, tal cual: es lo que dice qué estaba
    // haciendo el mapa en el tirón, que ningún promedio puede contar.
    let peor: Cuadro = {}
    for (const c of this.anillo) if ((c['cuadro.dt'] ?? 0) > (peor['cuadro.dt'] ?? 0)) peor = c
    const out = { cuadros: this.anillo.length, ejemplos: this.ejemplos, peor } as ReturnType<Telemetria['resumen']>
    const total: Record<string, number> = {}, max: Record<string, number> = {}
    for (const c of this.anillo) {
      for (const k in c) {
        total[k] = (total[k] ?? 0) + c[k]
        max[k] = Math.max(max[k] ?? 0, c[k])
      }
    }
    for (const k of Object.keys(total).sort((a, b) => total[b] - total[a])) {
      out[k] = { cuadro: +(total[k] / this.anillo.length).toFixed(2), max: max[k], total: +total[k].toFixed(2) }
    }
    return out
  }

  reiniciar (): void {
    this.anillo = []; this.actual = {}; this.ejemplos = {}
    this.previo.clear(); this.anterior.clear(); this.niveles.clear()
  }
}

export const telemetria = new Telemetria()
