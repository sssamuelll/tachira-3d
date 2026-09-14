import { test, expect, type Page } from '@playwright/test'
import { appendFileSync, mkdirSync } from 'node:fs'

/**
 * El sistema de capas, juzgado sobre la aplicación que se DIBUJA -- no sobre
 * los módulos en aislamiento, que ya tienen sus tests unitarios.
 *
 * Lo que sólo se puede ver acá, y por eso está acá:
 *
 *  - Un marcador de hospital termina donde está el suelo, o flotando, o
 *    enterrado. El apoyo es un raycast contra la malla YA dibujada: sin malla
 *    real no hay nada que medir, y `alturaGruesa` sola no lo responde.
 *  - Que ningún nodo del relieve conserve el uniforme `uLimites`: es el
 *    camino viejo que este mismo cambio borró, y un test unitario del shader
 *    no ve el bucle por nodo que podía dejarlo a medio apagar.
 *  - La URL y el panel no se desincronizan ni entran en ciclo.
 *  - Un clic en un marcador abre su ficha -- y qué le hace a la selección de
 *    vías, que es el defecto conocido y sin arreglar de esta rama.
 *
 * Corre con WebGL por software, así que es lento. No va en `npm test`; se
 * invoca aparte: `npx playwright test capas`.
 */

declare global {
  interface Window { __estado?: any }
}

/** Cuánto puede separarse un marcador del suelo para contar como apoyado.
 *
 *  No es un número de gusto: la celda del terreno mide unos 36 m de lado a z15
 *  y el marcador se apoya en el punto exacto mientras que la medición de acá
 *  toma el VÉRTICE más cercano, que puede estar a media celda. Sobre una ladera
 *  de 45° media celda ya son 18 m de cota. 60 m deja pasar ese error de
 *  muestreo y atrapa lo que importa: un marcador a cota 0 (a 1.000 m del suelo
 *  en el Táchira) o uno que se quedó con una cota de otro sitio.
 *
 *  El test imprime la distribución completa: si algún día hay que mover esto,
 *  se mueve con el dato del informe delante, no a ojo. */
const APOYO_MAX = 60

/** Error de consola que NO es de las capas: el LineMaterial de las vías declara
 *  más atributos de vértice de los que admite el programa. Es un defecto
 *  anterior a esta rama (sale también con GPU real) y está acotado a su mensaje
 *  exacto para que cualquier OTRO error siga tumbando esto. */
const RUIDO_CONOCIDO = /Too many attributes|VALIDATE_STATUS false/

const SAN_CRISTOBAL = { lat: 7.76690, lon: -72.22500 }

function informar (linea: string) {
  mkdirSync('e2e/salida-capas', { recursive: true })
  appendFileSync('e2e/salida-capas/informe.txt', linea + '\n')
  console.log(linea)
}

/** El store de la escena, publicado por <PuenteEscena> (App.tsx, sólo en DEV). */
async function engancharEscena (page: Page) {
  await page.waitForFunction(() => !!(window as any).__escena, { timeout: 120_000 })
  await page.evaluate(() => { window.__estado = () => (window as any).__escena.getState() })
  await page.waitForFunction(
    () => (window.__estado!().scene.getObjectByName('terrain')?.children.length ?? 0) > 0,
    { timeout: 120_000 },
  )
}

/**
 * Espera a que el quadtree deje de cambiar. Las teselas llegan por red y el LOD
 * refina en cuanto una aterriza: medir antes de esto mide una vista a medias.
 *
 * Entre muestra y muestra se cuentan CUADROS, no milisegundos. La versión por
 * reloj de esto se rindió antes de tiempo en una máquina cargada y dejó la
 * cámara con una cota mala: el test reportó "0 hospitales dentro del radio"
 * donde había 20, y el fallo no era del mapa sino de que en esos 400 ms no
 * había cabido ni un cuadro. Contar cuadros hace que la espera signifique lo
 * mismo con GPU (60 fps) que por software (1 fps).
 */
async function esperarQuieto (page: Page, vueltas = 5, cuadros = 2) {
  let previo = '', estables = 0
  for (let t = 0; t < 60; t++) {
    const firma = await page.evaluate(() => {
      const g = window.__estado!().scene.getObjectByName('terrain')
      if (!g) return ''
      const vis = g.children.filter((m: any) => m.visible)
      return vis.length + ':' +
        vis.reduce((s: number, m: any) => s + m.geometry.attributes.position.count, 0)
    })
    estables = firma === previo && firma !== '' && firma !== '0:0' ? estables + 1 : 0
    previo = firma
    if (estables >= vueltas) return
    await esperarCuadros(page, cuadros)
  }
}

/** Pone la cámara sobre un punto en dos pasos: primero alto, para que el LOD
 *  baje las teselas de ahí, y recién entonces se lee la cota buena. Desde la
 *  vista inicial del estado entero lo único cargado son las raíces z8 y el
 *  vértice "más cercano" puede estar a kilómetros. */
async function situarse (page: Page, lat: number, lon: number, altura: number) {
  const { x, z } = await page.evaluate(({ lat, lon }) => {
    const v = (window as any).__enu(lat, lon, 0)
    return { x: v.x, z: v.z }
  }, { lat, lon })

  const colocar = (suelo: number, alt: number) => page.evaluate(({ x, z, suelo, alt }) => {
    const s = window.__estado!()
    const c = s.camera as any, ctrl = s.controls as any
    const d = alt * 1.2
    c.position.set(x + d, suelo + alt, z + d)
    if (ctrl?.target) { ctrl.target.set(x, suelo, z); ctrl.update() }
    else c.lookAt(x, suelo, z)
    c.updateMatrixWorld()
  }, { x, z, suelo, alt })

  await colocar(1000, altura * 4)
  await esperarQuieto(page, 2, 2)
  const suelo = await cotaEn(page, x, z)
  await colocar(suelo, altura)
  await esperarQuieto(page, 3, 2)
  return { x, z, suelo }
}

/** La cota del terreno en (x,z), del vértice dibujado más cercano. */
async function cotaEn (page: Page, x: number, z: number) {
  return page.evaluate(({ x, z }) => {
    const g = window.__estado!().scene.getObjectByName('terrain')
    let mejor = Infinity, cota = 0
    for (const m of (g?.children ?? []) as any[]) {
      if (!m.visible) continue
      const p = m.geometry.attributes.position
      for (let k = 0; k < p.count; k += 3) {
        const d = (p.getX(k) - x) ** 2 + (p.getZ(k) - z) ** 2
        if (d < mejor) { mejor = d; cota = p.getY(k) }
      }
    }
    return cota
  }, { x, z })
}

/** Espera a que pasen `n` cuadros de verdad.
 *
 *  Hace falta porque los plazos de esta app se cuentan en CUADROS (CapaPuntos
 *  reapoya cada 30) y acá corre a ~1 cuadro por segundo con WebGL por software:
 *  un `waitForTimeout(4000)` que con GPU sería 240 cuadros, acá son 4. Medir el
 *  apoyo tras una espera de reloj mide la velocidad de la máquina. */
async function esperarCuadros (page: Page, n: number) {
  await page.evaluate(async n => {
    let v = 0
    await new Promise<void>(res => {
      const tic = () => { v++; v >= n ? res() : requestAnimationFrame(tic) }
      requestAnimationFrame(tic)
    })
  }, n, { timeout: 180_000 } as any)
}

/** Prende o apaga una capa por su nombre visible, y espera a que el botón lo
 *  confirme. Por el rol y el nombre accesible a propósito: si el panel deja de
 *  ser accesible, esto se cae, que es lo correcto. */
async function alternar (page: Page, nombre: string, encender: boolean) {
  const b = page.getByRole('button', { name: nombre, exact: true })
  await expect(b).toHaveAttribute('aria-pressed', String(!encender))
  await b.click()
  await expect(b).toHaveAttribute('aria-pressed', String(encender))
}

// ---------------------------------------------------------------------------
// 1. El panel y la URL. No necesita relieve fino, así que va aparte y rápido.
// ---------------------------------------------------------------------------

test('el panel y la URL dicen lo mismo, en los dos sentidos', async ({ page }) => {
  const errores: string[] = []
  page.on('console', m => {
    if (m.type() === 'error' && !RUIDO_CONOCIDO.test(m.text())) errores.push(m.text())
  })

  // Un parámetro ajeno para comprobar que el efecto de la URL no se lo come.
  await page.goto('/?hora=14')
  await engancharEscena(page)

  const panel = page.getByRole('group', { name: 'Capas del mapa' })
  await expect(panel.getByRole('button')).toHaveCount(3)

  // Estado de fábrica: sólo edificaciones. Y sin `?capas=` en la URL, para que
  // el enlace de siempre siga siendo el enlace de siempre.
  await expect(page.getByRole('button', { name: 'Edificaciones', exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Municipios', exact: true }))
    .toHaveAttribute('aria-pressed', 'false')
  expect(new URL(page.url()).searchParams.has('capas')).toBe(false)
  expect(new URL(page.url()).searchParams.get('hora')).toBe('14')

  await alternar(page, 'Hospitales y centros médicos', true)
  expect(new URL(page.url()).searchParams.get('capas')).toBe('edificios,hospitales')

  await alternar(page, 'Edificaciones', false)
  expect(new URL(page.url()).searchParams.get('capas')).toBe('hospitales')

  // El conjunto vacío no puede escribirse como `capas=`: eso se lee igual que
  // no haber puesto nada, y volverían los defectos. De ahí el centinela.
  await alternar(page, 'Hospitales y centros médicos', false)
  expect(new URL(page.url()).searchParams.get('capas')).toBe('ninguna')

  // El parámetro ajeno sobrevivió a las cuatro reescrituras.
  expect(new URL(page.url()).searchParams.get('hora')).toBe('14')

  // Y en el otro sentido: la URL manda al arrancar.
  await page.goto('/?capas=municipios&hora=9')
  await engancharEscena(page)
  await expect(page.getByRole('button', { name: 'Municipios', exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Edificaciones', exact: true }))
    .toHaveAttribute('aria-pressed', 'false')
  expect(new URL(page.url()).searchParams.get('hora')).toBe('9')

  // Un id que no existe se descarta sin romper nada ni dejarlo en la URL.
  await page.goto('/?capas=municipios,inventada')
  await engancharEscena(page)
  await expect(page.getByRole('button', { name: 'Municipios', exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
  expect(new URL(page.url()).searchParams.get('capas')).toBe('municipios')

  // El alias viejo tiene que seguir sirviendo: hay enlaces por ahí con él.
  await page.goto('/?edificios=0')
  await engancharEscena(page)
  await expect(page.getByRole('button', { name: 'Edificaciones', exact: true }))
    .toHaveAttribute('aria-pressed', 'false')

  // Ningún ciclo: el efecto que escribe la URL no puede volver a dispararse.
  // Se comprueba sobre el historial, que es donde un ciclo deja huella.
  const antes = await page.evaluate(() => history.length)
  await alternar(page, 'Municipios', true)
  await page.waitForTimeout(1500)
  const despues = await page.evaluate(() => history.length)
  expect(despues, 'replaceState no debe apilar entradas de historial').toBe(antes)

  expect(errores, 'consola limpia').toEqual([])
})

// ---------------------------------------------------------------------------
// 2, 3 y 4 comparten la carga del relieve, que es lo caro. Una sola página.
// ---------------------------------------------------------------------------

test.describe.serial('sobre el relieve dibujado', () => {
  let page: Page
  const errores: string[] = []

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    page.on('console', m => {
      if (m.type() === 'error' && !RUIDO_CONOCIDO.test(m.text())) errores.push(m.text())
    })
    await page.goto('/?capas=edificios,municipios,hospitales')
    await engancharEscena(page)
  })

  test.afterAll(async () => { await page?.close() })

  test('los 127 hospitales se apoyan en el terreno', async () => {
    await page.waitForFunction(
      () => (window.__estado!().scene.getObjectByName('capa:hospitales')?.children.length ?? 0) > 0,
      { timeout: 120_000 },
    )

    const total = await page.evaluate(
      () => window.__estado!().scene.getObjectByName('capa:hospitales').children.length,
    )
    informar(`marcadores montados: ${total}`)
    expect(total).toBe(127)

    // Antes de mover la cámara: ninguno puede estar en cero ni en NaN. Cero es
    // el nivel del mar y en el Táchira no hay un solo hospital ahí; NaN pasa
    // cualquier comparación numérica sin que nadie lo note.
    const crudos = await page.evaluate(() => {
      const g = window.__estado!().scene.getObjectByName('capa:hospitales')
      const ys = (g.children as any[]).map(m => m.position.y)
      return {
        noFinitos: ys.filter((y: number) => !Number.isFinite(y)).length,
        enCero: ys.filter((y: number) => y === 0).length,
        min: Math.min(...ys), max: Math.max(...ys),
      }
    })
    informar(`cotas al montar: min ${crudos.min.toFixed(0)} m, max ${crudos.max.toFixed(0)} m, ` +
      `noFinitos ${crudos.noFinitos}, en cero ${crudos.enCero}`)
    expect(crudos.noFinitos, 'marcadores con cota NaN/Infinity').toBe(0)
    expect(crudos.enCero, 'marcadores caídos al nivel del mar').toBe(0)

    // Ahora sí: la cámara a San Cristóbal, donde hay hospitales de verdad, y se
    // les deja varios ciclos de apoyo (uno cada 30 cuadros).
    await situarse(page, SAN_CRISTOBAL.lat, SAN_CRISTOBAL.lon, 1500)
    // Dos ciclos enteros de reapoyo (CADA = 30 cuadros) mas margen.
    await esperarCuadros(page, 70)

    const medida = await page.evaluate(() => {
      const s = window.__estado!()
      const terreno = s.scene.getObjectByName('terrain')
      const g = s.scene.getObjectByName('capa:hospitales')
      const cam = s.camera.position

      // La superficie dibujada, para comparar contra ella.
      const cota = (x: number, z: number) => {
        let mejor = Infinity, y = NaN
        for (const m of terreno.children as any[]) {
          if (!m.visible) continue
          const p = m.geometry.attributes.position
          for (let k = 0; k < p.count; k += 1) {
            const d = (p.getX(k) - x) ** 2 + (p.getZ(k) - z) ** 2
            if (d < mejor) { mejor = d; y = p.getY(k) }
          }
        }
        return { y, lejos: Math.sqrt(mejor) }
      }

      const cerca: any[] = []
      for (const m of g.children as any[]) {
        const d = Math.hypot(cam.x - m.position.x, cam.z - m.position.z)
        if (d > 3000) continue // RADIO_APOYO: fuera de eso no se apoya, y está bien
        const c = cota(m.position.x, m.position.z)
        cerca.push({
          d: +d.toFixed(0), marcador: +m.position.y.toFixed(1),
          suelo: +c.y.toFixed(1), desvio: +(m.position.y - c.y).toFixed(1),
          vertice: +c.lejos.toFixed(0),
        })
      }
      cerca.sort((a, b) => Math.abs(b.desvio) - Math.abs(a.desvio))
      // Dónde acabó la cámara de verdad y a qué distancia queda el hospital más
      // cercano: sin esto, un "0 dentro del radio" no dice si el problema es la
      // cámara, los marcadores o el radio.
      let masCerca = Infinity
      for (const m of g.children as any[]) {
        masCerca = Math.min(masCerca, Math.hypot(cam.x - m.position.x, cam.z - m.position.z))
      }
      return {
        cerca,
        camara: [cam.x, cam.y, cam.z].map(Math.round),
        masCerca: Math.round(masCerca),
        objetivo: (s.controls as any)?.target
          ? [s.controls.target.x, s.controls.target.y, s.controls.target.z].map(Math.round)
          : null,
      }
    })

    informar(`cámara en ${JSON.stringify(medida.camara)}, mirando a ${JSON.stringify(medida.objetivo)}`)
    informar(`hospital más cercano a la cámara: ${medida.masCerca} m`)
    informar(`hospitales dentro del radio de apoyo: ${medida.cerca.length}`)
    expect(medida.cerca.length,
      'ningún hospital cerca de San Cristóbal: la parada no mide nada').toBeGreaterThan(3)

    for (const h of medida.cerca.slice(0, 8)) {
      informar(`  a ${h.d} m de cámara: marcador ${h.marcador} m, suelo ${h.suelo} m, ` +
        `desvío ${h.desvio} m (vértice a ${h.vertice} m)`)
    }

    const peor = medida.cerca[0]
    expect(Math.abs(peor.desvio),
      `el peor marcador está a ${peor.desvio} m del suelo`).toBeLessThan(APOYO_MAX)
  })

  test('los límites municipales se dibujan como línea, no como textura', async () => {
    await alternar(page, 'Municipios', false)
    await page.waitForFunction(
      () => !window.__estado!().scene.getObjectByName('limites'), { timeout: 60_000 })

    await alternar(page, 'Municipios', true)
    await page.waitForFunction(
      () => !!window.__estado!().scene.getObjectByName('limites'), { timeout: 60_000 })

    const m = await page.evaluate(() => {
      const o = window.__estado!().scene.getObjectByName('limites') as any
      const s = window.__estado!().size
      return {
        segmentos: o.geometry.attributes.instanceStart.count,
        anchoPx: o.material.linewidth,
        resolucion: [o.material.resolution.x, o.material.resolution.y],
        lienzo: [s.width, s.height],
        // worldUnits decide si el ancho va en píxeles o en metros, y es la
        // diferencia entera con la textura que esto reemplaza. renderOrder
        // negativo mantiene la línea por debajo de toda vía (ordenCapa nunca
        // baja de 0). Ningún test unitario los cubre: una regresión que
        // borrara cualquiera de los dos pasaba la suite entera en verde.
        worldUnits: o.material.worldUnits,
        orden: o.renderOrder,
        // El uniforme viejo no puede seguir vivo en ningún nodo del relieve.
        quedanUniformes: (window.__estado!().scene.getObjectByName('terrain')?.children ?? [])
          .filter((n: any) => n.material?.userData?.uniforms?.uLimites).length,
      }
    })
    informar(`límites: ${m.segmentos} segmentos, ${m.anchoPx} px, resolución ${JSON.stringify(m.resolucion)}`)
    expect(m.segmentos).toBeGreaterThan(80_000)
    expect(m.quedanUniformes, 'quedó uLimites en algún nodo del relieve').toBe(0)
    // Si la resolución no sigue al lienzo, el ancho en píxeles deja de ser el pedido.
    expect(m.resolucion).toEqual(m.lienzo)
    expect(m.worldUnits, 'con worldUnits el ancho volvería a ir en metros').toBe(false)
    expect(m.orden, 'la línea tiene que quedar por debajo de toda vía').toBeLessThan(0)
  })

  test('un clic en un marcador abre su ficha', async () => {
    await situarse(page, SAN_CRISTOBAL.lat, SAN_CRISTOBAL.lon, 1200)
    await esperarCuadros(page, 40)

    // El marcador con nombre más cercano al centro de la pantalla: el que un
    // humano tocaría. Se proyecta con la misma cámara que lo dibujó.
    const objetivo = await page.evaluate(() => {
      const s = window.__estado!()
      const g = s.scene.getObjectByName('capa:hospitales')
      const cam = s.camera
      const { width, height } = s.size ?? { width: innerWidth, height: innerHeight }
      let mejor: any = null
      for (const m of g.children as any[]) {
        const v = m.position.clone().project(cam)
        if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.85 || Math.abs(v.y) > 0.85) continue
        const px = (v.x + 1) / 2 * width, py = (1 - v.y) / 2 * height
        const d = Math.hypot(px - width / 2, py - height / 2)
        if (!mejor || d < mejor.d) mejor = { px, py, d }
      }
      return mejor
    })

    expect(objetivo, 'ningún marcador visible en pantalla desde San Cristóbal').not.toBeNull()
    informar(`clic en marcador a (${objetivo.px.toFixed(0)}, ${objetivo.py.toFixed(0)})`)

    await page.mouse.click(objetivo.px, objetivo.py)
    await page.waitForTimeout(800)

    // La ficha del rasgo se monta arriba a la izquierda, con el enlace a OSM
    // como seña inequívoca de que es ESTA ficha y no la de una vía.
    const ficha = page.locator('a[href*="openstreetmap.org"]').first()
    await expect(ficha, 'la ficha del hospital no se abrió con el clic').toBeVisible({ timeout: 10_000 })

    await page.screenshot({ path: 'e2e/salida-capas/ficha.png' })
    expect(errores, 'consola limpia').toEqual([])
  })

  test('el clic en un marcador NO toca la selección de vías', async () => {
    // Este test nació al revés: documentaba el defecto. El clic sintético de
    // r3f sale de `pointerup` y llega DESPUÉS de que el click nativo del Picker
    // ya corrió entero, así que stopPropagation no podía pararlo y mirar un
    // hospital borraba la selección con la que estabas trabajando.
    // El arreglo no va por ahí: el marcador levanta una bandera en su
    // `pointerdown`, que sí va delante de todos, y el Picker la respeta.
    await situarse(page, SAN_CRISTOBAL.lat, SAN_CRISTOBAL.lon, 1200)
    await esperarCuadros(page, 40)

    // Seleccionar vías con el lazo: un rectángulo grande sobre la ciudad agarra
    // varias sin depender de acertarle a una con un clic.
    await page.getByRole('button', { name: 'Seleccionar por lazo' }).click()
    const caja = (await page.locator('canvas').first().boundingBox())!
    const cx = caja.x + caja.width / 2, cy = caja.y + caja.height / 2
    await page.mouse.move(cx - 250, cy - 180)
    await page.mouse.down()
    for (const [dx, dy] of [[250, -180], [250, 180], [-250, 180], [-250, -180]]) {
      await page.mouse.move(cx + dx, cy + dy, { steps: 8 })
    }
    await page.mouse.up()
    await esperarCuadros(page, 5)

    // El botón "Guardar en N vías" es exclusivo de la ficha de vías y existe
    // tanto con una seleccionada como con miles, así que sirve de testigo sin
    // depender de cómo esté redactado el encabezado.
    const testigo = page.getByRole('button', { name: /Guardar en/ })
    const seleccionadas = async () =>
      (await testigo.count()) > 0 ? await testigo.first().innerText() : null

    const antes = await seleccionadas()
    informar(`lazo: selección de vías = ${antes}`)
    test.skip(antes === null, 'el lazo no agarró ninguna vía en esta parada')

    const objetivo = await page.evaluate(() => {
      const s = window.__estado!()
      const g = s.scene.getObjectByName('capa:hospitales')
      const { width, height } = s.size ?? { width: innerWidth, height: innerHeight }
      let mejor: any = null
      for (const m of g.children as any[]) {
        const v = m.position.clone().project(s.camera)
        if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.85 || Math.abs(v.y) > 0.85) continue
        const px = (v.x + 1) / 2 * width, py = (1 - v.y) / 2 * height
        const d = Math.hypot(px - width / 2, py - height / 2)
        if (!mejor || d < mejor.d) mejor = { px, py, d }
      }
      return mejor
    })
    test.skip(!objetivo, 'ningún marcador visible para el clic')

    await page.mouse.click(objetivo.px, objetivo.py)
    await esperarCuadros(page, 5)

    const despues = await seleccionadas()
    informar(`tras el clic en el marcador: selección de vías = ${despues}`)
    await page.screenshot({ path: 'e2e/salida-capas/tras-clic.png' })

    expect(despues, 'el clic en el marcador se llevó por delante la selección').toBe(antes)
    // Y la ficha del hospital sí se abrió: el freno no puede tragarse el clic.
    await expect(page.locator('a[href*="openstreetmap.org"]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('el marcador mide lo que tiene que medir, no media pantalla', async () => {
    // `sizeAttenuation: false` no significa que la escala sean píxeles: el
    // shader de sprites multiplica por la profundidad y la división por w lo
    // cancela. Con la escala de 14 que había, cada marcador medía trece mil
    // píxeles de alto -- tapaba el mapa y se comía los clics de medio estado.
    const medida = await page.evaluate(() => {
      const s = window.__estado!()
      const g = s.scene.getObjectByName('capa:hospitales')
      const cam = s.camera as any
      const alto = (s.size ?? { height: innerHeight }).height
      const f = 1 / Math.tan((cam.fov * Math.PI / 180) / 2)
      // El alto en pantalla que produce el shader, para el sprite tal como está.
      const sp = (g.children as any[])[0]
      return { px: f * sp.scale.y * alto / 2, alto }
    })
    informar(`marcador: ${medida.px.toFixed(1)} px de alto sobre un viewport de ${medida.alto} px`)
    expect(medida.px).toBeGreaterThan(10)
    expect(medida.px).toBeLessThan(60)
  })

  test('el tema cambia el chrome y NO cambia el color del dato', async () => {
    // Hace falta una vía seleccionada: la ficha del PCI es donde vive el color
    // del dato en el DOM. Se selecciona con el lazo, como en el test del clic.
    await situarse(page, SAN_CRISTOBAL.lat, SAN_CRISTOBAL.lon, 1200)
    await esperarCuadros(page, 20)

    // El lazo puede haber quedado activo desde el test 'el clic en un
    // marcador NO toca la selección de vías': esa prueba lo enciende y nunca
    // lo apaga, y este describe.serial comparte la misma página (y con ella
    // el estado de React) entre tests. Pedir el botón por el nombre exacto
    // "Seleccionar por lazo" fallaría en ese caso -- ya dice "Salir del
    // lazo". Se ubica por el rol sin fijar cuál de las dos etiquetas trae, y
    // solo se hace clic si todavía no está en modo lazo.
    const botonLazo = page.getByRole('button', { name: /lazo/i })
    if (await botonLazo.getAttribute('aria-pressed') !== 'true') await botonLazo.click()

    const caja = (await page.locator('canvas').first().boundingBox())!
    const cx = caja.x + caja.width / 2, cy = caja.y + caja.height / 2
    await page.mouse.move(cx - 250, cy - 180)
    await page.mouse.down()
    for (const [dx, dy] of [[250, -180], [250, 180], [-250, 180], [-250, -180]]) {
      await page.mouse.move(cx + dx, cy + dy, { steps: 8 })
    }
    await page.mouse.up()
    await esperarCuadros(page, 5)

    // El chrome: el fondo del panel de capas.
    const fondoPanel = () => page.evaluate(() =>
      getComputedStyle(document.querySelector('[role="group"][aria-label="Capas del mapa"]')!)
        .backgroundColor)
    // El dato: el color con que la ficha pinta el tramo de PCI. Se busca el
    // elemento que lo lleva y se guarda su color calculado, que es lo que el
    // ojo ve -- no el token, que por definición cambiaría.
    const colorDelDato = () => page.evaluate(() => {
      const todos = [...document.querySelectorAll('*')]
        .map(e => getComputedStyle(e).backgroundColor)
        .filter(c => c.startsWith('rgb') && c !== 'rgba(0, 0, 0, 0)')
      return todos.join('|')
    })
    // El minimapa (Step 6b): su lienzo es 2D, así que getImageData sí lee
    // algo de verdad -- a diferencia del canvas WebGL del mapa grande, que
    // sin preserveDrawingBuffer se lee vacío. Se ubica por su `title` (no
    // tiene otro selector propio) y se suma el buffer entero en vez de
    // apostarle a una coordenada: T.fondo llena el cuadrado ANTES de
    // dibujarse el relieve encima, y como el bbox del estado no es cuadrado,
    // `encajar` deja franjas de ese fondo sin tapar dentro del disco -- esas
    // sí cambian con el tema, sin tener que adivinar dónde cae el estado
    // dentro del círculo.
    const SELECTOR_MINIMAPA = 'canvas[title="El estado completo. Un clic te lleva a ese punto"]'
    const sumaMinimapa = () => page.evaluate((selector) => {
      const cv = document.querySelector(selector) as HTMLCanvasElement
      const { data } = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height)
      let suma = 0
      for (let i = 0; i < data.length; i++) suma += data[i]
      return suma
    }, SELECTOR_MINIMAPA)

    const chromeAntes = await fondoPanel()
    const datoAntes = await colorDelDato()
    const minimapaAntes = await sumaMinimapa()
    expect(datoAntes, 'sin ficha de PCI abierta el test no mide nada').not.toBe('')

    await page.getByRole('button', { name: 'Tema oscuro' }).click()
    await expect.poll(fondoPanel).not.toBe(chromeAntes)
    // El arreglo del Step 6b, medido: sin `tema` en las dependencias de
    // dibujar(), el disco se hubiera quedado con los colores de antes hasta
    // mover la cámara. Se comprueba con waitForFunction (corre el predicado
    // DENTRO del navegador, vía requestAnimationFrame) y no con expect.poll:
    // esto último repetiría el getImageData()+suma de 150x150 px desde Node
    // en cada intento, y en una máquina cargada esa ida y vuelta puede
    // tardar minutos en vez de milisegundos -- se vio en la práctica
    // preparando este test. El margen es generoso por la misma razón.
    await page.waitForFunction(
      ({ selector, antes }) => {
        const cv = document.querySelector(selector) as HTMLCanvasElement
        const { data } = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height)
        let suma = 0
        for (let i = 0; i < data.length; i++) suma += data[i]
        return suma !== antes
      },
      { selector: SELECTOR_MINIMAPA, antes: minimapaAntes },
      { timeout: 120_000 },
    )

    // Y ahora lo que el spec §4.1 prohíbe: que el dato haya cambiado con él.
    const delPci = await page.evaluate(async () => {
      const { PCI_RANGES } = await import('/src/data/constants.ts')
      return PCI_RANGES.map((r: any) => `rgb(${r.color.map((c: number) => Math.round(c * 255)).join(', ')})`)
    })
    const datoDespues = await colorDelDato()
    for (const color of delPci) {
      expect(datoDespues.includes(color), `el tema se llevó por delante ${color} de la rampa del PCI`)
        .toBe(datoAntes.includes(color))
    }
  })
})
