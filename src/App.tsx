import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Sky } from './scene/Sky'
import { Terrain } from './scene/Terrain'
import { Roads } from './scene/Roads'
import { FlyTo, municipioBbox } from './scene/Camera'
import { usePicking } from './scene/PickingPass'
import { LassoOverlay, pointInLasso, type Pt } from './ui/LassoOverlay'
import { FilterPanel, EMPTY_FILTER, applyFilter } from './ui/FilterPanel'
import { EditPanel } from './ui/EditPanel'
import { CoverageBar } from './ui/CoverageBar'
import { loadAll } from './data/load'
import { BBOX } from './data/constants'
import { AttrStore } from './data/store'
import { AttrTexture } from './data/attrTexture'
import { isFsAccessSupported, pickFile, loadHandle, readJSON, downloadJSON, useAutosave } from './data/persist'
import type { Registro, Way } from './data/types'

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

// Camino compartido entre "cargar al arrancar" (loadHandle recordó el handle
// de una sesión previa) y "el usuario acaba de elegir el archivo con el
// botón" -- pickFile() puede apuntar a un pci-tachira.json que YA trae datos
// (el archivo se versiona en git a propósito, spec §9: abrirlo en un clon o
// un perfil de navegador nuevo, con IndexedDB vacío, es el caso normal, no
// uno raro). store.loadJSON() ya distingue huérfanos (ids que ya no existen
// en la red, no se borran) de inválidos (valores fuera de dominio,
// normalizados) -- acá solo se avisan por separado, sin fundirlos en un solo
// número que no diría qué pasó con cada uno.
async function cargarDesdeArchivo (h: FileSystemFileHandle, store: AttrStore, ways: Way[]) {
  let obj: unknown
  try { obj = await readJSON(h) } catch { return }   // archivo vacío/recién creado o ilegible: nada que cargar
  const { orphans, invalid } = store.loadJSON(obj as any, ways)
  if (orphans.length) console.warn(
    `pci-tachira.json: ${orphans.length} id(s) huérfano(s) -- ya no existen en la red vial ` +
    '(probablemente OSM partió esa vía). No se borraron del archivo, decide tú qué hacer con ellos:', orphans)
  if (invalid.length) console.warn(
    `pci-tachira.json: ${invalid.length} registro(s) con un valor fuera de rango -- se normalizaron ` +
    'a "sin dato" en su campo para no pintarse como si fueran válidos:', invalid)
}

export default function App () {
  const [data, setData] = useState<Data | null>(null)
  const [date] = useState(() => new Date('2026-09-05T14:00:00Z'))
  const [flyTo, setFlyTo] = useState<typeof BBOX | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [lassoOn, setLassoOn] = useState(false)
  const [filter, setFilter] = useState(EMPTY_FILTER)
  // Se incrementa en cada notify() del store -- onApply (Task 19, más abajo)
  // es el primer caller real de store.set() fuera de seedFromSurface().
  // applyFilter lee pci/fuente del store, no de `ways` -- sin este contador
  // el useMemo de la máscara de abajo no volvería a correr tras una edición
  // real: ni `store` (misma instancia) ni `filter` cambiarían.
  const [storeVersion, setStoreVersion] = useState(0)
  // Handle del archivo en disco (Task 21): null hasta que loadHandle() lo
  // recuerde de una sesión previa o el usuario lo elija con el botón. Vive
  // en React, no dentro de persist.ts, porque useAutosave (más abajo) tiene
  // que re-suscribirse cuando cambia, igual que ya hace con store/storeVersion.
  const [handle, setHandle] = useState<FileSystemFileHandle | null>(null)
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
    if (!store) return
    store.onChange(() => setStoreVersion(v => v + 1))
  }, [store])

  // Task 21: al arrancar, si hubo un archivo elegido en una sesión previa
  // (loadHandle lo recuerda en IndexedDB y re-pide permiso si el navegador lo
  // olvidó, persist.ts), se restaura. setHandle va al FINAL, después de
  // cargarDesdeArchivo -- no al principio -- porque ese propio loadJSON()
  // sube storeVersion (notify()): si el handle ya fuera visible para
  // useAutosave en ese momento, vería el handle nuevo y la subida de versión
  // juntos en la misma vuelta, y los tomaría por una edición real -- justo el
  // "se guardó solo por abrir la app" que el debounce existe para evitar
  // (visto de verdad trazando el orden de los effects, no a ojo). [store,
  // data] y no [] porque cargarDesdeArchivo necesita `ways` (de `data`) para
  // resolver los ids del JSON contra la red actual.
  useEffect(() => {
    if (!store || !data) return
    loadHandle().then(async h => {
      if (!h) return
      await cargarDesdeArchivo(h, store, data.roads.ways)
      setHandle(h)
    })
  }, [store, data])

  useAutosave(store, handle, storeVersion)

  // Panel de filtros (Task 18): un byte por vía, mismo índice que `ways` y
  // que la data texture. 26.712 elementos es barato (microsegundos) pero hay
  // que memoizar -- sin esto correría en cada render, varias veces por
  // pulsación de tecla. El conteo suma `way.km` (longitud cartográfica, el
  // valor convencional), no `km3d`.
  const { mask, count, km } = useMemo(() => {
    if (!data || !store) return { mask: null, count: 0, km: 0 }
    const ways = data.roads.ways
    const mask = applyFilter(ways, store, filter)
    let count = 0, km = 0
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 1) { count++; km += ways[i].km }
    }
    return { mask, count, km }
  }, [data, store, filter, storeVersion])

  // La selección (Task 16) es estado de interacción, no un dato de la vía:
  // se repinta como una máscara aparte en cada cambio, sin pasar por
  // store.set() (eso marcaría fecha/fuente como si fuera una edición real).
  // Sube junto con la máscara del filtro en un solo refresh(): si cada una
  // llamara a refresh() por su cuenta, la segunda pisaría a la primera con
  // los valores por defecto (todo visible, nada seleccionado).
  useEffect(() => {
    if (!store || !attr || !mask) return
    const selectedMask = new Uint8Array(store.length)
    for (const i of selected) selectedMask[i] = 1
    attr.refresh(mask, selectedMask)
  }, [store, attr, mask, selected])

  // number[] para EditPanel y para store.set(), que esperan un arreglo, no
  // el Set que onPick/onLassoFinish necesitan para add() en O(1). Memoizado
  // por la misma razón que la máscara del filtro (arriba): sin esto se
  // reconstruye en cada render -- varias veces por arrastre de un slider del
  // FilterPanel, que también vive en App y re-renderiza este componente.
  const selectionArray = useMemo(() => Array.from(selected), [selected])

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

  // Task 19: onApply es el único llamador de store.set() en la app. Le pasa
  // el lote entero de una (selectionArray), nunca un for por vía -- set() ya
  // normaliza y notifica una sola vez por lote (store.ts); con selecciones
  // de miles de elementos, notificar por elemento es la diferencia entre
  // instantáneo y colgado. Ese único notify() sube storeVersion (el
  // useEffect de arriba), lo que hace recalcular `mask` (el useMemo de
  // arriba) y en cadena dispara el useEffect de refresh() con el mask y el
  // selected ya vigentes -- repinta sin perder ni el filtro ni la selección.
  // No hace falta otro onChange ni un refresh() manual acá.
  const onApply = useCallback((patch: Partial<Registro>) => {
    if (!store) return
    store.set(selectionArray, patch)
  }, [store, selectionArray])

  // "Seleccionar todo lo filtrado" es el camino principal de edición masiva
  // (26.712 vías, Task 19): arma la selección directo desde `mask`, ya
  // calculado por el useMemo de arriba -- no vuelve a filtrar.
  const onSelectAllFiltered = useCallback(() => {
    if (!mask) return
    const next = new Set<number>()
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) next.add(i)
    setSelected(next)
  }, [mask])

  // Task 20: Way.municipio y Municipio.name son el mismo string (build-data.mjs
  // los siembra desde la misma relación de OSM) -- un Map una sola vez por
  // carga de datos evita recorrer las 29 municipios por cada clic en la barra.
  const municipioPorNombre = useMemo(() => {
    if (!data) return null
    return new Map(data.municipios.map(m => [m.name, m]))
  }, [data])

  // CoverageBar (Task 20) ordena los 29 municipios por avance ascendente y
  // pulsar uno debe hacer dos cosas a la vez: acotar el filtro a ese municipio
  // (mismo campo que ya usa FilterPanel) y volar la cámara a su bbox. Update
  // funcional de `filter` (no `{ ...filter, municipio }` cerrado sobre el
  // filter del render en que se creó este callback) para no pisar en silencio
  // los demás campos que el usuario haya tocado desde entonces -- mismo motivo
  // que onPick (arriba) usa `setSelected(prev => ...)`.
  const onPickMunicipio = useCallback((nombre: string) => {
    setFilter(f => ({ ...f, municipio: nombre }))
    const m = municipioPorNombre?.get(nombre)
    if (m) setFlyTo(municipioBbox(m))
  }, [municipioPorNombre])

  // Task 21: único llamador de pickFile() en la app. El propio diálogo puede
  // apuntar a un pci-tachira.json ya existente (ver cargarDesdeArchivo,
  // arriba de App) -- por eso también intenta cargarlo, no solo conecta el
  // handle en blanco. Cancelar el diálogo rechaza con AbortError: no es un
  // error real (ningún dato se tocó todavía), así que no se reporta; otro
  // rechazo (ej. permiso denegado) sí, porque ese sí puede explicar por qué
  // "no pasó nada" al pulsar el botón.
  const onPickFile = useCallback(async () => {
    if (!store || !data) return
    let h: FileSystemFileHandle | null = null
    try { h = await pickFile() } catch (e) {
      if ((e as any)?.name !== 'AbortError') console.error('no se pudo elegir el archivo', e)
    }
    if (!h) return
    await cargarDesdeArchivo(h, store, data.roads.ways)
    setHandle(h)
  }, [store, data])

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
        {/* Task 21: Firefox no implementa la File System Access API (spec
            §9) -- isFsAccessSupported() decide en cada render cuál de los
            dos botones mostrar, para que ahí la app no se rompa, solo pierda
            el autoguardado directo a disco y caiga a descargar el archivo. */}
        {isFsAccessSupported() ? (
          <button onClick={onPickFile} title="Elegir o cambiar el pci-tachira.json donde se autoguarda">
            {handle ? `archivo: ${handle.name}` : 'archivo de datos'}
          </button>
        ) : (
          <button onClick={() => store && downloadJSON(store.toJSON())}
            title="Este navegador no soporta guardar directo a disco -- descarga el archivo y reemplaza pci-tachira.json a mano">
            descargar datos
          </button>
        )}
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
      <FilterPanel ways={data.roads.ways} filter={filter} onChange={setFilter} count={count} km={km} />
      {/* Fix round 1 (Task 20): EditPanel y CoverageBar ya no calculan su
          propia coordenada para no solaparse -- un left calculado a mano
          (16 + ancho de EditPanel + separación) se desincronizaba en
          silencio si cualquiera de los dos cambiaba de tamaño, y así se
          coló un solape real de 10px, invisible porque ambos comparten el
          mismo fondo casi opaco (encontrado con getBoundingClientRect(), no
          a ojo). Este contenedor los reparte con flex: EditPanel fijo
          (flexShrink:0, en su propio estilo), CoverageBar toma el resto
          (flex:1). pointerEvents:'none' acá y 'auto' en cada panel (sus
          propios estilos) para que el hueco entre los dos y el margen a la
          derecha sigan dejando pasar el lazo y el clic sobre el lienzo --
          sin esto la franja inferior entera dejaría de responder al lazo.
          alignItems:'flex-end' para que ambos compartan el borde inferior
          aunque EditPanel crezca hacia arriba con la selección. */}
      <div style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 20,
        display: 'flex', alignItems: 'flex-end', gap: 16, pointerEvents: 'none',
      }}>
        <EditPanel
          selection={selectionArray} filteredCount={count}
          onApply={onApply} onSelectAllFiltered={onSelectAllFiltered}
        />
        {store && <CoverageBar store={store} version={storeVersion} onPick={onPickMunicipio} />}
      </div>
    </>
  )
}
