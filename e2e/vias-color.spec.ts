import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'

// La paleta vial sobre la escena DIBUJADA, en sus dos modos. No es un assert
// de píxeles: es la medición que un test de unidad no da, y en particular la
// única forma de saber si los contornos claros de Liberty (#e9ac77, #cfcdca,
// pensados para un fondo plano #f8f4f0) se leen sobre relieve texturado.
const listo = async (page: any) => {
  await page.waitForFunction(() => {
    const s = (window as any).__escena?.getState().scene
    return s?.getObjectByName('terrain')?.children.some((n: any) => n.visible)
  }, undefined, { timeout: 180_000 })
  await page.waitForFunction(() => {
    const s = (window as any).__escena?.getState().scene
    let hay = false
    s?.traverse((o: any) => { if (o.isLineSegments2) hay = true })
    return hay
  }, undefined, { timeout: 180_000 })
}

// Encuadra un vértice real del nivel `local`: donde hay calles hay jerarquía
// por encima con la que comparar. Los siete niveles comparten programa, así
// que el nivel se lee del renderOrder, que ordenCapa() define como
// nivel*2 + 1 para el relleno (roadStyle.ts).
const encuadrar = (page: any, d: number) => page.evaluate((dist: number) => {
  const st = (window as any).__escena.getState()
  let obj: any = null
  st.scene.traverse((o: any) => {
    if (!obj && o.isLineSegments2 && o.renderOrder === 2 * 2 + 1) obj = o
  })
  if (!obj) throw new Error('no se encontró el relleno del nivel local')
  const a = obj.geometry.getAttribute('instanceStart')
  const i = Math.floor(a.count / 2)
  const t = st.controls.target
  t.set(a.getX(i), a.getY(i), a.getZ(i))
  st.camera.position.set(t.x, t.y + dist * 0.62, t.z + dist * 0.78)
  st.camera.updateProjectionMatrix()
  st.controls.update()
}, d)

test('la red vial en sus dos modos', async ({ page }) => {
  const errores: string[] = []
  page.on('pageerror', e => errores.push(e.message))
  mkdirSync('e2e/salida-vias', { recursive: true })

  // Sin ?capas=: los valores de fábrica, o sea la capa 'pci' apagada.
  await page.goto('/?diagnostico=1')
  await listo(page)
  await page.waitForTimeout(8_000)
  await page.screenshot({ path: 'e2e/salida-vias/1-liberty-estado.png' })
  await encuadrar(page, 1500)
  await page.waitForTimeout(22_000)
  await page.screenshot({ path: 'e2e/salida-vias/2-liberty-pueblo.png' })

  // Con la capa de PCI encendida tiene que volver el mapa de siempre.
  await page.goto('/?diagnostico=1&capas=edificios,pci')
  await listo(page)
  await encuadrar(page, 1500)
  await page.waitForTimeout(22_000)
  await page.screenshot({ path: 'e2e/salida-vias/3-pci-pueblo.png' })

  expect(errores).toEqual([])
})
