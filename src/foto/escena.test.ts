import { test, expect } from 'vitest'
import * as THREE from 'three'
import { construirEscena } from './escena'
import { ATTR_VIA, ATTR_VIA_ITEMS } from '../scene/roadsShader'
import { ATTR_SIZE } from '../data/constants'

// Este archivo existe por un fallo concreto: al empaquetar aCalzada, aCanales y
// aBorde en un solo vec3 (roadsShader.ts, ATTR_VIA), `escena.ts` se quedó
// pidiendo `getAttribute('aCalzada')`, que pasó a devolver undefined, y la foto
// trazada reventaba con un TypeError en CUALQUIER vista con vías. Las 882
// pruebas del repo pasaron igual: nadie recorría este camino.
//
// Así que lo que se prueba acá no es aritmética -- es el ACOPLE entre lo que
// Roads.tsx cuelga de la geometría y lo que la foto lee de ella. Por eso la
// vía de mentira se arma con los mismos nombres y el mismo entrelazado que
// LineSegmentsGeometry, y no con un objeto cualquiera que cumpla el tipo.

const CALZADA_M = 8
const LARGO_M = 10

/** Una vía de un solo tramo, armada como la arma Roads.tsx. */
function viaDeMentira (): THREE.Object3D {
  const geometry = new THREE.BufferGeometry()

  // instanceStart/End: un buffer entrelazado de 6 floats por tramo, igual que
  // LineSegmentsGeometry.setPositions.
  const xyz = new Float32Array([-LARGO_M / 2, 0, 0, LARGO_M / 2, 0, 0])
  const buf = new THREE.InstancedInterleavedBuffer(xyz, 6, 1)
  geometry.setAttribute('instanceStart', new THREE.InterleavedBufferAttribute(buf, 3, 0))
  geometry.setAttribute('instanceEnd', new THREE.InterleavedBufferAttribute(buf, 3, 3))

  // La normal del terreno en cada extremo, Int8 normalizado: hacia arriba.
  const nrm = new Int8Array([0, 127, 0, 0, 127, 0])
  const nrmBuf = new THREE.InstancedInterleavedBuffer(nrm, 6, 1)
  geometry.setAttribute('instanceNormalStart', new THREE.InterleavedBufferAttribute(nrmBuf, 3, 0, true))
  geometry.setAttribute('instanceNormalEnd', new THREE.InterleavedBufferAttribute(nrmBuf, 3, 3, true))

  // Calzada, canales y borde en un solo atributo: la componente x es la calzada.
  const via = new Float32Array([CALZADA_M, 2, 0])
  geometry.setAttribute(ATTR_VIA, new THREE.InstancedBufferAttribute(via, ATTR_VIA_ITEMS))
  geometry.setAttribute('segId', new THREE.InstancedBufferAttribute(new Float32Array([0]), 1))

  const material = new THREE.MeshStandardMaterial()
  // La foto distingue el relleno del contorno por la clave del programa, que
  // es la que arma patchLineMaterial.
  material.customProgramCacheKey = () => 'vias:relleno:base'
  material.userData.uniforms = {
    uAttr: { value: new THREE.DataTexture(new Uint8Array(ATTR_SIZE * ATTR_SIZE * 4), ATTR_SIZE, ATTR_SIZE) },
    uPisoPx: { value: 1 },
    uModoPci: { value: 0 },
  }

  const objeto = new THREE.Mesh(geometry, material) as THREE.Mesh & { isLineSegments2: boolean }
  objeto.isLineSegments2 = true
  return objeto
}

function camaraMirandoElTramo (): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 10_000)
  camera.position.set(0, 40, 0.001)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  return camera
}

test('la foto reconstruye un tramo de vía a partir de la geometría real', () => {
  const vista = new THREE.Scene()
  vista.add(viaDeMentira())

  const { escena, recuento } = construirEscena(vista, camaraMirandoElTramo(), 900, new Date('2026-09-18T15:00:00Z'))

  // Que no lance ya sería medio test; que además encuentre el tramo es el otro
  // medio. Con cero tramos la foto sale sin una sola carretera, que es
  // exactamente el fallo anterior de este archivo (ver el comentario de
  // `vias`, escena.ts) y salía "bien" sin lanzar nada.
  expect(recuento.tramos).toBe(1)

  const malla = escena.children.find(o => (o as THREE.Mesh).isMesh) as THREE.Mesh
  expect(malla).toBeDefined()
  const pos = malla.geometry.getAttribute('position')
  expect(pos.count).toBeGreaterThan(0)

  // El cuadrilátero tiene que medir la CALZADA de ancho. Es lo que se perdía si
  // se leía la componente equivocada del atributo empaquetado: con `aVia.y`
  // saldría de 2 m y con `aVia.z` de 0.
  let minZ = Infinity; let maxZ = -Infinity
  for (let i = 0; i < pos.count; i++) {
    minZ = Math.min(minZ, pos.getZ(i))
    maxZ = Math.max(maxZ, pos.getZ(i))
  }
  expect(maxZ - minZ).toBeCloseTo(CALZADA_M, 1)
})

test('sin vías visibles la escena se arma igual, sin tramos', () => {
  const vista = new THREE.Scene()
  const via = viaDeMentira()
  via.visible = false
  vista.add(via)

  const { recuento } = construirEscena(vista, camaraMirandoElTramo(), 900, new Date('2026-09-18T15:00:00Z'))
  expect(recuento.tramos).toBe(0)
})
