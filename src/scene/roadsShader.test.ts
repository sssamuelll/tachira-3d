import { test, expect } from 'vitest'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { patchLineMaterial, ANCLA_VERT, ANCLA_FRAG, PCI_COLOR_GLSL } from './roadsShader'
import { PCI_RANGES, pciColor } from '../data/constants'
import type { DataTexture } from 'three'

type Rule =
  | { op: '>' | '>='; threshold: number; color: number[] }
  | { fallback: true; color: number[] }

// Reconstruye, leyendo el texto GLSL generado (no reimplementando el
// generador), la misma cascada de if/return que ejecutaría el shader para un
// `pci` escalar. Es lo que permite comparar la salida REAL contra pciColor()
// en vez de comparar dos copias del mismo algoritmo.
function parseCascade (glsl: string): Rule[] {
  const rules: Rule[] = []
  for (const line of glsl.split('\n')) {
    const cond = line.match(/if \(pci (>=?) ([\d.]+)\) return vec3\(([^)]+)\);/)
    if (cond) {
      rules.push({ op: cond[1] as '>' | '>=', threshold: Number(cond[2]), color: cond[3].split(',').map(Number) })
      continue
    }
    const fallback = line.match(/^\s*return vec3\(([^)]+)\);/)
    if (fallback) rules.push({ fallback: true, color: fallback[1].split(',').map(Number) })
  }
  return rules
}

function pickColor (rules: Rule[], pci: number): number[] {
  for (const r of rules) {
    if ('fallback' in r) return r.color
    if (r.op === '>' ? pci > r.threshold : pci >= r.threshold) return r.color
  }
  throw new Error(`ninguna regla de la cascada cubrió pci=${pci}`)
}

test('el GLSL generado coincide con pciColor() en los 101 PCI enteros mas el centinela', () => {
  const rules = parseCascade(PCI_COLOR_GLSL)
  for (let pci = 0; pci <= 100; pci++) {
    expect(pickColor(rules, pci)).toEqual(pciColor(pci))
  }
  expect(pickColor(rules, 255)).toEqual(pciColor(255)) // 255 = centinela, ver encodeAttr
})

// El generador (roadsShader.ts) asume que PCI_RANGES viene ordenado
// descendente por `min` y que el último rango llega hasta 0 -- son los dos
// supuestos de los que depende leer la cascada como "el primero que matchea
// gana". pciRange()/pciColor() en TypeScript usan .find() sobre [min,max]
// completo y son insensibles al orden, así que nada más protege esto: si se
// reordena o se agrega un rango, TypeScript sigue correcto y el shader se
// desincroniza en silencio. Esta aserción fija el supuesto.
test('PCI_RANGES esta ordenado de mayor a menor por min, y el ultimo llega a 0', () => {
  for (let i = 1; i < PCI_RANGES.length; i++) {
    expect(PCI_RANGES[i].min).toBeLessThan(PCI_RANGES[i - 1].min)
  }
  expect(PCI_RANGES[PCI_RANGES.length - 1].min).toBe(0)
})

// Envuelve un LineMaterial REAL (no un shader inventado a mano) tal como lo
// recibiría onBeforeCompile de verdad -- así una actualización de three que
// mueva las anclas la agarra este test, no un usuario mirando un mapa mudo.
function realShader (material: LineMaterial) {
  return { uniforms: material.uniforms, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader }
}

test('las anclas existen de verdad en el LineMaterial instalado', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  expect(() => (material as any).onBeforeCompile(shader)).not.toThrow()
  expect(shader.vertexShader).toContain('attribute float segId;')
  expect(shader.fragmentShader).toContain('vAttr.r')
})

test('lanza si el ancla del vertex shader no aparece', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  shader.vertexShader = shader.vertexShader.replace(ANCLA_VERT, '// ancla removida')
  expect(() => (material as any).onBeforeCompile(shader)).toThrow(/ancla del vertex shader/)
})

test('lanza si el ancla de void main() no aparece en el fragment shader', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  shader.fragmentShader = shader.fragmentShader.replace(ANCLA_VERT, '// ancla removida')
  expect(() => (material as any).onBeforeCompile(shader)).toThrow(/ancla de void main\(\) en el fragment/)
})

test('lanza si el ancla de diffuseColor no aparece en el fragment shader', () => {
  const material = new LineMaterial()
  patchLineMaterial(material, {} as DataTexture, 164)
  const shader = realShader(material)
  shader.fragmentShader = shader.fragmentShader.replace(ANCLA_FRAG, '// ancla removida')
  expect(() => (material as any).onBeforeCompile(shader)).toThrow(/ancla del fragment shader/)
})
