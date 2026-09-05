import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree } from '@react-three/fiber'
import { patchLineMaterial } from './roadsShader'
import { ATTR_SIZE } from '../data/constants'
import type { AttrTexture } from '../data/attrTexture'

export function Roads (
  { positions, segIds, attr }: { positions: Float32Array; segIds: Float32Array; attr: AttrTexture },
) {
  const { size } = useThree()

  const object = useMemo(() => {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(positions)
    geometry.setAttribute('segId', new THREE.InstancedBufferAttribute(segIds, 1))

    const material = new LineMaterial({
      linewidth: 2, worldUnits: false, transparent: true, depthWrite: false,
    })
    patchLineMaterial(material, attr.texture, ATTR_SIZE)

    const line = new LineSegments2(geometry, material)
    // LineSegmentsGeometry.computeBoundingBox() sí es fiable (itera
    // instanceStart/instanceEnd reales) -- se desactiva el cull igual porque
    // esto es un solo objeto que cubre el bbox completo del Táchira (igual
    // que Terrain.tsx): a esa escala el cull es todo-o-nada y casi nunca
    // ahorra nada real (si el terreno está en cámara, casi siempre una parte
    // de la red vial también), así que no vale el riesgo de un caso límite
    // del bounding volume borrando la red entera del mapa.
    line.frustumCulled = false
    return line
  }, [positions, segIds, attr])

  // LineMaterial necesita saber el tamaño del lienzo para calcular el ancho en píxeles
  useEffect(() => {
    ;(object.material as LineMaterial).resolution.set(size.width, size.height)
  }, [object, size])

  return <primitive object={object} />
}
