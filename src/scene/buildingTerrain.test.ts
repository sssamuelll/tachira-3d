import { describe, expect, it } from 'vitest'
import { ancestrosEdificios, coberturaEdificios, errorMallaEdificios } from './buildingTerrain'
import { geometriaNodo } from './nodoTerreno'
import { makeEnuFrame } from '../data/enu'
import { tileXToLon, tileYToLat } from '../../scripts/lib/terrarium.mjs'

describe('terreno exacto antes de mostrar edificios', () => {
  it('solicita el camino a z15 sin refinar todo el estado', () => {
    const set=ancestrosEdificios(new Set(['15/100/200']))
    expect(set.has('14/50/100')).toBe(true)
    expect(set.has('8/0/1')).toBe(true)
    expect(set.has('14/51/100')).toBe(false)
  })
  it('no declara listo un padre grueso ni cobertura parcial fina', () => {
    expect(coberturaEdificios([{z:14,x:50,y:100}]).size).toBe(0)
    expect(coberturaEdificios([{z:16,x:200,y:400}]).size).toBe(0)
    expect(coberturaEdificios([{z:15,x:100,y:200}]).has('15/100/200')).toBe(true)
    const fine=[{z:16,x:200,y:400},{z:16,x:201,y:400},{z:16,x:200,y:401},{z:16,x:201,y:401}]
    expect(coberturaEdificios(fine).has('15/100/200')).toBe(true)
  })
  it('la demanda de detalle no se convierte en faldones infinitos al construir ancestros', () => {
    const node={z:12,x:1223,y:1948}
    const demand=ancestrosEdificios(new Set(['15/9784/15584']))
    expect(demand.has('12/1223/1948')).toBe(true)
    const error=errorMallaEdificios(node,{'12/1223/1948':25})
    const {geometry,caja}=geometriaNodo(node,{alturas:new Float32Array(257*257).fill(500),dentro:new Uint8Array(257*257).fill(1),min:500,max:500},
      {z:12,x0:1223,y0:1948,nx:1,ny:1},makeEnuFrame(tileYToLat(1948.5,12),tileXToLon(1223.5,12),0),error)
    expect([...geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true)
    expect(caja.max.y-caja.min.y).toBeLessThan(300)
    geometry.dispose()
  })
})
