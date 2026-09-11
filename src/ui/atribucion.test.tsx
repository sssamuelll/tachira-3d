import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Atribucion } from './MapControls'

// ODbL exige atribuir a OpenStreetMap siempre que se muestren sus datos, y
// las vías, los edificios y los municipios se ven con la imagen apagada. La
// atribución de Esri es distinta: solo aplica cuando su imagen está en
// pantalla.

describe('Atribucion', () => {
  it('nombra a OpenStreetMap y su licencia aunque la imagen esté apagada', () => {
    const html = renderToStaticMarkup(<Atribucion imagen={false} />)

    expect(html).toContain('OpenStreetMap')
    expect(html).toContain('ODbL')
  })

  it('nombra el terreno, que no es de OSM', () => {
    expect(renderToStaticMarkup(<Atribucion imagen={false} />)).toContain('Terrarium')
  })

  it('con la imagen apagada no atribuye a Esri, porque no se está usando', () => {
    const html = renderToStaticMarkup(<Atribucion imagen={false} />)

    expect(html).toContain('OpenStreetMap')
    expect(html).not.toContain('Esri')
  })

  it('con la imagen prendida, añade a Esri sin quitar lo demás', () => {
    const html = renderToStaticMarkup(<Atribucion imagen />)

    expect(html).toContain('Esri')
    expect(html).toContain('OpenStreetMap')
  })

  it('no recorta: un crédito obligatorio cortado no cumple', () => {
    // Con nowrap más ellipsis, en un teléfono angosto se perdía el final de
    // "(ODbL)". Se prefiere que la línea se parta en dos.
    const html = renderToStaticMarkup(<Atribucion imagen />)

    expect(html).not.toContain('nowrap')
    expect(html).not.toContain('ellipsis')
  })
})
