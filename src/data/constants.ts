export const ORIGIN = { lat: 8.021973, lon: -71.901563, h: 0 }
export const BBOX = { s: 7.3612911, w: -72.4878225, n: 8.6826552, e: -71.3153029 }
export const GRID = 1024
export const ATTR_SIZE = 164          // 164² = 26.896 ≥ 26.712 vías

// Rangos ASTM D6433
export const PCI_RANGES = [
  { min: 86, max: 100, label: 'Bueno',        color: [0.13, 0.62, 0.31] },
  { min: 71, max: 85,  label: 'Satisfactorio', color: [0.49, 0.75, 0.27] },
  { min: 56, max: 70,  label: 'Regular',      color: [0.95, 0.83, 0.25] },
  { min: 41, max: 55,  label: 'Deficiente',   color: [0.95, 0.60, 0.20] },
  { min: 26, max: 40,  label: 'Muy deficiente', color: [0.89, 0.36, 0.16] },
  { min: 11, max: 25,  label: 'Grave',        color: [0.78, 0.16, 0.16] },
  { min: 0,  max: 10,  label: 'Colapsado',    color: [0.45, 0.08, 0.12] },
] as const

export const SIN_EVALUAR: [number, number, number] = [0.45, 0.45, 0.45]

export const FUENTES = ['sin', 'heredado', 'estimado', 'medido'] as const
export const TIPOS = ['sin_definir', 'asfalto', 'concreto', 'granzon', 'tierra', 'empedrado'] as const

export function pciColor (pci: number | null): [number, number, number] {
  if (pci == null) return SIN_EVALUAR
  const r = PCI_RANGES.find(x => pci >= x.min && pci <= x.max)
  return r ? [...r.color] as [number, number, number] : SIN_EVALUAR
}
