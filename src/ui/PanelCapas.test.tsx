import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PanelCapas } from './PanelCapas'

const filas = [
  { id: 'edificios', nombre: 'Edificaciones' },
  { id: 'municipios', nombre: 'Municipios' },
  { id: 'hospitales', nombre: 'Hospitales y centros médicos', color: '#e0453a' },
]

describe('PanelCapas', () => {
  it('lista una fila por capa, con su nombre', () => {
    const html = renderToStaticMarkup(
      <PanelCapas disponibles={filas} visibles={new Set(['edificios'])} onAlternar={() => {}} />)

    for (const f of filas) expect(html).toContain(f.nombre)
  })

  // aria-pressed es lo que dice el estado a un lector de pantalla, y es
  // también lo que el E2E puede consultar sin depender del estilo.
  it('marca como pulsadas solo las capas visibles', () => {
    const html = renderToStaticMarkup(
      <PanelCapas disponibles={filas} visibles={new Set(['municipios'])} onAlternar={() => {}} />)

    // Se parte el HTML por botón y se mira CADA UNO. Un `toMatch` sobre el
    // documento entero puede casar el aria-pressed de un botón con el nombre
    // del siguiente y pasar sin que nada esté bien.
    const botones = html.split('<button').slice(1)
    expect(botones).toHaveLength(3)
    const estado = Object.fromEntries(botones.map(b => [
      filas.find(f => b.includes(f.nombre))!.id,
      b.includes('aria-pressed="true"'),
    ]))
    expect(estado).toEqual({ edificios: false, municipios: true, hospitales: false })
  })

  it('pinta la muestra de color de las capas que declaran uno', () => {
    const html = renderToStaticMarkup(
      <PanelCapas disponibles={filas} visibles={new Set()} onAlternar={() => {}} />)

    expect(html).toContain('#e0453a')
  })
})
