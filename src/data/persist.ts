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
// normal, no uno raro). Un archivo recién creado por showSaveFilePicker está
// vacío -- JSON.parse('') lanza, y el caller trata esa excepción como "nada
// que cargar todavía", igual que un archivo editado a mano que quedó
// ilegible: no es un motivo para romper el arranque de la app.
export async function readJSON (handle: FileSystemFileHandle): Promise<unknown> {
  const file = await handle.getFile()
  return JSON.parse(await file.text())
}

// ponytail: File System Access API; Firefox no lo soporta y cae a descarga manual
export function downloadJSON (obj: unknown, filename = 'pci-tachira.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export type EstadoGuardado = 'guardado' | 'pendiente' | 'guardando'

export function useAutosave (
  store: AttrStore | null, handle: FileSystemFileHandle | null, version: number,
): EstadoGuardado {
  const primera = useRef(true)
  const [estado, setEstado] = useState<EstadoGuardado>('guardado')
  // Guarda el "disparar ya" del debounce vigente, o null si no hay ninguno
  // pendiente -- lo lee el efecto de beforeunload de abajo, que no depende de
  // `version` y por tanto no puede ver el `t` de este efecto directamente.
  const flushRef = useRef<(() => void) | null>(null)
  const estadoRef = useRef(estado)
  estadoRef.current = estado

  useEffect(() => {
    if (!store || !handle) return
    if (primera.current) { primera.current = false; return }   // no guardar solo por montar
    setEstado('pendiente')
    const guardar = () => {
      flushRef.current = null
      setEstado('guardando')
      writeJSON(handle, store.toJSON()).then(() => setEstado('guardado')).catch(console.error)
    }
    const t = setTimeout(guardar, 2000)
    flushRef.current = guardar
    return () => { clearTimeout(t); flushRef.current = null }
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
      flushRef.current?.()
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  return estado
}
