import { describe, expect, it } from 'vitest'
import { analizarHuella, apoyarAnillo, hornearEdificio, empaquetarGeometrias } from '../lib/building-geometry.mjs'
import { makeEnuFrame } from '../lib/enu.mjs'
import { tileXToLon, tileYToLat } from '../lib/terrarium.mjs'

const frame = makeEnuFrame(7.77, -72.22, 0)
const square = [[-72.22, 7.77], [-72.2198, 7.77], [-72.2198, 7.7702], [-72.22, 7.7702]]
const building = { id: 'way/12', osmId: 12, osmType: 'way', tags: { building: 'yes' }, polygons: [{ outer: square, holes: [] }] }
const altura = { metros: 8, fuente: 'estimada', niveles: 2, evidencia: {} }
const roof = { rgb: [128, 90, 70], fuente: 'satelite', zoom: 18, muestras: 50 }

describe('geometría de edificios', () => {
  it('mide área y forma en metros ENU, restando patios', () => {
    const a = analizarHuella(building, frame)
    expect(a.area).toBeGreaterThan(480)
    expect(a.area).toBeLessThan(500)
    expect(a.elongacion).toBeLessThan(1.1)
    const patio = square.map(([x, z]) => [-72.2199 + (x + 72.2199) / 2, 7.7701 + (z - 7.7701) / 2])
    expect(analizarHuella({ ...building, polygons: [{ outer: square, holes: [patio] }] }, frame).area / a.area).toBeCloseTo(0.75, 3)
  })
  it('separa aristas en los cruces de posts y diagonales del DEM', () => {
    const geo = (u, v) => [tileXToLon(u / 256, 12), tileYToLat(v / 256, 12)]
    const ring = [geo(300000.2, 500000.2), geo(300002.7, 500000.2), geo(300002.7, 500002.7)]
    const out = apoyarAnillo(ring)
    expect(out.length).toBeGreaterThan(ring.length)
    expect(out.some(p => Math.abs(p[0] - geo(300000.8, 500000.2)[0]) < 1e-9)).toBe(true)
  })
  it('mantiene techo horizontal, identidad, fuente y contacto sobre pendiente', () => {
    const sample = (lat, lon) => 500 + (lon + 72.22) * 40000 + (lat - 7.77) * 10000
    const g = hornearEdificio(building, altura, roof, sample, frame)
    expect(g.record.id).toBe(building.id)
    expect(g.record.altura).toEqual(altura)
    expect(g.record.roofY - g.record.baseY).toBeCloseTo(8)
    const roofYs = g.positions.filter((_, i) => i % 3 === 1 && g.normals[i] === 127)
    expect(new Set(roofYs).size).toBe(1)
    expect(roofYs[0]).toBe(g.record.roofY)
    expect(g.positions.every(Number.isFinite)).toBe(true)
    expect(g.indices.every(i => i >= 0 && i < g.positions.length / 3)).toBe(true)
    for (let i = 0; i < g.indices.length; i += 3) {
      const [a,b,c] = g.indices.slice(i,i+3).map(j => g.positions.slice(j*3,j*3+3))
      const ab = b.map((v,j) => v-a[j]), ac = c.map((v,j) => v-a[j])
      const n = [ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]
      expect(n.reduce((s,v,j) => s+v*g.normals[g.indices[i]*3+j],0)).toBeGreaterThan(0)
    }
  })
  it('triangula el techo dejando abierto el patio', () => {
    const patio = square.map(([x,z]) => [-72.2199+(x+72.2199)/2,7.7701+(z-7.7701)/2])
    const b = {...building,polygons:[{outer:square,holes:[patio]}]}
    const g = hornearEdificio(b, altura, roof, () => 500, frame)
    let area = 0
    for(let k=0;k<g.indices.length;k+=3){
      const ids=g.indices.slice(k,k+3)
      if(g.normals[ids[0]*3+1]!==127) continue
      const [a,b,c]=ids.map(i=>g.positions.slice(i*3,i*3+3))
      area+=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2
    }
    expect(area).toBeCloseTo(analizarHuella(b,frame).area,0)
  })
  it('no disfraza ausencia de DEM como suelo cero', () => {
    expect(()=>hornearEdificio(building,altura,roof,()=>null,frame)).toThrow(/DEM/)
  })
  it('empaqueta buffers alineados con índices desplazados al fusionar', () => {
    const g=hornearEdificio(building,altura,roof,()=>500,frame)
    const bin=empaquetarGeometrias([g,g])
    expect(bin.readUInt32LE(0)).toBe(0x45444946)
    expect(bin.readUInt32LE(8)).toBe(g.positions.length/3*2)
    const n=bin.readUInt32LE(8), off=Math.ceil((16+n*18)/4)*4
    expect(bin.readUInt32LE(off+g.indices.length*4)).toBe(g.indices[0]+g.positions.length/3)
  })
})
