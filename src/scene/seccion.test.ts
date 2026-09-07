import { test, expect } from 'vitest'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import {
  seccionDe, bordeDe, urbano, HOMBRILLO_M, HOMBRILLO_TRONCAL_M, BROCAL_M,
  BOMBEO, SECCION_GLSL, SECCION_CUERPO_GLSL, SECCION_ANCHO_GLSL,
} from './seccion'
import { patchLineMaterial, extrusionGlsl } from './roadsShader'
import { patchPickMaterial } from './PickingPass'
import { ASFALTO_DESDE_PX, ASFALTO_HASTA_PX, ASFALTO_CUERPO_GLSL } from './asfalto'
import type { Way } from '../data/types'
import type { DataTexture } from 'three'

// Igual que asfalto.test.ts y roadsShader.test.ts: se parchea un LineMaterial
// REAL y se lee el GLSL que sale, no un shader inventado a mano.
function realShader (material: LineMaterial) {
  return { uniforms: material.uniforms, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }
}

function relleno () {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  ;(material as any).onBeforeCompile(shader)
  return shader
}

const codigo = (glsl: string) => glsl.replace(/\/\/.*$/gm, '')

const via = (p: Partial<Way>): Way => ({
  osmId: 1, ref: null, name: null, highway: 'residential', surface: null,
  lanes: null, oneway: null, tipo: 'sin_definir', municipio: null, km: 1, km3d: 1, ...p,
})

// ---------------------------------------------------------------- la regla

test('el nombre manda sobre la clase: la Avenida Libertador es secondary y lleva brocal', () => {
  // Caso REAL del dataset (roads-meta.json): highway=secondary, surface=asphalt,
  // oneway=true. Por clase sería carretera y saldría con hombrillo.
  const libertador = via({ name: 'Avenida Libertador', highway: 'secondary', surface: 'asphalt', oneway: true })
  expect(urbano(libertador)).toBe(true)
  expect(seccionDe(libertador)).toBe('brocal')
  expect(bordeDe(libertador)).toBe(-BROCAL_M)
})

test('y al revés: una residential que se llama Carretera lleva hombrillo', () => {
  const v = via({ name: 'Carretera vieja a Peribeca', highway: 'residential', surface: 'asphalt' })
  expect(urbano(v)).toBe(false)
  expect(seccionDe(v)).toBe('hombrillo')
})

test('la troncal rural lleva hombrillo, y el de la red estructurante es más ancho', () => {
  // Otro caso real: T-5, la Carretera Nacional Vía a Los Llanos.
  const t5 = via({ name: 'Carretera Nacional Vía a Los Llanos', highway: 'trunk', surface: 'asphalt', lanes: 2 })
  expect(seccionDe(t5)).toBe('hombrillo')
  expect(bordeDe(t5)).toBe(HOMBRILLO_TRONCAL_M)
  // Una terciaria rural tiene borde, no berma de proyecto.
  expect(bordeDe(via({ highway: 'tertiary' }))).toBe(HOMBRILLO_M)
  expect(HOMBRILLO_TRONCAL_M).toBeGreaterThan(HOMBRILLO_M)
})

test('sin nombre decide la clase: residential/living_street/service son calle, unclassified no', () => {
  for (const highway of ['residential', 'living_street', 'service']) {
    expect(seccionDe(via({ highway })), highway).toBe('brocal')
  }
  // unclassified es, por definición de OSM, la vía menor ENTRE poblados.
  expect(seccionDe(via({ highway: 'unclassified' }))).toBe('hombrillo')
  for (const highway of ['trunk', 'primary', 'secondary', 'tertiary', 'track']) {
    expect(seccionDe(via({ highway })), highway).toBe('hombrillo')
  }
})

test('sin pavimento no hay brocal: un service de tierra lleva el mismo borde que una carretera', () => {
  expect(seccionDe(via({ highway: 'service', surface: 'dirt' }))).toBe('hombrillo')
  expect(seccionDe(via({ highway: 'residential', surface: 'unpaved' }))).toBe('hombrillo')
  // …pero con surface desconocida sí: no saber no es saber que no.
  expect(seccionDe(via({ highway: 'residential', surface: null }))).toBe('brocal')
})

test('una acera no lleva ni brocal ni hombrillo', () => {
  for (const highway of ['footway', 'steps', 'path', 'bridleway', 'cycleway', 'pedestrian']) {
    expect(seccionDe(via({ highway })), highway).toBe('ninguna')
    expect(bordeDe(via({ highway })), highway).toBe(0)
  }
})

test('los anchos están en el rango de un hombrillo y un brocal reales', () => {
  expect(HOMBRILLO_M).toBeGreaterThanOrEqual(1)
  expect(HOMBRILLO_TRONCAL_M).toBeLessThanOrEqual(1.5)
  expect(BROCAL_M).toBeGreaterThanOrEqual(0.15)
  expect(BROCAL_M).toBeLessThanOrEqual(0.25)
})

test('el signo de bordeDe ES el tipo de franja: + hombrillo, - brocal, 0 nada', () => {
  expect(bordeDe(via({ highway: 'trunk' }))).toBeGreaterThan(0)
  expect(bordeDe(via({ highway: 'residential' }))).toBeLessThan(0)
  expect(bordeDe(via({ highway: 'footway' }))).toBe(0)
})

// --------------------------------------------------------- el ensanchamiento

test('la extrusión compartida ensancha 2 x |aBorde| y el contorno envuelve el total', () => {
  const g = codigo(extrusionGlsl(false))
  expect(g).toContain('float anchoTot = anchoBase + 2.0 * abs( bordeM );')
  expect(g).toContain('float anchoM = anchoTot;')
  // El contorno se calcula sobre el total, no sobre la calzada: si no, el borde
  // oscuro quedaría por dentro del hombrillo.
  expect(codigo(extrusionGlsl(true))).toMatch(/float anchoM = anchoTot \+ min\(/)
})

test('la franja se funde con el MISMO umbral de píxeles que el asfalto: a vista de estado la geometría es la de antes', () => {
  const g = codigo(extrusionGlsl(false))
  expect(g).toContain(`smoothstep( ${ASFALTO_DESDE_PX.toFixed(1)}, ${ASFALTO_HASTA_PX.toFixed(1)}, anchoBase / mppV )`)
  // Y cuando ese smoothstep vale 0, anchoTot == anchoBase: la misma cuenta que
  // antes de que esto existiera.
  expect(g).toMatch(/float bordeM = aBorde \* smoothstep/)
})

test('los dos pases comparten el ensanchamiento: el clic sobre el hombrillo selecciona la vía', () => {
  const pick = new LineMaterial()
  patchPickMaterial(pick)
  const ps = realShader(pick)
  ;(pick as any).onBeforeCompile(ps)
  expect(ps.vertexShader).toContain('attribute float aBorde;')
  expect(ps.vertexShader).toContain('float anchoTot = anchoBase + 2.0 * abs( bordeM );')
  const r = relleno()
  expect(r.vertexShader).toContain('attribute float aBorde;')
  // El bloque compartido no puede ganar varyings (el pase de ids no los
  // declara): vBordeM lo rellena el colofón, que es solo del pase visible. Sin
  // comentarios, que sí lo nombran para explicar de dónde sale.
  expect(codigo(extrusionGlsl(false))).not.toContain('vBordeM')
  expect(codigo(ps.vertexShader)).not.toContain('vBordeM')
  expect(r.vertexShader).toContain('varying float vBordeM;')
  expect(r.fragmentShader).toContain('varying float vBordeM;')
})

test('t se remapea para que la calzada siga ocupando [-1, 1] y la franja quede fuera', () => {
  const r = relleno()
  expect(r.fragmentShader).toMatch(
    /float t = vUv\.x \* \(1\.0 \+ 2\.0 \* abs\(vBordeM\) \/ max\(vCalzadaPx \* vMpp, 1e-6\)\);/)
  // Y el remapeo va ANTES del asfalto y de las marcas, que están escritas sobre
  // una calzada en [-1, 1] y no se tocan.
  expect(r.fragmentShader.indexOf('float t = vUv.x *'))
    .toBeLessThan(r.fragmentShader.indexOf('vec2 uvM'))
})

// ------------------------------------------------------------------ el bombeo

test('el bombeo es una normal, no geometría: 2 % del eje al borde, con la corona redondeada', () => {
  expect(BOMBEO).toBeGreaterThanOrEqual(0.015)
  expect(BOMBEO).toBeLessThanOrEqual(0.04)
  const c = codigo(SECCION_GLSL)
  // La normal de una superficie con pendiente transversal s es Ng + s*derecha.
  expect(c).toMatch(/normalize\(\s*Ng \+ s \* der\s*\)/)
  // La derecha del sentido de marcha, el mismo lado que extruye el vertex.
  expect(c).toMatch(/cross\(\s*normalize\(dirW\)\s*,\s*Ng\s*\)/)
  // La corona no es una arista viva: se redondea sobre unos decímetros.
  expect(c).toMatch(/clamp\(\s*v \/ [\d.]+/)
  // Nada de geometría nueva en el vertex por el bombeo.
  expect(codigo(extrusionGlsl(false))).not.toContain('BOMBEO')
})

test('el asfalto ilumina con la normal de la sección, y es el ÚNICO cambio suyo', () => {
  const c = codigo(ASFALTO_CUERPO_GLSL)
  expect(c).toContain('vec3 Ng = normalSeccion(vTerrW, vDirW, t, calzadaM, vBordeM);')
  expect(c).not.toContain('vec3 Ng = normalize(vTerrW);')
  // El marco sigue siendo ortonormal solo: cross(T, Ng + s*B) = B - s*Ng, que
  // es la tangente transversal de la superficie inclinada. Por eso B y N no se
  // tocan.
  expect(c).toContain('vec3 B = cross(T, Ng);')
  expect(c).toMatch(/vec3 N = normalize\(T \* nT\.x \* relieve/)
})

// ------------------------------------------------------------- los materiales

test('la franja se pinta DESPUÉS de las marcas y solo en el pase de relleno', () => {
  const r = relleno()
  const f = r.fragmentShader
  // La grava no va debajo de la pintura vial: no hay pintura sobre el hombrillo.
  expect(f.indexOf('float flecha')).toBeLessThan(f.indexOf('vec3 franja'))
  const contorno = new LineMaterial()
  patchLineMaterial(contorno, {} as DataTexture, 164, true)
  const sc = realShader(contorno)
  ;(contorno as any).onBeforeCompile(sc)
  expect(sc.fragmentShader).not.toContain('vec3 franja')
  expect(sc.fragmentShader).not.toContain('normalSeccion')
})

test('todo el cuerpo de la franja vive dentro de un if sobre el ancho del borde', () => {
  const c = codigo(SECCION_CUERPO_GLSL)
  expect(c).toMatch(/if \(abs\(vBordeM\) > 0\.0\)/)
  // Sin borde (una acera) o a vista de estado (borde fundido a cero) no se
  // ejecuta ni una línea.
})

test('la franja se mide en METROS de calzada, con piso de un píxel', () => {
  const c = codigo(SECCION_CUERPO_GLSL)
  // Metros al filo de la calzada, no unidades de t ni píxeles.
  expect(c).toMatch(/float dm = \(abs\(t\) - 1\.0\) \* semi;/)
  // Lo que no cabe en píxel y medio se apaga, no se aliasea (mismo criterio que
  // `nitidez` en asfalto.ts).
  expect(c).toMatch(/smoothstep\(0\.0, 1\.5, bordeAbs \/ e\)/)
  // El moteado de la grava también: por debajo de dos píxeles por celda se
  // desvanece hacia su media.
  expect(c).toMatch(/nitG/)
})

test('el brocal sugiere su cara vertical con oclusión al pie y filo claro arriba', () => {
  const c = codigo(SECCION_CUERPO_GLSL)
  // La oclusión cae hacia ADENTRO de la calzada (dm < 0), exponencial.
  expect(c).toMatch(/exp\(\s*min\(dm, 0\.0\)/)
  // Y el filo de arriba, del lado de afuera.
  expect(c).toContain('filo')
  // Las dos, en metros con piso de un píxel.
  expect(c).toMatch(/max\(\s*[\d.]+\s*,\s*e\s*\)/)
})

test('la franja se ilumina con el mismo reparto de luz que el asfalto, pero sin especular', () => {
  const c = codigo(SECCION_CUERPO_GLSL)
  expect(c).toMatch(/dot\(Nf, uSol\)/)
  expect(c).toMatch(/0\.5 \+ 0\.5 \* Nf\.y/)   // el mismo ambiente de hemisferio
  // El MISMO reparto, y ahora literalmente la misma función (asfalto.ts,
  // luzVia): si la franja y la calzada no normalizaran igual la exposición al
  // sol real, la franja daría un salto contra la calzada a cualquier hora que
  // no fuera la que se calibró a mano.
  expect(c).toMatch(/float luzF = luzVia\(/)
  expect(c).not.toMatch(/0\.42 \* mix\(0\.55/)
  // Ni la grava ni el concreto seco tienen lustre.
  expect(c).not.toContain('pow(max(dot(')
})

// El hombrillo y el brocal están pegados a la calzada: si la calzada se
// oscurece dentro de la sombra de la montaña y la franja no, el filo de la
// sombra se parte en el borde de la vía.
test('la franja también se apaga dentro de la sombra proyectada del relieve', () => {
  const c = codigo(SECCION_CUERPO_GLSL)
  expect(c).toMatch(/max\(dot\(Nf, uSol\), 0\.0\) \* sombraSol\(vPosW, Nf\)/)
})

test('lo seleccionado tiñe también la franja: es la misma vía', () => {
  expect(codigo(SECCION_CUERPO_GLSL)).toMatch(/tinte = mix\(tinte, .*selected\)/)
})
