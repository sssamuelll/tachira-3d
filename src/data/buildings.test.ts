import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-ignore -- igual que asfalto.test.ts: vitest usa Node, la app solo tipos de vite/client.
import { readFileSync } from 'node:fs'
import { ORIGIN } from './constants'
import { BuildingDownloads, decodeBuildingChunk, validateBuildingManifest } from './buildings'

afterEach(() => vi.unstubAllGlobals())

function triangle () {
  const buffer = new ArrayBuffer(84)
  const header = new DataView(buffer)
  header.setUint32(0, 0x45444946, true)
  header.setUint32(4, 1, true)
  header.setUint32(8, 3, true)
  header.setUint32(12, 3, true)
  new Float32Array(buffer, 16, 9).set([0, 10, 0, 1, 10, 0, 0, 10, 1])
  new Int8Array(buffer, 52, 9).set([0, 127, 0, 0, 127, 0, 0, 127, 0])
  new Uint8Array(buffer, 61, 9).fill(128)
  new Uint32Array(buffer, 72, 3).set([0, 1, 2])
  return buffer
}

const chunk = {
  key: '15/100/200', url: '15-100-200.bin', metadataUrl: '15-100-200.json',
  bounds: [0, 10, 0, 1, 10, 1], vertices: 3, triangles: 1, buildings: 1,
  demNodes: ['15/100/200'],
}
const manifest = () => ({ version: 1, origin: { ...ORIGIN }, modelVersion: '1', stats: {}, chunks: [{ ...chunk }] })

describe('binario de edificaciones', () => {
  it('decodifica vistas sin copias y respeta padding de índices', () => {
    const buffer = triangle()
    const decoded = decodeBuildingChunk(buffer)
    expect(decoded.positions.buffer).toBe(buffer)
    expect(decoded.positions[1]).toBe(10)
    expect(decoded.normals[1]).toBe(127)
    expect(decoded.colors[0]).toBe(128)
    expect([...decoded.indices]).toEqual([0, 1, 2])
    expect(decoded.byteLength).toBe(84)
  })

  it('rechaza truncamiento del header y de atributos o índices', () => {
    for (const bytes of [0, 15, 40, 83]) {
      expect(() => decodeBuildingChunk(triangle().slice(0, bytes))).toThrow(/edificios/i)
    }
  })

  it('rechaza firma y versión desconocidas', () => {
    for (const offset of [0, 4]) {
      const buffer = triangle()
      new DataView(buffer).setUint32(offset, 99, true)
      expect(() => decodeBuildingChunk(buffer)).toThrow(/edificios/i)
    }
  })

  it('rechaza índices fuera de rango y conteos sin triángulos completos', () => {
    const badIndex = triangle()
    new Uint32Array(badIndex, 72, 3)[2] = 3
    expect(() => decodeBuildingChunk(badIndex)).toThrow(/índice/i)
    const badCount = triangle()
    new DataView(badCount).setUint32(12, 2, true)
    expect(() => decodeBuildingChunk(badCount)).toThrow(/triángulos/i)
  })

  it('rechaza posiciones no finitas y normales nulas', () => {
    const nan = triangle()
    new Float32Array(nan, 16, 9)[0] = NaN
    expect(() => decodeBuildingChunk(nan)).toThrow(/posición/i)
    const normal = triangle()
    new Int8Array(normal, 52, 9).fill(0)
    expect(() => decodeBuildingChunk(normal)).toThrow(/normal/i)
  })

  it('contrasta conteos y bounds con el manifest', () => {
    const meta = validateBuildingManifest(manifest()).chunks[0]
    expect(() => decodeBuildingChunk(triangle(), meta)).not.toThrow()
    expect(() => decodeBuildingChunk(triangle(), { ...meta, vertices: 6 })).toThrow(/manifest/i)
    expect(() => decodeBuildingChunk(triangle(), { ...meta, bounds: [0, 0, 0, 1, 5, 1] })).toThrow(/caja/i)
  })
})

describe('manifest de edificaciones', () => {
  it('el asset entregado puede cargarse completo con el decodificador del visor', () => {
    const base = new URL('../../public/data/edificios/', import.meta.url)
    const index = validateBuildingManifest(JSON.parse(readFileSync(new URL('index.json', base), 'utf8')))
    let vertices = 0, triangles = 0, buildings = 0, bytes = 0
    for (const meta of index.chunks) {
      const file = readFileSync(new URL(meta.url, base))
      const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
      const decoded = decodeBuildingChunk(buffer, meta)
      vertices += decoded.positions.length / 3
      triangles += decoded.indices.length / 3
      buildings += meta.buildings
      bytes += decoded.byteLength
    }
    expect(vertices).toBe(index.stats.vertices)
    expect(triangles).toBe(index.stats.triangles)
    expect(buildings).toBe(index.stats.buildings)
    expect(bytes).toBe(index.stats.bytesGeometry)
  })

  it('valida el origen ENU contra el mapa', () => {
    expect(validateBuildingManifest(manifest()).chunks).toHaveLength(1)
    const value = manifest()
    value.origin.lat += 1
    expect(() => validateBuildingManifest(value)).toThrow(/origin/i)
  })

  it('rechaza claves repetidas, cajas invertidas y rutas ajenas', () => {
    const duplicate = manifest()
    duplicate.chunks.push({ ...chunk })
    expect(() => validateBuildingManifest(duplicate)).toThrow(/repetida/i)
    const inverted = manifest()
    inverted.chunks[0].bounds = [1, 10, 0, 0, 10, 1]
    expect(() => validateBuildingManifest(inverted)).toThrow(/caja/i)
    const path = manifest()
    path.chunks[0].url = '../roads-pos.bin'
    expect(() => validateBuildingManifest(path)).toThrow(/ruta/i)
  })

  it('rechaza un manifest incompleto y una dependencia DEM inválida', () => {
    expect(() => validateBuildingManifest({ version: 1 })).toThrow(/edificios/i)
    const value = manifest()
    value.chunks[0].demNodes = ['16/100/200']
    expect(() => validateBuildingManifest(value)).toThrow(/DEM/i)
  })
})

describe('carga de edificaciones', () => {
  function network () {
    const calls: { signal: AbortSignal; finish: (value: Response) => void }[] = []
    vi.stubGlobal('fetch', vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise<Response>(finish => {
      calls.push({ signal: options.signal, finish })
    })))
    const response = (ok = true) => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => triangle() }) as Response
    const metas = [0, 1, 2].map(i => ({ ...validateBuildingManifest(manifest()).chunks[0], key: `15/${100 + i}/200` }))
    return { calls, response, metas }
  }

  it('limita a dos entre descargas y buffers en espera de crear geometría', async () => {
    const { calls, response, metas } = network()
    const queue = new BuildingDownloads()
    queue.select(new Set(metas.map(meta => meta.key)))
    expect(queue.request(metas[0])).toBe(true)
    expect(queue.request(metas[1])).toBe(true)
    expect(queue.request(metas[2])).toBe(false)
    calls[0].finish(response())
    await vi.waitFor(() => expect(queue.pending.size).toBe(1))
    expect(queue.ready.size).toBe(1)
    expect(queue.request(metas[2])).toBe(false)
    queue.ready.delete(metas[0].key)
    expect(queue.request(metas[2])).toBe(true)
    queue.dispose()
  })

  it('aborta al salir de la zona y rechaza respuestas tardías aunque fetch ignore abort', async () => {
    const { calls, response, metas } = network()
    const queue = new BuildingDownloads()
    queue.select(new Set([metas[0].key]))
    queue.request(metas[0])
    queue.select(new Set())
    expect(calls[0].signal.aborted).toBe(true)
    calls[0].finish(response())
    await vi.waitFor(() => expect(queue.pending.size).toBe(0))
    expect(queue.ready.size).toBe(0)
    expect(queue.failed.size).toBe(0)
    queue.dispose()
  })

  it('un 404 queda registrado sin reintentar cada frame', async () => {
    const { calls, response, metas } = network()
    const warn = vi.fn()
    const queue = new BuildingDownloads(warn)
    queue.select(new Set([metas[0].key]))
    queue.request(metas[0])
    calls[0].finish(response(false))
    await vi.waitFor(() => expect(queue.failed.has(metas[0].key)).toBe(true))
    expect(warn).toHaveBeenCalledOnce()
    for (let frame = 0; frame < 60; frame++) expect(queue.request(metas[0])).toBe(false)
    expect(calls).toHaveLength(1)
    queue.dispose()
  })

  it('desmontar limpia colas, impide recargar y descarta llegadas pendientes', async () => {
    const { calls, response, metas } = network()
    const queue = new BuildingDownloads()
    queue.select(new Set(metas.map(meta => meta.key)))
    queue.request(metas[0])
    queue.dispose()
    expect(calls[0].signal.aborted).toBe(true)
    calls[0].finish(response())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(queue.ready.size).toBe(0)
    expect(queue.pending.size).toBe(0)
    expect(queue.request(metas[1])).toBe(false)
  })
})
