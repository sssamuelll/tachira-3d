import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Sky } from './scene/Sky'
import { Terrain } from './scene/Terrain'
import { Roads } from './scene/Roads'
import { FlyTo } from './scene/Camera'
import { usePicking } from './scene/PickingPass'
import { loadAll } from './data/load'
import { BBOX } from './data/constants'
import { AttrStore } from './data/store'
import { AttrTexture } from './data/attrTexture'

type Data = Awaited<ReturnType<typeof loadAll>>

// Traduce el clic del DOM a un id de vía a través del id buffer (Task 16) y
// se lo pasa a App. Vive dentro de <Canvas> porque usePicking necesita
// gl/camera/size de useThree().
function ClickPicker (
  { positions, segIds, onPick }:
  { positions: Float32Array; segIds: Float32Array; onPick: (i: number | null, add: boolean) => void },
) {
  const { pickAt } = usePicking({ positions, segIds })
  const { gl } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const h = (ev: MouseEvent) => {
      const r = el.getBoundingClientRect()
      onPick(pickAt(ev.clientX - r.left, ev.clientY - r.top), ev.shiftKey)
    }
    el.addEventListener('click', h)
    return () => el.removeEventListener('click', h)
  }, [gl, pickAt, onPick])
  return null
}

export default function App () {
  const [data, setData] = useState<Data | null>(null)
  const [date] = useState(() => new Date('2026-09-05T14:00:00Z'))
  const [flyTo, setFlyTo] = useState<typeof BBOX | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
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

  // La selección (Task 16) es estado de interacción, no un dato de la vía:
  // se repinta como una máscara aparte en cada cambio, sin pasar por
  // store.set() (eso marcaría fecha/fuente como si fuera una edición real).
  useEffect(() => {
    if (!store || !attr) return
    const visibleMask = new Uint8Array(store.length).fill(1)
    const selectedMask = new Uint8Array(store.length)
    for (const i of selected) selectedMask[i] = 1
    attr.refresh(visibleMask, selectedMask)
  }, [store, attr, selected])

  // add=true (shift-clic) agrega; add=false reemplaza, y en el vacío limpia.
  const onPick = useCallback((i: number | null, add: boolean) => {
    setSelected(prev => {
      if (add) {
        if (i == null) return prev
        return new Set(prev).add(i)
      }
      return i == null ? new Set() : new Set([i])
    })
  }, [])

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
          <ClickPicker positions={data.positions} segIds={data.segIds} onPick={onPick} />
          <OrbitControls makeDefault maxDistance={400000} />
          <FlyTo bbox={flyTo} />
        </Suspense>
      </Canvas>
    </>
  )
}
