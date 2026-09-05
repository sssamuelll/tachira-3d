import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Sky } from './scene/Sky'

export default function App () {
  const [date] = useState(() => new Date('2026-09-05T14:00:00Z'))
  return (
    <Canvas camera={{ position: [0, 40000, 60000], near: 10, far: 2_000_000, fov: 45 }}>
      <Suspense fallback={null}>
        <Sky date={date} />
        <OrbitControls maxDistance={400000} />
      </Suspense>
    </Canvas>
  )
}
