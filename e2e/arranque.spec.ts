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
  await expect(page.getByRole('button', { name: 'Municipios' }))
    .toHaveAttribute('title', /limites-pos.bin/)
})