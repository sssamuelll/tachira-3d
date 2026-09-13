import { ORIGIN } from './constants'
import { urlGenerado } from './rutas'

export const BUILDINGS_BASE = urlGenerado('edificios/')
export const BUILDINGS_INDEX = `${BUILDINGS_BASE}index.json`

/** OSM aporta un dato declarado, no una medición verificada por el Colegio.
 * La fuente se conserva separada del valor para poder corregirlo después. */
export type FuenteAltura = 'osm-height' | 'osm-levels' | 'estimada'
export interface AlturaEdificio {
  metros: number
  fuente: FuenteAltura
  niveles: number
  evidencia: {
    area: number; elongacion: number; compacidad: number; densidad: number; vecinosEfectivos: number
    via: string | null; distanciaVia: number | null
    intensidad: number; contexto: number
    perfil: 'osm' | 'casa' | 'mixto' | 'galpon'
  }
}

/** Coordenadas ENU del mapa, X este / Y arriba / Z sur. Los anillos
 * conservan el apoyo por vértice y los patios interiores, sin cerrar dos veces. */
export type PuntoEdificio = [number, number, number]
export interface PoligonoEdificio { outer: PuntoEdificio[]; holes: PuntoEdificio[][] }
export interface Edificio {
  id: string
  osmId: number
  osmType: 'way' | 'relation'
  tags: Record<string, string>
  altura: AlturaEdificio
  techo: {
    rgb: [number, number, number]
    fuente: 'satelite' | 'estimada'
    zoom: number | null
    muestras: number
    detalle?: string
  }
  baseY: number
  roofY: number
  apoyo: {
    fuente: 'dem-tallado-z12'
    desnivel: number
    cimientoMax: number
    revisar: boolean
  }
  /** indexStart cuenta índices escalares; un raycast aporta faceIndex * 3. */
  geometry: { vertexStart: number; vertexCount: number; indexStart: number; indexCount: number }
  polygons: PoligonoEdificio[]
}

export type BuildingBounds = [number, number, number, number, number, number]
export interface BuildingChunkMeta {
  key: string
  url: string
  metadataUrl: string
  bounds: BuildingBounds
  vertices: number
  triangles: number
  buildings: number
  demNodes: string[]
}
export interface BuildingManifest {
  version: 1
  origin: typeof ORIGIN
  modelVersion: string
  stats: Record<string, unknown>
  chunks: BuildingChunkMeta[]
}
export interface BuildingChunkMetadata { version: 1; key: string; buildings: Edificio[] }
export interface BuildingBuffer {
  positions: Float32Array
  normals: Int8Array
  /** Color LINEAL, normalizado por BufferAttribute; el JSON del techo guarda sRGB. */
  colors: Uint8Array
  indices: Uint32Array
  byteLength: number
}

const entero = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max
const nodoDem = /^15\/(\d+)\/(\d+)$/
function claveValida (value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = nodoDem.exec(value)
  return !!match && Number(match[1]) < 32768 && Number(match[2]) < 32768
}
function object (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** El manifest es pequeño y se valida una vez. No se carga metadata de 45.596
 * edificios para dibujar: el JSON detallado queda disponible por chunk. */
export function validateBuildingManifest (value: unknown): BuildingManifest {
  if (!object(value) || value.version !== 1 || !object(value.origin) ||
      typeof value.modelVersion !== 'string' || !object(value.stats) || !Array.isArray(value.chunks)) {
    throw new Error('edificios: manifest incompleto o versión desconocida')
  }
  for (const axis of ['lat', 'lon', 'h'] as const) {
    const component = value.origin[axis]
    if (typeof component !== 'number' || !Number.isFinite(component) || Math.abs(component - ORIGIN[axis]) > 1e-9) {
      throw new Error(`edificios: origin.${axis} no coincide con el origen ENU del mapa`)
    }
  }
  const seen = new Set<string>()
  for (const chunk of value.chunks) {
    if (!object(chunk) || !claveValida(chunk.key)) throw new Error('edificios: clave de chunk inválida')
    if (seen.has(chunk.key)) throw new Error(`edificios: clave repetida ${chunk.key}`)
    seen.add(chunk.key)
    const file = chunk.key.replaceAll('/', '-')
    if (chunk.url !== `${file}.bin` || chunk.metadataUrl !== `${file}.json`) throw new Error(`edificios: ruta inválida ${chunk.key}`)
    const bounds = chunk.bounds
    if (!Array.isArray(bounds) || bounds.length !== 6 || !bounds.every(v => typeof v === 'number' && Number.isFinite(v)) ||
        [0, 1, 2].some(axis => bounds[axis] > bounds[axis + 3])) {
      throw new Error(`edificios: caja inválida ${chunk.key}`)
    }
    if (!entero(chunk.vertices, 2_000_000) || !entero(chunk.triangles, 4_000_000) || !entero(chunk.buildings, 100_000)) {
      throw new Error(`edificios: conteos inválidos ${chunk.key}`)
    }
    if (!Array.isArray(chunk.demNodes) || chunk.demNodes.length === 0 || !chunk.demNodes.every(claveValida)) {
      throw new Error(`edificios: dependencias DEM inválidas ${chunk.key}`)
    }
  }
  return value as unknown as BuildingManifest
}

/** Vistas sobre un solo ArrayBuffer, sin duplicar atributos al subir a GPU.
 * La longitud exacta impide aceptar descargas truncadas o formatos distintos. */
export function decodeBuildingChunk (buffer: ArrayBuffer, meta?: BuildingChunkMeta): BuildingBuffer {
  if (buffer.byteLength < 16) throw new Error('edificios: header truncado')
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== 0x45444946 || view.getUint32(4, true) !== 1) {
    throw new Error('edificios: firma o versión del binario desconocida')
  }
  const vertices = view.getUint32(8, true)
  const indicesCount = view.getUint32(12, true)
  if (!entero(vertices, 2_000_000) || !entero(indicesCount, 12_000_000) || indicesCount % 3 !== 0) {
    throw new Error('edificios: conteo inválido de vértices o triángulos')
  }
  const normalOffset = 16 + vertices * 12
  const colorOffset = normalOffset + vertices * 3
  const indexOffset = Math.ceil((colorOffset + vertices * 3) / 4) * 4
  const expected = indexOffset + indicesCount * 4
  if (buffer.byteLength !== expected) throw new Error(`edificios: binario truncado o longitud inválida (${buffer.byteLength}, esperado ${expected})`)
  if (meta && (meta.vertices !== vertices || meta.triangles * 3 !== indicesCount)) {
    throw new Error(`edificios: conteos diferentes al manifest (${meta.key})`)
  }
  const positions = new Float32Array(buffer, 16, vertices * 3)
  const normals = new Int8Array(buffer, normalOffset, vertices * 3)
  const colors = new Uint8Array(buffer, colorOffset, vertices * 3)
  const indices = new Uint32Array(buffer, indexOffset, indicesCount)
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const p = positions[i + axis]
      if (!Number.isFinite(p)) throw new Error('edificios: posición no finita')
      // El horneado redondea la caja en JSON; tolera 1 cm de cuantización.
      if (meta && (p < meta.bounds[axis] - 0.01 || p > meta.bounds[axis + 3] + 0.01)) {
        throw new Error(`edificios: posición fuera de la caja del manifest (${meta.key})`)
      }
    }
    if ((normals[i] === 0 && normals[i + 1] === 0 && normals[i + 2] === 0) ||
        normals[i] === -128 || normals[i + 1] === -128 || normals[i + 2] === -128) {
      throw new Error('edificios: normal inválida')
    }
  }
  for (const index of indices) if (index >= vertices) throw new Error('edificios: índice fuera de rango')
  return { positions, normals, colors, indices, byteLength: buffer.byteLength }
}

/** Dos descargas/arrays EN TOTAL, incluyendo los que esperan construcción.
 * Abort cancela la red; wanted + closed también protegen contra respuestas
 * tardías de una petición que ya había terminado antes de abortarla. */
export class BuildingDownloads<T extends BuildingChunkMeta = BuildingChunkMeta> {
  readonly pending = new Map<string, AbortController>()
  readonly ready = new Map<string, { meta: T; buffer: ArrayBuffer }>()
  readonly failed = new Set<string>()
  private wanted = new Set<string>()
  private closed = false

  constructor (private readonly warn: (error: unknown) => void = error => console.warn('Edificios:', error)) {}

  select (wanted: Set<string>) {
    this.wanted = wanted
    for (const [key, controller] of this.pending) if (!wanted.has(key)) controller.abort()
    for (const key of this.ready.keys()) if (!wanted.has(key)) this.ready.delete(key)
  }

  request (meta: T): boolean {
    if (this.closed || !this.wanted.has(meta.key) || this.failed.has(meta.key) ||
        this.pending.has(meta.key) || this.ready.has(meta.key) || this.pending.size + this.ready.size >= 2) return false
    const controller = new AbortController()
    this.pending.set(meta.key, controller)
    const url = BUILDINGS_BASE + meta.url
    void fetch(url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
      const buffer = await response.arrayBuffer()
      if (!this.closed && !controller.signal.aborted && this.wanted.has(meta.key)) this.ready.set(meta.key, { meta, buffer })
    }).catch((error: unknown) => {
      if (this.closed || controller.signal.aborted) return
      this.failed.add(meta.key)
      this.warn(error)
    }).finally(() => {
      if (this.pending.get(meta.key) === controller) this.pending.delete(meta.key)
    })
    return true
  }

  dispose () {
    this.closed = true
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
    this.ready.clear()
    this.wanted.clear()
  }
}
