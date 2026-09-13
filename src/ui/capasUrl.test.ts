import { describe, it, expect } from 'vitest'
import { capasDesdeUrl, capasAUrl } from './capasUrl'

// Un catálogo de mentira: la traducción no puede depender de qué capas tenga
// el mapa hoy, solo de la forma { id, porDefecto }.
const disponibles = [
  { id: 'edificios', porDefecto: true },
  { id: 'municipios', porDefecto: false },
  { id: 'hospitales', porDefecto: false },
] as const

describe('capasDesdeUrl', () => {
  it('sin ?capas= devuelve las de por defecto', () => {
    expect([...capasDesdeUrl('', disponibles)]).toEqual(['edificios'])
  })

  it('con ?capas= devuelve exactamente ese conjunto, aunque apague una de por defecto', () => {
    const v = capasDesdeUrl('?capas=municipios,hospitales', disponibles)
    expect([...v].sort()).toEqual(['hospitales', 'municipios'])
  })

  it('ignora en silencio los ids que no existen', () => {
    expect([...capasDesdeUrl('?capas=municipios,inventada', disponibles)]).toEqual(['municipios'])
  })

  // El alias que ya existía antes del panel: ?edificios=0 apagaba los
  // edificios. Los enlaces que alguien tenga guardados siguen funcionando.
  it('?edificios=0 quita los edificios del conjunto', () => {
    expect([...capasDesdeUrl('?edificios=0', disponibles)]).toEqual([])
  })

  it('?edificios=0 también gana sobre un ?capas= que los pedía', () => {
    const v = capasDesdeUrl('?capas=edificios,municipios&edificios=0', disponibles)
    expect([...v]).toEqual(['municipios'])
  })
})

describe('capasAUrl', () => {
  it('no escribe nada cuando el conjunto es el de por defecto', () => {
    expect(capasAUrl(new Set(['edificios']), disponibles)).toBe('')
  })

  it('escribe los ids en el orden del catálogo, no en el de inserción', () => {
    expect(capasAUrl(new Set(['hospitales', 'edificios']), disponibles))
      .toBe('capas=edificios,hospitales')
  })

  it('escribe el conjunto vacío de forma que capasDesdeUrl lo reconozca', () => {
    const texto = capasAUrl(new Set(), disponibles)
    expect([...capasDesdeUrl(`?${texto}`, disponibles)]).toEqual([])
  })

  it('va y vuelve para cualquier conjunto', () => {
    for (const ids of [[], ['edificios'], ['municipios'], ['edificios', 'hospitales'],
      ['edificios', 'municipios', 'hospitales']]) {
      const texto = capasAUrl(new Set(ids), disponibles)
      expect([...capasDesdeUrl(`?${texto}`, disponibles)].sort(), texto).toEqual([...ids].sort())
    }
  })
})
