import { useMemo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree, useFrame } from '@react-three/fiber'
import { patchLineMaterial, SOMBRA_VACIA } from './roadsShader'
import { TEXTURAS, TEXTURAS_BASE, type Asfalto } from './asfalto'
import { direccionSol, CASCADA_CERCA } from './sol'
import { avanzarMojado } from './mojado'
import { NIVELES, repartirPorNivel, metrosPorPixel, presencia } from './roadStyle'
import { distanciaVista } from './distanciaVista'
import { anchoCalzada, carrilesDe, sentidoUnico, marcasPermitidas } from './calzada'
import { bordeDe } from './seccion'
import { ATTR_SIZE } from '../data/constants'
import type { AttrTexture } from '../data/attrTexture'
import type { Way } from '../data/types'

// Ya no hay alza en metros desde acá: la calzada se levanta ERROR_PX píxeles
// en el vertex shader, por vértice, y se inclina con la normal del terreno
// (roadsShader.ts, extrusionGlsl). Es la misma cifra con la que el relieve
// decide cuánto refinar (quadtree.ts).

export function Roads (
  { positions, segIds, index, ways, attr, normals, date, lluvia }: {
    positions: Float32Array; segIds: Float32Array; index: Uint32Array
    ways: Way[]; attr: AttrTexture
    /** Normal del terreno en cada extremo de tramo (roads-nrm.bin). */
    normals: Int8Array
    /** Fecha de la escena: de ella sale la dirección del sol (sol.ts). */
    date: Date
    /** Calzada mojada: charcos en las huellas y en los baches (mojado.ts). */
    lluvia: boolean
  },
) {
  const { size, camera, controls, gl, scene } = useThree()
  // Dirección HACIA el sol en ejes del mundo, la misma que ilumina el relieve.
  // La fecha no cambia mientras la app corre, así que se calcula una vez.
  const sol = useMemo(() => direccionSol(date), [date])

  // Cuánto se mojó la calzada, entre 0 y 1. Vive en un ref y no en estado de
  // React a propósito: cambia en cada cuadro durante segundo y medio y lo único
  // que lo lee es un uniform. Por estado serían noventa re-renders del árbol
  // entero para escribir un float.
  const mojado = useRef(0)

  // La cascada de sombra más cercana, dueña del shadow map que la calzada
  // muestrea para no salir a pleno sol dentro de la sombra del relieve
  // (asfalto.ts, sombraSol). La crea TerrainLod.tsx dentro de un efecto y le
  // pone el nombre; acá se busca cada cuadro hasta encontrarla y después nunca
  // más, igual que TerrainLod hace con el <SunLight> de takram.
  const cascada = useRef<THREE.DirectionalLight | null>(null)

  // Los tres mapas del asfalto (ambientCG Asphalt006, CC0 -- ver el LICENSE.md
  // de public/texturas/asfalto). Se cargan UNA vez para toda la red: los siete
  // niveles y sus catorce materiales comparten los mismos objetos de textura,
  // así que son tres subidas a la GPU, no veintiuna.
  //
  // El albedo va en sRGB (three lo declara como SRGB8_ALPHA8 y el decodificado
  // lo hace el hardware al muestrear); normal y rugosidad van LINEALES, que es
  // lo que son: una dirección y un número, no colores. Confundirlos deja el
  // relieve del asfalto plano y la rugosidad corrida hacia lo mate.
  //
  // `listo` se sube a 1 cuando los tres están arriba. Hasta entonces el shader
  // no muestrea nada: un sampler sin textura devuelve NEGRO en WebGL, sin
  // error, y la calzada parpadearía en negro en el primer acercamiento.
  const asfalto: Asfalto = useMemo(() => {
    const listo = { value: 0 }
    let faltan = 3
    const cargador = new THREE.TextureLoader()
    const carga = (archivo: string, srgb: boolean) => {
      const t = cargador.load(TEXTURAS_BASE + archivo, () => { if (--faltan === 0) listo.value = 1 })
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      // La calzada se ve casi de canto en cuanto la cámara baja: sin
      // anisotropía el árido se convierte en un borrón longitudinal justo a la
      // distancia en la que este trabajo tiene sentido. Pero tampoco al
      // máximo: cuando la relación de derivadas se pasa del tope, el filtrado
      // deja de compensar y submuestrea el eje corto, que en pantalla son
      // vetas a lo largo de la calzada. 8 cubre el ángulo útil sin llegar a
      // ese régimen; el resto lo resuelve el desvanecimiento por Nyquist del
      // shader (asfalto.ts, `nitidez`).
      t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
      return t
    }
    return {
      albedo: carga(TEXTURAS.albedo, true),
      normal: carga(TEXTURAS.normal, false),
      rough: carga(TEXTURAS.rough, false),
      listo,
    }
  }, [gl])

  // Un objeto por nivel de jerarquía y no uno solo para toda la red: el piso
  // en píxeles y la presencia son del nivel, y el orden de dibujo también. El
  // reparto recorre los 450.261 segmentos una vez por carga (roadStyle.ts).
  // Ancho de calzada y canales de cada vía: el ancho es lo que el vertex
  // shader extruye en metros (roadsShader.ts), y los canales dicen cuántas
  // separaciones pintar, si lleva eje de doble sentido y si lleva flechas. El
  // signo de `canales` carga el sentido (negativo = sentido único) y el 0
  // significa "sin marcas" -- una trocha de tierra o un camino peatonal no
  // tienen pintura que dibujar.
  // `bordes` es la sección transversal: metros de hombrillo o brocal a cada
  // lado, con el signo diciendo cuál de los dos (seccion.ts). Ensancha el
  // cuadrilátero en el vertex shader, así que tiene que llegar por vía y no por
  // nivel: dentro de un mismo nivel conviven la avenida con brocal y la
  // carretera con hombrillo.
  const porVia = useMemo(() => {
    const anchos = new Float32Array(ways.length)
    const canales = new Float32Array(ways.length)
    const bordes = new Float32Array(ways.length)
    for (let i = 0; i < ways.length; i++) {
      anchos[i] = anchoCalzada(ways[i])
      canales[i] = marcasPermitidas(ways[i])
        ? carrilesDe(ways[i]) * (sentidoUnico(ways[i]) ? -1 : 1)
        : 0
      bordes[i] = bordeDe(ways[i])
    }
    return [anchos, canales, bordes]
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
    geometry.setAttribute('aBorde', new THREE.InstancedBufferAttribute(t.extras[2], 1))
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
      // El asfalto solo va al relleno: el contorno es un borde oscuro de unos
      // píxeles, no una superficie, y texturizarlo serían tres samplers y un
      // Voronoi por fragmento para pintar el mismo gris.
      patchLineMaterial(material, attr.texture, ATTR_SIZE, casing, casing ? undefined : asfalto)
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
  }), [positions, segIds, index, ways, attr, porVia, normals, asfalto])

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
  useFrame((state, dt) => {
    // La lluvia no cae de un cuadro al otro: un salto de seco a mojado se lee
    // como un cambio de material y no como que empezó a llover (mojado.ts).
    mojado.current = avanzarMojado(mojado.current, lluvia ? 1 : 0, dt)
    // La misma superficie que mide la barra, aunque el pivote de la órbita
    // haya quedado bajo el terreno al panear.
    const objetivo = (controls as { target?: THREE.Vector3 } | null)?.target
    const distancia = distanciaVista(camera, scene, objetivo, state.clock.elapsedTime)
    const mpp = metrosPorPixel(distancia, (camera as THREE.PerspectiveCamera).fov ?? 45, size.height)

    // El shadow map de la cascada más cercana. `shadow.map` es null hasta el
    // primer pase de sombra, y lo que hay que pasar es su `depthTexture` y no
    // su `texture`: el DepthTexture es el que three crea con
    // compareFunction = LessEqualCompare, o sea el único que un sampler2DShadow
    // puede comparar en hardware (WebGLShadowMap.js). La matriz se pasa por
    // REFERENCIA: es la misma Matrix4 que three reescribe en cada pase de
    // sombra, y el pase de sombra corre al principio de renderer.render(),
    // antes de que se dibujen las vías. Los dos sesgos son los de la luz, para
    // que la calzada y el relieve comparen contra el mismo plano.
    if (!cascada.current) cascada.current = scene.getObjectByName(CASCADA_CERCA) as THREE.DirectionalLight | null
    const sombra = cascada.current?.shadow
    const mapaSombra = sombra?.map?.depthTexture ?? null

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
        if (!u) continue
        u.uPisoPx.value = o.nivel.pisoPx
        // La dirección del sol para el asfalto. uSol lo declara
        // roadsShader.ts en los dos materiales (asfalto.test.ts lo afirma);
        // alimentarlo desde acá y no desde el parche del shader es a
        // propósito: el sol es de la escena, no del asfalto.
        u.uSol.value.copy(sol)
        // También en el contorno, que no lo usa: el uniform existe en los dos
        // materiales (roadsShader.ts) justo para no tener que averiguar acá
        // cuál es cuál.
        u.uMojado.value = mojado.current
        // Mientras no hay mapa se deja el texel de relleno ligado y uSombraOn
        // en 0: un sampler2DShadow apuntando a nada -- o a la textura vacía de
        // three -- descarta la llamada de dibujo entera (ver SOMBRA_VACIA).
        u.uSombraMapa.value = mapaSombra ?? SOMBRA_VACIA
        u.uSombraOn.value = mapaSombra ? 1 : 0
        if (sombra) {
          u.uSombraMat.value = sombra.matrix
          u.uSombraNormalBias.value = sombra.normalBias
          u.uSombraSesgo.value = sombra.bias
        }
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
