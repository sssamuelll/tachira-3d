import { test, expect, vi, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import * as THREE from 'three'
import { OrbitControls } from 'three-stdlib'
import { enuOf, bboxCenterAndSpan, idsCenterAndSpan, Vista, FlyTo, type ApiVista } from './Camera'
import { ORIGIN, BBOX } from '../data/constants'
import type { Escala } from '../ui/escala'

// Solo se sustituye el puente de r3f: cámara, controles, mallas y el cuadro
// de Vista son reales. No hace falta WebGL para medir la escala que publica.
let estado: { camera: THREE.PerspectiveCamera; controls: OrbitControls; scene: THREE.Scene; size: { width: number; height: number }; clock: { elapsedTime: number }; invalidate: () => void }
// Cuántos cuadros pidió Vista. Con frameloop="demand" (App.tsx) un cuadro que
// nadie pide no se dibuja, así que una animación que no llama a invalidate se
// congela a medias. Contarlos es la única forma de que un test lo note.
let pedidos = 0
let cuadro: (state: unknown, dt: number) => void
const cuadros: { f: typeof cuadro; prioridad: number }[] = []
const efectos: (() => void | (() => void))[] = []
const limpiezas: (() => void)[] = []
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (f: () => void | (() => void)) => { efectos.push(f) },
}))
vi.mock('@react-three/fiber', () => ({
  useThree: () => estado,
  useFrame: (f: typeof cuadro, prioridad = 0) => {
    cuadros.push({ f, prioridad })
    cuadros.sort((a, b) => a.prioridad - b.prioridad)
    cuadro = (_state, dt) => {
      estado.clock.elapsedTime += dt
      for (const callback of cuadros) callback.f(estado, dt)
    }
  },
}))

function ejecutarEfectos () {
  for (const efecto of efectos.splice(0)) {
    const limpiar = efecto()
    if (limpiar) limpiezas.push(limpiar)
  }
}

afterEach(() => {
  efectos.length = 0
  cuadros.length = 0
  for (const limpiar of limpiezas.splice(0)) limpiar()
})

/** Ejecuta Vista y OrbitControls reales; solamente sustituye el ciclo de React/r3f. */
function vistaSobreSuelo (altura = 125, enterrado = false) {
  const camera = new THREE.PerspectiveCamera(45, 1600 / 870, 10, 2_000_000)
  const controls = new OrbitControls(camera)
  controls.minDistance = 30
  controls.maxDistance = 400_000
  camera.position.set(0, altura, altura * 4 / 3)
  if (enterrado) controls.target.set(0, -11_380, -11_380 * 4 / 3)
  controls.update()
  const scene = new THREE.Scene()
  const terreno = new THREE.Group()
  terreno.name = 'terrain'
  scene.add(terreno)
  const agregarSuelo = (y: number, ancho = 200_000, x = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ancho, ancho), new THREE.MeshBasicMaterial())
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, y, z)
    terreno.add(mesh)
    scene.updateMatrixWorld(true)
    limpiezas.push(() => { mesh.geometry.dispose(); mesh.material.dispose() })
    return mesh
  }
  agregarSuelo(0)
  estado = { camera, controls, scene, size: { width: 1600, height: 870 }, clock: { elapsedTime: 0 }, invalidate: () => { pedidos++ } }
  const api: { current: ApiVista | null } = { current: null }
  efectos.length = 0
  cuadros.length = 0
  renderToString(createElement(Vista, {
    api, mirilla: { current: null }, onEscala: () => {},
  }))
  ejecutarEfectos()
  const avanzar = (n = 1) => {
    for (let i = 0; i < n; i++) {
      controls.update()
      cuadro(null, 1 / 60)
    }
  }
  pedidos = 0
  return { camera, controls, scene, terreno, agregarSuelo, api, avanzar, pedidos: () => pedidos }
}

/** Solo el destino DOM es sintético; los gestos pasan por OrbitControls. */
function gestos (controls: OrbitControls) {
  const documento = new EventTarget()
  const elemento = Object.assign(new EventTarget(), {
    ownerDocument: documento, style: {}, clientWidth: 1600, clientHeight: 870,
    releasePointerCapture: () => {},
  })
  controls.connect(elemento as unknown as HTMLElement)
  controls.enableDamping = true // valor predeterminado de drei
  limpiezas.push(() => controls.dispose())
  return {
    rueda: () => elemento.dispatchEvent(Object.assign(new Event('wheel'), { deltaY: -100 })),
    arrastrar: (button: number, dx: number, dy: number) => {
      const pointer = { pointerId: 1, pointerType: 'mouse', button }
      elemento.dispatchEvent(Object.assign(new Event('pointerdown'), pointer, { clientX: 0, clientY: 0 }))
      documento.dispatchEvent(Object.assign(new Event('pointermove'), pointer, { clientX: dx, clientY: dy }))
      documento.dispatchEvent(Object.assign(new Event('pointerup'), pointer))
    },
  }
}

test.each([0.001, -0.001])('vista casi horizontal (%s): paneo derecho y cientos de ruedas conservan controles utilizables', pendiente => {
  const { camera, controls, avanzar } = vistaSobreSuelo(26_603.7)
  avanzar() // mide una cota antes de salir de la cobertura
  camera.position.set(200_000, 26_603.7, 0)
  controls.target.copy(camera.position).add(new THREE.Vector3(0, -73_439 * pendiente, -73_439))
  avanzar()
  const { rueda, arrastrar } = gestos(controls)
  for (let i = 0; i < 8; i++) { arrastrar(2, 0, 100); avanzar(120) }
  const radios = [200, 120, 180].map(n => {
    for (let i = 0; i < n; i++) { rueda(); avanzar() }
    return controls.getDistance()
  })
  // Sin piso radial: ~2,57 m tras 200, ~0,005 m tras 320, ~0,001 tras 500.
  for (const radio of radios) expect.soft(radio).toBeGreaterThanOrEqual(10 - 1e-6)
  const posicion = camera.position.clone()
  arrastrar(2, 100, 0)
  avanzar(120)
  expect(camera.position.distanceTo(posicion)).toBeGreaterThan(0.1)
  const trasPaneo = camera.position.clone()
  arrastrar(0, 100, 0)
  avanzar(120)
  expect(camera.position.distanceTo(trasPaneo)).toBeGreaterThan(0.1)
  const radio = controls.getDistance()
  controls.dollyOut()
  avanzar()
  expect(controls.getDistance()).toBeGreaterThan(radio + 0.1)
})

test('muchos acercamientos por botón tampoco colapsan el radio mirando al horizonte', () => {
  const { camera, controls, api, avanzar } = vistaSobreSuelo(26_603.7)
  camera.position.set(200_000, 26_603.7, 0)
  controls.target.set(200_000, 26_603.7, -73_439)
  avanzar()
  for (let i = 0; i < 40; i++) { api.current!.acercar(); avanzar(120) }
  expect(controls.getDistance()).toBeGreaterThanOrEqual(10 - 1e-6)
  const radio = controls.getDistance()
  api.current!.alejar()
  avanzar(120)
  expect(controls.getDistance()).toBeGreaterThan(radio + 1)
})

test.each([false, true])('una superficie a milímetros no colapsa el pivote ni desplaza la cámara (destino pendiente: %s)', pendiente => {
  const { camera, controls, terreno, agregarSuelo, api, avanzar } = vistaSobreSuelo()
  camera.position.set(0, 125, 0)
  controls.target.set(0, 125, -100)
  // Cara de una ladera muy empinada: el rayo central la encuentra a 2 mm,
  // aunque la columna vertical sigue viendo el suelo 125 m más abajo.
  const pared = agregarSuelo(125, 20, 0, -0.002)
  pared.rotation.x = 0
  terreno.updateMatrixWorld(true)
  controls.update()
  const posicion = camera.position.clone()
  const inclinacion = camera.quaternion.clone()
  if (pendiente) api.current!.acercar()
  avanzar()
  // Se comprueba ANTES de otro update: minDistance solo no protege el target.
  expect.soft(controls.getDistance()).toBeGreaterThanOrEqual(10 - 1e-6)
  avanzar(180)
  expect(controls.getDistance()).toBeGreaterThanOrEqual(10 - 1e-6)
  expect(camera.position.distanceTo(posicion)).toBeLessThan(1e-6)
  expect(camera.quaternion.angleTo(inclinacion)).toBeLessThan(1e-7)
})

test('FlyTo mantiene un piso radial aun si llegan muchos dolly antes del siguiente cuadro', () => {
  const { controls, avanzar } = vistaSobreSuelo()
  avanzar()
  renderToString(createElement(FlyTo, {
    objetivo: { center: new THREE.Vector3(200_000, 26_603.7, 0), span: 1200 },
  }))
  ejecutarEfectos()
  for (let i = 0; i < 800; i++) controls.dollyIn()
  expect(controls.getDistance()).toBeGreaterThanOrEqual(10 - 1e-6)
})

test('el piso radial permite inspeccionar hacia abajo con un radio cercano a 15 m', () => {
  const { camera, controls, avanzar } = vistaSobreSuelo()
  camera.position.set(0, 125, 0)
  avanzar()
  for (let i = 0; i < 1200; i++) { controls.dollyIn(); avanzar() }
  expect(camera.position.y).toBeGreaterThanOrEqual(15)
  expect(controls.getDistance()).toBeLessThan(16)
})

test('el target enterrado deja de llevar la rueda bajo el suelo, sin cambiar la inclinación', () => {
  const { camera, controls, avanzar } = vistaSobreSuelo(125, true)
  const inclinacion = camera.quaternion.clone()
  avanzar()
  const pivote = controls.target.clone()
  const alturaAntes = camera.position.y
  const giro = inclinacion.angleTo(camera.quaternion)
  controls.dollyIn()
  avanzar()
  // Sin el arreglo: target=-11.380, radio=19.175; 0,95 deja Y=-450,25 m.
  expect(camera.position.y).toBeGreaterThanOrEqual(15)
  expect(camera.position.y).toBeLessThan(125)
  expect(pivote.y).toBeCloseTo(0, 6)
  expect(alturaAntes).toBeCloseTo(125, 6)
  expect(giro).toBeLessThan(1e-7)
})

test('seguir acercando llega a inspección de pavimento y nunca atraviesa el piso', () => {
  const { camera, controls, avanzar } = vistaSobreSuelo(125, true)
  avanzar()
  let minima = Infinity
  for (let i = 0; i < 240; i++) {
    controls.dollyIn()
    avanzar()
    minima = Math.min(minima, camera.position.y)
  }
  expect(minima).toBeGreaterThanOrEqual(15)
  expect(camera.position.y).toBeLessThan(30)
  const alturaMinima = camera.position.y
  controls.dollyOut()
  avanzar()
  expect(camera.position.y).toBeGreaterThan(alturaMinima + 0.1)
})

test('el paso relativo de rueda disminuye al acercarse al piso', () => {
  const pasoRelativo = (altura: number) => {
    const { camera, controls, avanzar } = vistaSobreSuelo(altura)
    avanzar()
    controls.dollyIn()
    avanzar()
    return (altura - camera.position.y) / altura
  }
  const lejos = pasoRelativo(125)
  const cerca = pasoRelativo(30)
  // Sin freno ambos pasos son 0,05: reducir metros solo por dolly no basta.
  expect(cerca).toBeGreaterThan(0)
  expect(cerca).toBeLessThan(lejos - 1e-4)
})

test('corrige un cerro bajo la cámara aunque el centro de pantalla vea suelo más bajo', () => {
  const { camera, controls, agregarSuelo, avanzar } = vistaSobreSuelo(125)
  avanzar()
  // Un paneo conserva el brazo de la órbita y entra en un parche elevado.
  camera.position.x += 1000
  controls.target.x += 1000
  agregarSuelo(200, 20, camera.position.x, camera.position.z)
  avanzar()
  // El rayo oblicuo todavía ve Y=0. El vertical debe detectar Y=200 incluso
  // si el paneo ya dejó la cámara por debajo de esa superficie.
  expect(camera.position.y).toBeGreaterThanOrEqual(215)
})

test('un padre LOD oculto no empuja la cámara sobre una superficie que no se dibuja', () => {
  const { camera, agregarSuelo, avanzar } = vistaSobreSuelo(30)
  agregarSuelo(500).visible = false
  avanzar()
  expect(camera.position.y).toBeCloseTo(30, 6)
})

test('espera sobre la cota máxima mientras carga y recibir la malla no salta la cámara', () => {
  const { camera, controls, terreno, agregarSuelo, avanzar } = vistaSobreSuelo(6000)
  terreno.children[0].visible = false
  terreno.userData.alturaMaxima = 5000
  avanzar()
  for (let i = 0; i < 240; i++) { controls.dollyIn(); avanzar() }
  expect(camera.position.y).toBeGreaterThanOrEqual(5015)
  const posicion = camera.position.clone()
  const inclinacion = camera.quaternion.clone()
  agregarSuelo(1000)
  avanzar()
  expect(camera.position.distanceTo(posicion)).toBeLessThan(1e-6)
  expect(camera.quaternion.angleTo(inclinacion)).toBeLessThan(1e-7)
})

test('la vista oblicua lejana puede acercarse aunque la cámara quede fuera de la cobertura vertical', () => {
  const { camera, controls, terreno, agregarSuelo, avanzar } = vistaSobreSuelo(6000)
  terreno.children[0].visible = false
  agregarSuelo(0, 1000)
  terreno.userData.alturaMaxima = 5000
  // El centro ve el suelo; la cámara (Y=6000, Z=8000) queda fuera de su caja.
  avanzar()
  const radio = controls.getDistance()
  controls.dollyIn()
  avanzar()
  expect(camera.position.y).toBeLessThan(6000)
  expect(controls.getDistance()).toBeLessThan(radio)
  expect(camera.position.y).toBeGreaterThanOrEqual(5015)
})

test('perder cobertura a baja altura espera el relieve sin saltar a la cota máxima del estado', () => {
  const { camera, controls, terreno, avanzar } = vistaSobreSuelo(30)
  terreno.userData.alturaMaxima = 3872
  avanzar()
  terreno.children[0].visible = false
  avanzar()
  expect(camera.position.y).toBeCloseTo(30, 6)
  for (let i = 0; i < 20; i++) { controls.dollyIn(); avanzar() }
  expect(camera.position.y).toBeCloseTo(30, 6)
  terreno.children[0].visible = true
  avanzar()
  controls.dollyIn()
  avanzar()
  expect(camera.position.y).toBeLessThan(30)
  expect(camera.position.y).toBeGreaterThanOrEqual(15)
})

test('el error del LOD reserva altura y el detalle nuevo permite bajar sin saltos de cámara', () => {
  const { camera, controls, terreno, agregarSuelo, avanzar } = vistaSobreSuelo(6000)
  terreno.children[0].visible = false
  const padre = agregarSuelo(1744.956413)
  padre.userData.techoCarga = 3600
  avanzar()
  for (let i = 0; i < 240; i++) { controls.dollyIn(); avanzar() }
  // El DEM fino puede estar 882 m por encima de este padre simplificado.
  expect(camera.position.y).toBeGreaterThanOrEqual(3615)
  const sobrePadre = camera.position.clone()
  padre.visible = false
  const hijo = agregarSuelo(2626.956543)
  hijo.userData.techoCarga = 3400
  avanzar()
  expect(camera.position.distanceTo(sobrePadre)).toBeLessThan(1e-6)

  const sobreHijo = camera.position.clone()
  hijo.visible = false
  agregarSuelo(2626.956543)
  avanzar()
  expect(camera.position.distanceTo(sobreHijo)).toBeLessThan(1e-6)
  for (let i = 0; i < 240; i++) { controls.dollyIn(); avanzar() }
  expect(camera.position.y - 2626.956543).toBeGreaterThanOrEqual(15)
  expect(camera.position.y - 2626.956543).toBeLessThan(30)
})

test('el destino de los botones sigue animando al corregir el target y respeta el piso', () => {
  const { camera, api, avanzar } = vistaSobreSuelo(125, true)
  // La solicitud ya está pendiente cuando se corrige el pivote enterrado.
  api.current!.acercar()
  let minima = Infinity
  for (let i = 0; i < 180; i++) {
    avanzar()
    minima = Math.min(minima, camera.position.y)
  }
  expect(minima).toBeGreaterThanOrEqual(15)
  expect(camera.position.y).toBeGreaterThan(30)
  expect(camera.position.y).toBeLessThan(125)
  for (let i = 0; i < 8; i++) { api.current!.acercar(); avanzar(120) }
  expect(camera.position.y).toBeGreaterThanOrEqual(15)
  expect(camera.position.y).toBeLessThan(30)
  const alturaMinima = camera.position.y
  api.current!.alejar()
  avanzar(180)
  expect(camera.position.y).toBeGreaterThan(alturaMinima + 1)
})

test('FlyTo conserva el encuadre de búsqueda y el acercamiento posterior respeta el suelo', () => {
  const { camera, agregarSuelo, api, avanzar } = vistaSobreSuelo()
  agregarSuelo(200)
  // Elegir una vía también cancela el zoom y paneo anteriores pendientes.
  api.current!.acercar()
  api.current!.irA(new THREE.Vector3(-10_000, 0, -10_000))
  const center = new THREE.Vector3(1000, 200, 1000)
  renderToString(createElement(FlyTo, { objetivo: { center, span: 1200 } }))
  ejecutarEfectos()
  avanzar(180)
  expect(camera.position.x).toBeCloseTo(1000, 6)
  expect(camera.position.y).toBeCloseTo(1040, 6)
  expect(camera.position.z).toBeCloseTo(2080, 6)
  for (let i = 0; i < 10; i++) { api.current!.acercar(); avanzar(120) }
  expect(camera.position.y).toBeGreaterThanOrEqual(215)
  expect(camera.position.y).toBeLessThan(230)
})

test('la escala sigue el suelo al acercarse aunque el paneo haya enterrado el target', () => {
  const camera = new THREE.PerspectiveCamera(45, 1600 / 870, 10, 2_000_000)
  const controls = new OrbitControls(camera)
  // El paneo en pantalla puede dejar el pivote kilómetros bajo el suelo.
  // La superficie está 25 km por delante de él sobre el eje de la cámara.
  controls.target.set(0, -15_000, -20_000)
  const scene = new THREE.Scene()
  const terreno = new THREE.Group()
  terreno.name = 'terrain'
  const suelo = new THREE.Mesh(new THREE.PlaneGeometry(10_000, 10_000), new THREE.MeshBasicMaterial())
  suelo.rotation.x = -Math.PI / 2
  terreno.add(suelo)
  scene.add(terreno)
  scene.updateMatrixWorld(true)
  estado = { camera, controls, scene, size: { width: 1600, height: 870 }, clock: { elapsedTime: 0 }, invalidate: () => { pedidos++ } }
  const publicadas: Escala[] = []
  renderToString(createElement(Vista, {
    api: { current: null }, mirilla: { current: null }, onEscala: e => publicadas.push(e),
  }))

  // En cada paso, 2*d*tan(22,5°)/870 da 1,904 / 0,952 / 0,095 m/px.
  // La barra de 104 px debe bajar de 100 m a 50 m y a 5 m.
  for (const d of [2000, 1000, 100]) {
    camera.position.set(0, d * 0.6, d * 0.8)
    controls.update()
    cuadro(null, 1 / 60)
  }
  expect(publicadas.map(e => e.metros)).toEqual([100, 50, 5])
  expect(publicadas.map(e => e.px)).toEqual([53, 53, 53])
  suelo.geometry.dispose()
  suelo.material.dispose()
})

test('el origen del proyecto cae en el cero de la escena', () => {
  const v = enuOf(ORIGIN.lat, ORIGIN.lon, 0)
  expect(v.length()).toBeLessThan(1e-6)
})

test('el span del bbox del Tachira ronda los 200 km de diagonal', () => {
  const { span } = bboxCenterAndSpan(BBOX)
  expect(span).toBeGreaterThan(180000)
  expect(span).toBeLessThan(220000)
})

// Fija la convencion de ejes (X=este, Y=arriba, Z=-norte) eje por eje.
// El test del origen da (0,0,0) sin importar el orden/signo de los ejes, y
// bboxCenterAndSpan usa distanceTo, invariante ante cualquier permutacion:
// ninguno de los dos revienta si enuOf devuelve, p.ej., (e, n, u) en vez de
// (e, u, -n). Este si: cada eje se mueve solo, y solo debe moverse el
// componente que le toca.
test('mover al este/norte/arriba solo mueve el eje que le corresponde', () => {
  const este = enuOf(ORIGIN.lat, ORIGIN.lon + 0.01, 0)
  expect(este.x).toBeGreaterThan(500)      // este -> +X
  expect(Math.abs(este.z)).toBeLessThan(1) // sin componente norte

  const norte = enuOf(ORIGIN.lat + 0.01, ORIGIN.lon, 0)
  expect(norte.z).toBeLessThan(-500)        // norte -> -Z
  expect(Math.abs(norte.x)).toBeLessThan(1) // sin componente este

  const arriba = enuOf(ORIGIN.lat, ORIGIN.lon, 1000)
  expect(arriba.y).toBeGreaterThan(999) // altura -> +Y
  expect(arriba.y).toBeLessThan(1001)
})

// positions es CSR sobre segmentos: seis floats por segmento (los dos
// extremos). Un buffer a mano es la unica forma de comprobar que se leen los
// DOS extremos y que el rango de la via i sale de index[i]..index[i+1] --
// leer solo el primer extremo, o desfasar el indice en uno, sigue dando un
// encuadre plausible sobre el dato real.
const positions = new Float32Array([
  // via 0: dos segmentos, de (0,0,0) a (2000,0,0)
  0, 0, 0, 1000, 0, 0,
  1000, 0, 0, 2000, 0, 0,
  // via 1: un segmento lejos, de (10000,0,10000) a (10000,0,12000)
  10000, 0, 10000, 10000, 0, 12000,
])
const index = new Uint32Array([0, 2, 3])

test('el encuadre de una via cubre sus dos extremos', () => {
  const e = idsCenterAndSpan(positions, index, [0])!
  expect(e.center.x).toBeCloseTo(1000)
  expect(e.center.z).toBeCloseTo(0)
})

test('el encuadre de varias vias cubre todas', () => {
  const e = idsCenterAndSpan(positions, index, [0, 1])!
  expect(e.center.x).toBeCloseTo(5000)
  expect(e.center.z).toBeCloseTo(6000)
  expect(e.span).toBeCloseTo(Math.hypot(10000, 12000))
})

// Una via urbana mide decenas de metros: sin piso la camara queda a ~40 m del
// suelo, por dentro del near plane (10, App.tsx) y contra un relieve
// muestreado cada 130 m que a esa distancia es un plano.
test('el span nunca baja del piso, aunque la via sea de metros', () => {
  const corta = new Float32Array([0, 0, 0, 30, 0, 0])
  const e = idsCenterAndSpan(corta, new Uint32Array([0, 1]), [0])!
  expect(e.span).toBe(1200)
  expect(e.center.x).toBeCloseTo(15)
})

test('un conjunto vacio o sin segmentos no pide encuadre', () => {
  expect(idsCenterAndSpan(positions, index, [])).toBeNull()
  // via con rango vacio (index[i] === index[i+1]): existe pero no dibuja nada
  expect(idsCenterAndSpan(positions, new Uint32Array([0, 0]), [0])).toBeNull()
})

// El bucle de render va por demanda (App.tsx, frameloop="demand"): un cuadro
// que nadie pide no se dibuja. OrbitControls pide el suyo mientras el ratón
// está apretado, pero el zoom amortiguado sigue corriendo DESPUÉS de soltar, y
// nadie más lo empujaría. Si se quita el invalidate de Vista, un clic en
// "acercar" mueve la cámara en el modelo y la pantalla se queda en el cuadro
// anterior hasta que alguien vuelva a tocar algo.
test('el acercamiento pide cuadro mientras se mueve y deja de pedirlos al llegar', () => {
  const { api, avanzar, pedidos } = vistaSobreSuelo()
  expect(pedidos()).toBe(0)
  api.current!.acercar()
  avanzar(10)
  const enMarcha = pedidos()
  expect(enMarcha).toBeGreaterThan(0)
  // Hasta que la animación termina. A partir de ahí no se pide ni uno más:
  // eso es lo que deja la CPU y la GPU en cero con el mapa quieto.
  avanzar(600)
  const alFinal = pedidos()
  expect(alFinal).toBeGreaterThan(enMarcha)
  avanzar(120)
  expect(pedidos()).toBe(alFinal)
})
