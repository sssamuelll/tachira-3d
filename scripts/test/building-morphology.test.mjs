import { describe, expect, it } from 'vitest'
import { crearContexto, estimarAltura } from '../lib/building-morphology.mjs'

const huella = (id = 'way/1', x = 0, z = 0, extra = {}) => ({
  id, x, z, area: 110, elongacion: 1.2, compacidad: 0.75, tags: {}, ...extra,
})
const señales = (densidad, intensidad) => ({
  densidad, intensidad, contexto: 0.58 * densidad + 0.24 * intensidad + 0.09,
  via: intensidad ? 'primary' : null, distanciaVia: intensidad ? 10 : null,
})
const varianza = valores => {
  const media = valores.reduce((a, b) => a + b, 0) / valores.length
  return valores.reduce((a, b) => a + (b - media) ** 2, 0) / valores.length
}

describe('estimarAltura: procedencia y precedencia OSM', () => {
  it('height válido manda sobre levels y morfología, sin recortar alturas reales', () => {
    const edificio = huella('way/1', 0, 0, { tags: { height: '145.6 m', 'building:levels': '2' } })
    const resultado = estimarAltura(edificio, señales(0, 0))
    expect(resultado.metros).toBe(145.6)
    expect(resultado.fuente).toBe('osm-height')
    expect(resultado.niveles).toBe(2)
  })

  it.each([
    ['12', 12], ['12.5m', 12.5], ['12,5 m', 12.5], ['40 ft', 12.192],
    ["40'", 12.192], ["5' 6\"", 1.6764], ['40 feet', 12.192], [8.25, 8.25],
  ])('interpreta height %s sin confundir unidades', (height, metros) => {
    const resultado = estimarAltura(huella('way/2', 0, 0, { tags: { height } }), señales(1, 1))
    expect(resultado.metros).toBeCloseTo(metros, 5)
    expect(resultado.fuente).toBe('osm-height')
  })

  it('usa los niveles válidos a 3 m/planta cuando no hay height interpretable', () => {
    const resultado = estimarAltura(huella('way/3', 0, 0, {
      tags: { height: 'aprox. 20', 'building:levels': '3.5' },
    }), señales(0, 0))
    expect(resultado).toMatchObject({ metros: 10.5, fuente: 'osm-levels', niveles: 3.5 })
  })

  it.each([undefined, null, '', ' ', '-4', '0', '10;20', '12-15', '12 yards',
    '12 metros aprox.', 'Infinity', 'NaN', true, {}, Infinity, NaN])(
    'no trata el dato height ambiguo %s como una medición', height => {
      const resultado = estimarAltura(huella('way/4', 0, 0, { tags: { height } }), señales(0.4, 0.3))
      expect(resultado.fuente).toBe('estimada')
      expect(Number.isFinite(resultado.metros)).toBe(true)
      expect(resultado.metros).toBeGreaterThan(0)
    })

  it.each(['0', '-2', '3;4', '3 plantas', true, NaN])('rechaza building:levels ambiguo %s', levels => {
    expect(estimarAltura(huella('way/5', 0, 0, {
      tags: { 'building:levels': levels },
    }), señales(0, 0)).fuente).toBe('estimada')
  })

  it('incluye las señales usadas para explicar y revisar la estimación', () => {
    const resultado = estimarAltura(huella(), señales(0.5, 0.8))
    expect(resultado.evidencia).toMatchObject({
      area: 110, elongacion: 1.2, compacidad: 0.75, densidad: 0.5,
      intensidad: 0.8, via: 'primary', distanciaVia: 10,
    })
  })
})

describe('crearContexto: estructura urbana continua y reproducible', () => {
  it('es determinista aunque se reordenen las huellas y las vías', () => {
    const huellas = Array.from({ length: 40 }, (_, i) => huella(`way/${i}`, (i % 8) * 24, Math.floor(i / 8) * 25))
    const vias = [
      { ax: -200, az: 5, bx: 500, bz: 5, highway: 'residential' },
      { ax: -200, az: 50, bx: 500, bz: 50, highway: 'primary' },
    ]
    const antes = structuredClone(huellas)
    const a = crearContexto(huellas, vias)
    const b = crearContexto([...huellas].reverse(), [...vias].reverse())
    for (const h of huellas) {
      expect(b.get(h.id)).toEqual(a.get(h.id))
      expect(estimarAltura(h, a.get(h.id))).toEqual(estimarAltura(h, b.get(h.id)))
    }
    expect(huellas).toEqual(antes)
  })

  it('detecta la avenida cercana aunque una calle local esté entre ella y la huella', () => {
    const h = huella()
    const contexto = crearContexto([h], [
      { ax: -500, az: 2, bx: 500, bz: 2, highway: 'residential' },
      { ax: -500, az: 24, bx: 500, bz: 24, highway: 'primary' },
    ]).get(h.id)
    expect(contexto.via).toBe('primary')
    expect(contexto.distanciaVia).toBe(24)
    expect(contexto.intensidad).toBeGreaterThan(0.5)
  })

  it('mantiene la influencia continua al cruzar una celda espacial', () => {
    const huellas = [huella('way/1', 159.99), huella('way/2', 160.01)]
    const vias = [{ ax: -200, az: 35, bx: 500, bz: 35, highway: 'secondary' }]
    const a = crearContexto(huellas, vias).get('way/1')
    const b = crearContexto(huellas, vias).get('way/2')
    expect(Math.abs(a.contexto - b.contexto)).toBeLessThan(0.001)
    expect(Math.abs(a.densidad - b.densidad)).toBeLessThan(0.001)
  })

  it('no extrapola vías fuera del radio de influencia', () => {
    const h = huella()
    const contexto = crearContexto([h], [
      { ax: -500, az: 1000, bx: 500, bz: 1000, highway: 'primary' },
    ]).get(h.id)
    expect(contexto).toMatchObject({ via: null, distanciaVia: null, intensidad: 0, densidad: 0 })
  })

  it('la densidad responde al vecindario y no a la cantidad global del archivo', () => {
    const h = huella()
    const cerca = Array.from({ length: 200 }, (_, i) => huella(`way/c${i}`, (i % 20) * 15 - 140, Math.floor(i / 20) * 15 - 70))
    const lejos = cerca.map(c => ({ ...c, x: c.x + 10_000 }))
    const denso = crearContexto([h, ...cerca], []).get(h.id)
    const disperso = crearContexto([h, ...lejos], []).get(h.id)
    expect(denso.densidad).toBeGreaterThan(0.45)
    expect(disperso.densidad).toBe(0)
  })

  it('distingue tejidos de más de 120 vecinos efectivos sin saturar ambos a uno', () => {
    const barrio = paso => Array.from({ length: 31 * 31 }, (_, i) =>
      huella(`way/${i}`, (i % 31 - 15) * paso, (Math.floor(i / 31) - 15) * paso))
    const idCentral = 'way/480'
    const medio = crearContexto(barrio(18), []).get(idCentral)
    const compacto = crearContexto(barrio(12), []).get(idCentral)
    expect(medio.vecinosEfectivos).toBeGreaterThan(120)
    expect(compacto.vecinosEfectivos).toBeGreaterThan(medio.vecinosEfectivos * 1.8)
    expect(compacto.densidad).toBeGreaterThan(medio.densidad + 0.15)
    expect(compacto.densidad).toBeLessThan(0.99)
  })

  it('presenta menor dispersión dentro de manzanas comparables que entre barrios distintos', () => {
    const centro = Array.from({ length: 225 }, (_, i) => huella(`way/c${i}`, (i % 15) * 14 - 98, Math.floor(i / 15) * 14 - 98))
    const rural = Array.from({ length: 16 }, (_, i) => huella(`way/r${i}`, 3000 + (i % 4) * 70, Math.floor(i / 4) * 70))
    const calles = [{ ax: -400, az: 0, bx: 400, bz: 0, highway: 'primary' }]
    const contexto = crearContexto([...centro, ...rural], calles)
    const alturasCentro = centro.filter(h => Math.abs(h.x) < 30 && Math.abs(h.z) < 30)
      .map(h => estimarAltura(h, contexto.get(h.id)).metros)
    const alturasRural = rural.map(h => estimarAltura(h, contexto.get(h.id)).metros)
    const media = arr => arr.reduce((a, b) => a + b, 0) / arr.length
    expect(media(alturasCentro) - media(alturasRural)).toBeGreaterThan(3)
    const entreBarrios = varianza([media(alturasCentro), media(alturasRural)])
    expect(varianza(alturasCentro)).toBeLessThan(entreBarrios)
    expect(varianza(alturasRural)).toBeLessThan(entreBarrios)
    expect(Math.max(...alturasCentro) - Math.min(...alturasCentro)).toBeLessThan(3.7)
  })
})

describe('estimarAltura: respuesta de la morfología', () => {
  it('el centro denso gana altura frente a la periferia con la misma huella', () => {
    const h = huella()
    expect(estimarAltura(h, señales(1, 0.2)).metros)
      .toBeGreaterThan(estimarAltura(h, señales(0.05, 0.2)).metros)
  })

  it('una avenida concentra altura frente a una calle local en un mismo tejido', () => {
    const h = huella('way/1', 0, 0, { area: 450 })
    expect(estimarAltura(h, señales(0.8, 1)).metros)
      .toBeGreaterThan(estimarAltura(h, señales(0.8, 0.1)).metros)
  })

  it('una huella grande compacta urbana gana altura frente a una casa', () => {
    const urbano = señales(1, 1)
    expect(estimarAltura(huella('way/1', 0, 0, { area: 850 }), urbano).metros)
      .toBeGreaterThan(estimarAltura(huella(), urbano).metros + 6)
  })

  it('una nave grande alargada permanece baja aun en tejido denso', () => {
    const resultado = estimarAltura(huella('way/1', 0, 0, {
      area: 1400, elongacion: 5, compacidad: 0.38,
    }), señales(1, 1))
    expect(resultado.metros).toBeLessThan(9)
    expect(resultado.evidencia.perfil).toBe('galpon')
  })

  it('el tipo industrial explícito se respeta sin hacer alto un galpón compacto', () => {
    const resultado = estimarAltura(huella('way/1', 0, 0, {
      area: 1200, elongacion: 1.2, tags: { building: 'warehouse' },
    }), señales(1, 1))
    expect(resultado.metros).toBeLessThan(9)
    expect(resultado.evidencia.perfil).toBe('galpon')
  })

  it('la semilla cambia solo la variación fina, con vecinos comparables dentro de una planta', () => {
    const alturas = Array.from({ length: 100 }, (_, i) => estimarAltura(huella(`way/${i}`), señales(0.5, 0.3)).metros)
    expect(new Set(alturas).size).toBeGreaterThan(10)
    expect(Math.max(...alturas) - Math.min(...alturas)).toBeLessThan(3.7)
  })
})
