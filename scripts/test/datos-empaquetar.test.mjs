import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { CONTENIDO, versionDe, argumentosTar } from '../datos-empaquetar.mjs'

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

  it('el tar se arma con la lista, no con la carpeta entera', () => {
    // Si alguien empaqueta 'data' en vez de ...CONTENIDO, el paquete se lleva
    // piezas/, que ya viaja en git. Esta prueba es lo que lo impide.

    // La invocación real nombra cada entrada de la lista, y nunca la carpeta
    // suelta. Sin esto, la prueba de abajo solo demostraría cómo se comporta
    // tar, no que nosotros lo llamemos bien.
    const args = argumentosTar()
    for (const entrada of CONTENIDO) expect(args).toContain(entrada)
    expect(args).not.toContain('data')

    const raiz = mkdtempSync(join(tmpdir(), 'empaquetar-'))
    try {
      mkdirSync(join(raiz, 'data/piezas'), { recursive: true })
      writeFileSync(join(raiz, 'data/terrain.json'), '{}')
      writeFileSync(join(raiz, 'data/VERSION'), '{}')
      writeFileSync(join(raiz, 'data/piezas/x.glb'), 'x')
      // El nombre del archivo va relativo y con cwd: el tar de Git Bash lee
      // un 'C:\...' como host remoto y falla. -C sí admite ruta absoluta.
      const opciones = { cwd: raiz, encoding: 'utf8' }

      execFileSync('tar', ['-czf', 'prueba.tar.gz', '-C', raiz, 'data/VERSION', 'data/terrain.json'], opciones)
      const dentro = execFileSync('tar', ['-tzf', 'prueba.tar.gz'], opciones)

      expect(dentro).toContain('data/terrain.json')
      expect(dentro).not.toContain('piezas')
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
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
