import { useMemo, useCallback, useEffect } from 'react'
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
import { ANCLA_VERT, ANCLA_FRAG, extrusionGlsl, parcharExtrusion } from './roadsShader'
import { cortePorSegmento, porSegmento, metrosPorPixel } from './roadStyle'
import { anchoCalzada } from './calzada'
import { bordeDe } from './seccion'
import type { Way } from '../data/types'

export const encodeId = (i: number): [number, number, number] =>
  [(i >> 16) & 255, (i >> 8) & 255, i & 255]

export const decodeId = (r: number, g: number, b: number): number =>
  (r << 16) | (g << 8) | b

// Piso en píxeles de la extrusión del pase de ids: más ancho que el piso del
// pase visible (0,8 a 3,4 px por nivel, roadStyle.ts) para dar tolerancia de
// clic sobre una vía fina a lo lejos. De cerca no manda: la vía se extruye a
// su ancho real en metros, igual que en el pase visible, así que una avenida
// de 400 px se selecciona en sus 400 px. Demasiado ancho y las vías paralelas
// se tapan entre sí en el id buffer. Calibrable -- ver task-16-report.md.
export const PICK_WIDTH = 8

// Radio en píxeles de pantalla que explora pickAt alrededor del cursor.
// 7 px da un objetivo de 15x15: cómodo con ratón o trackpad y todavía chico
// frente a la separación entre dos vías paralelas a cualquier acercamiento
// razonable. Calibrable.
const RADIO_CLIC = 7

// Cuánto se HUNDE el relieve que oclusiona el pase de picking, en metros.
//
// Nació cuando las vías iban drapeadas sobre el DEM completo y el relieve
// dibujado era una malla de 130 m: sobre terreno cóncavo la malla gruesa
// pasaba por encima de la vía y el oclusor tapaba vías a la vista (medido:
// 67.210 píxeles de vía en el id buffer con el oclusor pegado, 337.574 sin
// él). Hoy el relieve es el quadtree (TerrainLod.tsx) y de cerca es la misma
// triangulación sobre la que el pipeline apoyó las vías, así que el desfase
// que queda es el error del LOD en los nodos gruesos, nunca más que ERROR_PX
// en pantalla. Este margen puede bajar en cuanto se mida; el precio de
// dejarlo es que una vía detrás de una loma de menos de 250 m de altura se
// puede seleccionar. Calibrable.
const OCLUSOR_ABAJO = 250

/** Escribe el id de cada vía como color, descartando las que el acercamiento
 * ya apagó.
 *
 * Ese descarte es la contraparte exacta de una sola regla: lo que se dibuja,
 * se puede tocar; lo que no se dibuja, no. El pase ya la rompió una vez --
 * cuando existía el panel de filtros, lo que el filtro escondía seguía
 * escribiendo su id acá, y un clic o un lazo sobre un mapa vacío devolvían
 * miles de vías invisibles que una edición masiva pintaba de PCI sin que nadie
 * las viera. El filtro se fue, pero el desvanecimiento por acercamiento
 * (roadStyle.ts) volvió a esconder vías del mapa, y con ello volvió el deber
 * de descartarlas: a vista de estado el id buffer traería la red entera con la
 * pantalla mostrando solo troncales.
 *
 * Lo que NO se consulta acá es el estado editable de la vía (la textura de
 * atributos): eso cambia con lo que el usuario pinta, y el id buffer no puede
 * depender de ello. El corte sí, porque sale del mismo sitio que el pase
 * visible y de nada más -- `uMpp` contra el `aCorte` de cada segmento, los dos
 * definidos en roadStyle.ts. */
export function patchPickMaterial (material: THREE.Material) {
  // LineMaterial es un ShaderMaterial: `uniforms` existe desde la construcción
  // y el programa se enlaza por nombre al dibujar. Declararlo acá y no dentro
  // de onBeforeCompile (que corre en el primer render, DESPUÉS de que render()
  // haya querido escribirlo) es lo que evita que el primer clic de la sesión
  // se haga con el corte sin aplicar.
  ;(material as THREE.ShaderMaterial).uniforms.uMpp = { value: 0 }
  ;(material as THREE.ShaderMaterial).uniforms.uPisoPx = { value: PICK_WIDTH }

  // Ver el comentario gemelo en patchLineMaterial: la clave de caché de
  // programas de three ignora onBeforeCompile. Este material hoy difiere del
  // visible en transparent/depthWrite, así que por casualidad no colisiona --
  // pero que el id buffer salga correcto no puede depender de una casualidad
  // de flags que cualquiera puede igualar sin darse cuenta.
  material.customProgramCacheKey = () => 'vias:picking'

  material.onBeforeCompile = (shader) => {
    if (!shader.vertexShader.includes(ANCLA_VERT)) {
      throw new Error('PickingPass: no se encontró el ancla del vertex shader de LineMaterial')
    }
    shader.vertexShader = parcharExtrusion(
      shader.vertexShader.replace(ANCLA_VERT, `
        attribute float segId;
        attribute float aCorte;
        attribute float aCalzada;
        // El hombrillo o el brocal de la vía (seccion.ts). Va acá porque el
        // bloque de extrusión es el mismo que el del pase visible: si el id
        // buffer no ensanchara igual, el clic sobre el hombrillo no
        // seleccionaría la vía que se está viendo.
        attribute float aBorde;
        attribute vec3 instanceNormalStart;
        attribute vec3 instanceNormalEnd;
        uniform float uPisoPx;
        varying float vSegId;
        varying float vCorte;
        void main() {
          vSegId = segId;
          vCorte = aCorte;
      `),
      // Misma extrusión que el pase visible (roadsShader.ts): lo que se dibuja
      // se puede tocar, también de cerca. El piso es PICK_WIDTH, no el del
      // nivel: el área de acierto de una vía fina a lo lejos sigue siendo
      // generosa.
      extrusionGlsl(false),
    )
    if (!shader.fragmentShader.includes(ANCLA_VERT)) {
      throw new Error('PickingPass: no se encontró el ancla de void main() en el fragment shader de LineMaterial')
    }
    if (!shader.fragmentShader.includes(ANCLA_FRAG)) {
      throw new Error('PickingPass: no se encontró el ancla del fragment shader de LineMaterial')
    }
    shader.fragmentShader = shader.fragmentShader
      .replace(ANCLA_VERT, 'uniform float uMpp;\nvarying float vSegId;\nvarying float vCorte;\nvoid main() {')
      .replace(ANCLA_FRAG, `
        // Fuera antes de escribir nada: un discard posterior al color no borra
        // lo ya escrito en algunos drivers, y de todos modos pagaría la
        // escritura. vCorte lo pone cortePorSegmento() con el mismo número que
        // apaga el objeto en el pase visible (roadStyle.ts).
        if (uMpp > vCorte) discard;
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
  { positions, segIds, ways, index, normals }: {
    positions: Float32Array; segIds: Float32Array; ways: Way[]; index: Uint32Array; normals: Int8Array
  },
) {
  const { gl, scene, camera, size, controls } = useThree()

  // Geometría, material y escena del pase de picking: independientes del
  // pase visible (Roads.tsx) porque necesitan su propio ancho de línea y su
  // propio shader de color-por-id. No dependen de `size` -- igual que en
  // Roads.tsx, un resize solo debe mover la resolución del material (efecto
  // de abajo), no forzar volver a subir 450.261 segmentos a la GPU.
  const { pickScene, pickLine } = useMemo(() => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(positions)
    geometry.setAttribute('segId', new THREE.InstancedBufferAttribute(segIds, 1))
    geometry.setAttribute('aCorte', new THREE.InstancedBufferAttribute(cortePorSegmento(ways, index), 1))
    geometry.setAttribute('aCalzada', new THREE.InstancedBufferAttribute(porSegmento(ways, index, anchoCalzada), 1))
    geometry.setAttribute('aBorde', new THREE.InstancedBufferAttribute(porSegmento(ways, index, bordeDe), 1))
    // La misma normal del terreno que el pase visible: la extrusión es la
    // misma fórmula, y lo que se dibuja se puede tocar.
    const nrmBuf = new THREE.InstancedInterleavedBuffer(normals, 6, 1)
    geometry.setAttribute('instanceNormalStart', new THREE.InterleavedBufferAttribute(nrmBuf, 3, 0, true))
    geometry.setAttribute('instanceNormalEnd', new THREE.InterleavedBufferAttribute(nrmBuf, 3, 3, true))
    const material = new LineMaterial({ worldUnits: false })
    patchPickMaterial(material)
    const pickLine = new LineSegments2(geometry, material)
    pickLine.frustumCulled = false     // el bbox de una geometría instanciada no es fiable (Roads.tsx)
    const pickScene = new THREE.Scene()
    pickScene.add(pickLine)
    return { pickScene, pickLine }
  }, [positions, segIds, ways, index, normals])

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

  // Las mallas de solo profundidad del relieve. El relieve son los nodos
  // visibles del quadtree (TerrainLod.tsx), que cambian con la cámara, así que
  // se rearman en cada render() -- corre por clic, no por cuadro -- reusando
  // la geometría real de cada nodo (no se clona) con un material que solo
  // escribe profundidad: las vías ocluidas fallan el depth test sin pintar
  // nada encima del id buffer.
  //
  // Sin polygonOffset: el sesgo que hace falta acá no es de precisión del
  // depth buffer sino geométrico, y se aplica hundiendo el oclusor
  // OCLUSOR_ABAJO metros con `bajada`. Dos sesgos superpuestos, uno en metros
  // y otro en unidades de profundidad, se calibran peleándose.
  const depthMaterial = useMemo(() => new THREE.MeshBasicMaterial({ colorWrite: false }), [])
  const oclusores = useMemo(() => new THREE.Group(), [])
  const bajada = useMemo(() => new THREE.Matrix4().makeTranslation(0, -OCLUSOR_ABAJO, 0), [])

  const render = useCallback(() => {
    // Sin el relieve en el pase de picking no hay nada contra qué ocluir: una
    // vía detrás de una montaña se seleccionaría igual que una visible. Mismo
    // criterio que las anclas del shader -- si no aparece, esto debe reventar
    // ruidosamente, no dar picking sin oclusión en silencio. El grupo lo
    // nombra TerrainLod.tsx.
    const terrainObj = scene.getObjectByName('terrain')
    if (!terrainObj) {
      throw new Error('PickingPass: no se encontró el grupo "terrain" en la escena -- el picking quedaría sin oclusión del relieve')
    }
    if (!oclusores.parent) pickScene.add(oclusores)
    oclusores.clear()
    terrainObj.updateMatrixWorld()
    const caja = new THREE.Box3()
    for (const nodo of terrainObj.children) {
      if (!(nodo as THREE.Mesh).isMesh || !nodo.visible) continue
      const geometry = (nodo as THREE.Mesh).geometry
      const depthMesh = new THREE.Mesh(geometry, depthMaterial)
      depthMesh.frustumCulled = false
      depthMesh.matrixAutoUpdate = false
      depthMesh.matrix.copy(nodo.matrixWorld).premultiply(bajada)
      // Objetos opacos con el mismo renderOrder three.js los ordena por
      // material.id (WebGLRenderLists.js: painterSortStable), no por
      // profundidad: sin esto la vía escribiría su color antes de que el
      // terreno "gane" el depth test y solo actualice profundidad
      // (colorWrite:false no borra lo ya pintado). renderOrder negativo
      // fuerza que el relieve se dibuje primero pase lo que pase.
      depthMesh.renderOrder = -1
      oclusores.add(depthMesh)
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      caja.union(geometry.boundingBox!.clone().applyMatrix4(nodo.matrixWorld))
    }

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
    // `caja` es la unión de los nodos visibles, ya en mundo.
    const bb = caja.isEmpty() ? new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)) : caja
    camera.updateMatrixWorld()
    let minViewDist = Infinity
    let maxViewDist = -Infinity
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(
        i & 1 ? bb.max.x : bb.min.x,
        i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z,
      )
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

    // El mismo acercamiento que el pase visible mide en cada cuadro
    // (Roads.tsx), calculado acá y no guardado desde allá: este render corre
    // por clic, no por cuadro, y leer la cámara viva es una operación contra
    // un estado compartido que puede quedar desfasado.
    const objetivo = (controls as { target?: THREE.Vector3 } | null)?.target
    const distancia = objetivo ? camera.position.distanceTo(objetivo) : camera.position.length()
    ;(pickLine.material as LineMaterial).uniforms.uMpp.value =
      metrosPorPixel(distancia, (camera as THREE.PerspectiveCamera).fov ?? 45, size.height)

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
  }, [gl, scene, camera, target, pickScene, pickLine, bajada, depthMaterial, oclusores, controls, size.height])

  const pickAt = useCallback((x: number, y: number): number | null => {
    render()
    // Se lee un cuadrado alrededor del cursor y gana la vía más cercana, no el
    // texel exacto de debajo. Un texel suelto exige que el clic caiga dentro
    // del ancho de la línea en el id buffer, y a vista de estado una vía mide
    // 2 px con 130 m de terreno por píxel: fallar por dos píxeles era lo
    // normal, y un clic fallido no es inocuo -- limpia la selección. Con el
    // radio, la tolerancia deja de depender de acertarle a un trazo fino.
    const r = RADIO_CLIC
    const cx = Math.round(x)
    // readRenderTargetPixels cuenta desde abajo-izquierda; el mouse, desde
    // arriba-izquierda.
    const cy = Math.round(size.height - y)
    const x0 = Math.max(0, cx - r)
    const y0 = Math.max(0, cy - r)
    const w = Math.min(size.width - x0, cx + r + 1 - x0)
    const h = Math.min(size.height - y0, cy + r + 1 - y0)
    if (w <= 0 || h <= 0) return null
    const buf = new Uint8Array(w * h * 4)
    gl.readRenderTargetPixels(target, x0, y0, w, h, buf)
    let mejor: number | null = null
    let mejorDist = Infinity
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const o = (row * w + col) * 4
        const id = decodeId(buf[o], buf[o + 1], buf[o + 2])
        if (id === 0) continue
        const dx = x0 + col - cx, dy = y0 + row - cy
        const d = dx * dx + dy * dy
        if (d < mejorDist) { mejorDist = d; mejor = id - 1 }
      }
    }
    return mejor
  }, [gl, target, render, size.height, size.width])

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
