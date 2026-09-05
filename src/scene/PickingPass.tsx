import { useMemo, useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree } from '@react-three/fiber'
// Las anclas del LineMaterial son las mismas para los dos pases y viven en un
// solo sitio (roadsShader.ts), donde roadsShader.test.ts las comprueba contra
// el material real: duplicarlas acá dejaba este pase sin cobertura, así que
// una actualización de three que las moviera ponía roja la suite por el otro
// lado, se arreglaba allá, y el picking quedaba roto hasta el primer clic.
import { ANCLA_VERT, ANCLA_FRAG, ATTR_VERT_GLSL, DISCARD_OCULTAS_GLSL } from './roadsShader'
import { ATTR_SIZE } from '../data/constants'
import type { AttrTexture } from '../data/attrTexture'

export const encodeId = (i: number): [number, number, number] =>
  [(i >> 16) & 255, (i >> 8) & 255, i & 255]

export const decodeId = (r: number, g: number, b: number): number =>
  (r << 16) | (g << 8) | b

// Más ancho que el pase visible (2 px, Roads.tsx): da tolerancia de clic sobre
// una vía fina. Demasiado ancho y las vías paralelas se tapan entre sí en el
// id buffer. Calibrable -- ver task-16-report.md para el valor probado.
export const PICK_WIDTH = 8

/** El buffer de ids lee la MISMA textura de atributos que el pase visible y
 * descarta con el MISMO bloque (roadsShader.ts): una vía que el filtro oculta
 * no puede escribir su id acá. Sin esto el buffer dibujaba las 26.712 vías
 * siempre, filtradas o no -- un clic o un lazo sobre un mapa vacío devolvían
 * miles de vías invisibles, y el panel de edición les escribía PCI con marca
 * de procedencia encima. Se arregla en el buffer y no en onPick/onLassoFinish
 * a propósito: así cualquier consumidor futuro hereda la corrección en vez de
 * tener que acordarse de intersectar con la máscara. */
export function patchPickMaterial (
  material: THREE.Material, attrTexture: THREE.DataTexture, attrSize: number,
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAttr = { value: attrTexture }
    shader.uniforms.uAttrSize = { value: attrSize }

    if (!shader.vertexShader.includes(ANCLA_VERT)) {
      throw new Error('PickingPass: no se encontró el ancla del vertex shader de LineMaterial')
    }
    shader.vertexShader = shader.vertexShader.replace(ANCLA_VERT, `
      varying float vSegId;
      ${ATTR_VERT_GLSL}
        vSegId = segId;
    `)
    if (!shader.fragmentShader.includes(ANCLA_VERT)) {
      throw new Error('PickingPass: no se encontró el ancla de void main() en el fragment shader de LineMaterial')
    }
    if (!shader.fragmentShader.includes(ANCLA_FRAG)) {
      throw new Error('PickingPass: no se encontró el ancla del fragment shader de LineMaterial')
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(ANCLA_VERT, 'varying float vSegId;\nvarying vec4 vAttr;\nvoid main() {')
      .replace(ANCLA_FRAG, `
        ${DISCARD_OCULTAS_GLSL}
        float id = vSegId + 1.0;   // 0 queda reservado para "nada"
        // El id buffer tiene que ser OPACO: cualquier mezcla de color entre
        // dos vías vecinas decodifica como un id que no existe. gl_FragColor
        // saca su alpha de esta variable local alpha, no de diffuseColor.a
        // (LineMaterial.js:417) -- hay que reasignarla a ella, no solo
        // construir diffuseColor con otro valor.
        alpha = 1.0;
        vec4 diffuseColor = vec4(
          floor(mod(id / 65536.0, 256.0)) / 255.0,
          floor(mod(id / 256.0, 256.0)) / 255.0,
          floor(mod(id, 256.0)) / 255.0,
          1.0);
      `)
  }
  material.needsUpdate = true
}

export function usePicking (
  { positions, segIds, attr }:
  { positions: Float32Array; segIds: Float32Array; attr: AttrTexture },
) {
  const { gl, scene, camera, size } = useThree()

  // Geometría, material y escena del pase de picking: independientes del
  // pase visible (Roads.tsx) porque necesitan su propio ancho de línea y su
  // propio shader de color-por-id. No dependen de `size` -- igual que en
  // Roads.tsx, un resize solo debe mover la resolución del material (efecto
  // de abajo), no forzar volver a subir 450.261 segmentos a la GPU.
  const { pickScene, pickLine } = useMemo(() => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(positions)
    geometry.setAttribute('segId', new THREE.InstancedBufferAttribute(segIds, 1))
    const material = new LineMaterial({ linewidth: PICK_WIDTH, worldUnits: false })
    patchPickMaterial(material, attr.texture, ATTR_SIZE)
    const pickLine = new LineSegments2(geometry, material)
    pickLine.frustumCulled = false     // el bbox de una geometría instanciada no es fiable (Roads.tsx)
    const pickScene = new THREE.Scene()
    pickScene.add(pickLine)
    return { pickScene, pickLine }
  }, [positions, segIds, attr])

  // Render target sin antialiasing ni mipmaps: un texel debe decodificar a un
  // id exacto, no a un promedio entre vecinos. Se crea una sola vez;
  // setSize() en el efecto de abajo lo reajusta en cada resize sin tirar y
  // volver a pedir memoria de GPU (que es lo que pasaría si esto viviera en
  // el useMemo de arriba con `size` en las deps).
  const target = useMemo(() => new THREE.WebGLRenderTarget(size.width, size.height, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, colorSpace: THREE.NoColorSpace,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])

  useEffect(() => {
    target.setSize(size.width, size.height)
    ;(pickLine.material as LineMaterial).resolution.set(size.width, size.height)
  }, [target, pickLine, size.width, size.height])

  // El mesh de solo-profundidad del terreno se engancha perezosamente (al
  // primer render(), no en el useMemo de arriba): cuando ese useMemo corre,
  // durante la fase de render de React, <Terrain> puede todavía no haberse
  // montado en la escena real -- todos los hermanos de un mismo padre
  // renderizan antes de que cualquiera confirme (commit) su objeto de three.
  // Al primer clic (render() corre solo bajo demanda) el montaje ya pasó.
  const depthTerrainRef = useRef<THREE.Mesh | null>(null)

  const render = useCallback(() => {
    // Sin el relieve en el pase de picking no hay nada contra qué ocluir: una
    // vía detrás de una montaña se seleccionaría igual que una visible. Mismo
    // criterio que las anclas del shader -- si no aparece, esto debe reventar
    // ruidosamente, no dar picking sin oclusión en silencio.
    // scene.getObjectByName tipa Object3D -- este objeto lo nombramos
    // nosotros mismos en Terrain.tsx y siempre es el <mesh> real, así que el
    // cast a Mesh (para .geometry) es seguro.
    const terrainObj = scene.getObjectByName('terrain') as THREE.Mesh | undefined
    if (!terrainObj) {
      throw new Error('PickingPass: no se encontró el mesh "terrain" en la escena -- el picking quedaría sin oclusión del relieve')
    }
    if (!depthTerrainRef.current) {
      // Reusa la geometría real (1M de vértices, no se clona) con un
      // material que solo escribe profundidad -- las vías ocluidas fallan el
      // depth test sin pintar nada encima del id buffer.
      //
      // polygonOffset negativo sesga al terreno un poco más cerca de cámara
      // de lo que realmente está. Necesario incluso con near/far ya acotados
      // al alcance real (ver más abajo): quedó un punto de prueba que seguía
      // filtrando con precisión de sobra (razón far/near ~4.7:1) -- caso
      // límite de la extrusión en pantalla de LineSegments2 (las vías no son
      // geometría plana pegada al terreno, son quads que miran a cámara), no
      // de precisión de depth buffer. Probado en vivo contra los 3 puntos
      // ciegos del fix round 1 más un control sobre una vía visible real:
      // -3 ya resuelve los 3 puntos sin tocar el control; -8 ya sobre-ocluye
      // el control (falso negativo en una vía visible). -4 dado por bueno,
      // con margen a ambos lados. Calibrable si aparecen más casos.
      const depthMaterial = new THREE.MeshBasicMaterial({
        colorWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      })
      const depthMesh = new THREE.Mesh(terrainObj.geometry, depthMaterial)
      depthMesh.frustumCulled = false   // igual que el terreno real (Terrain.tsx)
      depthMesh.matrixAutoUpdate = false
      // Objetos opacos con el mismo renderOrder (default 0 los dos) three.js
      // los ordena por material.id -- orden de creación, no por profundidad
      // real (WebGLRenderLists.js: painterSortStable). Este material se crea
      // perezosamente, después del de pickLine, así que sin esto SIEMPRE
      // dibujaría el terreno después de las vías: la vía ya habría escrito su
      // color antes de que el terreno "gane" el depth test y solo actualice
      // profundidad (colorWrite:false no borra lo ya pintado). renderOrder
      // negativo fuerza que el terreno se dibuje primero pase lo que pase.
      depthMesh.renderOrder = -1
      pickScene.add(depthMesh)
      depthTerrainRef.current = depthMesh
    }
    // El terreno no se mueve hoy, pero si alguna vez lo hiciera, la
    // profundidad quedaría desalineada sin esto -- barato de mantener
    // sincronizada en cada clic (esto no corre por frame).
    terrainObj.updateMatrixWorld()
    depthTerrainRef.current.matrix.copy(terrainObj.matrixWorld)

    // La cámara real usa near=10/far=2.000.000 (App.tsx) para que el cielo de
    // la atmósfera no se recorte -- con un depth buffer estándar (no
    // logarítmico) esa razón de 200.000:1 deja tan poca precisión a la
    // distancia real de cámara que dos superficies a kilómetros de distancia
    // cuantizan al mismo valor: el terreno ocluye en unos píxeles y en otros
    // no (confirmado en vivo -- con solo el renderOrder corregido, 1 de 3
    // clics ciegos de prueba seguía filtrando). Lo que importa es la razón
    // far/near, no el valor absoluto de far -- angostar solo far (con near
    // fijo) casi no mejora nada si near queda chico frente al far nuevo.
    // El picking no necesita ver el cielo: se acotan los dos a la profundidad
    // de vista real del terreno solo durante este render, y se restauran
    // después -- mismo patrón que toneMapping/clearColor. Una esfera
    // envolvente da una cota matemáticamente segura pero floja para un
    // terreno ancho y chato (147x129 km) visto de frente: su radio es casi
    // todo extensión horizontal, no profundidad de vista. Las 8 esquinas del
    // bounding box, proyectadas al eje de la cámara (view-space Z, no
    // distancia radial), dan la cota óptima -- el mín/máx de una función
    // lineal sobre un poliedro convexo siempre cae en un vértice.
    if (!terrainObj.geometry.boundingBox) terrainObj.geometry.computeBoundingBox()
    const bb = terrainObj.geometry.boundingBox!
    camera.updateMatrixWorld()
    let minViewDist = Infinity
    let maxViewDist = -Infinity
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(
        i & 1 ? bb.max.x : bb.min.x,
        i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z,
      )
        .applyMatrix4(terrainObj.matrixWorld)
        .applyMatrix4(camera.matrixWorldInverse)
      const viewDist = -corner.z   // three.js: la cámara mira hacia -Z en su propio espacio
      if (viewDist < minViewDist) minViewDist = viewDist
      if (viewDist > maxViewDist) maxViewDist = viewDist
    }
    const prevNear = camera.near
    const prevFar = camera.far
    camera.near = Math.max(1, minViewDist)
    camera.far = Math.max(camera.near + 1, maxViewDist)
    camera.updateProjectionMatrix()

    const prevTarget = gl.getRenderTarget()
    const prevTone = gl.toneMapping
    const prevClearColor = gl.getClearColor(new THREE.Color())
    const prevClearAlpha = gl.getClearAlpha()
    gl.toneMapping = THREE.NoToneMapping
    gl.setRenderTarget(target)
    gl.setClearColor(0x000000, 1)
    gl.clear()
    gl.render(pickScene, camera)
    gl.setRenderTarget(prevTarget)
    gl.toneMapping = prevTone
    gl.setClearColor(prevClearColor, prevClearAlpha)
    camera.near = prevNear
    camera.far = prevFar
    camera.updateProjectionMatrix()
  }, [gl, scene, camera, target, pickScene])

  const pickAt = useCallback((x: number, y: number): number | null => {
    render()
    const buf = new Uint8Array(4)
    // readRenderTargetPixels cuenta desde abajo-izquierda; el mouse, desde
    // arriba-izquierda -- de ahí el size.height - y.
    gl.readRenderTargetPixels(target, x, size.height - y, 1, 1, buf)
    const id = decodeId(buf[0], buf[1], buf[2])
    return id === 0 ? null : id - 1
  }, [gl, target, render, size.height])

  const pickRegion = useCallback(
    (rect: { x: number; y: number; w: number; h: number }, inside: (px: number, py: number) => boolean) => {
      render()
      const buf = new Uint8Array(rect.w * rect.h * 4)
      gl.readRenderTargetPixels(target, rect.x, size.height - rect.y - rect.h, rect.w, rect.h, buf)
      const ids = new Set<number>()
      for (let row = 0; row < rect.h; row++) {
        for (let col = 0; col < rect.w; col++) {
          const o = (row * rect.w + col) * 4
          const id = decodeId(buf[o], buf[o + 1], buf[o + 2])
          if (id === 0) continue
          // la fila 0 del buffer leído es la de abajo: se devuelve a coordenadas de pantalla
          if (inside(rect.x + col, rect.y + rect.h - 1 - row)) ids.add(id - 1)
        }
      }
      return [...ids]
    }, [gl, target, render, size.height])

  return { pickAt, pickRegion }
}
