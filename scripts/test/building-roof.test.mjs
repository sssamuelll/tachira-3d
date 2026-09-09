import { describe, expect, it } from 'vitest'
import { medianaTecho, crearMuestreadorTechos } from '../lib/building-roof.mjs'
import { tileXToLon, tileYToLat } from '../lib/terrarium.mjs'

const polygon = (x0, y0, x1, y1, zoom = 18) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [tileXToLon(x / 256, zoom), tileYToLat(y / 256, zoom)])
describe('mediana de techo sobre píxeles reales', () => {
  it('excluye patios aun cuando dominan el centro del bbox', () => {
    const x = 20000000, y = 32000000
    const p = { outer: polygon(x, y, x + 10, y + 10), holes: [polygon(x + 1, y + 1, x + 9, y + 9)] }
    const sample = medianaTecho([p], (_z, gx, gy) => gx >= x + 1 && gx < x + 9 && gy >= y + 1 && gy < y + 9 ? [0, 255, 0] : [151, 90, 62])
    expect(sample.rgb).toEqual([151, 90, 62])
    expect(sample.fuente).toBe('satelite')
    expect(sample.muestras).toBe(36)
  })

  it('no inventa una mediana repitiendo un único píxel de una huella diminuta', () => {
    const p = { outer: polygon(20000000, 32000000, 20000001, 32000001), holes: [] }
    expect(medianaTecho([p], () => [120, 80, 60])).toBeNull()
  })

  it('marca el respaldo sin fotografía como estimado', () => {
    const sample = crearMuestreadorTechos({ satCache: 'ruta-inexistente', imgDir: 'ruta-inexistente' })({ polygons: [{ outer: polygon(20000000, 32000000, 20000003, 32000003), holes: [] }] })
    expect(sample).toMatchObject({ fuente: 'estimada', zoom: null, muestras: 0 })
  })
})
