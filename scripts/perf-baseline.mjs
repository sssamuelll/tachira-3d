// Sonda de rendimiento. Solo lectura sobre el repo: abre el mapa publicado (o
// la URL que le pases) en un Chromium con GPU real, mide la carga y muestrea
// cuadros en varias vistas.
//   node scripts/perf-baseline.mjs [url] [--preview] [--headed] [--brave] [--sweep] [--perfil]
//
// --preview es la forma de comparar un cambio contra su antes: hornea el build
// de producción, lo sirve con `vite preview` y mide contra eso. Medir en el
// servidor de desarrollo no sirve para comparar dos ramas -- el módulo sin
// empaquetar y el mapa de fuentes mueven los números por su cuenta.
// --sweep quita el tope de vsync y, en cada vista, apaga por turnos sombras,
// vías, edificios e imagen y cambia el dpr, para ver qué cuesta cada cosa.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const preview = args.includes('--preview')
const PUERTO_PREVIEW = 4173
const target = args.find(a => !a.startsWith('--'))
  ?? (preview ? `http://localhost:${PUERTO_PREVIEW}/` : 'https://sssamuelll.github.io/tachira-3d/')
const url = new URL(target); url.searchParams.set('diagnostico', '1')

// Levanta el build horneado. Devuelve el proceso para matarlo al final.
const correr = (cmd, espera) => new Promise((ok, mal) => {
  const p = spawn(cmd, { shell: true, stdio: 'inherit' })
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
if (sweep) flags.push('--disable-frame-rate-limit', '--disable-gpu-vsync')
const browser = await chromium.launch({
  headless: !headed,
  executablePath: brave ? 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe' : undefined,
  args: flags,
})
const salida = { url: url.href, headed, brave, sweep, preview, boot: {}, hitos: {}, errores: [], muestras: [], perfiles: [] }
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

  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120_000 })

  // Línea de tiempo de los carteles de carga.
  let vistoCargando = false
  const inicio = Date.now()
  while (Date.now() - inicio < 180_000) {
    const s = await page.evaluate(() => ({
      escena: !!window.__escena,
      cargando: document.body.innerText.includes('Cargando la red vial'),
      armando: document.body.innerText.includes('Armando el relieve'),
      error: document.body.innerText.includes('No se pudo cargar el mapa'),
    }))
    const t = Date.now() - t0
    if (s.cargando) vistoCargando = true
    if (!s.cargando && (vistoCargando || s.armando || s.escena) && salida.hitos.cargando_fuera_ms == null) salida.hitos.cargando_fuera_ms = t
    if (s.escena && salida.hitos.escena_ms == null) salida.hitos.escena_ms = t
    if (s.escena && !s.armando && salida.hitos.armando_fuera_ms == null) { salida.hitos.armando_fuera_ms = t; break }
    if (s.error) { salida.hitos.error_ms = t; break }
    await page.waitForTimeout(250)
  }
  salida.red_arranque = resumenRed('al desaparecer "Armando el relieve"')

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
  const sonda = async (etiqueta, durante) => {
    const p = page.evaluate(() => new Promise(res => {
      const st = window.__escena.getState(); const gl = st.gl
      const auto = gl.info.autoReset; gl.info.autoReset = false; gl.info.reset()
      const t0 = performance.now(); let last = t0; const dts = [], calls = [], tris = [], cpu = [], largas = []
      const po = new PerformanceObserver(l => { for (const e of l.getEntries()) largas.push(Math.round(e.duration)) })
      try { po.observe({ type: 'longtask' }) } catch {}
      const q = (a, k) => { const o = [...a].sort((x, y) => x - y); return o[Math.floor(k * (o.length - 1))] }
      function tick (ts) {
        const now = performance.now(); dts.push(now - last); last = now; cpu.push(now - ts)
        calls.push(gl.info.render.calls); tris.push(gl.info.render.triangles); gl.info.reset()
        if (now - t0 < 3000) { requestAnimationFrame(tick); return }
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
    }))
    const [r] = await Promise.all([p, durante ? durante() : Promise.resolve()])
    Object.assign(r, await heapMB())
    salida.muestras.push({ etiqueta, ...r })
    process.stderr.write('  ' + etiqueta + ': ' + r.fps + ' fps, ' + r.ms_p50 + ' ms, cpu ' + r.cpu_p50 + ' ms, ' + r.calls + ' calls, ' + r.tris_k + 'k tris, nodos ' + r.nodos + (r.largas.length ? ', largas ' + r.largas.join('/') : '') + '\n')
  }
  const colocar = (lat, lon, h, dx, dy, dz) => page.evaluate(([lat, lon, h, dx, dy, dz]) => {
    const st = window.__escena.getState(); const t = window.__enu(lat, lon, h)
    st.controls.target.copy(t); st.camera.position.set(t.x + dx, t.y + dy, t.z + dz); st.controls.update()
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
    await page.waitForTimeout(3000)
    await sonda('B1 estado quieta')
    await sonda('B2 estado quieta')
    salida.red_estado = resumenRed('tras ~10 s en vista de estado')
    if (perfil) await perfilar('B estado quieta')
    if (sweep) await barrido('B estado')
    await sonda('B3 estado orbitando', () => arrastrar(300, 0))
    await colocar(...SAN_CRISTOBAL, 0, 2500, 4000)
    await page.waitForTimeout(8000)
    await sonda('C1 ciudad quieta')
    await page.waitForTimeout(5000)
    await sonda('C2 ciudad quieta')
    if (perfil) await perfilar('C ciudad quieta')
    if (sweep) await barrido('C ciudad')
    if (perfil) await perfilar('D ciudad orbitando', async () => { await arrastrar(300, 0); await arrastrar(0, 150); await arrastrar(-250, 0) })
    await sonda('D1 ciudad orbitando', () => arrastrar(300, 0))
    await sonda('D2 ciudad orbitando', () => arrastrar(0, 200))
    await colocar(...SAN_CRISTOBAL, 0, 120, 220)
    await page.waitForTimeout(10000)
    await sonda('E1 calle quieta')
    if (perfil) await perfilar('E calle quieta')
    if (sweep) await barrido('E calle')
    await sonda('E2 calle orbitando', () => arrastrar(200, 0))
    const lluvia = page.locator('button[title="Lluvia"]')
    if (await lluvia.count()) {
      await lluvia.click(); await page.waitForTimeout(3000)
      await sonda('F calle lluvia quieta')
      await lluvia.click()
    } else salida.errores.push('sin botón de lluvia: títulos = ' + salida.botones.join(' | '))
    await colocar(8.021973, -71.901563, 0, 0, 55000, 100000)
    await page.waitForTimeout(4000)
    await sonda('G estado de vuelta')
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
