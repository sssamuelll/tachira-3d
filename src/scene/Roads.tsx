import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree, useFrame } from '@react-three/fiber'
import { patchLineMaterial } from './roadsShader'
import { direccionSol } from './sol'
import { NIVELES, repartirPorNivel, metrosPorPixel, presencia } from './roadStyle'
import { anchoCalzada, carrilesDe, sentidoUnico, marcasPermitidas } from './calzada'
import { ATTR_SIZE } from '../data/constants'
import type { AttrTexture } from '../data/attrTexture'
import type { Way } from '../data/types'

// Ya no hay alza en metros desde acá: la calzada se levanta ERROR_PX píxeles
// en el vertex shader, por vértice, y se inclina con la normal del terreno
// (roadsShader.ts, extrusionGlsl). Es la misma cifra con la que el relieve
// decide cuánto refinar (quadtree.ts).

export function Roads (
  { positions, segIds, index, ways, attr, normals, date }: {
    positions: Float32Array; segIds: Float32Array; index: Uint32Array
    ways: Way[]; attr: AttrTexture
    /** Normal del terreno en cada extremo de tramo (roads-nrm.bin). */
    normals: Int8Array
    /** Fecha de la escena: de ella sale la dirección del sol (sol.ts). */
    date: Date
  },
) {
  const { size, camera, controls } = useThree()
  // Dirección HACIA el sol en ejes del mundo, la misma que ilumina el relieve.
  // La fecha no cambia mientras la app corre, así que se calcula una vez.
  const sol = useMemo(() => direccionSol(date), [date])

  // Un objeto por nivel de jerarquía y no uno solo para toda la red: el piso
  // en píxeles y la presencia son del nivel, y el orden de dibujo también. El
  // reparto recorre los 450.261 segmentos una vez por carga (roadStyle.ts).
  // Ancho de calzada y canales de cada vía: el ancho es lo que el vertex
  // shader extruye en metros (roadsShader.ts), y los canales dicen cuántas
  // separaciones pintar, si lleva eje de doble sentido y si lleva flechas. El
  // signo de `canales` carga el sentido (negativo = sentido único) y el 0
  // significa "sin marcas" -- una trocha de tierra o un camino peatonal no
  // tienen pintura que dibujar.
  const porVia = useMemo(() => {
    const anchos = new Float32Array(ways.length)
    const canales = new Float32Array(ways.length)
    for (let i = 0; i < ways.length; i++) {
      anchos[i] = anchoCalzada(ways[i])
      canales[i] = marcasPermitidas(ways[i])
        ? carrilesDe(ways[i]) * (sentidoUnico(ways[i]) ? -1 : 1)
        : 0
    }
    return [anchos, canales]
  }, [ways])

  const objetos = useMemo(() => repartirPorNivel(positions, segIds, index, ways, porVia, normals).map(t => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(t.positions)
    geometry.setAttribute('segId', new THREE.InstancedBufferAttribute(t.segIds, 1))
    // Normal del terreno por extremo, Int8 normalizado: el shader la lee en
    // [-1, 1] y extruye la calzada en el plano de la ladera.
    const nrmBuf = new THREE.InstancedInterleavedBuffer(t.normales, 6, 1)
    geometry.setAttribute('instanceNormalStart', new THREE.InterleavedBufferAttribute(nrmBuf, 3, 0, true))
    geometry.setAttribute('instanceNormalEnd', new THREE.InterleavedBufferAttribute(nrmBuf, 3, 3, true))
    geometry.setAttribute('aCalzada', new THREE.InstancedBufferAttribute(t.extras[0], 1))
    geometry.setAttribute('aCanales', new THREE.InstancedBufferAttribute(t.extras[1], 1))
    // La distancia recorrida a lo largo del trazo le da fase a las rayas
    // discontinuas. Se ponen a mano con los nombres que usa el modo dash de
    // LineMaterial, pero SIN activarlo: ese modo trae su propio patrón y
    // descarta las tapas que cierran las curvas entre tramo y tramo.
    geometry.setAttribute('instanceDistanceStart', new THREE.InstancedBufferAttribute(t.d0, 1))
    geometry.setAttribute('instanceDistanceEnd', new THREE.InstancedBufferAttribute(t.d1, 1))

    // Contorno y relleno comparten la MISMA geometría (no una copia): son el
    // mismo trazo dibujado dos veces con otro ancho y otro color.
    const capas = [true, false].map(casing => {
      // worldUnits: false a propósito, aunque el ancho vaya en metros: el
      // parche sustituye el bloque de pantalla de three, no activa su modo de
      // mundo (roadsShader.ts, extrusionGlsl).
      const material = new LineMaterial({ worldUnits: false, transparent: true, depthWrite: false })
      patchLineMaterial(material, attr.texture, ATTR_SIZE, casing)
      const linea = new LineSegments2(geometry, material)
      // Todos los contornos de un nivel van antes que sus rellenos, y un nivel
      // entero antes que el siguiente: así una troncal cruza una calle con su
      // propio borde limpio, en vez de que la calle le pise el color. Sin
      // esto, three ordena los transparentes por distancia a la cámara y el
      // orden cambia solo al orbitar.
      linea.renderOrder = t.nivel * 2 + (casing ? 0 : 1)
      // El bbox de una geometría instanciada no es fiable, y esto cubre el
      // estado entero de todos modos (mismo criterio que Terrain.tsx).
      linea.frustumCulled = false
      return { material, linea }
    })

    return { nivel: NIVELES[t.nivel], casing: capas[0], relleno: capas[1] }
  }), [positions, segIds, index, ways, attr, porVia, normals])

  // El vertex shader necesita el alto del lienzo para convertir el piso en
  // píxeles a metros en cada vértice (roadsShader.ts).
  useEffect(() => {
    for (const o of objetos) {
      o.casing.material.resolution.set(size.width, size.height)
      o.relleno.material.resolution.set(size.width, size.height)
    }
  }, [objetos, size])

  // La presencia de cada nivel depende de cuánto terreno cabe en un píxel, así
  // que se recalcula mientras la cámara se mueve. Son unas pocas asignaciones
  // de float por cuadro: más barato que detectar si la cámara se movió.
  useFrame(() => {
    // El objetivo de OrbitControls es el punto que se está mirando; sin
    // controles montados todavía, la distancia al origen del ENU local sirve
    // igual (el terreno está centrado ahí).
    const objetivo = (controls as { target?: THREE.Vector3 } | null)?.target
    const distancia = objetivo ? camera.position.distanceTo(objetivo) : camera.position.length()
    const mpp = metrosPorPixel(distancia, (camera as THREE.PerspectiveCamera).fov ?? 45, size.height)
    for (const o of objetos) {
      const alpha = presencia(o.nivel, mpp)
      // Un nivel apagado no se dibuja en absoluto, en vez de dibujarse con
      // opacidad 0: son dos draw calls de decenas de miles de segmentos que a
      // vista de estado no aportan un solo píxel. El pase de ids descarta los
      // mismos por el mismo corte (PickingPass.tsx).
      o.relleno.linea.visible = alpha > 0
      o.casing.linea.visible = alpha > 0
      // La opacidad del material es la base que el shader multiplica por el
      // foco y la selección (roadsShader.ts), así que el desvanecimiento por
      // acercamiento se compone con los otros dos sin tocar el GLSL.
      o.relleno.material.opacity = alpha
      o.casing.material.opacity = alpha
      // El ancho ya no se fija acá: lo extruye el vertex shader en metros, con
      // el piso en píxeles del nivel evaluado en cada vértice (roadsShader.ts).
      // Solo hay que decirle el piso; `resolution` ya la pone el efecto de
      // arriba.
      for (const capa of [o.relleno, o.casing]) {
        const u = capa.material.userData.uniforms
        if (u) u.uPisoPx.value = o.nivel.pisoPx
        // La dirección del sol, si el shader de la calzada la pide. El `if`
        // no es defensivo de más: uSol lo declara roadsShader.ts, que es de
        // otra rama, y hasta que esa rama entre este uniform no existe.
        // Alimentarlo desde acá y no desde el parche del shader es a
        // propósito: el sol es de la escena, no del asfalto.
        if (u?.uSol) u.uSol.value.copy(sol)
      }
    }
  })

  return (
    <group>
      {objetos.map(o => (
        <group key={o.nivel.clave}>
          <primitive object={o.casing.linea} />
          <primitive object={o.relleno.linea} />
        </group>
      ))}
    </group>
  )
}
