import { describe, expect, it, vi, afterEach } from 'vitest'
import { urlVersionado, urlGenerado } from './rutas'

afterEach(() => { vi.unstubAllEnvs() })

describe('urlVersionado', () => {
  it('cuelga del raíz de datos del propio sitio', () => {
    expect(urlVersionado('piezas/obelisco-italianos.glb')).toBe('/data/piezas/obelisco-italianos.glb')
  })

  it('respeta el subdirectorio bajo el que se sirve el sitio', () => {
    // Es el caso de GitHub Pages: el sitio no está en la raíz del dominio.
    vi.stubEnv('BASE_URL', '/tachira-3d/')
    expect(urlVersionado('piezas/obelisco-italianos.glb')).toBe('/tachira-3d/data/piezas/obelisco-italianos.glb')
  })

  it('no se va al bucket aunque VITE_DATOS esté puesto: lo versionado viaja con el sitio', () => {
    vi.stubEnv('VITE_DATOS', 'https://datos.ejemplo.org')
    expect(urlVersionado('piezas/x.glb')).toBe('/data/piezas/x.glb')
  })
})

describe('urlGenerado', () => {
  it('sin VITE_DATOS va junto al sitio, igual que lo versionado', () => {
    expect(urlGenerado('terrain.json')).toBe('/data/terrain.json')
  })

  it('con VITE_DATOS va al bucket', () => {
    vi.stubEnv('VITE_DATOS', 'https://datos.ejemplo.org')
    expect(urlGenerado('edificios/index.json')).toBe('https://datos.ejemplo.org/edificios/index.json')
  })

  it('una barra final de sobra en VITE_DATOS no duplica la barra', () => {
    vi.stubEnv('VITE_DATOS', 'https://datos.ejemplo.org/')
    expect(urlGenerado('terrain.bin')).toBe('https://datos.ejemplo.org/terrain.bin')
  })

  it('bajo subdirectorio y sin bucket, cuelga del subdirectorio', () => {
    vi.stubEnv('BASE_URL', '/tachira-3d/')
    expect(urlGenerado('dem/errores.json')).toBe('/tachira-3d/data/dem/errores.json')
  })
})

// @ts-ignore -- igual que buildings.test.ts: vitest corre en Node, la app solo
// tiene los tipos de vite/client. El repo no depende de @types/node.
import { readdirSync, readFileSync } from 'node:fs'
// @ts-ignore
import { join } from 'node:path'

it('ningún archivo de src/ escribe una ruta absoluta a los datos', () => {
  // La razón de existir de rutas.ts: una ruta '/data/…' funciona en local y
  // da 404 bajo el subdirectorio de GitHub Pages. Esta prueba es lo que
  // impide que reaparezca.
  const ofensores: string[] = []
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name)
      if (entrada.isDirectory()) { recorrer(ruta); continue }
      if (!/\.tsx?$/.test(entrada.name)) continue
      if (ruta.endsWith('rutas.test.ts')) continue          // este mismo archivo
      // La Task 3 borra el horneado de imagen y con él las únicas rutas
      // '/data/' que quedan, en el módulo y en su prueba. Hasta entonces esta
      // excepción es lo que deja el barrido verde sin mentir sobre lo que
      // falta. La Task 3 la quita.
      if (/^imagenTeselas\.(test\.)?ts$/.test(entrada.name)) continue
      readFileSync(ruta, 'utf8').split('\n').forEach((linea: string, i: number) => {
        if (/['"`]\/data\//.test(linea)) ofensores.push(`${ruta}:${i + 1}`)
      })
    }
  }
  recorrer('src')
  expect(ofensores).toEqual([])
})
