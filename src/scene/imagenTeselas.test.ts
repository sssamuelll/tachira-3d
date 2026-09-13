import { describe, expect, it, vi, afterEach } from 'vitest'
import { urlImagen, ancestroCargado, CacheImagenes } from './imagenTeselas'

describe('urlImagen', () => {
  it('todos los niveles se piden en vivo a Esri, que pone la fila antes que la columna', () => {
    // No se reparte ninguna tesela: Esri permite usar el servicio, no copiarlo.
    expect(urlImagen(8, 76, 121)).toMatch(/World_Imagery\/MapServer\/tile\/8\/121\/76$/)
    expect(urlImagen(12, 1229, 1954)).toMatch(/World_Imagery\/MapServer\/tile\/12\/1954\/1229$/)
    expect(urlImagen(15, 9832, 15633)).toMatch(/World_Imagery\/MapServer\/tile\/15\/15633\/9832$/)
  })

  it('ninguna URL sale del propio sitio', () => {
    for (const z of [8, 10, 12, 15, 17]) {
      expect(urlImagen(z, 100, 200).startsWith('https://')).toBe(true)
    }
  })
})

describe('ancestroCargado', () => {
  it('si la tesela del nodo está cargada, es ella misma sin transformar', () => {
    expect(ancestroCargado({ z: 14, x: 4916, y: 7816 }, () => true)).toEqual({
      z: 14, x: 4916, y: 7816, ox: 0, oy: 0, esc: 1,
    })
  })

  it('si no, el ancestro más cercano cargado, con su ventana dentro de él', () => {
    // El nodo z14 (4916, 7816) está dentro del z12 (1229, 1954) en la celda
    // (0, 0) de las 4×4 en que se parte: escala 1/4, sin desplazamiento.
    const tiene = (z: number) => z === 12
    expect(ancestroCargado({ z: 14, x: 4916, y: 7816 }, tiene)).toEqual({
      z: 12, x: 1229, y: 1954, ox: 0, oy: 0, esc: 0.25,
    })
    // Y el vecino de la esquina opuesta cae en la celda (3, 3) de esa misma
    // tesela: 0,75 de desplazamiento en las dos direcciones.
    expect(ancestroCargado({ z: 14, x: 4919, y: 7819 }, tiene)).toEqual({
      z: 12, x: 1229, y: 1954, ox: 0.75, oy: 0.75, esc: 0.25,
    })
  })

  it('sin ninguna tesela cargada no hay imagen: el nodo se queda con la hipsometría', () => {
    expect(ancestroCargado({ z: 17, x: 39331, y: 62534 }, () => false)).toBeNull()
  })

  it('no sube más allá de z8, que es la raíz del quadtree', () => {
    const vistos: number[] = []
    ancestroCargado({ z: 11, x: 614, y: 977 }, z => { vistos.push(z); return false })
    expect(vistos).toEqual([11, 10, 9, 8])
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('sin red', () => {
  it('una tesela que no llega no se guarda, y tras los reintentos deja de pedirse', async () => {
    // Es el camino que sustituye al horneado: antes, sin red, el nodo caía a
    // la tesela guardada en el repo; ahora cae a la hipsometría, y eso tiene
    // que ser un camino normal y no una excepción sin atrapar.
    const espia = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }))
    // Un turno de macrotarea drena las microtareas pendientes: sin esto las
    // aserciones leerían el estado ANTES de que corran el .catch y el
    // .finally de pedir, que es justo lo que hay que interrogar.
    const asentar = () => new Promise(r => setTimeout(r, 0))
    const cache = new CacheImagenes()

    for (let i = 0; i < 3; i++) { cache.pedir(12, 1229, 1954); await asentar() }

    // Dos peticiones, no una ni tres. Que haya una segunda prueba que la
    // clave se soltó de enVuelo; que no haya tercera prueba que el fallo se
    // contó. Borra el .finally y sale una; borra el .catch y salen tres.
    expect(espia).toHaveBeenCalledTimes(2)
    expect(cache.tiene(12, 1229, 1954)).toBe(false)
    expect(cache.mejor({ z: 12, x: 1229, y: 1954 })).toBeNull()
  })
})
