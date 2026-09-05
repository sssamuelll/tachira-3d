import { useMemo, useCallback, useEffect } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree } from '@react-three/fiber'

export const encodeId = (i: number): [number, number, number] =>
  [(i >> 16) & 255, (i >> 8) & 255, i & 255]

export const decodeId = (r: number, g: number, b: number): number =>
  (r << 16) | (g << 8) | b

// Más ancho que el pase visible (2 px, Roads.tsx): da tolerancia de clic sobre
// una vía fina. Demasiado ancho y las vías paralelas se tapan entre sí en el
// id buffer. Calibrable -- ver task-16-report.md para el valor probado.
export const PICK_WIDTH = 8

function patchPickMaterial (material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('void main() {', `
      attribute float segId;
      varying float vSegId;
      void main() {
        vSegId = segId;
    `)
    // Mismo ancla que roadsShader.ts, y por la misma razón: en three@0.185.1
    // el main() del fragment abre con `float alpha = opacity;` y arma
    // diffuseColor con esa variable local -- el string de versiones viejas
    // (`vec4( diffuse, opacity )`) no existe acá. Verificado leyendo
    // node_modules/three/examples/jsm/lines/LineMaterial.js:337-338. Si un
    // three futuro cambia este shader, esto debe reventar, no dar un picking
    // mudo que nunca selecciona nada.
    const ancla = 'vec4 diffuseColor = vec4( diffuse, alpha );'
    if (!shader.fragmentShader.includes(ancla)) {
      throw new Error('PickingPass: no se encontró el ancla del fragment shader de LineMaterial')
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vSegId;\nvoid main() {')
      .replace(ancla, `
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
  { positions, segIds }: { positions: Float32Array; segIds: Float32Array },
) {
  const { gl, camera, size } = useThree()

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
    patchPickMaterial(material)
    const pickLine = new LineSegments2(geometry, material)
    pickLine.frustumCulled = false     // el bbox de una geometría instanciada no es fiable (Roads.tsx)
    const pickScene = new THREE.Scene()
    pickScene.add(pickLine)
    return { pickScene, pickLine }
  }, [positions, segIds])

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

  const render = useCallback(() => {
    const prevTarget = gl.getRenderTarget()
    const prevTone = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping
    gl.setRenderTarget(target)
    gl.setClearColor(0x000000, 1)
    gl.clear()
    gl.render(pickScene, camera)
    gl.setRenderTarget(prevTarget)
    gl.toneMapping = prevTone
  }, [gl, camera, target, pickScene])

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
