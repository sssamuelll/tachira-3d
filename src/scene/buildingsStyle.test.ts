import { describe, expect, it } from 'vitest'
import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { edificiosActivos, candidatosEdificios, sueloEdificiosListo, HALO_EDIFICIOS } from './buildingsStyle'

const box = (x: number, z = 0) => new Box3(new Vector3(x, 0, z), new Vector3(x + 20, 20, z + 20))

describe('LOD de edificaciones', () => {
  it('a vista de estado no dibuja y a ≤3 m/px activa toda la masa', () => {
    expect(edificiosActivos(100, true)).toBe(false)
    expect(edificiosActivos(6, true)).toBe(false)
    expect(edificiosActivos(3, false)).toBe(true)
    expect(edificiosActivos(0.05, false)).toBe(true)
  })

  it('la histéresis conserva estado entre 3 y 6 y evita titilar al orbitar', () => {
    expect(edificiosActivos(4, true)).toBe(true)
    expect(edificiosActivos(4, false)).toBe(false)
    expect(edificiosActivos(NaN, true)).toBe(false)
  })

  it('retiene emisores fuera del frustum principal dentro del halo', () => {
    const camera = new PerspectiveCamera(50, 1, 1, 5000)
    camera.position.set(0, 15, 0)
    camera.lookAt(0, 15, -100)
    camera.updateMatrixWorld()
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    const frente = { key: 'frente', caja: box(0, -100) }
    const emisor = { key: 'detrás', caja: box(0, 100) }
    expect(frustum.intersectsBox(emisor.caja)).toBe(false)
    expect(candidatosEdificios([frente, emisor], camera.position).map(c => c.key)).toContain('detrás')
  })

  it('acota el halo y prioriza cercanía cuando se agota el presupuesto', () => {
    const values = [
      { key: 'lejos', caja: box(HALO_EDIFICIOS + 1) },
      { key: 'dos', caja: box(100) },
      { key: 'uno', caja: box(10) },
    ]
    expect(candidatosEdificios(values, new Vector3()).map(c => c.key)).toEqual(['uno', 'dos'])
    expect(candidatosEdificios(values, new Vector3(), 1).map(c => c.key)).toEqual(['uno'])
  })

  it('no muestra masa hasta cubrir todos sus nodos DEM', () => {
    const nodes = ['15/100/200', '15/101/200']
    expect(sueloEdificiosListo(nodes, undefined)).toBe(false)
    expect(sueloEdificiosListo(nodes, new Set([nodes[0]]))).toBe(false)
    expect(sueloEdificiosListo(nodes, new Set(nodes))).toBe(true)
  })
})
