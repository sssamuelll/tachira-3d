import type { FUENTES, TIPOS } from './constants'

export type Fuente = typeof FUENTES[number]
export type Tipo = typeof TIPOS[number]

export interface Way {
  osmId: number
  ref: string | null
  name: string | null
  highway: string
  surface: string | null
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
}

// polygons: multipolígono en [lon, lat] — polígono[anillo][punto]. orphanFragments
// cuenta fragmentos de frontera OSM que no cerraron en anillo (ver build-data.mjs).
export interface Municipio { osmId: number; name: string; polygons: number[][][][]; orphanFragments: number }

export interface Registro { pci: number | null; fuente: Fuente; tipo: Tipo; fecha: string; nota: string }
