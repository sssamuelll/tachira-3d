import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Sky } from './scene/Sky'
import { Terrain } from './scene/Terrain'
import { Roads } from './scene/Roads'
import { FlyTo } from './scene/Camera'
import { usePicking } from './scene/PickingPass'
import { LassoOverlay, pointInLasso, type Pt } from './ui/LassoOverlay'
import { loadAll } from './data/load'
import { BBOX } from './data/constants'
import { AttrStore } from './data/store'
import { AttrTexture } from './data/attrTexture'

type Data = Awaited<ReturnType<typeof loadAll>>
// Forma real de lo que devuelve usePicking (Task 16): pickAt para el clic,
// pickRegion para el lazo. Derivado del propio hook -- retipiarlo a mano se
// desincroniza en silencio si PickingPass.tsx cambia la forma del retorno.
type PickerApi = ReturnType<typeof usePicking>

// Traduce el clic del DOM a un id de vía a través del id buffer (Task 16) y
// se lo pasa a App. Vive dentro de <Canvas> porque usePicking necesita
// gl/camera/size de useThree(). Además sube {pickAt, pickRegion} a un ref que
// sostiene App (Task 17, Ruling 3 del plan): el lazo se dibuja fuera del
// Canvas, en un SVG superpuesto (LassoOverlay.tsx) sin ningún padre común en
// el árbol de React salvo App -- el ref es el único puente entre los dos.
function Picker (
  { positions, segIds, onPick, pickerRef }:
  {
    positions: Float32Array; segIds: Float32Array
    onPick: (i: number | null, add: boolean) => void
    pickerRef: RefObject<PickerApi | null>
  },
) {
  const { pickAt, pickRegion } = usePicking({ positions, segIds })
  const { gl } = useThree()

  useEffect(() => { pickerRef.current = { pickAt, pickRegion } }, [pickerRef, pickAt, pickRegion])

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
  const [lassoOn, setLassoOn] = useState(false)
  // Único puente entre el SVG del lazo (fuera del Canvas) y pickRegion
  // (dentro): <Picker> lo rellena en un useEffect al montarse/actualizarse.
  const pickerRef = useRef<PickerApi | null>(null)
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

  // El lazo siempre agrega (como el shift-clic), nunca reemplaza la
  // selección previa. El readback ocurre acá, al soltar -- nunca durante el
  // arrastre, que en LassoOverlay solo dibuja el polígono en SVG (gratis).
  const onLassoFinish = useCallback((pts: Pt[]) => {
    const picker = pickerRef.current
    if (!picker) { console.warn('lazo: pickRegion aún no está listo, se ignora este trazo'); return }
    const xs = pts.map(p => p.x)
    const ys = pts.map(p => p.y)
    // bbox en enteros de píxel de pantalla, acotado al viewport: un arrastre
    // que sale de la ventana (el navegador sigue mandando mousemove fuera
    // del área cliente) no debe pedirle a pickRegion un buffer desproporcionado.
    const x0 = Math.max(0, Math.floor(Math.min(...xs)))
    const y0 = Math.max(0, Math.floor(Math.min(...ys)))
    const x1 = Math.min(window.innerWidth, Math.ceil(Math.max(...xs)))
    const y1 = Math.min(window.innerHeight, Math.ceil(Math.max(...ys)))
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    if (rect.w <= 0 || rect.h <= 0) return
    const ids = picker.pickRegion(rect, (px, py) => pointInLasso(px, py, pts))
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
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
      {/* zIndex 20, por encima del SVG del lazo (10): si no, en cuanto el lazo
          se activa su propio overlay tapa este botón y "clic para salir" deja
          de poder hacer clic en nada -- se detectó arrastrando de verdad en
          el navegador, no en los tests del predicado. */}
      <div style={{ position: 'fixed', top: 12, left: 12, zIndex: 20, display: 'flex', gap: 8 }}>
        <button onClick={() => setFlyTo(BBOX)}>Encuadrar Táchira</button>
        <button onClick={() => setLassoOn(o => !o)}>
          {lassoOn ? 'Lazo activo (clic para salir)' : 'Selección por lazo'}
        </button>
      </div>
      <Canvas camera={{ position: [0, 55000, 100000], near: 10, far: 2_000_000, fov: 45 }}>
        <Suspense fallback={null}>
          <Sky date={date} />
          <Terrain grid={data.terrainGrid} meta={data.terrain} />
          {attr && <Roads positions={data.positions} segIds={data.segIds} attr={attr} />}
          <Picker positions={data.positions} segIds={data.segIds} onPick={onPick} pickerRef={pickerRef} />
          {/* enabled=false mientras el lazo está activo: arrastrar para dibujar
              y arrastrar para orbitar son el mismo gesto -- si OrbitControls
              también escucha, el lazo sale torcido y la vista se mueve sola. */}
          <OrbitControls makeDefault maxDistance={400000} enabled={!lassoOn} />
          <FlyTo bbox={flyTo} />
        </Suspense>
      </Canvas>
      <LassoOverlay active={lassoOn} onFinish={onLassoFinish} />
    </>
  )
}
