import type { FUENTES, TIPOS } from './constants'

export type Fuente = typeof FUENTES[number]
export type Tipo = typeof TIPOS[number]

export interface Way {
  osmId: number
  ref: string | null
  name: string | null
  highway: string
  surface: string | null
  // Opcionales para metadatos anteriores; null significa que OSM no lo define.
  lanes?: number | null
  // true = circula en el orden de los nodos: el pipeline invierte las vías
  // con oneway=-1 al empaquetar (scripts/lib/road-meta.mjs, orientar).
  oneway?: boolean | null
  tipo: Tipo
  municipio: string | null
  km: number
  km3d: number
}

export interface RoadsMeta { count: number; ways: Way[] }
export interface TerrainMeta {
  width: number; height: number
  bbox: { s: number; w: number; n: number; e: number }
  min: number; max: number
  origin: { lat: number; lon: number; h: number }
  // Rango de teselas z12 del DEM completo: la rejilla de la pirámide de
  // public/data/dem (nodoTerreno.ts). El post (c, f) de la tesela (tx, ty)
  // está en la coordenada de tesela (tx + c/256, ty + f/256).
  dem: { z: number; x0: number; y0: number; nx: number; ny: number }
}

// polygons: multipolígono en [lon, lat] — polígono[anillo][punto]. orphanFragments
// cuenta fragmentos de frontera OSM que no cerraron en anillo (ver build-data.mjs).
export interface Municipio { osmId: number; name: string; polygons: number[][][][]; orphanFragments: number }

export interface Registro { pci: number | null; fuente: Fuente; tipo: Tipo; fecha: string; nota: string }
