import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { makeEnuFrame, geodeticToEnu } from '../data/enu'
import { ORIGIN } from '../data/constants'

const frame = makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)

// Ejes del mundo: X=este, Y=arriba, Z=-norte (igual que Terrain.tsx y
// scripts/lib/pack.mjs) -- geodeticToEnu ya devuelve [e, n, u].
export function enuOf (lat: number, lon: number, h = 0) {
  const [e, n, u] = geodeticToEnu(frame, lat, lon, h)
  return new THREE.Vector3(e, u, -n)
}

export function bboxCenterAndSpan (bbox: { s: number; w: number; n: number; e: number }) {
  const a = enuOf(bbox.s, bbox.w), b = enuOf(bbox.n, bbox.e)
  return { center: a.clone().add(b).multiplyScalar(0.5), span: a.distanceTo(b) }
}

/** Encuadra un bbox geodésico moviendo cámara y target de OrbitControls. */
export function FlyTo ({ bbox }: { bbox: { s: number; w: number; n: number; e: number } | null }) {
  const { camera, controls: rawControls } = useThree()
  // controls tipa en RootState como THREE.EventDispatcher | null -- sin
  // .target/.update() del OrbitControlsImpl real de drei. any acotado solo
  // a esto; camera ya tipa bien por si solo (Ortho|PerspectiveCamera).
  const controls = rawControls as any
  useEffect(() => {
    if (!bbox) return
    const { center, span } = bboxCenterAndSpan(bbox)
    camera.position.set(center.x, center.y + span * 0.7, center.z + span * 0.9)
    camera.updateProjectionMatrix()
    if (controls) { controls.target.copy(center); controls.update() }
  }, [bbox, camera, controls])
  return null
}
