import { describe, expect, it, vi } from 'vitest'
// @ts-ignore -- igual que asfalto.test.ts: vitest usa Node, la app solo tipos de vite/client.
import { readFileSync } from 'node:fs'
// @ts-ignore -- ídem.
import { createRequire } from 'node:module'
import { CacheTeselas, decodificar, LADO, pixelesDelPng } from './demTiles'

const { PNG } = createRequire(import.meta.url)('pngjs')
/** Una tesela real del horneado, dentro del estado. */
const TESELA = 'public/data/dem/12/1226/1954.png'
const bytesDe = (b: Uint8Array<ArrayBuffer>) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)

describe('pixelesDelPng', () => {
  it('da los mismos bytes RGBA que pngjs, sin pasar por ningún canvas', async () => {
    const png = readFileSync(TESELA)
    const rgba = await pixelesDelPng(bytesDe(png))
    expect(rgba.length).toBe(LADO * LADO * 4)
    expect(rgba).toEqual(new Uint8Array(PNG.sync.read(png).data))
  })

  it('rechaza un PNG que no sea RGBA de 8 bits', async () => {
    const roto = new Uint8Array(readFileSync(TESELA))
    roto[25] = 2   // IHDR: tipo de color RGB sin alpha
    await expect(pixelesDelPng(roto.buffer)).rejects.toThrow(/RGBA/)
  })

  // La misma área (257·257 píxeles) en una sola fila pasaba como tesela válida
  // y sus consumidores la leían como rejilla: hay que exigir ancho Y alto.
  it('rechaza un PNG que no mida LADO×LADO aunque tenga los mismos píxeles', async () => {
    const roto = new Uint8Array(readFileSync(TESELA))
    const v = new DataView(roto.buffer)
    v.setUint32(16, LADO * LADO); v.setUint32(20, 1)   // IHDR: 66049×1
    await expect(pixelesDelPng(roto.buffer)).rejects.toThrow(/257/)
  })

  it('rechaza un PNG con la firma rota o sin IEND', async () => {
    const png = new Uint8Array(readFileSync(TESELA))
    const firma = png.slice(); firma[5] = 0
    await expect(pixelesDelPng(firma.buffer)).rejects.toThrow(/PNG/)
    const sinFin = png.slice(0, png.length - 12)   // IEND son los últimos 12 bytes
    await expect(pixelesDelPng(sinFin.buffer)).rejects.toThrow(/IEND/)
  })
})

describe('CacheTeselas', () => {
  // Brave (y cualquier navegador con protección anti-huella) altera los píxeles
  // que devuelve getImageData: un bit del canal R es ±256 m, un cono. En Node no
  // hay OffscreenCanvas ni createImageBitmap, así que este test solo pasa si la
  // tesela se decodifica de los bytes del PNG, nunca del canvas.
  it('pedir() deja la tesela decodificada de los bytes del PNG, byte a byte', async () => {
    const png = readFileSync(TESELA)
    const fetchOriginal = globalThis.fetch
    globalThis.fetch = (async () => new Response(png)) as typeof fetch
    try {
      const cache = new CacheTeselas('http://pruebas/dem')
      cache.pedir(12, 1226, 1954)
      await vi.waitFor(() => expect(cache.get(12, 1226, 1954)).toBeDefined(), { timeout: 5000 })
      const t = cache.get(12, 1226, 1954)!
      const ref = decodificar(PNG.sync.read(png).data)
      expect(t.alturas).toEqual(ref.alturas)
      expect(t.dentro).toEqual(ref.dentro)
    } finally {
      globalThis.fetch = fetchOriginal
    }
  })
})

describe('decodificar', () => {
  it('lee Terrarium y el alpha 255 como dentro', () => {
    const rgba = new Uint8Array(LADO * LADO * 4)
    // post (3, 2) = 1234.5 m: v = 1234.5 + 32768 = 34002.5 -> r=132, g=210, b=128
    const o = (2 * LADO + 3) * 4
    rgba[o] = 132; rgba[o + 1] = 210; rgba[o + 2] = 128; rgba[o + 3] = 255
    const t = decodificar(rgba)
    expect(t.alturas[2 * LADO + 3]).toBeCloseTo(1234.5, 2)
    expect(t.dentro[2 * LADO + 3]).toBe(1)
    expect(t.dentro[0]).toBe(0)
    expect(t.max).toBeCloseTo(1234.5, 2)
    expect(t.min).toBeCloseTo(-32768, 2)
  })

  it('el alpha 254 (fuera) no es dentro', () => {
    const rgba = new Uint8Array(LADO * LADO * 4).fill(254)
    expect(decodificar(rgba).dentro.every(v => v === 0)).toBe(true)
  })
})
