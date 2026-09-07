import { describe, it, expect } from 'vitest'
import {
  NIVELES, NIVEL_POR_DEFECTO, CLASES_CONOCIDAS, nivelDe, metrosPorPixel,
  presencia, repartirPorNivel, mppCorte, cortePorSegmento, porSegmento, SIN_CORTE,
} from './roadStyle'
import roadsJson from '../../public/data/roads-meta.json'
import type { RoadsMeta, Way } from '../data/types'

const ways = (roadsJson as RoadsMeta).ways

// Los dos extremos reales de la aplicación, para no probar el estilo en
// abstracto: la cámara arranca a ~114 km del centroide (App.tsx) y el piso de
// encuadre de una vía suelta es 1.200 m (SPAN_MINIMO, Camera.tsx). Con fov 45
// sobre una ventana de 900 px de alto eso da los dos m/px de abajo.
const ESTADO = metrosPorPixel(114_000, 45, 900)   // ~105 m/px
const CALLE = metrosPorPixel(1_200, 45, 900)      // ~1,1 m/px

// A qué m/px queda la cámara cuando encuadra UNA vía suelta. FlyTo la coloca
// en center + (0, span*0.7, span*0.9), o sea a span * hypot(0.7, 0.9) del
// objetivo (Camera.tsx), y el span de una vía suelta es SPAN_MINIMO = 1.200 m.
// Es el acercamiento más lejano al que el usuario puede pedir ver una vía
// concreta, y por eso es la cota que ningún nivel puede apagar antes.
const ENCUADRE = metrosPorPixel(1_200 * Math.hypot(0.7, 0.9), 45, 900)   // ~1,26 m/px

// Los dos acercamientos del enunciado: a 10 km solo la red estructurante, a
// 1 km las calles completas.
const DIEZ_KM = metrosPorPixel(10_000, 45, 900)   // ~9,2 m/px
const UN_KM = metrosPorPixel(1_000, 45, 900)      // ~0,92 m/px

const nivel = (clave: string) => NIVELES.find(n => n.clave === clave)!
const ESTRUCTURANTES = ['secundaria', 'principal', 'troncal']

describe('clasificación', () => {
  it('toda clase de highway del dataset tiene nivel propio, ninguna cae al de reserva', () => {
    // Si OSM estrena una clase al regenerar los datos, este test la señala en
    // vez de dejarla dibujándose como calle sin que nadie lo decida.
    const conocidas = new Set(CLASES_CONOCIDAS)
    expect([...new Set(ways.map(w => w.highway))].filter(h => !conocidas.has(h))).toEqual([])
  })

  it('el nivel de reserva existe y es un nivel real', () => {
    expect(nivelDe('una_clase_que_osm_no_ha_inventado')).toBe(NIVEL_POR_DEFECTO)
    expect(NIVELES[NIVEL_POR_DEFECTO]).toBeDefined()
  })

  it('reparte las 26.712 vías del Táchira en los siete niveles, sin dejar ninguno vacío', () => {
    const porNivel = new Array(NIVELES.length).fill(0)
    for (const w of ways) porNivel[nivelDe(w.highway)]++
    expect(porNivel.reduce((a, b) => a + b, 0)).toBe(ways.length)
    for (let n = 0; n < NIVELES.length; n++) expect(porNivel[n]).toBeGreaterThan(0)
  })
})

describe('piso', () => {
  it('el piso en píxeles es la jerarquía visible a lo lejos', () => {
    // A vista de estado hasta una troncal de 24 m mide 0,23 px: ahí manda el
    // piso, y es el piso el que dibuja la jerarquía. Lo aplica el vertex
    // shader por vértice (roadsShader.ts); acá solo se fija que crezca con
    // el nivel.
    for (let i = 1; i < NIVELES.length; i++) {
      expect(NIVELES[i].pisoPx).toBeGreaterThan(NIVELES[i - 1].pisoPx)
    }
    for (const n of NIVELES) expect(n.pisoPx).toBeLessThan(5)
  })

  it('el ancho de referencia crece con el nivel', () => {
    for (let i = 1; i < NIVELES.length; i++) {
      expect(NIVELES[i].metros).toBeGreaterThan(NIVELES[i - 1].metros)
    }
  })
})

describe('repartirPorNivel', () => {
  it('reparte las normales por nivel junto a los segmentos', () => {
    const vias = [{ highway: 'residential' }, { highway: 'motorway' }] as Way[]
    const index = new Uint32Array([0, 1, 2])
    const positions = new Float32Array(12)
    const segIds = new Float32Array([0, 1])
    const normals = new Int8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const tandas = repartirPorNivel(positions, segIds, index, vias, [], normals)
    expect(Array.from(tandas.find(t => t.nivel === 2)!.normales)).toEqual([1, 2, 3, 4, 5, 6])
    expect(Array.from(tandas.find(t => t.nivel === 6)!.normales)).toEqual([7, 8, 9, 10, 11, 12])
  })
})

describe('presencia', () => {
  it('la red estructurante nunca se desvanece', () => {
    for (const n of NIVELES.filter(x => !x.desvanece)) {
      for (const mpp of [CALLE, 10, ESTADO, 5000]) expect(presencia(n, mpp)).toBe(1)
    }
    // secundaria, principal y troncal: el esqueleto legible a toda escala
    expect(NIVELES.filter(x => !x.desvanece).map(x => x.clave))
      .toEqual(['secundaria', 'principal', 'troncal'])
  })

  it('a escala de calle todo está a plena presencia', () => {
    for (const n of NIVELES) expect(presencia(n, CALLE)).toBe(1)
  })

  it('a vista de estado no queda nada salvo la red estructurante', () => {
    // Antes ninguna llegaba a cero, porque el pase de picking dibujaba TODAS
    // las vías y devolvía cualquiera que se tocara: una vía seleccionable sin
    // rastro en pantalla habría sido una trampa. Ahora el pase de ids descarta
    // por el mismo corte que este módulo define (cortePorSegmento, más abajo,
    // y el discard de PickingPass.tsx), así que apagar del todo ya no parte en
    // dos la lista de lo dibujado y la de lo seleccionable.
    for (const n of NIVELES) {
      expect(presencia(n, ESTADO)).toBe(ESTRUCTURANTES.includes(n.clave) ? 1 : 0)
    }
  })

  it('a 10 km solo se ve la red estructurante', () => {
    // El encargo, medido: a esa distancia el mapa tiene que leerse como el de
    // Maps a la misma altura -- autopistas y carreteras, sin el rayado de
    // calles residenciales encima.
    for (const n of NIVELES) {
      expect(presencia(n, DIEZ_KM)).toBe(ESTRUCTURANTES.includes(n.clave) ? 1 : 0)
    }
  })

  it('a 1 km están todas las calles, enteras', () => {
    for (const n of NIVELES) expect(presencia(n, UN_KM)).toBe(1)
  })

  it('ningún nivel se apaga antes de que la cámara pueda encuadrarlo', () => {
    // La cota que ata las bandas por abajo. Seleccionar una vía la encuadra a
    // ENCUADRE m/px como mucho (Camera.tsx): si a esa distancia su nivel ya se
    // apagó, el buscador te lleva hasta la vía para no enseñarte nada, y el
    // clic que la seleccionó tampoco tiene ya nada que devolver.
    for (const n of NIVELES) expect(presencia(n, ENCUADRE)).toBe(1)
  })

  it('un nivel nunca se ve más que otro por encima de él', () => {
    // Lo que hace que apagar por acercamiento siga dibujando una jerarquía y
    // no un revoltijo: si una vereda aguantara más lejos que la calle que la
    // acompaña, a media distancia el mapa mostraría el detalle sin mostrar su
    // estructura.
    for (let mpp = 0.05; mpp < 400; mpp *= 1.1) {
      for (let i = 1; i < NIVELES.length; i++) {
        expect(presencia(NIVELES[i], mpp)).toBeGreaterThanOrEqual(presencia(NIVELES[i - 1], mpp))
      }
    }
  })

  it('se apaga de forma monótona al alejarse y nunca revive', () => {
    for (const n of NIVELES) {
      let previo = 1
      for (let mpp = 0.2; mpp < 4000; mpp *= 1.15) {
        const a = presencia(n, mpp)
        expect(a).toBeLessThanOrEqual(previo + 1e-9)
        expect(a).toBeGreaterThanOrEqual(n.desvanece ? 0 : 1)
        previo = a
      }
    }
  })
})

describe('corte', () => {
  // El corte existe para que el pase de ids (PickingPass.tsx) descarte
  // exactamente lo que el pase visible dejó de dibujar. Los dos lo sacan de
  // acá; estos tests son lo único que impide que las dos mitades de "lo que se
  // dibuja se puede tocar" se separen sin que nadie se entere.

  it('porSegmento expande un valor por vía a uno por segmento, en el orden del buffer', () => {
    // Tres vías con 2, 1 y 3 segmentos: CSR [0, 2, 3, 6].
    const vias = [
      { highway: 'residential' }, { highway: 'motorway' }, { highway: 'footway' },
    ] as Way[]
    const index = new Uint32Array([0, 2, 3, 6])
    const out = porSegmento(vias, index, w => w.highway.length)
    expect(Array.from(out)).toEqual([11, 11, 8, 7, 7, 7])
  })

  it('cortePorSegmento es porSegmento con el corte del nivel', () => {
    const vias = [{ highway: 'residential' }, { highway: 'motorway' }] as Way[]
    const index = new Uint32Array([0, 1, 2])
    expect(Array.from(cortePorSegmento(vias, index)))
      .toEqual(Array.from(porSegmento(vias, index, w => Math.min(mppCorte(NIVELES[nivelDe(w.highway)]), SIN_CORTE))))
  })

  it('marca justo el m/px donde la presencia llega a cero', () => {
    for (const n of NIVELES.filter(x => x.desvanece)) {
      const corte = mppCorte(n)
      expect(Number.isFinite(corte)).toBe(true)
      expect(presencia(n, corte)).toBe(0)
      // Justo antes del corte todavía queda algo: si no, el corte estaría más
      // acá de donde el nivel de verdad se apaga y el picking descartaría vías
      // que siguen viéndose.
      expect(presencia(n, corte * 0.99)).toBeGreaterThan(0)
    }
  })

  it('la red estructurante no tiene corte', () => {
    for (const n of NIVELES.filter(x => !x.desvanece)) {
      expect(mppCorte(n)).toBe(Infinity)
    }
  })

  it('le da a cada segmento el corte de la vía a la que pertenece', () => {
    const via = (osmId: number, highway: string): Way => ({
      osmId, ref: null, name: null, highway, surface: null,
      tipo: 'sin_definir', municipio: null, km: 1, km3d: 1,
    })
    const red = [via(1, 'motorway'), via(2, 'residential'), via(3, 'footway')]
    const index = new Uint32Array([0, 2, 3, 6])   // 2, 1 y 3 segmentos
    const cortes = cortePorSegmento(red, index)
    expect(cortes).toHaveLength(6)
    const de = (clave: string) => Math.min(mppCorte(nivel(clave)), 1e9)
    expect([...cortes]).toEqual([
      de('troncal'), de('troncal'),
      de('local'),
      de('peatonal'), de('peatonal'), de('peatonal'),
    ])
  })

  it('el corte que va a la GPU es finito, también el de la red estructurante', () => {
    // Un atributo de vértice con Infinity queda indefinido en WebGL1 y depende
    // del driver en WebGL2. El centinela tiene que estar por encima de
    // cualquier m/px alcanzable: a la distancia máxima de OrbitControls
    // (400 km, App.tsx) el mapa va a ~368 m/px.
    const red = [{
      osmId: 1, ref: null, name: null, highway: 'motorway', surface: null,
      tipo: 'sin_definir', municipio: null, km: 1, km3d: 1,
    } as Way]
    const cortes = cortePorSegmento(red, new Uint32Array([0, 1]))
    expect(Number.isFinite(cortes[0])).toBe(true)
    expect(cortes[0]).toBeGreaterThan(metrosPorPixel(400_000, 45, 900))
  })

  it('cubre la red real entera, un corte por segmento', () => {
    const n = ways.length
    const index = new Uint32Array(n + 1)
    for (let i = 0; i < n; i++) index[i + 1] = index[i] + 1
    const cortes = cortePorSegmento(ways, index)
    expect(cortes).toHaveLength(n)
    expect([...cortes].every(c => c > 0)).toBe(true)
  })
})

describe('metrosPorPixel', () => {
  it('crece con la distancia y baja con la resolución', () => {
    expect(metrosPorPixel(2000, 45, 900)).toBeCloseTo(2 * metrosPorPixel(1000, 45, 900), 9)
    expect(metrosPorPixel(1000, 45, 1800)).toBeCloseTo(metrosPorPixel(1000, 45, 900) / 2, 9)
  })

  it('no divide por cero con un lienzo de alto 0', () => {
    // Un <canvas> puede reportar 0 de alto durante el primer montaje.
    expect(Number.isFinite(metrosPorPixel(1000, 45, 0))).toBe(true)
  })
})

describe('repartirPorNivel', () => {
  // Red mínima con una vía por nivel de interés y varios segmentos cada una,
  // para comprobar el reparto sin depender de los 450.261 segmentos reales.
  const via = (osmId: number, highway: string): Way => ({
    osmId, ref: null, name: null, highway, surface: null,
    tipo: 'sin_definir', municipio: null, km: 1, km3d: 1,
  })
  const red = [via(1, 'motorway'), via(2, 'residential'), via(3, 'footway'), via(4, 'trunk')]
  // 2, 1, 3 y 1 segmentos: CSR acumulado.
  const index = new Uint32Array([0, 2, 3, 6, 7])
  const positions = new Float32Array(7 * 6)
  for (let i = 0; i < positions.length; i++) positions[i] = i
  const segIds = new Float32Array([10, 11, 12, 13, 14, 15, 16])

  it('no pierde ni duplica un solo segmento', () => {
    const tandas = repartirPorNivel(positions, segIds, index, red)
    const total = tandas.reduce((a, t) => a + t.segIds.length, 0)
    expect(total).toBe(segIds.length)
    expect([...tandas.flatMap(t => [...t.segIds])].sort((a, b) => a - b)).toEqual([...segIds])
  })

  it('cada segmento conserva sus seis floats junto a su id', () => {
    const tandas = repartirPorNivel(positions, segIds, index, red)
    for (const t of tandas) {
      for (let s = 0; s < t.segIds.length; s++) {
        // segIds se llenó con 10 + índice original, así que el segmento
        // original es id - 10 y sus posiciones arrancan seis floats más allá.
        const orig = t.segIds[s] - 10
        for (let c = 0; c < 6; c++) {
          expect(t.positions[s * 6 + c]).toBe(positions[orig * 6 + c])
        }
      }
    }
  })

  it('manda cada vía a su nivel y omite los niveles vacíos', () => {
    const tandas = repartirPorNivel(positions, segIds, index, red)
    const por = Object.fromEntries(tandas.map(t => [NIVELES[t.nivel].clave, t.segIds.length]))
    expect(por).toEqual({ troncal: 3, local: 1, peatonal: 3 })  // motorway+trunk juntos
    expect(tandas.every(t => t.positions.length === t.segIds.length * 6)).toBe(true)
  })

  it('reparte la red real completa sin perder segmentos', () => {
    // El reparto corre una vez por carga con las 26.712 vías: que cuadre con
    // datos de juguete no dice nada del CSR real.
    const n = ways.length
    const index = new Uint32Array(n + 1)
    for (let i = 0; i < n; i++) index[i + 1] = index[i] + 1   // un segmento por vía
    const positions = new Float32Array(n * 6)
    const segIds = new Float32Array(n)
    for (let i = 0; i < n; i++) segIds[i] = i
    const tandas = repartirPorNivel(positions, segIds, index, ways)
    expect(tandas.reduce((a, t) => a + t.segIds.length, 0)).toBe(n)
    expect(new Set(tandas.flatMap(t => [...t.segIds])).size).toBe(n)
  })
})
