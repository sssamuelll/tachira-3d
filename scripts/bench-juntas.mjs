// Sólo lectura. Ejecutar desde la raíz: node scripts/bench-juntas.mjs
// Vite transforma los módulos TS en Node; no abre navegador ni hornea datos.
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent' })
try {
  const { prepararJuntas } = await server.ssrLoadModule('/src/scene/juntas.ts')
  const { repartirPorNivel } = await server.ssrLoadModule('/src/scene/roadStyle.ts')
  const { anchoCalzada, carrilesDe, sentidoUnico, marcasPermitidas } = await server.ssrLoadModule('/src/scene/calzada.ts')
  const { bordeDe } = await server.ssrLoadModule('/src/scene/seccion.ts')
  const bin = (nombre, Tipo) => {
    const b = readFileSync(`public/data/${nombre}.bin`)
    return new Tipo(b.buffer, b.byteOffset, b.byteLength / Tipo.BYTES_PER_ELEMENT)
  }
  const positions = bin('roads-pos', Float32Array)
  const segIds = bin('roads-segid', Float32Array)
  const index = bin('roads-index', Uint32Array)
  const normals = bin('roads-nrm', Int8Array)
  const ways = JSON.parse(readFileSync('public/data/roads-meta.json', 'utf8')).ways
  const porVia = [
    Float32Array.from(ways, anchoCalzada),
    Float32Array.from(ways, w => marcasPermitidas(w) ? carrilesDe(w) * (sentidoUnico(w) ? -1 : 1) : 0),
    Float32Array.from(ways, bordeDe),
  ]
  const tiempos = []
  let juntas, base, superficie
  for (let run = 0; run < 3; run++) {
    const t0 = performance.now()
    juntas = prepararJuntas(positions, index, ways)
    const t1 = performance.now()
    repartirPorNivel(positions, segIds, index, ways, porVia, normals)
    const t2 = performance.now()
    base = repartirPorNivel(positions, segIds, index, ways, porVia, normals, juntas)
    superficie = repartirPorNivel(positions, segIds, index, ways, porVia, normals, juntas, true)
    const t3 = performance.now()
    tiempos.push({ preparar: t1 - t0, repartoAnterior: t2 - t1, repartoConJuntas: t3 - t2, totalConJuntas: t1 - t0 + t3 - t2 })
  }
  const mediana = campo => tiempos.map(t => t[campo]).sort((a, b) => a - b)[1]
  let afectados = 0, extremosEnTope = 0
  const radios = []
  const nodosEnTope = new Set()
  for (let s = 0; s < segIds.length; s++) {
    if (juntas.zonas[s * 4 + 1] > 0 || juntas.zonas[s * 4 + 3] > 0) afectados++
    for (let e = s * 2; e < s * 2 + 2; e++) {
      if (juntas.zonas[e * 2] !== 0 || juntas.zonas[e * 2 + 1] <= 0) continue
      const radio = juntas.zonas[e * 2 + 1]
      radios.push(radio)
      if (radio === 80) {
        extremosEnTope++
        nodosEnTope.add(`${positions[e * 3]},${positions[e * 3 + 1]},${positions[e * 3 + 2]}`)
      }
    }
  }
  radios.sort((a, b) => a - b)
  const subset = superficie.reduce((n, t) => n + t.segIds.length, 0)
  const bytesSuperficie = superficie.reduce((n, t) => n + [t.positions, t.segIds, t.normales, ...t.extras, t.d0, t.d1, t.limites, t.zonas, t.estilos].reduce((sum, a) => sum + a.byteLength, 0), 0)
  const bytesLimitesBase = base.reduce((n, t) => n + t.limites.byteLength, 0)
  const redondea = n => Math.round(n * 10) / 10
  console.log(JSON.stringify({
    entorno: { node: process.version, plataforma: process.platform, arquitectura: process.arch },
    segmentos: segIds.length,
    nodos: juntas.nodos,
    segmentosInfluidos: afectados,
    porcentajeNeutro: redondea(100 * (1 - afectados / segIds.length)),
    segmentosSuperficieAsfaltada: subset,
    tandasExtra: superficie.length,
    radiosPorExtremoMetros: { p50: radios[Math.floor(radios.length * 0.50)], p90: radios[Math.floor(radios.length * 0.90)], p99: radios[Math.floor(radios.length * 0.99)], max: radios.at(-1), extremosEnTope, nodosEnTope: nodosEnTope.size },
    tiemposMs: tiempos.map(t => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, redondea(v)]))),
    medianaMs: Object.fromEntries(Object.keys(tiempos[0]).map(k => [k, redondea(mediana(k))])),
    bytesAdicionales: {
      preprocesadoRetenido: juntas.limites.byteLength + juntas.zonas.byteLength + juntas.niveles.byteLength,
      ordenTemporal: segIds.length * 2 * 4,
      continuacionesTemporal: segIds.length * 2 * 4,
      limitesBase: bytesLimitesBase,
      limitesPicking: juntas.limites.byteLength,
      superficie: bytesSuperficie,
      superficiePorSegmento: subset ? bytesSuperficie / subset : 0,
      gpuTotal: bytesLimitesBase + juntas.limites.byteLength + bytesSuperficie,
      cpuRetenidoTotal: juntas.limites.byteLength + juntas.zonas.byteLength + juntas.niveles.byteLength + bytesLimitesBase + bytesSuperficie,
    },
  }, null, 2))
} finally {
  await server.close()
}
