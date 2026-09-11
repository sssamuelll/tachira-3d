/** Caja ENU, X este / Z sur, en metros del mapa. */
export interface CajaSustituida { minX: number; maxX: number; minZ: number; maxZ: number }

export interface Pieza {
  id: string
  nombre: string
  lat: number
  lon: number
  glb: string
  /** Grados horarios desde el norte (-Z); omitido equivale a 0°.
   * Es la rotación del marco canónico del GLB, no una orientación medida. */
  rumbo?: number
  /** Dónde la pieza REEMPLAZA al bloque genérico de OSM. Sin esto, el prisma
   * estimado del horneado se vería dentro de la pieza. Se declara como caja y
   * no como lista de ids porque el cliente dibuja un binario fusionado por
   * tesela y no carga la metadata que traduce id → rango de índices. Lo que
   * cae dentro lo fija una prueba contra los datos reales, no la confianza. */
  sustituye?: CajaSustituida
  representación: 'generada'
}

/** Metros, X este / Y arriba / Z -norte; origen en el centro del apoyo.
 * Añadir una entrada incorpora otra pieza sin cambiar el cargador. */
export const PIEZAS: readonly Pieza[] = [
  {
    id: 'node/2958281048',
    nombre: 'Obelisco de los Italianos',
    // El nodo de OSM está mal situado: cae 1,7 km al noroeste de donde está el
    // monumento. El punto lo dio Samuel, que conoce la ciudad, y luego se
    // desplazó 5,4 m al centro del hueco medido entre calzadas. Monumento e
    // isla COMPARTEN centro: son la misma obra y tienen que ir concéntricos.
    lat: 7.76865841602524,
    lon: -72.21417741143414,
    glb: '/data/piezas/obelisco-italianos.glb',
    // Samuel, que conoce el sitio: el fuste va unos 10° girado a la izquierda,
    // ortogonal a las direcciones de la avenida. Horario desde el norte, así que
    // a la izquierda es negativo. Sigue sin ser un rumbo levantado en campo.
    rumbo: -10,
    representación: 'generada',
  },
  {
    id: 'obelisco/ovalo',
    nombre: 'Óvalo de protección y fuentes del Obelisco',
    // Mismo centro que el monumento: lo rodea.
    lat: 7.76865841602524,
    lon: -72.21417741143414,
    glb: '/data/piezas/obelisco-ovalo.glb',
    // Samuel: el óvalo va 90° girado respecto al fuste. El monumento conserva su
    // dirección; la isla cruza. De ahí -10 + 90.
    rumbo: 80,
    representación: 'generada',
  },
  // Los dos viaductos van SIN rumbo: su directriz es la geometría real de OSM,
  // ya orientada. Girarlos la estropearía.
  {
    id: 'way/1203013290',
    nombre: 'Viaducto Viejo',
    lat: 7.76271285,
    lon: -72.23427815,
    glb: '/data/piezas/viaducto-viejo.glb',
    representación: 'generada',
  },
  {
    id: 'way/74534876',
    nombre: 'Viaducto Nuevo',
    lat: 7.76432975,
    lon: -72.2206145,
    glb: '/data/piezas/viaducto-nuevo.glb',
    representación: 'generada',
  },
  {
    // Sin rumbo, por lo mismo que los viaductos: la planta sale del
    // multipolígono real de OSM y ya está orientada. El punto es el centro de
    // su caja, que es el origen con el que se exportó el GLB.
    id: 'relation/3499128',
    nombre: 'Centro Cívico de San Cristóbal',
    lat: 7.7674716,
    lon: -72.2326948,
    glb: '/data/piezas/centro-civico.glb',
    // La caja de la huella de OSM, redondeada 1 cm hacia fuera. Dentro caen el
    // multipolígono y tres `building=roof` que son las cubiertas del propio
    // zócalo, ya modeladas en el GLB.
    sustituye: { minX: -36544.72, maxX: -36468.39, minZ: 28093.95, maxZ: 28177.45 },
    representación: 'generada',
  },
  {
    // La manzana pegada al norte del Centro Cívico. Sin rumbo por lo mismo, y
    // SIN `sustituye`: dentro del perímetro no hay ninguna huella de OSM que
    // pisar. El punto es el centroide de los vértices de la plaza, que es el
    // origen con el que se exportó el GLB.
    id: 'way/1326164631',
    nombre: 'Plaza Bolívar',
    lat: 7.7679729,
    lon: -72.232404,
    glb: '/data/piezas/plaza-bolivar.glb',
    representación: 'generada',
  },
]

/** Las cajas de sustitución que tocan la caja de un chunk de edificios,
 * `[minX, minY, minZ, maxX, maxY, maxZ]`. Casi siempre ninguna. */
export function cajasSustituidas (bounds: readonly number[]): CajaSustituida[] {
  const dentro: CajaSustituida[] = []
  for (const pieza of PIEZAS) {
    const caja = pieza.sustituye
    if (!caja) continue
    if (caja.maxX < bounds[0] || caja.minX > bounds[3]) continue
    if (caja.maxZ < bounds[2] || caja.minZ > bounds[5]) continue
    dentro.push(caja)
  }
  return dentro
}

/** Quita del índice los triángulos que la pieza sustituye. Decide por
 * centroide: vaciar por vértice suelto abriría agujeros en el edificio vecino
 * que comparte pared con el borde de la caja. */
export function vaciarSustituidos (
  positions: Float32Array, indices: Uint32Array, cajas: readonly CajaSustituida[],
): Uint32Array {
  if (cajas.length === 0) return indices
  const quedan = new Uint32Array(indices.length)
  let n = 0
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3
    const x = (positions[a] + positions[b] + positions[c]) / 3
    const z = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3
    let fuera = true
    for (const caja of cajas) {
      if (x >= caja.minX && x <= caja.maxX && z >= caja.minZ && z <= caja.maxZ) { fuera = false; break }
    }
    if (fuera) {
      quedan[n++] = indices[i]
      quedan[n++] = indices[i + 1]
      quedan[n++] = indices[i + 2]
    }
  }
  return n === indices.length ? indices : quedan.subarray(0, n)
}
