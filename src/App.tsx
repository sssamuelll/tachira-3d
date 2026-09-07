import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Sky } from './scene/Sky'
import { TerrainLod } from './scene/TerrainLod'
import { Roads } from './scene/Roads'
import { FlyTo, Vista, bboxCenterAndSpan, idsCenterAndSpan, type Encuadre, type ApiVista } from './scene/Camera'
import { usePicking } from './scene/PickingPass'
import { LassoOverlay, pointInLasso, type Pt } from './ui/LassoOverlay'
import { SearchPanel } from './ui/SearchPanel'
import { Ficha } from './ui/Ficha'
import { MapControls, BarraArchivo, BarraEscala } from './ui/MapControls'
import { MiniMapa } from './ui/MiniMapa'
import { indexar, buscar, type Resultado } from './ui/search'
import { T, nf } from './ui/theme'
import type { Escala } from './ui/escala'
import type { Mirilla } from './ui/disco'
import { loadAll } from './data/load'
import { BBOX } from './data/constants'
import { AttrStore } from './data/store'
import { AttrTexture } from './data/attrTexture'
import { isFsAccessSupported, pickFile, checkHandle, reconnectHandle, readJSON, downloadJSON, useAutosave } from './data/persist'
import type { Registro, Way } from './data/types'

type Data = Awaited<ReturnType<typeof loadAll>>
// Forma real de lo que devuelve usePicking (Task 16): pickAt para el clic,
// pickRegion para el lazo. Derivado del propio hook -- retiparlo a mano se
// desincroniza en silencio si PickingPass.tsx cambia la forma del retorno.
type PickerApi = ReturnType<typeof usePicking>

// Cuánto puede moverse el puntero entre presionar y soltar y seguir contando
// como clic. Calibrable: 5 px absorbe el temblor de una mano sobre un trackpad
// sin tragarse un clic deliberado (una órbita real mueve decenas de píxeles).
const UMBRAL_CLIC_PX = 5

// Traduce el clic del DOM a un id de vía a través del id buffer (Task 16) y se
// lo pasa a App. Vive dentro de <Canvas> porque usePicking necesita
// gl/camera/size de useThree(). Además sube {pickAt, pickRegion} a un ref que
// sostiene App: el lazo se dibuja fuera del Canvas, en un SVG superpuesto
// (LassoOverlay.tsx) sin ningún padre común en el árbol de React salvo App --
// el ref es el único puente entre los dos.
function Picker (
  { positions, segIds, ways, index, normals, onPick, pickerRef }:
  {
    positions: Float32Array; segIds: Float32Array
    ways: Way[]; index: Uint32Array; normals: Int8Array
    onPick: (i: number | null, add: boolean) => void
    pickerRef: RefObject<PickerApi | null>
  },
) {
  const { pickAt, pickRegion } = usePicking({ positions, segIds, ways, index, normals })
  const { gl } = useThree()

  useEffect(() => { pickerRef.current = { pickAt, pickRegion } }, [pickerRef, pickAt, pickRegion])

  useEffect(() => {
    const el = gl.domElement
    // Arrastrar para orbitar termina disparando `click` igual, en el punto
    // donde soltaste: sin umbral, mirar lo que acabas de seleccionar lo
    // borraba (el picking devuelve null sobre el terreno vacío y onPick con
    // add=false limpia). Visto de verdad en el navegador: 4.817 seleccionadas
    // -> una órbita -> nada. De paso ahorra un pase completo de picking por
    // cada órbita, que hoy se pagaba entero.
    let desde: { x: number; y: number } | null = null
    const onDown = (ev: PointerEvent) => { desde = { x: ev.clientX, y: ev.clientY } }
    const onClick = (ev: MouseEvent) => {
      if (desde && Math.hypot(ev.clientX - desde.x, ev.clientY - desde.y) > UMBRAL_CLIC_PX) return
      const r = el.getBoundingClientRect()
      onPick(pickAt(ev.clientX - r.left, ev.clientY - r.top), ev.shiftKey)
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('click', onClick)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('click', onClick)
    }
  }, [gl, pickAt, onPick])
  return null
}

// Armar la escena tarda decenas de segundos: un millón de vértices de relieve
// proyectados uno a uno a ENU, sus normales, y 450.261 segmentos de vía
// subidos a la GPU. Todo eso pasa DESPUÉS de que los datos llegaron, así que
// el "cargando" de la carga de red se apaga y quedan treinta segundos de
// pantalla vacía que se leen como que la aplicación se rompió. Este
// componente avisa cuando de verdad hay algo dibujado: useFrame no corre
// hasta que la escena está montada y r3f empezó su bucle.
function AvisaCuandoDibuja ({ onListo }: { onListo: () => void }) {
  const cuadros = useRef(0)
  useFrame(() => {
    // Al segundo cuadro, no al primero: el callback de useFrame corre ANTES
    // del render de ese cuadro, así que en el primero todavía no hay nada en
    // pantalla y el aviso se quitaría sobre un lienzo en blanco.
    cuadros.current++
    if (cuadros.current === 2) onListo()
  })
  return null
}

// Camino compartido entre "cargar al arrancar" (checkHandle recordó el handle
// de una sesión previa, con permiso vigente) y "el usuario acaba de elegir el
// archivo con el botón" -- pickFile() puede apuntar a un pci-tachira.json que
// YA trae datos (el archivo se versiona en git a propósito, spec §9: abrirlo
// en un clon o un perfil de navegador nuevo, con IndexedDB vacío, es el caso
// normal, no uno raro). store.loadJSON() ya distingue huérfanos (ids que ya no
// existen en la red, no se borran) de inválidos (valores fuera de dominio,
// normalizados) -- acá solo se avisan por separado, sin fundirlos en un solo
// número que no diría qué pasó con cada uno.
//
// 'ilegible' es su propio caso, no un null más: un archivo con contenido que
// no parsea NO se conecta para escritura -- si se conectara, la primera
// edición escribiría el store recién sembrado encima y borraría todo lo que
// había. El usuario ve el aviso, arregla la coma de más a mano y vuelve a
// elegir el archivo.
type AvisoCarga =
  | { tipo: 'ilegible'; detalle: string }
  | { tipo: 'carga'; orphans: number; invalid: number }

async function cargarDesdeArchivo (
  h: FileSystemFileHandle, store: AttrStore, ways: Way[],
): Promise<AvisoCarga | null> {
  let obj: unknown
  try { obj = await readJSON(h) } catch (e) {
    const detalle = (e as Error)?.message ?? String(e)
    console.error(`${h.name}: tiene contenido pero no se pudo leer como JSON -- no se conectó para escritura`, e)
    return { tipo: 'ilegible', detalle }
  }
  if (obj == null) return null    // archivo vacío/recién creado: nada que cargar
  const { orphans, invalid } = store.loadJSON(obj as any, ways)
  if (orphans.length) console.warn(
    `pci-tachira.json: ${orphans.length} id(s) huérfano(s) -- ya no existen en la red vial ` +
    '(probablemente OSM partió esa vía). No se borraron del archivo, decide tú qué hacer con ellos:', orphans)
  if (invalid.length) console.warn(
    `pci-tachira.json: ${invalid.length} registro(s) con un valor fuera de rango -- se normalizaron ` +
    'a "sin dato" en su campo para no pintarse como si fueran válidos:', invalid)
  if (!orphans.length && !invalid.length) return null
  return { tipo: 'carga', orphans: orphans.length, invalid: invalid.length }
}

function textoAviso (a: AvisoCarga | null): string | null {
  if (!a) return null
  if (a.tipo === 'ilegible') {
    return `El archivo tiene contenido pero no es JSON válido (${a.detalle}). No se conectó ` +
      'para escritura, para no sobrescribirlo: arréglalo a mano y vuelve a elegirlo.'
  }
  const partes: string[] = []
  if (a.orphans > 0) {
    partes.push(`${nf.format(a.orphans)} vía(s) del archivo ya no existen en la red. ` +
      'Se conservaron tal cual: decide tú qué hacer con ellas.')
  }
  if (a.invalid > 0) {
    partes.push(`${nf.format(a.invalid)} registro(s) traían un valor fuera de rango ` +
      'y quedaron como "sin dato" en ese campo.')
  }
  return partes.join(' ')
}

export default function App () {
  const [data, setData] = useState<Data | null>(null)
  const [date] = useState(() => new Date('2026-09-05T14:00:00Z'))
  const [objetivo, setObjetivo] = useState<Encuadre | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [lassoOn, setLassoOn] = useState(false)
  const [q, setQ] = useState('')
  // Clave del resultado de búsqueda sobre el que está puesto el foco, y la
  // máscara de vías que ese resultado abarca. null = no hay foco, y el mapa
  // dibuja todo a plena opacidad.
  const [activa, setActiva] = useState<string | null>(null)
  const [enfoque, setEnfoque] = useState<Uint8Array | null>(null)
  // Se incrementa en cada notify() del store. Es lo que hace que la búsqueda
  // por condición y por procedencia (que leen el store, no `ways`) y la ficha
  // se recalculen después de guardar.
  const [storeVersion, setStoreVersion] = useState(0)
  // Handle del archivo en disco (Task 21): null hasta que checkHandle() lo
  // recuerde de una sesión previa (con permiso vigente) o el usuario lo elija
  // con el botón. Vive en React, no dentro de persist.ts, porque useAutosave
  // (más abajo) tiene que re-suscribirse cuando cambia.
  const [handle, setHandle] = useState<FileSystemFileHandle | null>(null)
  // Handle recordado en IndexedDB cuyo permiso el navegador olvidó: distinto
  // de `handle` a propósito -- este NO se pasa a useAutosave (nadie debe
  // autoguardar sobre un archivo sin autorización vigente). Solo existe para
  // que la interfaz ofrezca un botón de reconectar; se vacía en cuanto se
  // conecta algo (por reconexión o por elegir un archivo nuevo).
  const [pendingHandle, setPendingHandle] = useState<FileSystemFileHandle | null>(null)
  const [avisoCarga, setAvisoCarga] = useState<AvisoCarga | null>(null)
  const [dibujado, setDibujado] = useState(false)
  // Cuánto terreno mide la pantalla ahora mismo, y el puente para pedirle un
  // acercamiento a la cámara desde los botones. Los dos los rellena <Vista>,
  // que vive dentro del Canvas -- ver scene/Camera.tsx.
  const [escala, setEscala] = useState<Escala | null>(null)
  const vista = useRef<ApiVista | null>(null)
  // La otra dirección del mismo puente: el minimapa deja acá su función de
  // repintado y <Vista> la llama en cada cuadro. No pasa por estado de React a
  // propósito -- ver el comentario en scene/Camera.tsx.
  const mirilla = useRef<((m: Mirilla) => void) | null>(null)
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

  // Al arrancar, si hubo un archivo elegido en una sesión previa, checkHandle()
  // lo recuerda de IndexedDB y solo CONSULTA el permiso (queryPermission, sin
  // gesto de usuario: requestPermission exige uno real, y llamarlo acá, sin
  // ningún clic de por medio, devolvía el estado vigente sin preguntar nada
  // tras un reinicio del navegador). Si el permiso sigue vigente (ej. un F5,
  // que sí lo conserva), se restaura solo; si no, se deja en `pendingHandle`
  // para que el botón de reconectar pida el permiso de verdad.
  //
  // setHandle va al FINAL, después de cargarDesdeArchivo -- no al principio --
  // porque ese propio loadJSON() sube storeVersion (notify()): si el handle ya
  // fuera visible para useAutosave en ese momento, vería el handle nuevo y la
  // subida de versión juntos en la misma vuelta y los tomaría por una edición
  // real, que es justo el "se guardó solo por abrir la app" que el debounce
  // existe para evitar.
  useEffect(() => {
    if (!store || !data) return
    checkHandle().then(async res => {
      if (!res) return
      if (!res.granted) { setPendingHandle(res.handle); return }
      const aviso = await cargarDesdeArchivo(res.handle, store, data.roads.ways)
      setAvisoCarga(aviso)
      if (aviso?.tipo === 'ilegible') return   // no conectar: el autoguardado lo sobrescribiría
      setHandle(res.handle)
    })
  }, [store, data])

  const estadoGuardado = useAutosave(store, handle, storeVersion)

  // El índice del buscador se arma una vez por carga de datos: agrupa las
  // 26.712 vías en 29 municipios, unos miles de nombres y 6 rodaduras, y a
  // partir de ahí cada tecla compara contra esa lista corta.
  const indice = useMemo(() => (data ? indexar(data.roads.ways) : null), [data])

  const grupos = useMemo(() => {
    if (!data || !store || !indice) return []
    return buscar(q, indice, data.roads.ways, store)
    // storeVersion entra en las dependencias porque los grupos de condición y
    // de procedencia se calculan contra el store: una edición cambia lo que
    // devuelve la misma consulta, sin que la consulta cambie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, indice, data, store, storeVersion])

  // La selección y el foco son máscaras aparte, no datos de la vía: se
  // repintan sin pasar por store.set() (eso marcaría fecha/procedencia como si
  // fuera una edición real). Suben juntas en un solo refresh(): si cada una
  // llamara por su cuenta, la segunda pisaría a la primera con los valores por
  // defecto. `enfoque` en null significa "todo enfocado", que es lo que
  // AttrTexture.refresh() entiende por el argumento ausente.
  useEffect(() => {
    if (!store || !attr) return
    const sel = new Uint8Array(store.length)
    for (const i of selected) sel[i] = 1
    attr.refresh(enfoque ?? undefined, sel)
  }, [store, attr, enfoque, selected, storeVersion])

  const seleccion = useMemo(() => Array.from(selected), [selected])
  const registro = store && seleccion.length === 1 ? store.get(seleccion[0]) : null

  // add=true (shift-clic) agrega; add=false reemplaza, y en el vacío limpia.
  // No toca el foco: seguir trabajando dentro del municipio que buscaste es lo
  // normal, y apagarle la atenuación al primer clic obligaría a buscarlo otra
  // vez para recuperarla.
  const onPick = useCallback((i: number | null, add: boolean) => {
    setSelected(prev => {
      if (add) {
        if (i == null) return prev
        return new Set(prev).add(i)
      }
      return i == null ? new Set() : new Set([i])
    })
  }, [])

  // El lazo siempre agrega (como el shift-clic), nunca reemplaza la selección
  // previa. El readback ocurre acá, al soltar -- nunca durante el arrastre,
  // que en LassoOverlay solo dibuja el polígono en SVG (gratis).
  const onLassoFinish = useCallback((pts: Pt[]) => {
    const picker = pickerRef.current
    if (!picker) { console.warn('lazo: pickRegion aún no está listo, se ignora este trazo'); return }
    const xs = pts.map(p => p.x)
    const ys = pts.map(p => p.y)
    // bbox en enteros de píxel de pantalla, acotado al viewport: un arrastre
    // que sale de la ventana (el navegador sigue mandando mousemove fuera del
    // área cliente) no debe pedirle a pickRegion un buffer desproporcionado.
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

  // Elegir un resultado hace tres cosas a la vez, y las tres son la misma
  // intención: enfocar (el resto del mapa se atenúa), volar hasta lo que
  // abarca, y dejarlo seleccionado. Lo tercero es lo que convierte una
  // búsqueda en un lote editable, sin tener que redibujar con el lazo una
  // forma que acabas de nombrar -- que es el trabajo de esta aplicación.
  const onElegir = useCallback((r: Resultado) => {
    if (!store || !data) return
    const m = new Uint8Array(store.length)
    for (const i of r.ids) m[i] = 1
    setEnfoque(m)
    setActiva(r.clave)
    setSelected(new Set(r.ids))
    const e = idsCenterAndSpan(data.positions, data.index, r.ids)
    if (e) setObjetivo(e)
  }, [store, data])

  const onQ = useCallback((s: string) => {
    setQ(s)
    // Borrar la búsqueda apaga la atenuación, pero NO la selección: lo
    // seleccionado es memoria del usuario (puede haberlo armado a clics) y
    // este repo no descarta esa clase de estado en silencio en ningún otro
    // sitio. La ficha sigue abierta, con su botón para soltarla.
    if (!s.trim()) { setActiva(null); setEnfoque(null) }
  }, [])

  // Único llamador de store.set() en la app. Le pasa el lote entero de una
  // vez, nunca un for por vía -- set() ya normaliza y notifica una sola vez
  // por lote (store.ts); con selecciones de miles, notificar por elemento es
  // la diferencia entre instantáneo y colgado.
  //
  // Ya no hace falta intersectar la selección con ninguna máscara antes de
  // escribir. Esa intersección existía porque el panel de filtros escondía
  // vías de verdad y una selección hecha con un filtro permisivo sobrevivía a
  // uno que la ocultaba: "aplicar" escribía sobre miles de vías que no estaban
  // en pantalla. Ahora no hay nada oculto -- lo que queda fuera del foco se
  // dibuja más tenue, pero se dibuja -- y la ficha declara cuántas son y cómo
  // se reparten por municipio antes de que toques el botón.
  const onAplicar = useCallback((patch: Partial<Registro>) => {
    if (!store || seleccion.length === 0) return
    store.set(seleccion, patch)
  }, [store, seleccion])

  const onPickFile = useCallback(async () => {
    if (!store || !data) return
    // Firefox no implementa la File System Access API (spec §9): ahí la app no
    // se rompe, solo pierde el autoguardado directo a disco y cae a descargar
    // el archivo para reemplazarlo a mano.
    if (!isFsAccessSupported()) { downloadJSON(store.toJSON()); return }
    let h: FileSystemFileHandle | null = null
    // Cancelar el diálogo rechaza con AbortError: no es un error real (ningún
    // dato se tocó todavía), así que no se reporta; otro rechazo (ej. permiso
    // denegado) sí, porque ese sí explica por qué "no pasó nada".
    try { h = await pickFile() } catch (e) {
      if ((e as any)?.name !== 'AbortError') console.error('no se pudo elegir el archivo', e)
    }
    if (!h) return
    const aviso = await cargarDesdeArchivo(h, store, data.roads.ways)
    setAvisoCarga(aviso)
    setPendingHandle(null)
    if (aviso?.tipo === 'ilegible') return   // no conectar: el autoguardado lo sobrescribiría
    setHandle(h)
  }, [store, data])

  // Único llamador de reconnectHandle() -- vive detrás de un clic real, que es
  // el único lugar donde requestPermission() de verdad le pregunta algo al
  // usuario (ver persist.ts). Si el navegador deniega, se limpia pendingHandle
  // igual: insistir con el mismo handle no cambiaría nada, y el botón de
  // archivo sigue disponible para elegir de cero.
  const onReconectar = useCallback(async () => {
    if (!pendingHandle || !store || !data) return
    const ok = await reconnectHandle(pendingHandle)
    if (!ok) {
      console.warn('permiso denegado para el archivo recordado -- elige el archivo de nuevo')
      setPendingHandle(null)
      return
    }
    const aviso = await cargarDesdeArchivo(pendingHandle, store, data.roads.ways)
    setAvisoCarga(aviso)
    setPendingHandle(null)
    if (aviso?.tipo === 'ilegible') return
    setHandle(pendingHandle)
  }, [pendingHandle, store, data])

  if (!data) return <Cargando titulo="Cargando la red vial" detalle="26.712 vías y el relieve del estado." />

  // el terreno vive en ENU local centrado en ORIGIN (bbox ~147×129 km,
  // Task 11): [0, 55000, 100000] queda a ~114 km del centroide, ~29° sobre el
  // horizonte. Verificado visualmente: a ese ángulo se ve el relieve completo
  // con buen contraste hipsométrico. Dos alternativas probadas y descartadas:
  // a 90 km de altura (fuera del topRadius de 60 km de la atmósfera
  // precalculada) el cielo sale apagado; a 12° de rasante la neblina de
  // AerialPerspective satura el terreno entero.
  return (
    <>
      {/* shadows="soft" = PCFSoftShadowMap. Probado contra VSM: VSM difumina
          con un blur separable sobre el propio mapa, y con cascadas de tamaño
          tan distinto (0,1 m por texel la primera, kilómetros la última) el
          mismo radio de blur o no suaviza nada lejos o sangra luz por debajo
          de las crestas cerca. PCFSoft trabaja en el espacio del receptor y se
          porta igual en las tres. */}
      <Canvas shadows="soft" camera={{ position: [0, 55000, 100000], near: 10, far: 2_000_000, fov: 45 }}>
        <Suspense fallback={null}>
          <Sky date={date} />
          <TerrainLod meta={data.terrain} municipios={data.municipios} date={date} />
          {attr && (
            <Roads
              positions={data.positions} segIds={data.segIds} index={data.index}
              ways={data.roads.ways} attr={attr} normals={data.normals} date={date}
            />
          )}
          <Picker
            positions={data.positions} segIds={data.segIds}
            ways={data.roads.ways} index={data.index} normals={data.normals}
            onPick={onPick} pickerRef={pickerRef}
          />
          {/* enabled=false mientras el lazo está activo: arrastrar para dibujar
              y arrastrar para orbitar son el mismo gesto -- si OrbitControls
              también escucha, el lazo sale torcido y la vista se mueve sola. */}
          {/* minDistance no es cosmético: es el tope al que llegan los
              botones de zoom, y por debajo de ~30 m el relieve de delante
              empieza a recortarse contra el near plane (10). */}
          <OrbitControls makeDefault minDistance={30} maxDistance={400000} enabled={!lassoOn} />
          <FlyTo objetivo={objetivo} />
          <Vista api={vista} onEscala={setEscala} mirilla={mirilla} />
          <AvisaCuandoDibuja onListo={() => setDibujado(true)} />
        </Suspense>
      </Canvas>

      {!dibujado && (
        <Cargando titulo="Armando el relieve"
          detalle="Un millón de puntos de elevación y 450.261 tramos de vía. Tarda unos segundos." />
      )}

      <LassoOverlay active={lassoOn} onFinish={onLassoFinish} />

      <SearchPanel
        q={q} onQ={onQ} grupos={grupos} activa={activa} onElegir={onElegir}
        ficha={seleccion.length > 0
          ? (
            <Ficha
              ways={data.roads.ways} seleccion={seleccion} registro={registro}
              onCerrar={() => setSelected(new Set())} onAplicar={onAplicar}
            />
          )
          : null}
      />

      <MapControls
        lazo={lassoOn}
        onLazo={() => setLassoOn(o => !o)}
        // Un Encuadre nuevo en cada clic: el efecto de <FlyTo> depende de la
        // identidad del objeto, así que reusar uno haría que el botón
        // funcionara una sola vez por sesión.
        onEncuadrar={() => setObjetivo(bboxCenterAndSpan(BBOX))}
        onAcercar={() => vista.current?.acercar()}
        onAlejar={() => vista.current?.alejar()}
      />

      <MiniMapa
        grid={data.terrainGrid} meta={data.terrain} municipios={data.municipios}
        mirilla={mirilla} onIr={p => vista.current?.irA(p)}
      />

      <BarraEscala escala={escala} />

      <BarraArchivo
        nombre={handle?.name ?? null}
        estado={handle ? estadoGuardado : null}
        pendiente={pendingHandle?.name ?? null}
        avisar={textoAviso(avisoCarga)}
        onElegir={onPickFile}
        onReconectar={onReconectar}
      />
    </>
  )
}

function Cargando ({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center',
      background: '#eef1f4', fontFamily: T.fuente,
    }}>
      <div style={{ display: 'grid', gap: 6, justifyItems: 'center', textAlign: 'center', padding: 24 }}>
        <strong style={{ fontSize: 16, fontWeight: 500, color: T.texto }}>{titulo}</strong>
        <span style={{ fontSize: 13, color: T.texto2, maxWidth: 340 }}>{detalle}</span>
      </div>
    </div>
  )
}
