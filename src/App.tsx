import { Suspense, useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Sky } from './scene/Sky'
import { Terrain } from './scene/Terrain'
import { Roads } from './scene/Roads'
import { FlyTo } from './scene/Camera'
import { loadAll } from './data/load'
import { BBOX } from './data/constants'
import { AttrStore } from './data/store'
import { AttrTexture } from './data/attrTexture'

type Data = Awaited<ReturnType<typeof loadAll>>

export default function App () {
  const [data, setData] = useState<Data | null>(null)
  const [date] = useState(() => new Date('2026-09-05T14:00:00Z'))
  const [flyTo, setFlyTo] = useState<typeof BBOX | null>(null)
  useEffect(() => { loadAll().then(setData) }, [])

  // Store y textura de atributos (Task 14) se crean una sola vez por carga de
  // datos: 26.712 registros viven fuera de React a propósito (ver store.ts),
  // la escena los relee vía onChange, no por re-render de componentes.
  const { store, attr } = useMemo(() => {
    if (!data) return { store: null, attr: null }
    const s = new AttrStore(data.roads.ways)
    const sembradas = s.seedFromSurface()
    console.log(`${sembradas} vías con tipo sembrado desde surface`)
    return { store: s, attr: new AttrTexture(s) }
  }, [data])

  useEffect(() => {
    if (!store || !attr) return
    store.onChange(() => attr.refresh())
  }, [store, attr])

  if (!data) return <div style={{ padding: 24 }}>cargando datos del Táchira…</div>

  // el terreno vive en ENU local centrado en ORIGIN (bbox ~147×129 km,
  // Task 11): [0, 55000, 100000] queda a ~114 km del centroide, ~29° sobre
  // el horizonte. Verificado visualmente (ver task-11-report.md): a ese
  // ángulo se ve el relieve completo con buen contraste hipsométrico. Dos
  // alternativas probadas y descartadas — a 90 km de altura (fuera del
  // topRadius de 60 km de la atmósfera precalculada,
  // AtmosphereParameters.ts) el cielo sale apagado; a 12° de rasante sobre
  // el horizonte la neblina de AerialPerspective satura el terreno entero.
  return (
    <>
      <button
        onClick={() => setFlyTo(BBOX)}
        style={{ position: 'fixed', top: 12, left: 12, zIndex: 1 }}
      >
        Encuadrar Táchira
      </button>
      <Canvas camera={{ position: [0, 55000, 100000], near: 10, far: 2_000_000, fov: 45 }}>
        <Suspense fallback={null}>
          <Sky date={date} />
          <Terrain grid={data.terrainGrid} meta={data.terrain} />
          {attr && <Roads positions={data.positions} segIds={data.segIds} attr={attr} />}
          <OrbitControls makeDefault maxDistance={400000} />
          <FlyTo bbox={flyTo} />
        </Suspense>
      </Canvas>
    </>
  )
}
