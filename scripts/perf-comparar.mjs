// Compara dos corridas de perf-baseline.mjs. Es el veredicto de un cambio de
// rendimiento: sin esto, "quedó más rápido" es una impresión.
//   node scripts/perf-comparar.mjs .cache/perf/base.json .cache/perf/f1.json
//
// El signo se lee siempre igual: en ms y en peticiones, menos es mejor; en fps,
// más es mejor. La última línea es la peor regresión de ms_p50 entre muestras
// comparables, que es lo que decide si un cambio pasa o no.
//
// Si las dos corridas llevan --capturas, también compara las imágenes. Eso es
// la otra mitad del veredicto: un cambio que acelera porque dejó de dibujar
// algo se ve perfecto en la tabla de milisegundos.
import { readFileSync, existsSync } from 'node:fs'
import { PNG } from 'pngjs'

const [rutaA, rutaB] = process.argv.slice(2)
if (!rutaA || !rutaB) { console.error('uso: node scripts/perf-comparar.mjs <antes.json> <después.json>'); process.exit(2) }
const a = JSON.parse(readFileSync(rutaA, 'utf8'))
const b = JSON.parse(readFileSync(rutaB, 'utf8'))
const porEtiqueta = r => new Map(r.muestras.map(m => [m.etiqueta, m]))
const A = porEtiqueta(a), B = porEtiqueta(b)

// Diferencia relativa en porcentaje, con el signo tal cual: -30% en ms es 30%
// más rápido. Un antes en cero no tiene porcentaje que valga.
const rel = (antes, despues) => (antes === 0 ? '  n/d' : (((despues - antes) / antes) * 100).toFixed(0).padStart(4) + '%')
const col = (x, n = 7) => String(x).padStart(n)

const shaders = r => r.errores.filter(e => e.includes('VALIDATE_STATUS') || e.includes('program not valid')).length

console.log('antes:   ' + rutaA + '  (' + a.url + ')')
console.log('después: ' + rutaB + '  (' + b.url + ')')
console.log('')
console.log('carga      primer cuadro ' + col(a.hitos.armando_fuera_ms) + ' -> ' + col(b.hitos.armando_fuera_ms) + ' ms  ' + rel(a.hitos.armando_fuera_ms, b.hitos.armando_fuera_ms))
console.log('           MB al arrancar ' + col(a.red_arranque?.MB) + ' -> ' + col(b.red_arranque?.MB) + ' MB  ' + rel(a.red_arranque?.MB, b.red_arranque?.MB))
console.log('           peticiones     ' + col(a.red_arranque?.peticiones) + ' -> ' + col(b.red_arranque?.peticiones) + '     ' + rel(a.red_arranque?.peticiones, b.red_arranque?.peticiones))
console.log('errores de shader         ' + col(shaders(a)) + ' -> ' + col(shaders(b)))
console.log('')
console.log('muestra                     ms p50            ms p95            draw calls        k triángulos')
let peor = { etiqueta: null, pct: -Infinity }
for (const [etiqueta, ma] of A) {
  const mb = B.get(etiqueta)
  if (!mb) { console.log(etiqueta.padEnd(24) + '  no está en la corrida nueva'); continue }
  console.log(
    etiqueta.padEnd(24) +
    col(ma.ms_p50) + '->' + col(mb.ms_p50) + rel(ma.ms_p50, mb.ms_p50) + '  ' +
    col(ma.ms_p95) + '->' + col(mb.ms_p95) + rel(ma.ms_p95, mb.ms_p95) + '  ' +
    col(ma.calls, 5) + '->' + col(mb.calls, 5) + rel(ma.calls, mb.calls) + '  ' +
    col(ma.tris_k, 6) + '->' + col(mb.tris_k, 6) + rel(ma.tris_k, mb.tris_k),
  )
  const p = ((mb.ms_p50 - ma.ms_p50) / ma.ms_p50) * 100
  if (p > peor.pct) peor = { etiqueta, pct: p }
}
console.log('')
console.log('peor regresión de ms_p50: ' + (peor.etiqueta ?? 'ninguna') + ' ' + peor.pct.toFixed(0) + '%')

// Las capturas. UMBRAL en niveles de 0-255 por canal: por debajo de eso son
// las diferencias que deja el propio motor entre dos corridas (el orden en que
// llegan las teselas de la foto satelital, sobre todo), no un cambio de dibujo.
const UMBRAL = 12
if (a.capturas && b.capturas && existsSync(a.capturas) && existsSync(b.capturas)) {
  console.log('')
  console.log('capturas                   píxeles distintos   diferencia media')
  let peorImg = { etiqueta: null, pct: 0 }
  for (const etiqueta of A.keys()) {
    const nombre = etiqueta.replace(/[^\w.-]+/g, '_') + '.png'
    const pa = a.capturas + '/' + nombre, pb = b.capturas + '/' + nombre
    if (!existsSync(pa) || !existsSync(pb)) continue
    const ia = PNG.sync.read(readFileSync(pa)), ib = PNG.sync.read(readFileSync(pb))
    if (ia.width !== ib.width || ia.height !== ib.height) { console.log(etiqueta.padEnd(24) + '  tamaños distintos'); continue }
    let distintos = 0, suma = 0
    for (let i = 0; i < ia.data.length; i += 4) {
      const d = Math.max(Math.abs(ia.data[i] - ib.data[i]), Math.abs(ia.data[i + 1] - ib.data[i + 1]), Math.abs(ia.data[i + 2] - ib.data[i + 2]))
      suma += d
      if (d > UMBRAL) distintos++
    }
    const total = ia.data.length / 4
    const pct = (100 * distintos) / total
    console.log(etiqueta.padEnd(24) + col(pct.toFixed(2), 16) + '%' + col((suma / total).toFixed(2), 16))
    if (pct > peorImg.pct) peorImg = { etiqueta, pct }
  }
  console.log('')
  console.log('captura que más cambió: ' + (peorImg.etiqueta ?? 'ninguna') + ' ' + peorImg.pct.toFixed(2) + '% de los píxeles')
}
