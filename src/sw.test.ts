import { describe, it, expect } from 'vitest'
// ?raw: lo trae Vite como texto, sin node:fs -- este repo no tiene @types/node
// y no vale traerlos por un test.
import CODIGO from '../public/sw.js?raw'

// public/sw.js no se puede importar: es un script de worker, no un módulo, y
// vive fuera de src. Se carga el archivo que de verdad se despliega y se le
// dan `self`, `caches` y `fetch` de mentira. Probar el artefacto y no una
// copia del criterio es el punto: la regla que protege la licencia de Esri
// solo vale si la cumple el archivo que se sube.

const ORIGEN = 'https://ejemplo.org'

function montar () {
  const oyentes: Record<string, (e: unknown) => void> = {}
  const abiertas: string[] = []
  const guardadas: string[] = []
  const cachesFalsas = {
    keys: async () => [],
    delete: async () => true,
    open: async (nombre: string) => {
      abiertas.push(nombre)
      return {
        match: async () => undefined,
        put: async (req: { url: string }) => { guardadas.push(req.url) },
      }
    },
  }
  const fetchFalso = async () => ({ status: 200, clone: () => ({}) })
  const self = {
    location: { href: `${ORIGEN}/tachira-3d/sw.js?v=abc123`, origin: ORIGEN },
    addEventListener: (n: string, f: (e: unknown) => void) => { oyentes[n] = f },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }
  new Function('self', 'caches', 'fetch', CODIGO)(self, cachesFalsas, fetchFalso)

  /** Devuelve la promesa que el worker pasó a respondWith, o null si dejó
   *  pasar la petición sin tocarla. */
  const pedir = (url: string, method = 'GET') => {
    let tomada: Promise<unknown> | null = null
    oyentes.fetch({ request: { method, url }, respondWith: (p: Promise<unknown>) => { tomada = p } })
    return tomada as Promise<unknown> | null
  }
  return { pedir, abiertas, guardadas }
}

describe('service worker', () => {
  it('NO intercepta las teselas de Esri', () => {
    // La licencia de Esri permite usar el servicio, no copiarlo: guardar una
    // tesela en la Cache API es hacer una copia. Si este test se pone rojo, el
    // arreglo no es cambiarlo -- es no guardar la tesela.
    const { pedir } = montar()
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/1/2'
    expect(pedir(esri)).toBeNull()
  })

  it('NO intercepta ningún otro origen, aunque la ruta parezca guardable', () => {
    const { pedir } = montar()
    expect(pedir('https://otro.example/data/roads-pos.bin')).toBeNull()
  })

  it('guarda los datos horneados, las texturas y el bundle con hash', () => {
    const { pedir } = montar()
    expect(pedir(`${ORIGEN}/tachira-3d/data/roads-pos.bin`)).not.toBeNull()
    expect(pedir(`${ORIGEN}/tachira-3d/texturas/asfalto/albedo.jpg`)).not.toBeNull()
    expect(pedir(`${ORIGEN}/tachira-3d/assets/index-DJT7buS4.js`)).not.toBeNull()
  })

  it('deja pasar index.html: es quien nombra el bundle de la versión nueva', () => {
    const { pedir } = montar()
    expect(pedir(`${ORIGEN}/tachira-3d/`)).toBeNull()
    expect(pedir(`${ORIGEN}/tachira-3d/index.html`)).toBeNull()
  })

  it('deja pasar lo que no es GET', () => {
    const { pedir } = montar()
    expect(pedir(`${ORIGEN}/tachira-3d/data/roads-pos.bin`, 'POST')).toBeNull()
  })

  it('nombra la caché con el sello del build que trae su propia query', async () => {
    const { pedir, abiertas, guardadas } = montar()
    await pedir(`${ORIGEN}/tachira-3d/data/terrain.bin`)
    expect(abiertas).toEqual(['tachira-abc123'])
    expect(guardadas).toEqual([`${ORIGEN}/tachira-3d/data/terrain.bin`])
  })
})
