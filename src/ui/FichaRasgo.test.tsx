import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FichaRasgo } from './FichaRasgo'
import type { Capa, Rasgo } from '../data/capas'

const capa: Capa = {
  id: 'hospitales', nombre: 'Hospitales', geometria: 'punto',
  campos: [
    { clave: 'nombre', nombre: 'Nombre', tipo: 'texto' },
    { clave: 'clase', nombre: 'Clase', tipo: 'opcion', opciones: ['hospital'], obligatorio: true },
    { clave: 'tipo', nombre: 'Tipo', tipo: 'opcion', opciones: ['publico', 'privado', 'sin_dato'], obligatorio: true },
    { clave: 'emergencias', nombre: 'Emergencias', tipo: 'booleano' },
  ],
  archivo: 'capas/hospitales.geojson', porDefecto: false, color: '#e0453a',
}

const rasgo = (properties: Record<string, unknown>) => ({
  type: 'Feature', id: 'osm/node/1',
  geometry: { type: 'Point', coordinates: [-72.2, 7.8] },
  properties,
} as unknown as Rasgo)

describe('FichaRasgo', () => {
  it('muestra cada campo del catálogo con su nombre legible', () => {
    const html = renderToStaticMarkup(<FichaRasgo capa={capa} onCerrar={() => {}}
      rasgo={rasgo({ nombre: 'Central', clase: 'hospital', origen: 'osm', osmId: 'node/1', version: 1 })} />)

    expect(html).toContain('Central')
    expect(html).toContain('Clase')
    expect(html).toContain('hospital')
  })

  it('enlaza a OSM cuando el rasgo viene de ahí', () => {
    const html = renderToStaticMarkup(<FichaRasgo capa={capa} onCerrar={() => {}}
      rasgo={rasgo({ clase: 'hospital', origen: 'osm', osmId: 'node/1', version: 1 })} />)

    expect(html).toContain('https://www.openstreetmap.org/node/1')
  })

  it('sin osmId no inventa un enlace', () => {
    const html = renderToStaticMarkup(<FichaRasgo capa={capa} onCerrar={() => {}}
      rasgo={rasgo({ clase: 'hospital', origen: 'comunidad', version: 1 })} />)

    expect(html).not.toContain('openstreetmap.org')
  })

  // Un campo que OSM no trae no se inventa ni se muestra como "false": no
  // saber si un hospital tiene emergencias no es lo mismo que saber que no.
  it('omite los campos que el rasgo no trae', () => {
    const html = renderToStaticMarkup(<FichaRasgo capa={capa} onCerrar={() => {}}
      rasgo={rasgo({ clase: 'hospital', origen: 'osm', osmId: 'node/1', version: 1 })} />)

    expect(html).not.toContain('Emergencias')
  })

  it('dice un booleano en palabras, no como true', () => {
    const html = renderToStaticMarkup(<FichaRasgo capa={capa} onCerrar={() => {}}
      rasgo={rasgo({ clase: 'hospital', emergencias: true, origen: 'osm', osmId: 'node/1', version: 1 })} />)

    // Se comprueba el TEXTO renderizado, no el documento entero: la ficha
    // lleva un `<span aria-hidden>` para el punto de color, y React lo escribe
    // como aria-hidden="true". Un `.not.toContain('true')` a secas se comería
    // ese atributo y fallaría con el componente perfectamente bien.
    expect(html).toContain('>Sí<')
    expect(html).not.toContain('>true<')
  })

  it('nombra de dónde salió el dato', () => {
    const html = renderToStaticMarkup(<FichaRasgo capa={capa} onCerrar={() => {}}
      rasgo={rasgo({ clase: 'hospital', origen: 'comunidad', version: 2 })} />)

    expect(html).toContain('comunidad')
  })

  // sin_dato es el valor de 122 de los 127 hospitales -- la cadena más leída
  // de toda la ficha -- y un guion bajo es jerga de programador, no de vecino.
  it('un valor de opción con guion bajo se lee con espacio', () => {
    const html = renderToStaticMarkup(<FichaRasgo capa={capa} onCerrar={() => {}}
      rasgo={rasgo({ clase: 'hospital', tipo: 'sin_dato', origen: 'osm', osmId: 'node/1', version: 1 })} />)

    expect(html).toContain('sin dato')
    expect(html).not.toContain('sin_dato')
  })
})
