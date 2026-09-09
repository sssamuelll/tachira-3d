import { ShapeUtils, Vector2 } from 'three'
import { semilla, campoEspacial } from './building-morphology.mjs'

/** Hipótesis de cubierta, no levantamiento. La fuente califica la FORMA;
 * evidencia separa la altura OSM de la altura que propone este modelo. */
export const MODELO_TECHO = 'techo-tachira-v1'
export const FORMAS = Object.freeze(['plana', 'un-agua', 'dos-aguas', 'cuatro-aguas'])

const OSM = Object.freeze({
  flat: 'plana', skillion: 'un-agua', gabled: 'dos-aguas',
  hipped: 'cuatro-aguas', pyramidal: 'cuatro-aguas',
})
// Criterios escogidos, calibrables; no son estadísticas de techos del Táchira.
// 800 m² evita aplicar el prior doméstico a grandes cubiertas. Compacidad 0.60
// admite el rectángulo 12×8 (≈0.754 con 4πA/P²), sin exigir valores circulares.
const AREA_MAX = 800
const COMPACIDAD_MIN = 0.60
const limitar = n => Math.max(0, Math.min(1, n))

function metros(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) && valor >= 0 ? valor : null
  if (typeof valor !== 'string') return null
  const match = valor.trim().match(/^(\d+(?:[.,]\d+)?)\s*(?:m|meters?|metres?)?$/i)
  if (!match) return null
  const n = Number(match[1].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function formaTecho(building, metrica) {
  const tags = building.tags ?? {}
  const osm = String(tags['roof:shape'] ?? '').trim().toLowerCase()
  const conocida = Object.hasOwn(OSM, osm)
  const id = String(building.id ?? `${building.osmType}/${building.osmId}`)
  const barrio = campoEspacial(metrica.x, metrica.z)
  // El vecindario pesa más que el id, pero este aún permite cubiertas distintas
  // en una misma calle. Pesos y cortes son un prior visual, no frecuencias medidas.
  const muestra = 0.65 * barrio + 0.35 * semilla(`techo:forma:${id}`)
  let forma, motivo
  if (conocida) {
    forma = OSM[osm]
    motivo = `roof:shape=${osm}`
  } else if (metrica.area >= AREA_MAX) {
    forma = 'plana'
    motivo = `criterio área >= ${AREA_MAX} m²`
  } else if (metrica.compacidad < COMPACIDAD_MIN) {
    forma = 'plana'
    motivo = `criterio compacidad < ${COMPACIDAD_MIN}`
  } else {
    forma = muestra < 0.25 ? 'plana' : muestra < 0.45 ? 'un-agua' : muestra < 0.70 ? 'dos-aguas' : 'cuatro-aguas'
    motivo = `${MODELO_TECHO}: semilla de id + campo de barrio 220 m`
  }
  if (osm && !conocida) motivo = `roof:shape=${osm} no construible; ${motivo}`
  const alturaOsm = metros(tags['roof:height'])
  // Una tapa plana tiene flecha cero. Un roof:height positivo junto a flat
  // contradice esa definición del contrato: se conserva la discrepancia visible.
  const alturaM = forma === 'plana' ? 0 : alturaOsm ??
    Number((1.25 + 2.25 * (0.65 * barrio + 0.35 * semilla(`techo:altura:${id}`))).toFixed(3))
  const alturaFuente = forma === 'plana'
    ? `altura=0 por tapa plana${alturaOsm > 0 ? `; roof:height=${alturaOsm} incompatible con flecha cero` : ''}`
    : alturaOsm !== null ? `altura OSM roof:height=${alturaOsm} m` : 'altura estimada (criterio 1.25–3.50 m)'
  return { forma, fuente: conocida ? 'osm-roof-shape' : 'estimada', alturaM, evidencia: `${motivo}; ${alturaFuente}` }
}

/** Caja orientada sobre direcciones de aristas, como analizarHuella. Trabajar
 * respecto al primer punto reduce cancelación en coordenadas ENU grandes.
 * u sigue el lado largo: la cumbrera no cambia al rotar una casa rectangular. */
function cajaOrientada(anillo) {
  const [ox, oz] = anillo[0]
  let mejor = null
  for (let i = 0; i < anillo.length; i++) {
    const a = anillo[i], b = anillo[(i + 1) % anillo.length]
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz)
    if (l < 1e-9) continue
    let ux = dx / l, uz = dz / l
    // Signo canónico: invertir el recorrido no invierte el techo a un agua.
    if (ux < 0 || (ux === 0 && uz < 0)) { ux = -ux; uz = -uz }
    const limites = (cx, sz) => {
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
      for (const [x, z] of anillo) {
        const u = (x - ox) * cx + (z - oz) * sz
        const v = -(x - ox) * sz + (z - oz) * cx
        u0 = Math.min(u0, u); u1 = Math.max(u1, u)
        v0 = Math.min(v0, v); v1 = Math.max(v1, v)
      }
      return { u0, u1, v0, v1 }
    }
    let box = limites(ux, uz)
    if (box.v1 - box.v0 > box.u1 - box.u0) {
      ;[ux, uz] = [-uz, ux]
      if (ux < 0 || (ux === 0 && uz < 0)) { ux = -ux; uz = -uz }
      box = limites(ux, uz)
    }
    const area = (box.u1 - box.u0) * (box.v1 - box.v0)
    if (!mejor || area < mejor.area || (area === mejor.area && ux > mejor.ux)) {
      mejor = { ...box, ox, oz, ux, uz, area }
    }
  }
  return mejor
}

// Recortar triángulos de la huella, en vez de dibujar la caja entera, conserva
// entrantes y evita voladizos inventados incluso para una forma explícita OSM.
function recortar(poligono, distancia) {
  const out = []
  for (let i = 0; i < poligono.length; i++) {
    const a = poligono[i], b = poligono[(i + 1) % poligono.length]
    const da = distancia(a), db = distancia(b)
    if (da >= 0) out.push(a)
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db)
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
    }
  }
  return out
}

export function caparazonTecho(anilloXZ, forma, alturaM, roofY) {
  const positions = [], normals = [], indices = []
  const resultado = { positions, normals, indices }
  // Copiar: triangulateShape puede retirar el cierre repetido de su entrada.
  const anillo = anilloXZ.map(p => [p[0], p[1]])
  if (anillo.length > 1 && anillo[0][0] === anillo.at(-1)[0] && anillo[0][1] === anillo.at(-1)[1]) anillo.pop()
  // Se conserva también el contorno degenerado aunque no tenga caras dibujables.
  for (const [x, z] of anillo) { positions.push(x, roofY, z); normals.push(0, 127, 0) }
  if (anillo.length < 3) return resultado
  const triangulos = ShapeUtils.triangulateShape(anillo.map(p => new Vector2(...p)), [])
  const caja = cajaOrientada(anillo)

  function cara(a, b, c) {
    const cruz = (p, q, r) => {
      const u = q.map((n, i) => n - p[i]), v = r.map((n, i) => n - p[i])
      return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    }
    let n = cruz(a, b, c)
    if (n[1] < 0) { [b, c] = [c, b]; n = cruz(a, b, c) }
    const l = Math.hypot(...n)
    if (l === 0) return
    n = n.map(v => Math.round(127 * v / l))
    const k = positions.length / 3
    for (const p of [a, b, c]) { positions.push(...p); normals.push(...n) }
    indices.push(k, k + 1, k + 2)
  }
  const punto = (p, h = 0) => [p[0], roofY + h, p[1]]
  if (forma === 'plana' || !(alturaM > 0) || !FORMAS.includes(forma) || !caja || caja.area < 1e-12) {
    for (const t of triangulos) cara(...t.map(i => punto(anillo[i])))
    return resultado
  }
  const { ox, oz, ux, uz, u0, u1, v0, v1 } = caja
  const u = p => (p[0] - ox) * ux + (p[1] - oz) * uz
  const v = p => -(p[0] - ox) * uz + (p[1] - oz) * ux
  const ancho = v1 - v0
  // La envolvente inferior de planos forma aguas auténticas: dos faldones
  // hasta los hastiales, o cuatro con cumbrera acortada media anchura por lado.
  const planos = forma === 'un-agua' ? [p => (v(p) - v0) / ancho] : [
    p => 2 * (v(p) - v0) / ancho,
    p => 2 * (v1 - v(p)) / ancho,
  ]
  if (forma === 'cuatro-aguas') planos.push(p => 2 * (u(p) - u0) / ancho, p => 2 * (u1 - u(p)) / ancho)
  const altura = p => limitar(Math.min(...planos.map(f => f(p))))
  const superficies = []
  let cima = 0
  for (const t of triangulos) {
    for (let i = 0; i < planos.length; i++) {
      let region = t.map(k => anillo[k])
      for (let j = 0; j < planos.length && region.length; j++) {
        if (i !== j) region = recortar(region, p => planos[j](p) - planos[i](p))
      }
      if (region.length < 3) continue
      for (const p of region) cima = Math.max(cima, altura(p))
      superficies.push(region)
    }
  }
  // En huellas no rectangulares la caja puede tener su centro fuera de la casa.
  // Escalar por la cima efectivamente recortada mantiene la flecha solicitada.
  const h = p => cima > 0 ? alturaM * limitar(altura(p) / cima) : 0
  for (const region of superficies) {
    for (let i = 1; i + 1 < region.length; i++) cara(...[region[0], region[i], region[i + 1]].map(p => punto(p, h(p))))
  }
  // Un agua tiene borde alto; dos aguas tienen hastiales. Estos cierres son
  // parte del caparazón: llegan al alero original y sus normales Y son cero.
  // Partir donde cambian los planos evita puentear la cumbrera con un cierre.
  const area = anillo.reduce((s, a, i) => {
    const b = anillo[(i + 1) % anillo.length]
    return s + (a[0] - ox) * (b[1] - oz) - (b[0] - ox) * (a[1] - oz)
  }, 0)
  for (let i = 0; i < anillo.length; i++) {
    let a = anillo[i], b = anillo[(i + 1) % anillo.length]
    if (area < 0) [a, b] = [b, a]
    const cortes = [0, 1]
    for (let j = 0; j < planos.length; j++) for (let k = j + 1; k < planos.length; k++) {
      const da = planos[j](a) - planos[k](a), db = planos[j](b) - planos[k](b)
      const t = da / (da - db)
      if (t > 0 && t < 1) cortes.push(t)
    }
    cortes.sort((a, b) => a - b)
    const interpolar = t => t === 0 ? a : t === 1 ? b : [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
    for (let j = 0; j + 1 < cortes.length; j++) {
      const p = interpolar(cortes[j]), q = interpolar(cortes[j + 1])
      cara(punto(p), punto(p, h(p)), punto(q, h(q)))
      cara(punto(p), punto(q, h(q)), punto(q))
    }
  }
  return resultado
}
