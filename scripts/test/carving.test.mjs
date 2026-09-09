import { describe, expect, it } from 'vitest'
import { tileXToLon, tileYToLat } from '../lib/terrarium.mjs'
import { alturaEnPosts } from '../lib/drape.mjs'
import { anchoCalzada } from '../../src/scene/calzada.ts'
import { normalizeLanes, normalizeOneway } from '../lib/road-meta.mjs'
import {
  perfil, tallar, tallaTerreno, anchoCalzadaTags, nivelDe, metrosPorPost,
} from '../lib/carving.mjs'

// Ladera sintética de 48x48 posts sobre la tesela z12 (1223, 1948), la misma
// convención de rejilla que drape.test.mjs: el post (c, f) está en la
// coordenada de tesela (1223 + c/256, 1948 + f/256).
//
// Altura = 100 + 8·f + 2·c: baja hacia el norte 8 m por post (~21 % de
// pendiente transversal, una ladera de verdad) y sube 2 m por post hacia el
// este (~5,3 %, por debajo del límite de una troncal, así que el perfil la
// respeta tal cual).
const W = 48, H = 48
const lonDe = c => tileXToLon(1223 + c / 256, 12)
const latDe = f => tileYToLat(1948 + f / 256, 12)
const alturaCruda = (c, f) => 100 + 8 * f + 2 * c

function ladera () {
  const data = new Float32Array(W * H)
  for (let f = 0; f < H; f++) for (let c = 0; c < W; c++) data[f * W + c] = alturaCruda(c, f)
  return { data, width: W, height: H, tile: { z: 12, x0: 1223, y0: 1948, nx: 1, ny: 1 } }
}

// Vía recta de oeste a este por la fila de posts f = 20, un punto por post
// (~37,8 m, el paso del pipeline es 30 m: mismo orden).
const viaRecta = (tags, f = 20, c0 = 4, c1 = 43) => ({
  tags,
  coords: Array.from({ length: c1 - c0 + 1 }, (_, k) => [lonDe(c0 + k), latDe(f)]),
})

// Corredor ancho a propósito: el DEM tiene posts cada ~37,8 m y una calzada
// real no llega a un post de ancho. Para poder AFIRMAR "plano de lado a lado"
// sobre posts hace falta que el corredor pleno abarque varios, y por eso el
// hombrillo y la banda son calibrables.
const ANCHO = { hombrillo: 60, transicion: [80, 80, 80, 80, 80, 80, 80] }

describe('perfil', () => {
  it('fija cota y tangente con anclas sin exceder la pendiente entre muestras', () => {
    const h = [120, 80, 140, 90, 150, 110]
    const s = [0, 10, 30, 70, 100, 150]
    const z = perfil(h, s, 0.12, 150, [[0, 100], [1, 101], [5, 109]])
    expect(z).not.toBeNull()
    expect(z[0]).toBe(100)
    expect(z[1]).toBe(101)
    expect(z[5]).toBe(109)
    for (let i = 1; i < s.length; i++) {
      expect(Math.abs(z[i] - z[i - 1]) / (s[i] - s[i - 1])).toBeLessThanOrEqual(0.12 + 1e-9)
    }
  })

  it('declara imposibles dos anclas que requieren exceder el límite', () => {
    expect(perfil([0, 100], [0, 30], 0.08, 150, [[0, 0], [1, 100]])).toBeNull()
    expect(perfil([100, 100], [0, 30], 0.08, 150, [[0, 100], [0, 101]])).toBeNull()
  })

  it('aplica también una ancla a un perfil de una sola muestra', () => {
    expect(Array.from(perfil([80], [0], 0.12, 150, [[0, 100]]))).toEqual([100])
  })

  it('sin anclas conserva el acotado previo, incluso cuando mueve los extremos', () => {
    expect(Array.from(perfil([0, 100], [0, 30], 0.08))).toEqual([48.8, 51.2])
    expect(Array.from(perfil([0, 100], [0, 30], 0.08, 150, []))).toEqual([48.8, 51.2])
  })

  it('acota la pendiente al límite de la clase', () => {
    // Serrucho de 20 m de amplitud cada 30 m: 66 % de pendiente cruda.
    const n = 40
    const s = Array.from({ length: n }, (_, i) => i * 30)
    const h = Array.from({ length: n }, (_, i) => 500 + (i % 2 ? 20 : 0))
    const z = perfil(h, s, 0.08, 150)
    for (let i = 1; i < n; i++) {
      expect(Math.abs(z[i] - z[i - 1]) / (s[i] - s[i - 1])).toBeLessThanOrEqual(0.08 + 1e-9)
    }
  })

  it('deja intacta una rampa que ya cumple el límite', () => {
    // Una media móvil centrada de ventana simétrica no mueve una recta, y el
    // acotador tampoco si la pendiente ya cabe. Si el perfil aplanara todo,
    // una carretera de montaña quedaría colgada de sus extremos.
    const n = 30
    const s = Array.from({ length: n }, (_, i) => i * 30)
    const h = Array.from({ length: n }, (_, i) => 500 + i * 30 * 0.05)   // 5 %
    const z = perfil(h, s, 0.08, 150)
    for (let i = 0; i < n; i++) expect(z[i]).toBeCloseTo(h[i], 6)
  })

  it('respeta los extremos: dos vías que comparten un nodo no se separan', () => {
    // OSM parte las vías en los cruces. Si el suavizado corriera la altura del
    // primer o del último punto, los dos trozos de una misma carretera
    // tallarían alturas distintas en el mismo sitio.
    const n = 20
    const s = Array.from({ length: n }, (_, i) => i * 30)
    const h = Array.from({ length: n }, (_, i) => 500 + i * 30 * 0.04)
    const z = perfil(h, s, 0.20, 150)
    expect(z[0]).toBeCloseTo(h[0], 6)
    expect(z[n - 1]).toBeCloseTo(h[n - 1], 6)
  })
})

describe('tallar', () => {
  it('talla una rasante suministrada en vez de volver a suavizar el DEM', () => {
    const dem = ladera()
    const via = viaRecta({ highway: 'trunk' })
    via.carvingHeights = via.coords.map(() => 500)
    tallar(dem, [via])
    expect(dem.data[20 * W + 24]).toBeCloseTo(500, 4)
  })

  it('interpola el peso longitudinal y deja intacta la zona donde se apaga', () => {
    const dem = ladera()
    const original = ladera()
    const via = {
      tags: { highway: 'trunk' },
      coords: [[lonDe(10), latDe(20)], [lonDe(14), latDe(20)]],
      carvingHeights: [500, 500],
      carvingWeights: [1, 0],
    }
    tallar(dem, [via])
    expect(dem.data[20 * W + 10]).toBeCloseTo(500, 4)
    expect(dem.data[20 * W + 12]).toBeCloseTo(392, 4)
    expect(dem.data[20 * W + 14]).toBeCloseTo(original.data[20 * W + 14], 4)
    expect(dem.data[20 * W + 16]).toBe(original.data[20 * W + 16])
    expect(dem.data[0]).toBe(original.data[0])
  })

  it('un corredor de peso cero no modifica ningún post', () => {
    const dem = ladera()
    const via = viaRecta({ highway: 'trunk' })
    via.carvingHeights = via.coords.map(() => 500)
    via.carvingWeights = via.coords.map(() => 0)
    const result = tallar(dem, [via])
    expect(dem.data).toEqual(ladera().data)
    expect(result.posts).toBe(0)
  })

  it('limita el relleno por post sin tocar posts fuera del corredor ni impedir cortes', () => {
    const dem = ladera()
    const maxHeight = new Float32Array(W * H).fill(300)
    maxHeight[0] = 0
    const via = viaRecta({ highway: 'trunk' })
    via.carvingHeights = via.coords.map(() => 500)
    tallar(dem, [via], { maxHeight })
    expect(dem.data[20 * W + 24]).toBe(300)
    expect(dem.data[0]).toBe(100)
    via.carvingHeights.fill(200)
    tallar(dem, [via], { maxHeight })
    expect(dem.data[20 * W + 24]).toBeCloseTo(200, 4)
  })

  it('deja el corredor plano de lado a lado', () => {
    const dem = ladera()
    tallar(dem, [viaRecta({ highway: 'trunk' })], ANCHO)
    // La vía va por f = 20; los posts f = 19 y f = 21 están a 37,8 m del eje,
    // dentro del corredor pleno. Antes del tallado diferían 8 m entre filas.
    for (let c = 10; c <= 37; c++) {
      const eje = dem.data[20 * W + c]
      expect(dem.data[19 * W + c]).toBeCloseTo(eje, 4)
      expect(dem.data[21 * W + c]).toBeCloseTo(eje, 4)
      // y el eje sigue la rampa de 2 m por post que traía la ladera
      expect(eje).toBeCloseTo(alturaCruda(c, 20), 4)
    }
  })

  it('la banda de transición se funde de vuelta al DEM sin escalones', () => {
    const dem = ladera()
    const original = ladera()
    tallar(dem, [viaRecta({ highway: 'trunk' })], ANCHO)
    const c = 24
    const plataforma = alturaCruda(c, 20)
    // Cuánto de la plataforma queda en cada post: 1 dentro del corredor, 0
    // fuera de la banda. Se mide así y no por el desfase en metros porque el
    // terreno natural se aleja de la plataforma más rápido de lo que la mezcla
    // se apaga: el desfase crece aunque la mezcla ya esté bajando.
    const mezcla = f => (dem.data[f * W + c] - original.data[f * W + c]) /
                        (plataforma - original.data[f * W + c])
    // f = 20 es el propio eje: ahí plataforma y terreno coinciden y la
    // fracción es 0/0, por eso se empieza en el borde del corredor.
    expect(mezcla(21)).toBeCloseTo(1, 6)
    let previo = mezcla(21)
    for (let f = 22; f <= 27; f++) {
      const m = mezcla(f)
      expect(m).toBeLessThanOrEqual(previo + 1e-6)
      expect(m).toBeGreaterThanOrEqual(-1e-6)
      previo = m
    }
    expect(dem.data[27 * W + c]).toBeCloseTo(original.data[27 * W + c], 6)
  })

  it('la pendiente del DEM tallado a lo largo del eje respeta el límite', () => {
    // Escalera de 30 m cada dos posts: 40 % crudo, muy por encima del 8 % de
    // una troncal.
    const dem = ladera()
    for (let f = 0; f < H; f++) for (let c = 0; c < W; c++) {
      dem.data[f * W + c] = 100 + 30 * Math.floor(c / 2)
    }
    tallar(dem, [viaRecta({ highway: 'trunk' })], ANCHO)
    const mpp = metrosPorPost(latDe(20), 12)
    for (let c = 5; c <= 42; c++) {
      const dz = alturaEnPosts(dem, c, 20) - alturaEnPosts(dem, c - 1, 20)
      // el margen es la precisión de guardar la altura en Float32 (~3e-5 m a
      // 400 m de altitud), no holgura del acotador
      expect(Math.abs(dz) / mpp).toBeLessThanOrEqual(0.08 + 1e-5)
    }
  })

  it('un puente no toca el terreno', () => {
    const dem = ladera()
    const original = ladera()
    const r = tallar(dem, [viaRecta({ highway: 'trunk', bridge: 'yes' })], ANCHO)
    expect(r.vias).toBe(0)
    expect(Array.from(dem.data)).toEqual(Array.from(original.data))
  })

  it('un túnel tampoco', () => {
    const dem = ladera()
    const original = ladera()
    tallar(dem, [viaRecta({ highway: 'primary', tunnel: 'yes' })], ANCHO)
    expect(Array.from(dem.data)).toEqual(Array.from(original.data))
  })

  it('una acera no mueve tierra', () => {
    const dem = ladera()
    const original = ladera()
    tallar(dem, [viaRecta({ highway: 'footway' })], ANCHO)
    expect(Array.from(dem.data)).toEqual(Array.from(original.data))
  })

  it('en un cruce manda la de más jerarquía', () => {
    // Troncal por f = 20 y una calle por c = 24, sobre la misma ladera. La
    // calle sube 8 m por post, más del 12 % que su clase permite, así que su
    // perfil pide en el cruce una altura bien distinta de la de la troncal.
    const calle = {
      tags: { highway: 'residential' },
      coords: Array.from({ length: 40 }, (_, k) => [lonDe(24), latDe(4 + k)]),
    }
    const troncal = viaRecta({ highway: 'trunk' })
    const cruce = vias => { const d = ladera(); tallar(d, vias, ANCHO); return d.data[20 * W + 24] }
    const soloTroncal = cruce([troncal]), soloCalle = cruce([calle])
    const ambas = cruce([calle, troncal])
    expect(Math.abs(soloTroncal - soloCalle)).toBeGreaterThan(5)
    expect(Math.abs(ambas - soloTroncal)).toBeLessThan(Math.abs(ambas - soloCalle) / 10)
  })

  it('dos vías del mismo nivel dan la media, no un escalón', () => {
    const calle = {
      tags: { highway: 'residential' },
      coords: Array.from({ length: 40 }, (_, k) => [lonDe(24), latDe(4 + k)]),
    }
    const otra = viaRecta({ highway: 'residential' })
    const cruce = vias => { const d = ladera(); tallar(d, vias, ANCHO); return d.data[20 * W + 24] }
    expect(cruce([calle, otra])).toBeCloseTo((cruce([calle]) + cruce([otra])) / 2, 3)
  })

  it('el corredor nunca baja del piso en posts, ni para una calle angosta', () => {
    // Una residencial mide 6,8 m: con solo su calzada y su hombrillo el
    // corredor no llegaría ni al post vecino (37,8 m), y los posts de
    // alrededor quedarían a medio tallar — que es peor que no tallar, porque
    // la mezcla cambia de un post al siguiente según por dónde cruce la vía
    // la rejilla. Con opciones por DEFECTO el vecino tiene que quedar bien
    // dentro de la plataforma.
    const dem = ladera()
    const original = ladera()
    tallar(dem, [viaRecta({ highway: 'residential' })])
    const c = 24, plataforma = alturaCruda(c, 20)
    const mezcla = (dem.data[21 * W + c] - original.data[21 * W + c]) /
                   (plataforma - original.data[21 * W + c])
    expect(mezcla).toBeGreaterThan(0.5)
  })

  it('informa cuántos posts tocó y cuántas vías talló', () => {
    const dem = ladera()
    const r = tallar(dem, [viaRecta({ highway: 'trunk' })], ANCHO)
    expect(r.vias).toBe(1)
    expect(r.posts).toBeGreaterThan(100)
    expect(r.posts).toBeLessThan(W * H)
  })
})

describe('tallado de una muestra de posts', () => {
  it('reproduce bit a bit el tallado completo en los posts pedidos y conserva el resto', () => {
    const full = ladera(), sparse = ladera(), original = sparse.data.slice()
    const lines = [viaRecta({ highway: 'primary' }), viaRecta({ highway: 'residential' })]
    const posts = new Set([20 * W + 24, 21 * W + 24, 19 * W + 17, 0])
    tallar(full, lines)
    tallar(sparse, lines, { posts })
    for (let j = 0; j < original.length; j++) {
      expect(sparse.data[j]).toBe(posts.has(j) ? full.data[j] : original[j])
    }
  })

  it('no toca el DEM si la muestra está vacía', () => {
    const dem = ladera(), original = dem.data.slice()
    expect(tallar(dem, [viaRecta({ highway: 'primary' })], { posts: new Set() }).posts).toBe(0)
    expect(dem.data).toEqual(original)
  })
})

describe('tallaTerreno', () => {
  it('descarta puentes y túneles, y solo esos', () => {
    expect(tallaTerreno({ highway: 'trunk' })).toBe(true)
    expect(tallaTerreno({ highway: 'trunk', bridge: 'yes' })).toBe(false)
    expect(tallaTerreno({ highway: 'trunk', bridge: 'viaduct' })).toBe(false)
    expect(tallaTerreno({ highway: 'trunk', tunnel: 'building_passage' })).toBe(false)
    // bridge=no es un dato explícito de que NO hay puente: sí talla.
    expect(tallaTerreno({ highway: 'trunk', bridge: 'no' })).toBe(true)
    expect(tallaTerreno({ highway: 'trunk', tunnel: 'no' })).toBe(true)
  })
})

describe('equivalencia con src/scene/calzada.ts', () => {
  it('anchoCalzadaTags da lo mismo que anchoCalzada del navegador', () => {
    const clases = [
      'motorway', 'motorway_link', 'trunk', 'primary', 'secondary', 'tertiary',
      'residential', 'unclassified', 'service', 'track', 'footway', 'steps',
      'path', 'pedestrian', 'construction', 'inventado_por_osm',
    ]
    const lanes = [undefined, '1', '2', '4', '6', '2;3', '0', '99']
    const oneway = [undefined, 'yes', 'no', '-1', 'reversible']
    for (const highway of clases) {
      for (const l of lanes) {
        for (const o of oneway) {
          const tags = { highway }
          if (l !== undefined) tags.lanes = l
          if (o !== undefined) tags.oneway = o
          const via = {
            highway,
            lanes: normalizeLanes(tags.lanes),
            oneway: normalizeOneway(tags.oneway),
          }
          expect(anchoCalzadaTags(tags)).toBeCloseTo(anchoCalzada(via), 9)
        }
      }
    }
  })

  it('nivelDe clasifica igual que roadStyle', () => {
    expect(nivelDe('trunk')).toBe(6)
    expect(nivelDe('residential')).toBe(2)
    expect(nivelDe('footway')).toBe(0)
    expect(nivelDe('lo_que_sea')).toBe(2)
  })
})

describe('metrosPorPost', () => {
  it('da ~38 m en el Táchira a z12', () => {
    const m = metrosPorPost(8, 12)
    expect(m).toBeGreaterThan(37)
    expect(m).toBeLessThan(38.5)
  })
})
