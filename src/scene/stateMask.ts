import type { Municipio } from '../data/types'

type Bbox = { w: number; e: number; n: number; s: number }

/**
 * Rasteriza el contorno del estado sobre la rejilla lat/lon del terreno:
 * 255 dentro, 0 fuera, un byte por vértice, fila 0 = norte (la misma rejilla
 * que arma Terrain.tsx).
 *
 * El contorno es la UNIÓN de los 29 municipios, no una frontera estatal
 * traída aparte: así el relieve recortado coincide exactamente con los
 * polígonos que asignan cada vía a su municipio. Una frontera "oficial" que
 * difiriera unos metros dejaría vías flotando fuera del terreno, y la barra
 * de cobertura contando municipios que el mapa no dibuja.
 *
 * Cada municipio se rasteriza por separado (par-impar entre sus propios
 * anillos) y se funde con OR sobre la misma máscara. Volcar los cruces de los
 * 29 a una sola lista par-impar parece equivalente y es más frágil: depende
 * de que dos vecinos compartan sus nodos EXACTOS en OSM, y donde no lo hacen
 * los cruces dejan de aparearse y se abre una grieta dentro del estado. Con
 * OR, el peor caso de un borde mal compartido es un píxel de solape, que no
 * se ve.
 */
export function stateMask (municipios: Municipio[], bbox: Bbox, W: number, H: number): Uint8Array {
  const mask = new Uint8Array(W * H)
  const latSpan = bbox.n - bbox.s
  const lonSpan = bbox.e - bbox.w
  const rowOf = (lat: number) => (bbox.n - lat) * (H - 1) / latSpan
  const colOf = (lon: number) => (lon - bbox.w) * (W - 1) / lonSpan

  // Tabla de aristas: cada segmento se visita solo en las filas que cruza.
  // El barrido ingenuo (cada fila contra cada segmento) son 1024 filas x
  // 132.165 segmentos = 135 M de iteraciones en el hilo principal, en plena
  // carga; así son ~1 fila por segmento. Se reusa entre municipios.
  const cruces: number[][] = Array.from({ length: H }, () => [])

  for (const m of municipios) {
    for (const poly of m.polygons) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const [lon0, lat0] = ring[i]
          const [lon1, lat1] = ring[(i + 1) % ring.length]
          const r0 = rowOf(lat0), r1 = rowOf(lat1)
          // Regla semiabierta [min, max): cada arista aporta exactamente un
          // cruce por cada fila que atraviesa, y las horizontales ninguno
          // (yIni > yFin, que además es lo que evita dividir entre
          // lat1 - lat0 == 0 más abajo). Sin ella un vértice justo sobre una
          // fila se contaría dos veces y daría vuelta el relleno.
          const yIni = Math.max(0, Math.ceil(Math.min(r0, r1)))
          const yFin = Math.min(H - 1, Math.ceil(Math.max(r0, r1)) - 1)
          for (let y = yIni; y <= yFin; y++) {
            const lat = bbox.n - latSpan * y / (H - 1)
            cruces[y].push(colOf(lon0 + (lon1 - lon0) * (lat - lat0) / (lat1 - lat0)))
          }
        }
      }
    }
    for (let y = 0; y < H; y++) {
      const xs = cruces[y]
      if (xs.length > 1) {
        xs.sort((a, b) => a - b)
        for (let i = 0; i + 1 < xs.length; i += 2) {
          // Misma regla semiabierta en x: se pinta el vértice cuya columna cae
          // en [x0, x1). Si el tramo queda fuera de la rejilla, x0 > x1 y
          // fill() no toca nada.
          const x0 = Math.max(0, Math.ceil(xs[i]))
          const x1 = Math.min(W - 1, Math.ceil(xs[i + 1]) - 1)
          mask.fill(255, y * W + x0, y * W + x1 + 1)
        }
      }
      xs.length = 0
    }
  }
  // Dos municipios vecinos no siempre comparten los nodos EXACTOS del borde
  // en OSM. Donde el borde de uno cae medio vértice al oeste del que dibuja
  // el otro, ninguno de los dos rellena esa columna y queda un pinchazo de un
  // vértice dentro del estado: 8 en la rejilla de 1024, invisibles de lejos y
  // agujeros de ~140 m por los que se ve el cielo cuando te acercas. Se tapan
  // al final -- un vértice apagado con los cuatro vecinos encendidos no puede
  // estar sobre el contorno real, haría falta que el estado tuviera una aguja
  // o un enclave de un solo vértice de ancho.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      if (!mask[i] && mask[i - 1] && mask[i + 1] && mask[i - W] && mask[i + W]) mask[i] = 255
    }
  }

  return mask
}

/**
 * El mismo barrido de stateMask, pero escribiendo QUIÉN en vez de SI: 0 fuera
 * del estado, i+1 para el municipio i. Es lo que el fragment del relieve lee
 * para saber dónde cambia de municipio y pintar ahí la línea de límite.
 *
 * Incluye el tapado de pinchazos de un vértice (como stateMask), pero aquí es
 * seguro porque el índice escrito nunca rompe la invariante: un vértice en el
 * contorno exterior del estado siempre tiene al menos un vecino en 0 (fuera),
 * así que nunca se llena. Un pinchazo en un borde compartido recibe uno de los
 * dos índices adyacentes, y la línea de límite se dibuja donde los índices
 * *difieren*, así que aparece de todas formas. Desaparecen solo los puntitos
 * de ruido donde un 0 rodeado de índices distintos dibujaría una línea falsa.
 *
 * En un solape gana el último que se rasteriza. Da igual cuál: dos municipios
 * de OSM solapan a lo sumo en un vértice de borde mal compartido, y ahí la
 * línea sale de todos modos porque los vecinos difieren.
 */
export function indiceMunicipios (municipios: Municipio[], bbox: Bbox, W: number, H: number): Uint8Array {
  // El 0 significa "fuera del estado", así que los municipios empiezan en 1 y
  // el último que cabe en un byte es el 255. Con uno más los índices darían la
  // vuelta en silencio: dos municipios distintos compartirían número y el
  // límite entre ellos simplemente no se dibujaría, sin error en ningún lado.
  if (municipios.length > 255) {
    throw new Error(`indiceMunicipios: ${municipios.length} municipios, no caben más de 255 en un byte`)
  }
  const idx = new Uint8Array(W * H)
  const latSpan = bbox.n - bbox.s
  const lonSpan = bbox.e - bbox.w
  const rowOf = (lat: number) => (bbox.n - lat) * (H - 1) / latSpan
  const colOf = (lon: number) => (lon - bbox.w) * (W - 1) / lonSpan
  const cruces: number[][] = Array.from({ length: H }, () => [])

  for (let m = 0; m < municipios.length; m++) {
    for (const poly of municipios[m].polygons) {
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const [lon0, lat0] = ring[i]
          const [lon1, lat1] = ring[(i + 1) % ring.length]
          const r0 = rowOf(lat0), r1 = rowOf(lat1)
          const yIni = Math.max(0, Math.ceil(Math.min(r0, r1)))
          const yFin = Math.min(H - 1, Math.ceil(Math.max(r0, r1)) - 1)
          for (let y = yIni; y <= yFin; y++) {
            const lat = bbox.n - latSpan * y / (H - 1)
            cruces[y].push(colOf(lon0 + (lon1 - lon0) * (lat - lat0) / (lat1 - lat0)))
          }
        }
      }
    }
    for (let y = 0; y < H; y++) {
      const xs = cruces[y]
      if (xs.length > 1) {
        xs.sort((a, b) => a - b)
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const x0 = Math.max(0, Math.ceil(xs[i]))
          const x1 = Math.min(W - 1, Math.ceil(xs[i + 1]) - 1)
          idx.fill(m + 1, y * W + x0, y * W + x1 + 1)
        }
      }
      xs.length = 0
    }
  }

  // Igual que en stateMask, tapar pinchazos de un vértice: donde OSM no compartió
  // nodos exactos en un borde, uno de los dos rellenos cae medio vértice al lado
  // del otro, dejando un píxel oscuro rodeado por los cuatro vecinos encendidos
  // (medición 2026-09-13: 3 pinchazos en la rejilla real de 256x256).
  // Taparlo es seguro: un vértice del contorno exterior del estado siempre
  // tiene al menos un vecino en 0 (fuera), así que esta condición nunca lo
  // alcanza; y en una frontera compartida entre dos municipios, la línea se
  // dibuja donde los índices *difieren* —cualquiera de los dos índices la
  // muestra correctamente. Solo desaparecen los puntitos de ruido donde habría
  // un 0 rodeado de índices diferentes.
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      if (!idx[i]) {
        const left = idx[i - 1]
        const right = idx[i + 1]
        const up = idx[i - W]
        const down = idx[i + W]
        if (left && right && up && down) {
          idx[i] = left
        }
      }
    }
  }

  return idx
}
