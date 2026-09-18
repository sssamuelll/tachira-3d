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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
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
  const comunes = readdirSync(a.capturas)
    .filter(f => f.endsWith('.png') && existsSync(b.capturas + '/' + f))
    .sort()
  const diferencia = nombre => {
    const ia = PNG.sync.read(readFileSync(a.capturas + '/' + nombre))
    const ib = PNG.sync.read(readFileSync(b.capturas + '/' + nombre))
    if (ia.width !== ib.width || ia.height !== ib.height) return null
    let distintos = 0; let suma = 0
    for (let i = 0; i < ia.data.length; i += 4) {
      const d = Math.max(Math.abs(ia.data[i] - ib.data[i]), Math.abs(ia.data[i + 1] - ib.data[i + 1]), Math.abs(ia.data[i + 2] - ib.data[i + 2]))
      suma += d
      if (d > UMBRAL) distintos++
    }
    const total = ia.data.length / 4
    return { pct: (100 * distintos) / total, media: suma / total }
  }
  const tabla = (titulo, nombres, veredicto) => {
    if (!nombres.length) return
    console.log('')
    console.log(titulo)
    let peorImg = { nombre: null, pct: 0 }
    for (const nombre of nombres) {
      const d = diferencia(nombre)
      const etiqueta = nombre.replace(/\.png$/, '').replace(/__sinfoto$/, '')
      if (!d) { console.log(etiqueta.padEnd(24) + '  tamaños distintos'); continue }
      console.log(etiqueta.padEnd(24) + col(d.pct.toFixed(2), 16) + '%' + col(d.media.toFixed(2), 16))
      if (d.pct > peorImg.pct) peorImg = { nombre: etiqueta, pct: d.pct }
    }
    console.log(veredicto + ': ' + (peorImg.nombre ?? 'ninguna') + ' ' + peorImg.pct.toFixed(2) + '% de los píxeles')
  }
  // Las de la foto satelital encendida van primero pero valen poco: medido
  // sobre el MISMO commit dos veces, la vista de ciudad daba 59 % de píxeles
  // distintos con la geometría idéntica, porque las teselas de Esri llegan en
  // otro orden cada vez. Las __sinfoto son la hipsometría del DEM propio, que
  // es la misma siempre: ahí una diferencia sí significa algo.
  tabla('capturas CON foto (ruidosas, la vista de ciudad varía ~59% sola)',
    comunes.filter(f => !f.includes('__sinfoto')), 'la que más cambió')
  tabla('capturas SIN foto (esto es lo que vale como veredicto visual)',
    comunes.filter(f => f.includes('__sinfoto')), 'VEREDICTO VISUAL, la que más cambió')
}
