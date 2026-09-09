import { readFileSync, existsSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { tileXf, tileYf } from './terrarium.mjs'
import { dentroAnillo } from './building-input.mjs'

const median = a => a.sort((x, y) => x - y)[a.length >> 1]

/** Median of unique pixel centres strictly inside footprint, excluding courtyards. */
export function medianaTecho (polygons, pixel, zoom = 18, maxSamples = 400) {
  const samples = [], visited = new Set()
  for (const polygon of polygons) {
    const project = r => r.map(([lon, lat]) => [tileXf(lon, zoom) * 256, tileYf(lat, zoom) * 256])
    const outer = project(polygon.outer), holes = polygon.holes.map(project)
    const xs = outer.map(p => p[0]), ys = outer.map(p => p[1])
    const minX = Math.floor(Math.min(...xs)), maxX = Math.ceil(Math.max(...xs)), minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys))
    const step = Math.max(1, Math.ceil(Math.sqrt((maxX - minX) * (maxY - minY) / maxSamples)))
    for (let y = minY; y < maxY; y += step) for (let x = minX; x < maxX; x += step) {
      const p = [x + 0.5, y + 0.5], key = `${x}/${y}`
      if (visited.has(key) || !dentroAnillo(p, outer) || holes.some(h => dentroAnillo(p, h))) continue
      visited.add(key)
      const rgb = pixel(zoom, x, y)
      if (rgb) samples.push(rgb)
    }
  }
  if (samples.length < 3) return null
  return { rgb: [0, 1, 2].map(i => median(samples.map(rgb => rgb[i]))), fuente: 'satelite', zoom, muestras: samples.length }
}

/** Offline only: optional z18 cache from the sibling and this project's baked z12. */
export function crearMuestreadorTechos ({ satCache, imgDir = 'public/data/img', cacheMax = 64 } = {}) {
  const decoded = new Map()
  function tile (z, x, y) {
    const key = `${z}/${x}/${y}`
    if (decoded.has(key)) { const value = decoded.get(key); decoded.delete(key); decoded.set(key, value); return value }
    const path = z === 18 && satCache ? `${satCache}/z18_${x}_${y}.jpg` : `${imgDir}/${key}.jpg`
    let img = null
    if (existsSync(path)) {
      try { img = jpeg.decode(readFileSync(path), { useTArray: true, formatAsRGBA: false }) } catch { /* Missing/invalid photo is explicitly estimated. */ }
    }
    decoded.set(key, img)
    while (decoded.size > cacheMax) decoded.delete(decoded.keys().next().value)
    return img
  }
  function pixel (z, gx, gy) {
    const img = tile(z, Math.floor(gx / 256), Math.floor(gy / 256))
    if (!img) return null
    const offset = ((gy % 256) * img.width + (gx % 256)) * 3
    return [img.data[offset], img.data[offset + 1], img.data[offset + 2]]
  }
  return building => {
    const measured = medianaTecho(building.polygons, pixel)
    if (measured) return measured
    // z12 has ~38 m pixels: contextual colour, never a claimed roof measurement.
    const outer = building.polygons[0].outer
    const lon = outer.reduce((s, p) => s + p[0], 0) / outer.length, lat = outer.reduce((s, p) => s + p[1], 0) / outer.length
    const gx = Math.floor(tileXf(lon, 12) * 256), gy = Math.floor(tileYf(lat, 12) * 256)
    const context = pixel(12, gx, gy)
    // Restrict chroma/brightness of the coarse land-cover sample to plausible roofing.
    const rgb = context ? context.map(v => Math.round(145 * 0.65 + Math.max(65, Math.min(190, v)) * 0.35)) : [145, 143, 139]
    return { rgb, fuente: 'estimada', zoom: context ? 12 : null, muestras: context ? 1 : 0, detalle: context ? 'contexto-satelital-z12; no resuelve el techo' : 'respaldo-neutro' }
  }
}
