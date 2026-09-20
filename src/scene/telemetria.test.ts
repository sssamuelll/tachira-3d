import { describe, expect, it, beforeEach } from 'vitest'
import { telemetria } from './telemetria'

beforeEach(() => { telemetria.reiniciar(); telemetria.activa = true })

describe('telemetría de lo que se dibuja', () => {
  it('apagada no guarda nada y no cuesta memoria', () => {
    telemetria.activa = false
    telemetria.sube('terreno.armados')
    telemetria.conjunto('terreno.visibles', new Set(['15/0/0']))
    telemetria.cerrarCuadro()
    expect(telemetria.cuadros()).toHaveLength(0)
  })

  it('cuenta eventos por cuadro y los deja en el anillo', () => {
    telemetria.sube('terreno.armados', 2)
    telemetria.sube('terreno.armados')
    telemetria.cerrarCuadro()
    expect(telemetria.cuadros()).toHaveLength(1)
    expect(telemetria.cuadros()[0]['terreno.armados']).toBe(3)
    telemetria.cerrarCuadro()
    expect(telemetria.cuadros()[1]['terreno.armados']).toBeUndefined()
  })

  it('un conjunto estable no produce churn; entrar y salir sí', () => {
    const a = new Set(['a', 'b'])
    telemetria.conjunto('terreno.visibles', a); telemetria.cerrarCuadro()
    telemetria.conjunto('terreno.visibles', new Set(['a', 'b'])); telemetria.cerrarCuadro()
    expect(telemetria.cuadros()[1]['terreno.visibles.entra']).toBeUndefined()
    telemetria.conjunto('terreno.visibles', new Set(['b', 'c'])); telemetria.cerrarCuadro()
    expect(telemetria.cuadros()[2]['terreno.visibles.entra']).toBe(1)
    expect(telemetria.cuadros()[2]['terreno.visibles.sale']).toBe(1)
    expect(telemetria.cuadros()[2]['terreno.visibles']).toBe(2)
  })

  it('un parpadeo -- sale y vuelve al cuadro siguiente -- se cuenta aparte', () => {
    telemetria.conjunto('t', new Set(['a'])); telemetria.cerrarCuadro()
    telemetria.conjunto('t', new Set([])); telemetria.cerrarCuadro()
    telemetria.conjunto('t', new Set(['a'])); telemetria.cerrarCuadro()
    expect(telemetria.cuadros()[2]['t.parpadeo']).toBe(1)
  })

  it('un mapa de niveles distingue refinar de engrosar', () => {
    telemetria.mapa('img', new Map([['a', 15], ['b', 15]])); telemetria.cerrarCuadro()
    telemetria.mapa('img', new Map([['a', 16], ['b', 14]])); telemetria.cerrarCuadro()
    expect(telemetria.cuadros()[1]['img.sube']).toBe(1)
    expect(telemetria.cuadros()[1]['img.baja']).toBe(1)
  })

  it('el resumen promedia por cuadro y guarda el peor', () => {
    telemetria.sube('x', 1); telemetria.cerrarCuadro()
    telemetria.sube('x', 5); telemetria.cerrarCuadro()
    const r = telemetria.resumen()
    expect(r.cuadros).toBe(2)
    expect(r.x.cuadro).toBe(3)
    expect(r.x.max).toBe(5)
    expect(r.x.total).toBe(6)
  })
})

describe('coste por parte del cuadro', () => {
  it('mide devuelve lo que devuelve la función y deja un número de ms', () => {
    telemetria.reiniciar(); telemetria.activa = true
    expect(telemetria.mide('terreno.ms', () => 42)).toBe(42)
    telemetria.cerrarCuadro()
    expect(telemetria.cuadros()[0]['terreno.ms']).toBeGreaterThanOrEqual(0)
  })

  it('apagada no mide ni guarda, pero sigue devolviendo', () => {
    telemetria.reiniciar(); telemetria.activa = false
    expect(telemetria.mide('terreno.ms', () => 42)).toBe(42)
    telemetria.activa = true
    telemetria.cerrarCuadro()
    expect(telemetria.cuadros()[0]['terreno.ms']).toBeUndefined()
  })
})
