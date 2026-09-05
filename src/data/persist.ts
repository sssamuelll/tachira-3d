import { useEffect, useRef } from 'react'
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

export async function loadHandle (): Promise<FileSystemFileHandle | null> {
  const db = await idb()
  const h = await new Promise<any>((res, rej) => {
    const tx = db.transaction(STORE, 'readonly')
    const r = tx.objectStore(STORE).get(KEY)
    r.onsuccess = () => res(r.result ?? null); r.onerror = () => rej(r.error)
  })
  if (!h) return null
  // el permiso no sobrevive siempre a un reinicio del navegador
  const perm = await (h as any).queryPermission({ mode: 'readwrite' })
  if (perm === 'granted') return h
  return (await (h as any).requestPermission({ mode: 'readwrite' })) === 'granted' ? h : null
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

export function useAutosave (
  store: AttrStore | null, handle: FileSystemFileHandle | null, version: number,
) {
  const primera = useRef(true)
  useEffect(() => {
    if (!store || !handle) return
    if (primera.current) { primera.current = false; return }   // no guardar solo por montar
    const t = setTimeout(() => { writeJSON(handle, store.toJSON()).catch(console.error) }, 2000)
    return () => clearTimeout(t)
  }, [store, handle, version])
}
