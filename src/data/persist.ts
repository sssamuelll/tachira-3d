import { useEffect, useRef, useState } from 'react'
import type { AttrStore } from './store'

// pci-tachira.json NO viene versionado en este repo (fix Task 21 ronda 2): el
// diseño es que cada usuario lo cree la primera vez que abre la app (botón
// "archivo de datos" -> pickFile()) y lo versione en SU PROPIO git, con SUS
// datos -- no queremos que el repo llegue con PCI de prueba puestos por
// quien lo desarrolló. El archivo aparece en la raíz del proyecto recién
// después de ese primer guardado.
const DB = 'vialidad-tachira', STORE = 'handles', KEY = 'pci'

export const isFsAccessSupported = () => typeof (window as any).showSaveFilePicker === 'function'

function idb (): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}

export async function saveHandle (h: FileSystemFileHandle) {
  const db = await idb()
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(h, KEY)
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
  })
}

async function getStoredHandle (): Promise<FileSystemFileHandle | null> {
  const db = await idb()
  return new Promise<any>((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(KEY)
    r.onsuccess = () => res(r.result ?? null); r.onerror = () => rej(r.error)
  })
}

// Solo consulta -- queryPermission() no exige gesto de usuario (a diferencia
// de requestPermission(), ver reconnectHandle abajo), así que es seguro
// llamarla desde un efecto de montaje. `granted:false` no es "sin acceso para
// siempre": es "hace falta un clic para volver a pedirlo" -- App.tsx usa esa
// distinción para decidir si restaura solo (permiso vigente, ej. un F5) o
// muestra el botón de reconectar (permiso perdido, ej. reinicio del navegador).
export async function checkHandle (): Promise<{ handle: FileSystemFileHandle; granted: boolean } | null> {
  const h = await getStoredHandle()
  if (!h) return null
  const perm = await (h as any).queryPermission({ mode: 'readwrite' })
  return { handle: h, granted: perm === 'granted' }
}

// requestPermission() SÍ exige un gesto de usuario real -- sin uno, la spec
// dice que devuelve el estado vigente sin preguntar nada, en silencio (fix
// Task 21 ronda 3: antes este pedido vivía en el efecto de montaje de
// App.tsx, sin ningún clic de por medio, así que tras un reinicio de
// navegador el permiso nunca se volvía a preguntar de verdad -- la app caía
// en silencio a "vuelve a elegir archivo", sin avisar que el archivo
// recordado seguía ahí). Por eso esta función solo puede llamarse desde un
// manejador de clic real.
export async function reconnectHandle (h: FileSystemFileHandle): Promise<boolean> {
  return (await (h as any).requestPermission({ mode: 'readwrite' })) === 'granted'
}

export async function pickFile (): Promise<FileSystemFileHandle | null> {
  if (!isFsAccessSupported()) return null
  const h = await (window as any).showSaveFilePicker({
    suggestedName: 'pci-tachira.json',
    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
  })
  await saveHandle(h)
  return h
}

export async function writeJSON (handle: FileSystemFileHandle, obj: unknown) {
  const w = await (handle as any).createWritable()
  await w.write(JSON.stringify(obj, null, 2))
  await w.close()
}

// Simétrico a writeJSON, y con el mismo riesgo al revés: usado tanto para
// restaurar el handle recordado al arrancar (App.tsx) como justo después de
// pickFile() -- el diálogo puede apuntar a un pci-tachira.json que YA trae
// datos (el archivo se versiona en git a propósito, spec §9: abrirlo en un
// clon o un perfil de navegador nuevo, con IndexedDB vacío, es el caso de uso
// normal, no uno raro).
//
// Devuelve null si el archivo está VACÍO (cero bytes o solo espacios: lo que
// deja showSaveFilePicker al crearlo) -- eso no es un error, simplemente no
// hay nada que cargar. Lanza si tiene contenido y no parsea. La distinción es
// el fix: antes ambos casos caían en el mismo catch, así que un JSON roto
// conectaba el handle igual, el store quedaba solo con la siembra, y la
// primera edición escribía {"registros":{}} encima -- todo el trabajo,
// borrado. Y el spec documenta editar este archivo a mano como flujo normal:
// una coma de más es el caso previsto, no uno raro.
export async function readJSON (handle: FileSystemFileHandle): Promise<unknown | null> {
  const texto = await (await handle.getFile()).text()
  if (!texto.trim()) return null
  return JSON.parse(texto)
}

// ponytail: File System Access API; Firefox no lo soporta y cae a descarga manual
export function downloadJSON (obj: unknown, filename = 'pci-tachira.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export type EstadoGuardado = 'guardado' | 'pendiente' | 'guardando'

// Máquina del debounce+guardado, sin React -- separada de useAutosave (que
// queda como puro pegamento de efectos alrededor) para poder probarla con
// vitest controlando el tiempo, sin renderizar un hook: este repo no tiene
// @testing-library/react ni jsdom, y montar esa infraestructura para un solo
// hook no valía la pena (Task 19/20 ya tomaron el mismo criterio).
//
// Guarda de generación (fix Task 21 ronda 4): sin esto, dos escrituras
// solapadas -- la primera resolviendo DESPUÉS de que la segunda edición ya
// armó su propio guardado -- dejaban que la resolución vieja pisara
// 'guardado' encima del 'pendiente' de la edición más nueva, mintiendo hasta
// que la escritura de verdad terminara. `editar()` sube `gen` cada vez que se
// llama; el `.then()` de una escritura solo declara 'guardado' si su propia
// generación sigue siendo la vigente cuando resuelve -- una resolución tardía
// de una escritura ya superada no tiene autoridad para tocar el estado.
export function crearAutoguardado (onEstado: (e: EstadoGuardado) => void, debounceMs = 2000) {
  let gen = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let flush: (() => void) | null = null

  return {
    // Llamar en cada edición real (subida de version). `write` se evalúa
    // recién cuando el debounce dispara, no antes -- así siempre lee el
    // store/handle vigentes al momento de escribir, no uno cerrado sobre el
    // instante de la edición.
    editar (write: () => Promise<void>) {
      if (timer) clearTimeout(timer)
      onEstado('pendiente')
      const miGen = ++gen
      const guardar = () => {
        timer = null; flush = null
        onEstado('guardando')
        write().then(() => { if (gen === miGen) onEstado('guardado') }).catch(console.error)
      }
      timer = setTimeout(guardar, debounceMs)
      flush = guardar
    },
    // beforeunload: si hay un debounce armado (no disparado todavía), lo
    // dispara ya en vez de esperar el resto del tiempo. No-op si no hay nada
    // pendiente (flush es null: nunca se armó, o ya disparó).
    flushPendiente () { flush?.() },
  }
}

export function useAutosave (
  store: AttrStore | null, handle: FileSystemFileHandle | null, version: number,
): EstadoGuardado {
  // Cuántas ediciones (store.ediciones, que solo sube set()) hay ya escritas
  // o programadas para escribirse. Reemplaza a un `primera` que se consumía
  // en la primera corrida con store Y handle no nulos (fix ronda final): si
  // el usuario editaba ANTES de conectar el archivo -- puede, el panel está
  // operativo -- al conectar el efecto corría por primera vez, veía `primera`
  // en true y salía sin guardar. El indicador seguía en su valor inicial
  // 'guardado', así que la barra mentía y el bloqueo al cerrar tampoco
  // saltaba. Contar ediciones distingue las dos cosas sin adivinar: montar y
  // cargar el archivo no suben el contador, editar sí.
  const guardadas = useRef(0)
  const [estado, setEstado] = useState<EstadoGuardado>('guardado')
  const estadoRef = useRef(estado)
  estadoRef.current = estado
  // Una sola instancia por vida del componente (inicialización perezosa de
  // ref, no un useMemo/useEffect: crearAutoguardado no tiene efectos
  // secundarios propios, solo arma clausuras).
  const autoRef = useRef<ReturnType<typeof crearAutoguardado> | null>(null)
  if (!autoRef.current) autoRef.current = crearAutoguardado(setEstado)

  useEffect(() => {
    if (!store || !handle) return
    if (store.ediciones === guardadas.current) return   // nada pendiente: montar o cargar no es editar
    guardadas.current = store.ediciones
    autoRef.current!.editar(() => writeJSON(handle, store.toJSON()))
  }, [store, handle, version])

  // beforeunload vive en un efecto aparte, montado UNA sola vez: si se
  // reinstalara junto al de arriba (en cada edición) avisaría "hay cambios
  // sin guardar" incluso con todo ya guardado -- el aviso que el usuario
  // aprende a ignorar. Lee el estado más reciente por `estadoRef` en vez de
  // depender de `version`. Si hay un guardado pendiente o en curso, lo
  // dispara de una vez (no espera los 2 s del debounce) y avisa con el
  // diálogo nativo del navegador -- un write async no se puede garantizar
  // completo antes de que la pestaña cierre de verdad; esto es lo más que el
  // navegador deja hacer (fix Task 21 ronda 3: el brief original no cubría
  // este caso -- cerrar la pestaña dentro de la ventana de 2 s perdía la
  // última edición sin ningún aviso).
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (estadoRef.current === 'guardado') return   // nada pendiente ni en curso: no bloquea el cierre
      autoRef.current!.flushPendiente()
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  return estado
}
