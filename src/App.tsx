import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Sky } from './scene/Sky'

export default function App () {
  const [date] = useState(() => new Date('2026-09-05T14:00:00Z'))
  return (
    // posición provisional: a este radio (~72 km del origen ECEF) la cámara
    // queda dentro del elipsoide sólido (radio real ~6.371 km) porque la
    // escena todavía no está rebasada a ENU — por eso la pantalla se ve
    // negra. La Task 11 la reemplaza al introducir el terreno y el rebase.
    <Canvas camera={{ position: [0, 40000, 60000], near: 10, far: 2_000_000, fov: 45 }}>
      <Suspense fallback={null}>
        <Sky date={date} />
        <OrbitControls maxDistance={400000} />
      </Suspense>
    </Canvas>
  )
}
