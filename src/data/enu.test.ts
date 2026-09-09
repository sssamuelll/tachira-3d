import { test, expect } from 'vitest'
import { makeEnuFrame, geodeticToEnu } from './enu'
import { makeEnuFrame as mkNode, geodeticToEnu as toEnuNode } from '../../scripts/lib/enu.mjs'

test('la version del navegador coincide con la del pipeline al milimetro', () => {
  const a = makeEnuFrame(8.021973, -71.901563, 0)
  const b = mkNode(8.021973, -71.901563, 0)
  for (const [lat, lon, h] of [[7.4, -72.4, 0], [8.6, -71.4, 3942], [8.0, -71.9, 1000]]) {
    const p = geodeticToEnu(a, lat, lon, h)
    const q = toEnuNode(b, lat, lon, h)
    expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThan(0.001)
  }
})
