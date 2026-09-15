import { describe, it, expect } from 'vitest'
// @ts-ignore -- igual que buildings.test.ts: vitest corre en Node, la app solo
// tiene los tipos de vite/client. El repo no depende de @types/node.
import { readFileSync, readdirSync } from 'node:fs'
import { TOKENS_CLARO, TOKENS_OSCURO, cssDeTokens } from './tema'
import { T } from './theme'

describe('los tokens del tema', () => {
  it('las dos paletas declaran exactamente los mismos tokens', () => {
    expect(Object.keys(TOKENS_OSCURO).sort()).toEqual(Object.keys(TOKENS_CLARO).sort())
  })

  it('todo lo que T expone como color apunta a un token declarado', () => {
    for (const [clave, valor] of Object.entries(T)) {
      if (typeof valor !== 'string' || !valor.startsWith('var(')) continue
      const token = valor.slice(6, -1)   // var(--fondo) -> fondo
      expect(TOKENS_CLARO, `T.${clave} apunta a --${token}, que no existe`).toHaveProperty(token)
    }
  })

  it('el CSS declara la paleta clara en :root y la oscura bajo data-tema', () => {
    const css = cssDeTokens(TOKENS_CLARO, TOKENS_OSCURO)
    expect(css).toContain(':root{')
    expect(css).toContain('[data-tema="oscuro"]')
    expect(css).toContain('--fondo:')
  })

  // La regla que no se cruza: el color del DATO no puede entrar acá. Un verde
  // que significa "pavimento bueno" tiene que ser el mismo de día y de noche.
  //
  // Los dos lados se normalizan a triplete rgb antes de comparar. Comparar el
  // hex del token contra lo que css3() devuelve (`rgb(33,158,79)`) no casaría
  // NUNCA, y el test pasaría siempre sin comprobar nada.
  it('ningún token es un color de la rampa del PCI', async () => {
    const { PCI_RANGES } = await import('../data/constants')
    // null ya NO significa "sáltatelo" sin más (Arreglo 3): antes, un formato
    // de color que este conversor no entendía -- hex de 8 dígitos como
    // '#219e4fff', o la sintaxis de espacios 'rgb(33 158 79)' -- devolvía null
    // igual que una sombra, y el bucle de abajo lo saltaba con `continue` sin
    // comprobar nada. Los dos son CSS válido y los dos pueden ser, sin que
    // nadie lo note, el mismo verde de la rampa del PCI.
    //
    // La distinción ahora es por FORMA, no por si el regex hizo match: un
    // valor que no arranca con '#' ni con 'rgb' no tiene pinta de color suelto
    // (las sombras arrancan con un número, ej. '0 1px 2px rgba(...)') y se
    // sigue saltando. Uno que SÍ arranca así pero no matchea ninguno de los
    // dos formatos conocidos revienta el test con un mensaje que dice qué
    // formato no entendió, en vez de ir añadiendo formatos uno a uno.
    const rgbDe = (v: string): string | null => {
      const t = v.trim()
      const hex = /^#([0-9a-f]{6})$/i.exec(t)
      if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).join(',')
      const rgb = /^rgba?\(([^)]+)\)$/i.exec(t)
      if (rgb) {
        const partes = rgb[1].split(',').slice(0, 3).map(n => Math.round(+n))
        if (partes.every(Number.isFinite)) return partes.join(',')
      }
      if (!/^#|^rgba?\(/i.test(t)) return null   // sombras y demás: no son un color suelto
      throw new Error(`rgbDe(): "${v}" tiene pinta de color pero este conversor no entiende su formato`)
    }
    const delDato = new Set(PCI_RANGES.map(r => r.color.map(c => Math.round(c * 255)).join(',')))
    // Las dos paletas se recorren POR SEPARADO. Fusionarlas con
    // `{ ...CLARO, ...OSCURO }` las colapsa por clave -- las dos declaran los
    // mismos 15 nombres -- y solo quedarían los valores de la oscura. La clara
    // es justamente la que se aplica mientras nadie toque `data-tema`, así que
    // ese fusionado vigilaba el lado inerte y dejaba suelto el que importa.
    for (const [nombre, tokens] of [['clara', TOKENS_CLARO], ['oscura', TOKENS_OSCURO]] as const) {
      for (const [clave, valor] of Object.entries(tokens)) {
        const rgb = rgbDe(valor)
        if (rgb === null) continue
        expect(delDato.has(rgb),
          `--${clave} de la paleta ${nombre} (${valor}) es un color de la rampa del PCI`).toBe(false)
      }
    }
  })
})

// Fórmula de luminancia relativa de WCAG 2.x: el contraste real que ve un
// ojo, no una distancia de bytes entre dos hex que podría no decir nada de
// legibilidad.
function luminancia (hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) throw new Error(`luminancia(): no es un hex de 6 dígitos: "${hex}"`)
  const [r, g, b] = m.slice(1, 4).map(h => {
    const c = parseInt(h, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contraste = (a: string, b: string): number => {
  const [L1, L2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (L1 + 0.05) / (L2 + 0.05)
}

// El acento conmuta con el tema (Arreglo 2); el texto/icono que va encima
// tiene que conmutar con él o el contraste se cae en uno de los dos lados.
// Blanco fijo daba 7,03:1 en claro pero 2,71:1 en oscuro -- por debajo del
// 4,5:1 de WCAG AA.
describe('sobreAcento sobre acento cumple WCAG AA', () => {
  it('el contraste real es >= 4,5:1 en las dos paletas', () => {
    for (const [nombre, tokens] of [['clara', TOKENS_CLARO], ['oscura', TOKENS_OSCURO]] as const) {
      const c = contraste(tokens.sobreAcento, tokens.acento)
      expect(c, `sobreAcento sobre acento en la paleta ${nombre} da ${c.toFixed(2)}:1`)
        .toBeGreaterThanOrEqual(4.5)
    }
  })
})

// index.html pinta la pantalla ANTES de que exista `<div id="root">` con algo
// adentro -- ahí no hay React, así que no puede leer T.texto ni nada por el
// estilo. Solo tiene el CSS en línea de su propio <style>. Si ese bloque trae
// un color de chrome escrito a mano, ese color no conmuta con el tema nunca
// (Arreglo 1): el texto de carga puede terminar ilegible sobre el fondo oscuro.
describe('index.html', () => {
  it('su bloque de estilo no deja colores de chrome sueltos', () => {
    const html = readFileSync('index.html', 'utf8')
    const bloque = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1]
    expect(bloque, 'index.html no tiene bloque <style>').toBeTruthy()
    // Un var(--token, #rrggbb) SÍ puede traer un color de reserva adentro --
    // es la paleta clara para el instante antes de que main.tsx inyecte los
    // tokens de verdad. Se retira la llamada entera (reserva incluida) antes
    // de buscar un color suelto: lo prohibido es un literal que NO esté
    // envuelto en una reserva de var().
    const sinReservas = bloque!.replace(/var\([^)]*\)/g, '')
    const colorSuelto = /#[0-9a-f]{3,8}\b|rgba?\(/i.exec(sinReservas)
    expect(colorSuelto,
      `index.html tiene un color de chrome fuera de var(--token, ...): "${colorSuelto?.[0]}"`)
      .toBeNull()
  })
})

// Arreglo 3 (review de rama, Task 8): un fondo de chrome (paneles, controles,
// atribución) escrito a mano como rgba(255,255,255,…) o rgba(0,0,0,…) no
// conmuta con el tema -- es exactamente el bug de <Atribucion>
// (MapControls.tsx), que con un fondo blanco fijo daba 1,11:1 de contraste
// sobre escena oscura y 2,19:1 sobre blanca. El token correcto ya existe
// (etiquetaFondo, arriba) y lo usa la etiqueta flotante de los marcadores; un
// `background` fijo en blanco o negro traslúcido es siempre una
// reimplementación a mano de eso.
//
// El barrido es sobre los .tsx de src/ui/ (sin sus *.test.tsx) más
// src/App.tsx -- ahí vive el chrome de la interfaz. tema.ts/theme.ts quedan
// fuera a propósito: son la fuente de los tokens, y ahí SÍ tienen que vivir
// los literales (etiquetaFondo es justamente 'rgba(255,255,255,.82)' en la
// paleta clara).
//
// Tres rgba(...) del código actual NO son este bug -- de hecho ninguno de
// los tres calza con este barrido, y se documentan igual para que quede
// escrito por qué, no porque el regex necesite excluirlos a mano:
//   - src/foto/Foto.tsx:129 -- rgba(31,33,36,.28) oscurece la escena 3D
//     mientras se traza una foto, no es chrome (ya juzgado correcto y fijo
//     en un review anterior); además vive fuera de src/ui/.
//   - src/ui/SearchPanel.tsx:32 -- rgba(0,0,0,.12) es un boxShadow (filete
//     interior), no un background, y decora una muestra de color que es
//     DATO (el PCI de un resultado de búsqueda), no chrome.
//   - src/ui/LassoOverlay.tsx -- rgba(21,96,122,.12) es el `fill` del SVG
//     del lazo, no un background; sigue pendiente y ya está anotado como tal
//     en el propio archivo -- no se toca en esta tanda.
describe('ningún fondo de chrome usa blanco/negro fijo en vez de un token', () => {
  const PROHIBIDO = /background:\s*['"]rgba\(\s*(?:255\s*,\s*255\s*,\s*255|0\s*,\s*0\s*,\s*0)\s*,/

  const dir = 'src/ui'
  const archivos: string[] = readdirSync(dir)
    .filter((f: string) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .map((f: string) => `${dir}/${f}`)
    .concat('src/App.tsx')

  for (const ruta of archivos) {
    it(`${ruta} no tiene un background rgba(255,255,255,…) ni rgba(0,0,0,…) fijo`, () => {
      const texto: string = readFileSync(ruta, 'utf8')
      expect(PROHIBIDO.test(texto), `${ruta} tiene un background blanco/negro fijo -- usa T.etiquetaFondo`).toBe(false)
    })
  }
})
