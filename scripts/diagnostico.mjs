import { chromium } from '@playwright/test'

const target = process.argv[2] ?? 'http://localhost:5173/'
const timeout = Number(process.argv[3] ?? 120000)
const url = new URL(target)
url.searchParams.set('diagnostico', '1')
const events = []
const record = (kind, detail) => {
  if (events.length < 500) events.push({ at: new Date().toISOString(), kind, detail })
}

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage()
  page.on('console', message => record(`console.${message.type()}`, message.text()))
  page.on('pageerror', error => record('pageerror', error.stack ?? error.message))
  page.on('requestfailed', request => record('requestfailed', {
    url: request.url(), error: request.failure()?.errorText,
  }))
  page.on('response', response => {
    if (response.status() >= 400) record('http', { url: response.url(), status: response.status() })
  })
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout })
  try {
    await page.waitForFunction(() => {
      const scene = window.__escena?.getState().scene
      const terrain = scene?.getObjectByName('terrain')
      return !!terrain?.children.some(node => node.visible) || document.body.textContent?.includes('No se pudo cargar el mapa')
    }, undefined, { timeout })
  } catch {
    record('timeout', `No visible terrain or load error after ${timeout} ms`)
  }
  const state = await page.evaluate(() => {
    const store = window.__escena
    const s = store?.getState()
    const terrain = s?.scene.getObjectByName('terrain')
    const renderer = s?.gl
    return {
      text: document.body.innerText.slice(0, 500),
      scene: s ? {
        camera: s.camera.position.toArray(),
        terrainNodes: terrain?.children.length ?? 0,
        visibleTerrainNodes: terrain?.children.filter(node => node.visible).length ?? 0,
        visibleTerrainVertices: terrain?.children.reduce((total, node) =>
          total + (node.visible ? (node.geometry?.attributes?.position?.count ?? 0) : 0), 0) ?? 0,
        objects: s.scene.children.map(node => node.name || node.type),
        render: renderer.info.render,
        memory: renderer.info.memory,
      } : null,
    }
  })
  process.stdout.write(JSON.stringify({ url: url.href, state, events }, null, 2) + '\n')
} finally {
  await browser.close()
}
