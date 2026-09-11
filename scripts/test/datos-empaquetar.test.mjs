import { describe, expect, it } from 'vitest'
import { CONTENIDO, versionDe } from '../datos-empaquetar.mjs'

describe('CONTENIDO', () => {
  it('nombra lo que entra, en vez de excluir lo que no', () => {
    // Una lista explícita es la garantía de que nada nuevo viaja por
    // descuido: piezas/ y capas/ van en git, e img/ ya no existe.
    expect(CONTENIDO).toContain('data/terrain.bin')
    expect(CONTENIDO).toContain('data/edificios')
    expect(CONTENIDO).toContain('data/VERSION')
  })

  it('deja fuera lo que ya viaja con el sitio', () => {
    expect(CONTENIDO).not.toContain('data/piezas')
    expect(CONTENIDO).not.toContain('data/capas')
    expect(CONTENIDO).not.toContain('data/img')
  })

  it('no repite ninguna entrada', () => {
    expect(new Set(CONTENIDO).size).toBe(CONTENIDO.length)
  })
})

describe('versionDe', () => {
  it('describe los datos que empaqueta, no el momento de empaquetarlos', () => {
    // origen y bbox salen de terrain.json, que es el dato real que viaja:
    // si alguien regenera con otro origen, el VERSION lo dice.
    const terrain = {
      origin: { lat: 8.021973, lon: -71.901563, h: 0 },
      bbox: { w: -72.5, e: -71.2, n: 8.7, s: 7.2 },
      width: 1024,
    }

    expect(versionDe(terrain, 'abc1234', '2026-09-11')).toEqual({
      fecha: '2026-09-11',
      scripts: 'abc1234',
      origen: { lat: 8.021973, lon: -71.901563, h: 0 },
      bbox: { w: -72.5, e: -71.2, n: 8.7, s: 7.2 },
    })
  })
})
