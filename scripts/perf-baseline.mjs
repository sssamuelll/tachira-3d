// Sonda de rendimiento. Solo lectura sobre el repo: abre el mapa publicado (o
// la URL que le pases) en un Chromium con GPU real, mide la carga y muestrea
// cuadros en varias vistas.
//   node scripts/perf-baseline.mjs [url] [--preview] [--capturas <dir>] [--recarga] [--recargas N] [--headed] [--brave] [--sweep] [--perfil]
//
// --preview es la forma de comparar un cambio contra su antes: hornea el build
// de producción, lo sirve con `vite preview` y mide contra eso. Medir en el
// servidor de desarrollo no sirve para comparar dos ramas -- el módulo sin
// empaquetar y el mapa de fuentes mueven los números por su cuenta.
// --sweep quita el tope de vsync y, en cada vista, apaga por turnos sombras,
// vías, edificios e imagen y cambia el dpr, para ver qué cuesta cada cosa.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const args = process.argv.slice(2)
// Las opciones que llevan valor: su valor NO es la URL. Sin esta lista, el
// `find` de más abajo tomaba `.cache/perf/f0` (el valor de --capturas) por la
// dirección a visitar y la sonda reventaba con "Invalid URL" en cuanto alguien
// usaba el comando documentado sin URL explícita.
const CON_VALOR = new Set(['--capturas', '--recargas'])
const valorDe = nombre => {
  const i = args.indexOf(nombre)
  return i >= 0 ? args[i + 1] : null
}
const posicionales = args.filter((a, i) => !a.startsWith('--') && !CON_VALOR.has(args[i - 1]))
const preview = args.includes('--preview')
// Una captura por muestra. No es cosmético: un cambio de rendimiento que
// acelera porque dejó de dibujar algo se ve idéntico en la tabla de fps y
// distinto en la imagen. perf-comparar.mjs las compara píxel a píxel.
const capturas = valorDe('--capturas')
const PUERTO_PREVIEW = 4173
const target = posicionales[0]
  ?? (preview ? `http://localhost:${PUERTO_PREVIEW}/` : 'https://sssamuelll.github.io/tachira-3d/')
const url = new URL(target); url.searchParams.set('diagnostico', '1')

// Levanta el build horneado. Devuelve el proceso para matarlo al final.
// La salida de los hijos va a stderr y no a stdout: en stdout va el JSON de la
// medición, y el resumen de vite en medio lo dejaría sin parsear.
const correr = (cmd, espera) => new Promise((ok, mal) => {
  const p = spawn(cmd, { shell: true, stdio: ['ignore', process.stderr, process.stderr] })
  if (!espera) return ok(p)
  p.on('exit', c => (c === 0 ? ok(p) : mal(new Error(cmd + ' salió con ' + c))))
})
const esperarHttp = async (u, ms) => {
  const hasta = Date.now() + ms
  while (Date.now() < hasta) {
    try { if ((await fetch(u)).ok) return true } catch {}
    await new Promise(r => setTimeout(r, 400))
  }
  throw new Error('el servidor no contestó en ' + ms + ' ms: ' + u)
}
let servidor = null
if (preview) {
  if (!args.includes('--sin-build')) {
    process.stderr.write('horneando el build de producción...\n')
    await correr('npm run build', true)
  }
  servidor = await correr(`npx vite preview --port ${PUERTO_PREVIEW} --strictPort`, false)
  await esperarHttp(`http://localhost:${PUERTO_PREVIEW}/`, 60_000)
  process.stderr.write('vite preview en pie\n')
}
const headed = args.includes('--headed')
const brave = args.includes('--brave')
const sweep = args.includes('--sweep')
// --perfil: perfil de CPU del hilo principal (CDP Profiler) en tres momentos,
// agregado por función. Úsalo contra el dev server (nombres sin minificar).
const perfil = args.includes('--perfil')
const W = 1400, H = 900
const SAN_CRISTOBAL = [7.7669, -72.2250, 830]

const flags = ['--use-gl=angle', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=' + W + ',' + H]
// Sin quitar el vsync, TODO sale a 16,6 ms y dos ramas distintas se ven
// iguales: el tope las esconde a las dos. Va aparte de --sweep para poder
// medir una comparación sensible sin pagar las seis variantes del barrido.
if (sweep || args.includes('--sinvsync')) flags.push('--disable-frame-rate-limit', '--disable-gpu-vsync')
const browser = await chromium.launch({
  headless: !headed,
  executablePath: brave ? 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' : undefined,
  args: flags,
})
if (capturas) mkdirSync(capturas, { recursive: true })
const salida = { url: url.href, headed, brave, sweep, preview, capturas, boot: {}, hitos: {}, errores: [], muestras: [], perfiles: [] }
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()

  // Red por CDP: bytes en el cable por petición.
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Performance.enable')
  const heapMB = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    const m = Object.fromEntries(metrics.map(x => [x.name, x.value]))
    return { heapMB: Math.round(m.JSHeapUsedSize / 1048576), heapTotalMB: Math.round(m.JSHeapTotalSize / 1048576), nodosDom: m.Nodes }
  }
  // Perfil de CPU: 4 s de muestras del hilo principal, agregadas por función
  // (tiempo propio). '(garbage collector)' y '(program)' salen como funciones.
  const perfilar = async (etiqueta, durante) => {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
    await cdp.send('Profiler.start')
    await Promise.all([page.waitForTimeout(4000), durante ? durante() : Promise.resolve()])
    const { profile } = await cdp.send('Profiler.stop')
    await cdp.send('Profiler.disable')
    const porId = new Map(profile.nodes.map(n => [n.id, n]))
    const propio = new Map(); let total = 0
    profile.samples.forEach((id, i) => {
      const dt = (profile.timeDeltas[i] ?? 0) / 1000; total += dt
      const n = porId.get(id); const cf = n.callFrame
      const clave = (cf.functionName || '(anónima)') + ' @ ' + (cf.url ? cf.url.split('/').slice(-2).join('/') + ':' + (cf.lineNumber + 1) : '')
      propio.set(clave, (propio.get(clave) ?? 0) + dt)
    })
    const top = [...propio.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)
      .map(([f, ms]) => ({ f: f.slice(0, 90), ms: Math.round(ms), pct: +(100 * ms / total).toFixed(1) }))
    salida.perfiles.push({ etiqueta, total_ms: Math.round(total), top })
    process.stderr.write('  perfil ' + etiqueta + ': ' + top.slice(0, 6).map(t => t.f.split(' @ ')[0] + ' ' + t.pct + '%').join(', ') + '\n')
  }
  const red = new Map()
  cdp.on('Network.requestWillBeSent', e => red.set(e.requestId, { url: e.request.url, bytes: 0, t0: e.timestamp, fin: null, cache: false }))
  cdp.on('Network.requestServedFromCache', e => { const r = red.get(e.requestId); if (r) r.cache = true })
  cdp.on('Network.loadingFinished', e => { const r = red.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.fin = e.timestamp } })
  const resumenRed = etiqueta => {
    const rs = [...red.values()].filter(r => r.fin != null)
    const cat = u => /arcgis|esri/i.test(u) ? 'esri' : /\/dem\//.test(u) ? 'dem' : /\/edificios\//.test(u) ? 'edificios' : /\/data\//.test(u) ? 'data' : /\/assets\//.test(u) ? 'assets' : 'otros'
    const porCat = {}
    for (const r of rs) { const c = cat(r.url); porCat[c] ??= { n: 0, MB: 0 }; porCat[c].n++; porCat[c].MB += r.bytes / 1048576 }
    for (const c of Object.values(porCat)) c.MB = +c.MB.toFixed(2)
    const top = [...rs].sort((a, b) => b.bytes - a.bytes).slice(0, 15)
      .map(r => ({ archivo: r.url.split('/').slice(-2).join('/').slice(-60), kB: Math.round(r.bytes / 1024), ms: Math.round((r.fin - r.t0) * 1000), cache: r.cache }))
    return { etiqueta, peticiones: rs.length, MB: +(rs.reduce((s, r) => s + r.bytes, 0) / 1048576).toFixed(1), porCat, top }
  }

  const t0 = Date.now()
  page.on('console', async m => {
    const txt = m.text()
    if (txt.startsWith('map.boot')) {
      let obj = null
      try { obj = (await Promise.all(m.args().map(a => a.jsonValue())))[1] ?? null } catch {}
      salida.boot[txt.split(' ')[0]] = { at_ms: Date.now() - t0, obj }
    } else if (m.type() === 'error' || m.type() === 'warning') {
      if (salida.errores.length < 30) salida.errores.push(m.type() + ': ' + txt.slice(0, 220))
    }
  })
  page.on('pageerror', e => salida.errores.push('pageerror: ' + (e.message ?? e)))

  // La línea de tiempo de la carga, desde `desde` (0 en el arranque, el momento
  // de la recarga en la segunda vuelta). Devuelve los hitos en vez de
  // escribirlos: la recarga los quiere aparte.
  //
  // `vias_ms` sale del evento de consola map.boot.loaded, no de un cartel. Es
  // el único hito que sobrevive a partir la carga en dos: el día que el relieve
  // se dibuje sin esperar a la red vial, el cartel se irá antes y las vías
  // llegarán después, y muestrear en medio compararía dos mapas a medio montar.
  const medirCarga = async desde => {
    const h = {}
    let vistoCargando = false
    const inicio = Date.now()
    const bootAntes = salida.boot['map.boot.loaded']?.at_ms ?? null
    while (Date.now() - inicio < 180_000) {
      // Los textos de los carteles, no uno solo: el primero se llamó "Cargando
      // la red vial" hasta que la carga se partió en dos y pasó a ser "Cargando
      // el relieve". Buscar solo el viejo dejaba cargando_fuera_ms midiendo
      // otra cosa sin que nada avisara.
      const s = await page.evaluate(() => {
        const texto = document.body.innerText
        return {
          escena: !!window.__escena,
          cargando: /Cargando (la red vial|el relieve)/.test(texto),
          armando: texto.includes('Armando el relieve'),
          error: texto.includes('No se pudo cargar el mapa'),
        }
      })
      const t = Date.now() - desde
      if (s.cargando) vistoCargando = true
      if (!s.cargando && (vistoCargando || s.armando || s.escena) && h.cargando_fuera_ms == null) h.cargando_fuera_ms = t
      if (s.escena && h.escena_ms == null) h.escena_ms = t
      if (s.escena && !s.armando && h.primer_cuadro_ms == null) h.primer_cuadro_ms = t
      if (s.error) { h.error_ms = t; break }
      // No basta con el primer cuadro: hay que esperar a que las vías estén
      // montadas, o las capturas comparan mapas a medio armar.
      const boot = salida.boot['map.boot.loaded']?.at_ms ?? null
      if (boot != null && boot !== bootAntes) { h.vias_listas_ms = boot - (desde - t0); if (h.primer_cuadro_ms != null) break }
      await page.waitForTimeout(250)
    }
    return h
  }

  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  Object.assign(salida.hitos, await medirCarga(t0))
  // Compatibilidad con las corridas viejas, que lo llamaban así.
  salida.hitos.armando_fuera_ms = salida.hitos.primer_cuadro_ms
  salida.red_arranque = resumenRed('hasta el primer cuadro con las vías montadas')

  salida.maquina = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2')
    const e = c && c.getExtension('WEBGL_debug_renderer_info')
    return { cores: navigator.hardwareConcurrency, memGB: navigator.deviceMemory, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], gpu: e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/d', maxAttribs: c ? c.getParameter(c.MAX_VERTEX_ATTRIBS) : null, ua: navigator.userAgent.slice(-60) }
  })
  salida.botones = await page.$$eval('button[title]', bs => bs.map(b => b.title.slice(0, 40)))

  // Sonda: 3 s de cuadros. Cuenta los draw calls de TODO el cuadro (sombras +
  // escena + composer) apagando el autoReset de renderer.info y reiniciándolo
  // a mano en cada rAF. `cpu` es cuánto llevaba ocupado el hilo principal
  // dentro del cuadro cuando corre este rAF (r3f registra el suyo primero,
  // así que ya pasó por sus useFrame y su render). `largas` son las long
  // tasks (>50 ms) que cayeron dentro de la ventana.
  let convergida = null
  const sonda = async (etiqueta, durante, ventanaMs = 3000) => {
    const p = page.evaluate(ventanaMs => new Promise(res => {
      const st = window.__escena.getState(); const gl = st.gl
      const auto = gl.info.autoReset; gl.info.autoReset = false; gl.info.reset()
      const t0 = performance.now(); let last = t0; const dts = [], calls = [], tris = [], cpu = [], largas = []
      const po = new PerformanceObserver(l => { for (const e of l.getEntries()) largas.push(Math.round(e.duration)) })
      try { po.observe({ type: 'longtask' }) } catch {}
      const q = (a, k) => { const o = [...a].sort((x, y) => x - y); return o[Math.floor(k * (o.length - 1))] }
      function tick (ts) {
        const now = performance.now(); dts.push(now - last); last = now; cpu.push(now - ts)
        calls.push(gl.info.render.calls); tris.push(gl.info.render.triangles); gl.info.reset()
        if (now - t0 < ventanaMs) { requestAnimationFrame(tick); return }
        gl.info.autoReset = auto; po.disconnect(); dts.shift(); calls.shift(); tris.shift(); cpu.shift()
        const terreno = st.scene.getObjectByName('terrain')
        res({
          frames: dts.length, fps: +(dts.length / ((now - t0) / 1000)).toFixed(1),
          ms_p50: +q(dts, .5).toFixed(1), ms_p95: +q(dts, .95).toFixed(1), ms_max: +Math.max(...dts).toFixed(1),
          cpu_p50: +q(cpu, .5).toFixed(1), cpu_p95: +q(cpu, .95).toFixed(1), largas,
          calls: q(calls, .5), calls_max: Math.max(...calls), tris_k: Math.round(q(tris, .5) / 1000),
          geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs.length,
          heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
          dpr: gl.getPixelRatio(), canvas: [gl.domElement.width, gl.domElement.height],
          nodos: terreno ? terreno.children.filter(c => c.visible).length + '/' + terreno.children.length : null,
          cam: st.camera.position.toArray().map(Math.round),
        })
      }
      requestAnimationFrame(tick)
    }), ventanaMs)
    const [r] = await Promise.all([p, durante ? durante() : Promise.resolve()])
    Object.assign(r, await heapMB())
    r.convergida = convergida
    // La captura va DESPUÉS de la muestra y con la cámara ya quieta, para que
    // dos corridas encuadren lo mismo. Las de orbitar no se capturan: la
    // cámara termina donde la deje el arrastre y no serían comparables.
    if (capturas && !/orbitando/.test(etiqueta)) {
      await page.screenshot({ path: capturas + '/' + etiqueta.replace(/[^\w.-]+/g, '_') + '.png' })
    }
    salida.muestras.push({ etiqueta, ...r })
    process.stderr.write('  ' + etiqueta + ': ' + r.fps + ' fps, ' + r.ms_p50 + ' ms, cpu ' + r.cpu_p50 + ' ms, ' + r.calls + ' calls, ' + r.tris_k + 'k tris, nodos ' + r.nodos + (r.largas.length ? ', largas ' + r.largas.join('/') : '') + '\n')
  }
  // Espera a que la escena deje de cambiar antes de medir. No es cortesía: el
  // relieve refina por niveles y la foto satelital llega tesela a tesela, así
  // que muestrear "tres segundos después de colocar la cámara" mide un momento
  // distinto en cada corrida. Medido: en la primera muestra de vista de estado
  // había 95 texturas vivas en una corrida y 178 en la siguiente, con el mismo
  // commit -- y las capturas salían con el 90 % de los píxeles distintos. La
  // muestra del final, ya convergida, salía idéntica al píxel.
  const esperarEstable = async (maxMs = 30_000, iguales = 3) => {
    let previo = null; let repetidos = 0
    const hasta = Date.now() + maxMs
    while (Date.now() < hasta) {
      const ahora = await page.evaluate(() => {
        const st = window.__escena.getState(); const gl = st.gl
        const t = st.scene.getObjectByName('terrain')
        return [gl.info.memory.textures, gl.info.memory.geometries,
          t ? t.children.filter(c => c.visible).length : 0].join('/')
      })
      if (ahora === previo) { if (++repetidos >= iguales) return { estable: true, estado: ahora } } else { repetidos = 0; previo = ahora }
      await page.waitForTimeout(700)
    }
    return { estable: false, estado: previo }
  }

  // Una captura con la foto satelital APAGADA. Es la única comparable entre dos
  // corridas: con la foto encendida, medido sobre el mismo commit dos veces,
  // la vista de ciudad daba el 59 % de los píxeles distintos aunque los
  // triángulos y los draw calls fueran idénticos -- las teselas de Esri llegan
  // en otro orden y a otra resolución cada vez. Sin foto queda la hipsometría,
  // que sale del DEM propio y es la misma siempre, así que una diferencia ahí
  // sí es un cambio de dibujo.
  const capturaSinFoto = async etiqueta => {
    if (!capturas) return
    const boton = page.locator('button[title="Imagen satelital"]')
    if (!await boton.count()) return
    await boton.click()
    await esperarEstable(20_000)
    await page.screenshot({ path: capturas + '/' + etiqueta.replace(/[^\w.-]+/g, '_') + '__sinfoto.png' })
    await boton.click()
    await esperarEstable(20_000)
  }

  const colocar = (lat, lon, h, dx, dy, dz) => page.evaluate(([lat, lon, h, dx, dy, dz]) => {
    const st = window.__escena.getState(); const t = window.__enu(lat, lon, h)
    st.controls.target.copy(t); st.camera.position.set(t.x + dx, t.y + dy, t.z + dz); st.controls.update()
    // El bucle va por demanda: controls.update() ya emite su 'change' y drei
    // pide el cuadro, pero esto es una sonda y no debe depender de eso para
    // no medir un cuadro viejo si algún día cambia.
    st.invalidate()
  }, [lat, lon, h, dx, dy, dz])
  const arrastrar = async (dx, dy) => {
    const cx = W / 2, cy = H / 2, n = 25
    await page.mouse.move(cx, cy); await page.mouse.down()
    for (let i = 1; i <= n; i++) { await page.mouse.move(cx + dx * i / n, cy + dy * i / n); await page.waitForTimeout(40) }
    await page.mouse.up()
  }
  // Variantes del barrido: cada una apaga UNA cosa, mide y la restaura.
  const variar = (nombre, on) => page.evaluate(([nombre, on]) => {
    const st = window.__escena.getState(); const gl = st.gl; const scene = st.scene
    if (nombre === 'sinSombras') gl.shadowMap.enabled = !on
    if (nombre === 'sinVias') scene.traverse(o => { if (o.isLineSegments2 && o.name !== 'limites') o.material.visible = !on })
    if (nombre === 'sinEdificios') { const g = scene.getObjectByName('edificios'); if (g) g.visible = !on }
    if (nombre === 'dpr0.5') st.setDpr(on ? 0.5 : 1)
    if (nombre === 'dpr1.5') st.setDpr(on ? 1.5 : 1)
    // Ninguna de estas cinco pasa por React ni por los controles, así que con
    // el bucle por demanda no se dibujarían nunca.
    st.invalidate()
  }, [nombre, on])
  const barrido = async vista => {
    for (const v of ['sinSombras', 'sinVias', 'sinEdificios', 'dpr0.5', 'dpr1.5']) {
      await variar(v, true); await page.waitForTimeout(1200)
      await sonda(vista + ' ' + v)
      await variar(v, false); await page.waitForTimeout(600)
    }
    const imagen = page.locator('button[title="Imagen satelital"]')
    if (await imagen.count()) {
      await imagen.click(); await page.waitForTimeout(3000)
      await sonda(vista + ' sinImagen')
      await imagen.click(); await page.waitForTimeout(3000)
    }
  }

  if (salida.hitos.armando_fuera_ms != null) {
    convergida = await esperarEstable()
    console.error('  estado:', JSON.stringify(convergida))
    await sonda('B1 estado quieta')
    await sonda('B2 estado quieta')
    await capturaSinFoto('B estado')
    salida.red_estado = resumenRed('tras ~10 s en vista de estado')
    if (perfil) await perfilar('B estado quieta')
    if (sweep) await barrido('B estado')
    await sonda('B3 estado orbitando', () => arrastrar(300, 0))
    await colocar(...SAN_CRISTOBAL, 0, 2500, 4000)
    convergida = await esperarEstable()
    console.error('  ciudad:', JSON.stringify(convergida))
    await sonda('C1 ciudad quieta')
    await sonda('C2 ciudad quieta')
    await capturaSinFoto('C ciudad')
    if (perfil) await perfilar('C ciudad quieta')
    if (sweep) await barrido('C ciudad')
    if (perfil) await perfilar('D ciudad orbitando', async () => { await arrastrar(300, 0); await arrastrar(0, 150); await arrastrar(-250, 0) })
    await sonda('D1 ciudad orbitando', () => arrastrar(300, 0))
    await sonda('D2 ciudad orbitando', () => arrastrar(0, 200))
    await colocar(...SAN_CRISTOBAL, 0, 120, 220)
    convergida = await esperarEstable()
    console.error('  calle:', JSON.stringify(convergida))
    await sonda('E1 calle quieta')
    await capturaSinFoto('E calle')
    if (perfil) await perfilar('E calle quieta')
    if (sweep) await barrido('E calle')
    await sonda('E2 calle orbitando', () => arrastrar(200, 0))
    const lluvia = page.locator('button[title="Lluvia"]')
    if (await lluvia.count()) {
      await lluvia.click(); await page.waitForTimeout(2500)
      convergida = await esperarEstable(10_000)
      await sonda('F calle lluvia quieta')
      await lluvia.click()
    } else salida.errores.push('sin botón de lluvia: títulos = ' + salida.botones.join(' | '))
    // Vuelo por el estado: ocho saltos a sitios lejanos entre si, a altura de
    // pueblo. Cada salto obliga a armar relieve nuevo entero, que es
    // exactamente el caso que el presupuesto de nodos por cuadro dice arreglar
    // (TerrainLod.tsx, NODOS_POR_CUADRO). Orbitar un poco no lo ejercita: los
    // nodos ya estan armados y la LRU los devuelve.
    const RUTA = [
      [7.7669, -72.2250], [7.8200, -72.2200], [8.1300, -71.9800], [7.8100, -72.4400],
      [7.7000, -72.3500], [8.0300, -72.2500], [8.0200, -71.7600], [8.2100, -72.2500],
    ]
    convergida = null
    await sonda('H vuelo por el estado', async () => {
      for (const [lat, lon] of RUTA) {
        await colocar(lat, lon, 1000, 0, 900, 1400)
        await page.waitForTimeout(1100)
      }
    }, 10_000)

    await colocar(8.021973, -71.901563, 0, 0, 55000, 100000)
    convergida = await esperarEstable()
    await sonda('G estado de vuelta')

    // La segunda visita. GitHub Pages sirve el sitio con max-age=600, así que
    // a los diez minutos volver al mapa rebaja los megabytes enteros. Lo único
    // que dice si una caché sirve es cuántas peticiones llegan de verdad a la
    // red tras un F5 en la misma pestaña.
    // --recargas N recarga N veces. Más de una hace falta para juzgar un
    // service worker: en la PRIMERA visita la página todavía no está
    // controlada -- el worker se instala mientras los datos ya van por el
    // cable -- así que la recarga 1 es la que LLENA su caché y la recarga 2 la
    // primera que puede servirse de ella. Con una sola recarga, una caché que
    // funciona se mide idéntica a no tener ninguna.
    if (args.includes('--recarga') || args.includes('--recargas')) {
      const cuantas = Math.max(1, Number(valorDe('--recargas') ?? 1))
      for (let i = 1; i <= cuantas; i++) {
        const yaVistas = new Set(red.keys())
        const desde = Date.now()
        salida.boot = {}
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
        const h = await medirCarga(desde)
        const sufijo = i === 1 ? '' : String(i)
        for (const [k, v] of Object.entries(h)) salida.hitos['recarga' + sufijo + '_' + k] = v
        const nuevas = [...red.entries()].filter(([k, r]) => !yaVistas.has(k) && r.fin != null)
        // Partido por origen a propósito: las teselas de Esri no se pueden
        // guardar (su licencia permite usar el servicio, no copiarlo), varían
        // de una corrida a otra según por dónde pasó la cámara, y son varios
        // MB. Sumadas al total tapan por completo lo que sí se puede ahorrar,
        // que es lo que viene del propio sitio.
        const delSitio = nuevas.filter(([, r]) => { try { return new URL(r.url).origin === url.origin } catch { return false } })
        salida['red_recarga' + sufijo] = {
          peticiones: nuevas.length,
          MB: +(nuevas.reduce((s, [, r]) => s + r.bytes, 0) / 1048576).toFixed(2),
          MB_sitio: +(delSitio.reduce((s, [, r]) => s + r.bytes, 0) / 1048576).toFixed(2),
          peticiones_sitio: delSitio.length,
          deCache: nuevas.filter(([, r]) => r.cache).length,
        }
        console.error('  recarga ' + i + ':', JSON.stringify(salida['red_recarga' + sufijo]), JSON.stringify(h))
      }
    }
  }
  salida.red_total = resumenRed('al final')
} finally {
  await browser.close()
  if (servidor) servidor.kill()
}
// Resumen legible a stderr: es lo que se compara entre dos corridas.
const shaders = salida.errores.filter(e => e.includes('VALIDATE_STATUS') || e.includes('program not valid')).length
process.stderr.write('\n== resumen ==\n')
process.stderr.write('carga: ' + salida.hitos.armando_fuera_ms + ' ms hasta el primer cuadro, ' +
  (salida.red_arranque?.MB ?? '?') + ' MB en ' + (salida.red_arranque?.peticiones ?? '?') + ' peticiones\n')
for (const m of salida.muestras) {
  process.stderr.write('  ' + m.etiqueta.padEnd(26) + String(m.fps).padStart(6) + ' fps  ' +
    String(m.ms_p50).padStart(6) + ' ms p50  ' + String(m.ms_p95).padStart(6) + ' ms p95  ' +
    String(m.calls).padStart(5) + ' calls  ' + String(m.tris_k).padStart(6) + 'k tris  ' +
    (m.largas.length ? 'largas ' + m.largas.join('/') : '') + '\n')
}
process.stderr.write('errores de shader: ' + shaders + '\n')
process.stdout.write(JSON.stringify(salida, null, 1) + '\n')
