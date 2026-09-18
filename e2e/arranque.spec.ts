import { test, expect } from '@playwright/test'

test('the map renders when an older data Release lacks boundaries', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/data/limites-pos.bin', route => route.fulfill({ status: 404, body: '' }))
  await page.goto('/?diagnostico=1')
  await page.waitForFunction(() => {
    const scene = (window as any).__escena?.getState().scene
    return scene?.getObjectByName('terrain')?.children.some((node: any) => node.visible)
  }, undefined, { timeout: 120_000 })
  expect(errors).toEqual([])
  // Fase 4: limites-pos.bin ya no viaja con la carga inicial (App.tsx,
  // efecto de `limites`), se pide al encender la capa "Municipios" (apagada
  // por defecto). Antes este 404 se disparaba solo al arrancar; ahora hay
  // que encender la capa para que la sonda de este test lo vea.
  await page.getByRole('button', { name: 'Municipios' }).click()
  await expect(page.getByRole('button', { name: 'Municipios' }))
    .toHaveAttribute('title', /limites-pos.bin/)
})