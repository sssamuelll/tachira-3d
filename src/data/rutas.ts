/**
 * Dónde vive cada dato del mapa. Es el único sitio que lo decide.
 *
 * Hay dos clases de dato y no siempre están en el mismo sitio:
 *
 *  - VERSIONADOS: pequeños, en git, se despliegan junto al sitio. Hoy
 *    `piezas/`. Viajan siempre con el código, para que un clon del repo
 *    los tenga sin bajar nada.
 *  - GENERADOS: los hornea el pipeline y no caben en git. Hoy también viajan
 *    junto al sitio; cuando pasen de lo que GitHub Pages admite, `VITE_DATOS`
 *    los manda a un bucket sin que ningún consumidor se entere.
 *
 * Las dos parten de `BASE_URL`, que Vite rellena desde `base` en
 * vite.config.ts y SIEMPRE termina en barra. Eso es lo que hace que el sitio
 * funcione bajo `/tachira-3d/`: una ruta escrita con barra inicial se iría a
 * la raíz del dominio y daría 404.
 *
 * Las dos leen el entorno EN CADA LLAMADA, no al importar el módulo: así una
 * prueba puede cambiarlo con vi.stubEnv.
 */

/** El raíz de datos del propio sitio. BASE_URL ya trae la barra final. */
const raizDelSitio = () => `${import.meta.env.BASE_URL}data`

/** Datos versionados en git: siempre junto al sitio. */
export function urlVersionado (rel: string): string {
  return `${raizDelSitio()}/${rel}`
}

/** Datos generados por el pipeline: junto al sitio, o donde diga VITE_DATOS. */
export function urlGenerado (rel: string): string {
  const externo = import.meta.env.VITE_DATOS
  return externo ? `${externo.replace(/\/$/, '')}/${rel}` : `${raizDelSitio()}/${rel}`
}
