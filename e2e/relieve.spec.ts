import { test, expect, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'

/**
 * Las agujas y los cráteres del relieve, juzgados sobre la malla que el mapa
 * DIBUJA de verdad -- no sobre el DEM ni sobre `geometriaNodo` en aislamiento.
 *
 * Por qué así: el defecto es masivo y estructural, y ya se "arregló" dos veces
 * midiendo la capa equivocada. Acá se abre la app, se pasea la cámara por todo
 * el estado, y en cada parada se recorren TODOS los vértices de TODOS los nodos
 * visibles. Lo que no aparezca acá es que no se ve.
 *
 * Cada vértice se compara con la MEDIANA de su anillo Chebyshev r=2 dentro de la
 * rejilla del nodo. Contra los 8 vecinos pegados no sirve, y no es teoría: así
 * estaba escrito este test al principio y daba VERDE sobre el DEM roto. El ruido
 * viene en grumos de 2×2 y cada miembro tiene a sus cómplices de vecinos, así que
 * no sobresale de ellos. Es el mismo error que tenía limpiarAnomalias.
 *
 * Y el criterio es la PENDIENTE, no los metros: el desvío se divide entre lo que
 * mide el anillo (dos celdas). En metros no sirve porque la celda mide 4,6 km a
 * z8 y 36 m a z15 -- el mismo desnivel es una montaña en un nivel y una aguja en
 * el otro.
 *
 * Corre con WebGL por software, así que es lento (unos 25 min las seis paradas).
 * No va en `npm test`; se invoca aparte con `npx playwright test`.
 */

const LADO = 33 // vértices por lado de un nodo (nodoTerreno.ts)

/**
 * Cuánto puede desviarse un vértice de la mediana de su anillo, medido en
 * anchos de celda. Calibrado corriendo ESTE test contra las dos puntas, no a
 * ojo (las seis paradas, 2026-09-12):
 *
 *   DEM arreglado, lo peor de las 6 paradas   2,12   (159 m, y es una vía
 *                                                     tallada sobre cresta,
 *                                                     no ruido: la pone tallar())
 *   DEM anterior al arreglo, misma parada 00  5,98   (el cráter de -231 m)
 *
 * 3 pasa por el medio: deja pasar el relieve real y los bancos de vía, y atrapa
 * el defecto. Si algún día una parada nueva roza el 3 sin que haya defecto, lo
 * que hay que rehacer es esta tabla -- no subir el número hasta que calle.
 */
const RAZON_MAX = 3

/** Mínimo de vértices medidos en una parada para que cuente. Sin esto el test
 *  pasa mirando terreno descartado por la máscara del estado: pantalla negra,
 *  cero vértices, cero agujas, verde. Ya pasó -- ver el comentario de SITIOS. */
const VERTICES_MIN = 5_000

/** Error de consola que NO es del relieve: el LineMaterial de las vías declara
 *  más atributos de vértice de los que admite el programa, y no valida. Sale
 *  también en Chrome con GPU real (D3D11, medido 2026-09-13), así que es un
 *  defecto de las vías pendiente, no ruido del GL por software. Se acota a este
 *  mensaje exacto para que cualquier OTRO error de consola siga tumbando esto. */
const RUIDO_SOFTWARE = /Too many attributes|VALIDATE_STATUS false/

/**
 * Lo que hace Brave con sus Shields de fábrica (y cualquier navegador con
 * protección anti-huella): altera a propósito los píxeles que devuelve
 * getImageData. Acá se imita en Chromium: el bit bajo del canal R de un píxel
 * de cada 500, en toda lectura. En una foto no se nota; en Terrarium el canal R
 * son 256 m, así que si el relieve pasara por el canvas saldría lleno de agujas
 * y cráteres de ±256 m -- que es exactamente como se veía en Brave el
 * 2026-09-13, con el DEM ya limpio.
 */
const FARBLING = `
  for (const C of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
    if (!C) continue
    const original = C.prototype.getImageData
    C.prototype.getImageData = function (...args) {
      const img = original.apply(this, args)
      for (let i = 0; i < img.data.length; i += 4 * 500) img.data[i] ^= 1
      return img
    }
  }
`

declare global {
  interface Window { __estado?: any }
}

/** El store de la escena, publicado por <PuenteEscena> (App.tsx, solo en DEV). */
async function engancharEscena (page: Page) {
  await page.waitForFunction(() => !!(window as any).__escena, { timeout: 120_000 })
  await page.evaluate(() => { window.__estado = () => (window as any).__escena.getState() })
  // El relieve tarda en aparecer: hay que bajar terrain.json y las raíces z8.
  await page.waitForFunction(
    () => (window.__estado!().scene.getObjectByName('terrain')?.children.length ?? 0) > 0,
    { timeout: 120_000 },
  )
}

/** Espera a que el quadtree deje de cambiar: mismo conjunto de nodos visibles
 *  durante varias vueltas seguidas. Las teselas llegan por red y el LOD refina
 *  en cuanto una aterriza, así que medir antes de esto mide una vista a medias. */
async function esperarQuieto (page: Page, vueltas = 6, ms = 700) {
  let previo = '', estables = 0
  for (let t = 0; t < 60; t++) {
    const firma = await page.evaluate(() => {
      const g = window.__estado!().scene.getObjectByName('terrain')
      if (!g) return ''
      return g.children.filter((m: any) => m.visible).length + ':' +
        g.children.filter((m: any) => m.visible)
          .reduce((s: number, m: any) => s + m.geometry.attributes.position.count, 0)
    })
    estables = firma === previo && firma !== '' && firma !== '0:0' ? estables + 1 : 0
    previo = firma
    if (estables >= vueltas) return
    await page.waitForTimeout(ms)
  }
}

/**
 * Dónde para la cámara. Por coordenadas y no por una rejilla sobre el bbox: el
 * DEM es un rectángulo y el Táchira es una mancha irregular dentro de él, así
 * que una rejilla cae en relleno vacío la mitad de las veces (medido: 3 de 5
 * paradas daban `visibles: 0` -- el test no miraba nada y pasaba igual).
 *
 * Los cuatro primeros son los sitios EXACTOS donde se midieron las anomalías del
 * DEM (scripts/lib/terrarium.mjs), convertidos desde la tesela z12 y el píxel en
 * que aparecieron. Son los que tienen que seguir limpios: si el filtro se
 * rompe, revientan acá primero.
 *
 * Los dos últimos reparten el resto del estado, para que esto no sea una prueba
 * de cuatro puntos sino del mapa. Cada parada mide TODOS los nodos visibles
 * desde ella, que son decenas: no es un punto, es la vista entera.
 */
const SITIOS = [
  { nombre: 'grumo pozo -238 m', lat: 7.91745, lon: -71.72871 },
  { nombre: 'grumo 235 m', lat: 7.49626, lon: -72.33261 },
  { nombre: 'grumo 216 m', lat: 7.87256, lon: -71.50211 },
  { nombre: 'banco de vía 159 m', lat: 7.79570, lon: -72.05521 },
  { nombre: 'San Cristóbal', lat: 7.76690, lon: -72.22500 },
  { nombre: 'La Grita', lat: 8.13860, lon: -71.98470 },
]
// El peor grumo del DEM (294 m, en 7,39651 / -72,26498) NO está acá a propósito:
// cae dentro del rectángulo del DEM pero fuera del contorno del estado, y el
// fragment lo descarta (la máscara de stateMask). Medido: esa parada dibuja 6
// nodos y pantalla negra. Nunca se vio en el mapa y no se puede juzgar mirando.

/** Coordenadas del mundo de un sitio, con la MISMA conversión que usa la app. */
async function mundoDe (page: Page, lat: number, lon: number) {
  return page.evaluate(({ lat, lon }) => {
    const v = (window as any).__enu(lat, lon, 0)
    return { x: v.x, z: v.z }
  }, { lat, lon })
}

/** Pone la cámara mirando a (x,z), a `altura` sobre la cota `suelo`.
 *
 *  La distancia horizontal es 1,2 × la altura: unos 40° de picada. Más rasante
 *  (2,2×, lo primero que se probó) llena media pantalla de cielo y deja el
 *  relieve en una franja; más cenital no deja ver de perfil, que es justo como
 *  se delata una aguja. */
async function mirarDesde (
  page: Page, x: number, z: number, suelo: number, altura: number, rumbo: number,
) {
  await page.evaluate(({ x, z, suelo, altura, rumbo }) => {
    const s = window.__estado!()
    const c = s.camera as any, ctrl = s.controls as any
    const d = altura * 1.2
    c.position.set(x + d * Math.cos(rumbo), suelo + altura, z + d * Math.sin(rumbo))
    if (ctrl?.target) { ctrl.target.set(x, suelo, z); ctrl.update() }
    else c.lookAt(x, suelo, z)
    c.updateMatrixWorld()
  }, { x, z, suelo, altura, rumbo })
}

/**
 * Sitúa la cámara sobre un punto en dos pasos. Hace falta porque la cota del
 * terreno solo se puede leer de la malla YA cargada, y desde la vista inicial
 * de todo el estado lo único cargado son las raíces z8: el vértice "más
 * cercano" puede estar a kilómetros y con la cota equivocada, y la cámara
 * termina bajo tierra o mirando al cielo (pasó: paradas con la cota a -1.351 m).
 *
 * Primero se pone alto sobre el punto para que el LOD baje las teselas de ahí,
 * y recién entonces se lee la cota buena y se coloca la vista de trabajo.
 */
async function situarse (page: Page, x: number, z: number, altura: number, rumbo: number) {
  await mirarDesde(page, x, z, 1000, altura * 4, rumbo)
  await esperarQuieto(page, 2, 300)
  const suelo = await cotaEn(page, x, z)
  await mirarDesde(page, x, z, suelo, altura, rumbo)
  await esperarQuieto(page, 3, 300)
  return suelo
}

/** Dónde quedó la cámara de verdad tras el tope de <Vista>, y qué se ve. */
async function estadoCamara (page: Page) {
  return page.evaluate(() => {
    const s = window.__estado!()
    const c = s.camera as any, ctrl = s.controls as any
    const g = s.scene.getObjectByName('terrain')
    const vis = (g?.children ?? []).filter((m: any) => m.visible)
    return {
      camara: [c.position.x, c.position.y, c.position.z].map((v: number) => Math.round(v)),
      objetivo: ctrl?.target ? [ctrl.target.x, ctrl.target.y, ctrl.target.z].map((v: number) => Math.round(v)) : null,
      visibles: vis.length,
    }
  })
}

/** La cota del terreno en (x,z), leída del vértice más cercano ya dibujado. */
async function cotaEn (page: Page, x: number, z: number) {
  return page.evaluate(({ x, z }) => {
    const g = window.__estado!().scene.getObjectByName('terrain')
    let mejor = Infinity, cota = 0
    for (const m of (g?.children ?? []) as any[]) {
      const p = m.geometry.attributes.position
      for (let k = 0; k < p.count; k += 7) {
        const d = (p.getX(k) - x) ** 2 + (p.getZ(k) - z) ** 2
        if (d < mejor) { mejor = d; cota = p.getY(k) }
      }
    }
    return cota
  }, { x, z })
}

/**
 * Recorre todos los vértices de superficie de todos los nodos visibles (los
 * faldones cuelgan por diseño y no se juzgan) y devuelve los que sobresalen de
 * su anillo. Devuelve la distribución completa, para poder calibrar el umbral
 * con el dato en la mano en vez de a ojo. Un vértice sin altura (NaN, Infinity)
 * cuenta aparte, en `noFinitos`: comparar contra NaN da falso en todo y antes
 * pasaba como "medido y limpio".
 */
async function medirAgujas (page: Page) {
  return page.evaluate((LADO) => {
    const g = window.__estado!().scene.getObjectByName('terrain')
    const cortes = [0.5, 1, 2, 3]
    const cuenta = cortes.map(() => 0)
    const peores: any[] = []
    let nodos = 0, vertices = 0, noFinitos = 0

    // El anillo Chebyshev r=2 DENTRO de la rejilla del nodo: los 16 vértices del
    // borde del 5×5. Nunca los 8 vecinos inmediatos -- el ruido del DEM viene en
    // grumos de 2×2 y contra los vecinos pegados cada miembro tiene a sus
    // cómplices al lado, así que no sobresale de ellos y no se ve. Es
    // exactamente el error que tenía limpiarAnomalias, y este test lo repitió:
    // con los 8 vecinos daba verde sobre el DEM roto.
    const anillo: number[][] = []
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) === 2) anillo.push([di, dj])
      }
    }

    for (const m of g.children as any[]) {
      if (!m.visible) continue
      nodos++
      const p = m.geometry.attributes.position
      // La rejilla del nodo es regular: la celda se mide una vez por nodo.
      const celda = (Math.abs(p.getX(1) - p.getX(0)) + Math.abs(p.getZ(LADO) - p.getZ(0))) / 2
      for (let j = 0; j < LADO; j++) {
        for (let i = 0; i < LADO; i++) {
          const k = j * LADO + i
          const y = p.getY(k)
          vertices++
          if (!Number.isFinite(y)) { noFinitos++; continue }
          // En el borde el anillo se recorta a lo que cabe en la rejilla: menos
          // testigos, pero el vértice se juzga igual. Antes se saltaban las dos
          // filas y columnas del borde, y un pico ahí pasaba sin más.
          const r: number[] = []
          for (const [di, dj] of anillo) {
            const ii = i + di, jj = j + dj
            if (ii >= 0 && ii < LADO && jj >= 0 && jj < LADO) r.push(p.getY(jj * LADO + ii))
          }
          r.sort((a, b) => a - b)
          const mediana = r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2
          const exceso = y - mediana
          // El anillo está a DOS celdas, así que la pendiente que este desnivel
          // representa se mide contra dos anchos de celda.
          const razon = Math.abs(exceso) / (2 * celda)
          for (let c = 0; c < cortes.length; c++) if (razon > cortes[c]) cuenta[c]++
          if (razon > 1) {
            peores.push({
              razon: +razon.toFixed(2), metros: +exceso.toFixed(0), celda: +celda.toFixed(0), i, j,
              x: +p.getX(k).toFixed(0), y: +y.toFixed(0), z: +p.getZ(k).toFixed(0),
            })
          }
        }
      }
    }
    peores.sort((a, b) => Math.abs(b.razon) - Math.abs(a.razon))
    // `cuenta` se llena con la razón sin redondear; `peores` la trae a dos
    // decimales para leerla. Las aserciones van sobre `cuenta`: 3,001 es 3.00
    // en `peores` y pasaría un filtro `> 3`.
    return { nodos, vertices, noFinitos, cortes, cuenta, peores: peores.slice(0, 15), total: peores.length }
  }, LADO)
}

test('el relieve dibujado no tiene agujas ni cráteres en ninguna parte del estado', async ({ page }) => {
  const errores: string[] = []
  const anotar = (t: string) => { if (!RUIDO_SOFTWARE.test(t)) errores.push(t) }
  page.on('console', m => { if (m.type() === 'error') anotar(m.text()) })
  page.on('pageerror', e => anotar(String(e)))

  mkdirSync('e2e/salida', { recursive: true })
  await page.setViewportSize({ width: 900, height: 500 })
  await page.goto('/')
  await engancharEscena(page)

  // Se apaga la foto satelital. Dos razones, las dos de peso:
  //  - Con la foto, el albedo lo pone Esri por la red; si una tesela no llega
  //    el relieve sale NEGRO y la captura no sirve para juzgar nada (pasó).
  //    Sin ella manda la hipsometría, que es local y siempre está.
  //  - La forma del terreno se lee mucho mejor sombreada que bajo una foto
  //    aérea, y la forma es justo lo que este test juzga.
  // Además quita de encima la descarga de cientos de teselas por parada.
  await page.getByRole('button', { name: 'Imagen satelital' }).click()
  await esperarQuieto(page)

  // 1.200 m sobre el suelo: la altura a la que una aguja de un par de cientos de
  // metros se ve de perfil contra el terreno, que es como aparecieron en la
  // captura reportada. Y es donde el nodo llega a z15, el nivel que NO se filtra
  // por diseño (alturaDeVertice devuelve la triangulación exacta a paso ≤ 1).
  const paradas = SITIOS.map((s, i) => ({ ...s, altura: 1200, rumbo: i * 0.9 }))
  const acumulado = { nodos: 0, vertices: 0, noFinitos: 0, cuenta: [0, 0, 0, 0], peores: [] as any[] }
  const vacias: string[] = []

  for (const [n, p] of paradas.entries()) {
    const { x, z } = await mundoDe(page, p.lat, p.lon)
    const suelo = await situarse(page, x, z, p.altura, p.rumbo)
    const etiqueta = `${String(n).padStart(2, '0')}-${p.nombre.replace(/[^a-zA-Z0-9]+/g, '_')}`
    await page.screenshot({ path: `e2e/salida/${etiqueta}.png` })
    const m = await medirAgujas(page)
    // A un archivo y no solo a console.log: el reporter de Playwright retiene la
    // salida hasta que el test termina, y esto tarda minutos.
    const linea = `${etiqueta}: cota ${Math.round(suelo)} m · nodos ${m.nodos}` +
      ` · vértices ${m.vertices} · cuenta ${JSON.stringify(m.cuenta)}` +
      (m.peores.length ? ` · peor ${JSON.stringify(m.peores[0])}` : '')
    appendFileSync('e2e/salida/informe.txt', linea + '\n')
    console.log(linea)
    if (m.vertices < VERTICES_MIN) vacias.push(`${etiqueta} (${m.vertices} vértices)`)
    acumulado.nodos += m.nodos
    acumulado.vertices += m.vertices
    acumulado.noFinitos += m.noFinitos
    m.cuenta.forEach((v, i) => { acumulado.cuenta[i] += v })
    acumulado.peores.push(...m.peores)
  }

  acumulado.peores.sort((a, b) => b.razon - a.razon)
  const informe = [
    `nodos medidos: ${acumulado.nodos}   vértices: ${acumulado.vertices.toLocaleString()}`,
    `  desvía > 0,5 celdas: ${acumulado.cuenta[0]}`,
    `  desvía > 1,0 celdas: ${acumulado.cuenta[1]}`,
    `  desvía > 2,0 celdas: ${acumulado.cuenta[2]}`,
    `  desvía > 3,0 celdas: ${acumulado.cuenta[3]}`,
    'peores:', ...acumulado.peores.slice(0, 15).map(p => `  ${JSON.stringify(p)}`),
  ].join('\n')
  console.log(informe)

  expect(errores, `errores de consola:\n${errores.join('\n')}`).toEqual([])
  // Sin esto el test pasa mirando al cielo: una parada fuera del estado no
  // dibuja un solo nodo y no encuentra una sola aguja. Ya pasó.
  expect(vacias, `paradas que no dibujaron relieve suficiente para juzgar: ${vacias.join(', ')}`).toEqual([])
  // Piso, no meta: las seis paradas miden ~141.000 vértices (2026-09-12). Está
  // puesto bien por debajo para que solo salte si el mapa dejó de cargar de
  // verdad, no cada vez que el LOD elija un nodo más o menos.
  expect(acumulado.vertices, 'se midieron muy pocos vértices para concluir nada')
    .toBeGreaterThan(100_000)
  expect(acumulado.noFinitos, 'hay vértices sin altura (NaN o infinito) en el relieve dibujado').toBe(0)
  expect(acumulado.cuenta[3], `hay agujas en el relieve dibujado\n${informe}`).toBe(0)
})

test('el relieve no depende de canvas.getImageData (Brave altera esos píxeles)', async ({ page }) => {
  await page.addInitScript(FARBLING)
  await page.setViewportSize({ width: 900, height: 500 })
  await page.goto('/')
  await engancharEscena(page)
  await page.getByRole('button', { name: 'Imagen satelital' }).click()
  await esperarQuieto(page)

  const sitio = SITIOS[4]   // San Cristóbal: lomas y ciudad, z15 en pantalla
  const { x, z } = await mundoDe(page, sitio.lat, sitio.lon)
  await situarse(page, x, z, 1200, 0)
  mkdirSync('e2e/salida', { recursive: true })
  await page.screenshot({ path: 'e2e/salida/farbling.png' })
  const m = await medirAgujas(page)
  expect(m.vertices, 'se midieron muy pocos vértices para concluir nada').toBeGreaterThan(VERTICES_MIN)
  expect(m.noFinitos, 'hay vértices sin altura (NaN o infinito)').toBe(0)
  expect(
    m.cuenta[3],
    `el relieve sí pasa por getImageData: agujas con los píxeles alterados\n${JSON.stringify(m.peores.slice(0, 5))}`,
  ).toBe(0)
})
