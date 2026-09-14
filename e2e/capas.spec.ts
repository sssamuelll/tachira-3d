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
 *  - El uniforme `uLimites` llega a TODOS los nodos del terreno o sólo a los
 *    que el bucle por cuadro alcanzó antes de un `continue`. Un test unitario
 *    del shader no ve el bucle; acá se leen los materiales vivos.
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

/** Espera a que TODOS los nodos visibles del terreno lleven el valor pedido en
 *  `uLimites`. Por condición y no por reloj: el uniforme se escribe dentro del
 *  useFrame y con WebGL por software esto corre a ~1 cuadro por segundo. */
async function esperarUniforme (page: Page, valor: number) {
  await page.waitForFunction(v => {
    const g = window.__estado!().scene.getObjectByName('terrain')
    const vis = (g?.children ?? []).filter((m: any) => m.visible &&
      m.material?.userData?.uniforms?.uLimites)
    return vis.length > 0 &&
      vis.every((m: any) => m.material.userData.uniforms.uLimites.value === v)
  }, valor, { timeout: 60_000 })
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

  test('los límites municipales llegan a todos los nodos del terreno', async () => {
    // Apagados primero: el uniforme tiene que estar en cero en TODOS, incluidos
    // los nodos que el bucle por cuadro salta con un `continue`. Un nodo que se
    // quede con el valor del cuadro anterior dibuja una línea fantasma.
    // Se espera por CONDICIÓN, no por tiempo. Con WebGL por software esta app
    // corre a ~1 cuadro por segundo (medido), y el uniforme sólo se reescribe
    // dentro del useFrame: cualquier espera en milisegundos es una apuesta
    // sobre cuántos cuadros caben. Con esto el test mide lo que quiere medir
    // -- que el valor llega -- y no la velocidad de la máquina.
    await alternar(page, 'Municipios', false)
    await esperarUniforme(page, 0)

    // Los uniformes del relieve no cuelgan de `material.uniforms` sino de
    // `material.userData.uniforms`: el material es un MeshStandardMaterial
    // parcheado con onBeforeCompile, no un ShaderMaterial. Sólo se miran los
    // nodos VISIBLES -- los que el quadtree dejó fuera conservan los valores
    // del cuadro en que se los usó, y eso no dibuja nada.
    const leer = () => page.evaluate(() => {
      const g = window.__estado!().scene.getObjectByName('terrain')
      const vals: number[] = []
      let sinTextura = 0, texel: any = null
      for (const m of g.children as any[]) {
        if (!m.visible) continue
        const u = m.material?.userData?.uniforms
        if (!u?.uLimites) continue
        vals.push(u.uLimites.value)
        if (!u.uIndices?.value) sinTextura++
        if (!texel && u.uTexelIdx) texel = [u.uTexelIdx.value.x, u.uTexelIdx.value.y]
      }
      return { n: vals.length, unos: vals.filter(v => v === 1).length, sinTextura, texel }
    })

    const off = await leer()
    informar(`municipios apagados: ${off.unos}/${off.n} nodos con uLimites=1`)
    expect(off.n, 'ningún nodo del terreno expone uLimites').toBeGreaterThan(0)
    expect(off.unos, 'nodos dibujando límites con la capa apagada').toBe(0)

    await alternar(page, 'Municipios', true)
    await esperarUniforme(page, 1)

    const on = await leer()
    informar(`municipios prendidos: ${on.unos}/${on.n} nodos con uLimites=1, ` +
      `sin textura de índices: ${on.sinTextura}, texel ${JSON.stringify(on.texel)}`)
    expect(on.unos, 'nodos que se quedaron sin el uniforme al prender la capa').toBe(on.n)

    // El uniforme sin la textura no dibuja nada y no avisa: es el fallo
    // silencioso que este test existe para atrapar.
    expect(on.sinTextura, 'nodos con uLimites=1 pero uIndices null').toBe(0)
    expect(on.texel[0]).toBeCloseTo(1 / 2048, 8)
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
})
