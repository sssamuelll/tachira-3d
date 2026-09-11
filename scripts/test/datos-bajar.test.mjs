import { describe, expect, it } from 'vitest'
import { elegirRelease, assetDe } from '../datos-bajar.mjs'

const rel = (tag, assets = ['datos-base.tar.gz']) => ({
  tag_name: tag,
  assets: assets.map(name => ({ name, browser_download_url: `https://ejemplo/${tag}/${name}`, size: 1 })),
})

describe('elegirRelease', () => {
  it('toma la etiqueta de datos más reciente, sin fiarse del orden en que vengan', () => {
    const releases = [rel('datos-2026-08-01'), rel('datos-2026-09-11'), rel('datos-2026-09-02')]
    expect(elegirRelease(releases).tag_name).toBe('datos-2026-09-11')
  })

  it('ignora las etiquetas que no son de datos', () => {
    // El repo tendrá Releases de versión del visor, que no traen datos.
    const releases = [rel('v2.0.0'), rel('datos-2026-09-11'), rel('estable')]
    expect(elegirRelease(releases).tag_name).toBe('datos-2026-09-11')
  })

  it('una etiqueta pedida a mano manda sobre la más reciente', () => {
    const releases = [rel('datos-2026-09-11'), rel('datos-2026-08-01')]
    expect(elegirRelease(releases, 'datos-2026-08-01').tag_name).toBe('datos-2026-08-01')
  })

  it('si la etiqueta pedida no existe, lo dice con su nombre', () => {
    expect(() => elegirRelease([rel('datos-2026-09-11')], 'datos-2020-01-01'))
      .toThrow(/datos-2020-01-01/)
  })

  it('sin ningún Release de datos, lo dice en vez de bajar cualquier cosa', () => {
    expect(() => elegirRelease([rel('v2.0.0')])).toThrow(/datos-/)
  })
})

describe('assetDe', () => {
  it('encuentra el paquete por su nombre', () => {
    expect(assetDe(rel('datos-2026-09-11')).name).toBe('datos-base.tar.gz')
  })

  it('un Release sin el paquete se denuncia nombrando la etiqueta', () => {
    expect(() => assetDe(rel('datos-2026-09-11', ['otra-cosa.zip'])))
      .toThrow(/datos-2026-09-11/)
  })
})
