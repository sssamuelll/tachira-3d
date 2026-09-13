/**
 * De dónde sale la primera versión de cada capa: una consulta a Overpass y una
 * traducción de sus elementos a rasgos.
 *
 * Añadir una capa sembrada desde OSM es añadir una entrada acá y otra en el
 * catálogo de src/data/capas.ts. Eso alcanza para una capa de puntos; una de
 * línea o polígono además necesita el componente que la dibuje, que todavía
 * no existe (CONTRIBUTING.md).
 */

const BBOX = '7.3612911,-72.4878225,8.6826552,-71.3153029'   // s,w,n,e, como quiere Overpass

const CLASES = { hospital: 'hospital', clinic: 'clinica', doctors: 'consultorio' }
const CLASES_HEALTHCARE = {
  hospital: 'hospital', clinic: 'clinica', doctor: 'consultorio', centre: 'ambulatorio',
}
const PUBLICOS = new Set(['public', 'government', 'community'])

export const REGISTRO = {
  hospitales: {
    consulta: `[out:json][timeout:300];
(
  nwr[amenity=hospital](${BBOX});
  nwr[amenity~"^(clinic|doctors)$"](${BBOX});
  nwr[healthcare~"^(hospital|clinic|centre|doctor)$"](${BBOX});
);
out center;`,

    traducir (el) {
      const tags = el.tags ?? {}
      // amenity manda sobre healthcare: es la etiqueta que la comunidad de OSM
      // mantiene mejor en Venezuela, y las dos suelen venir juntas.
      const clase = CLASES[tags.amenity] ?? CLASES_HEALTHCARE[tags.healthcare] ?? null
      if (!clase) return null
      // Un node trae lat/lon; un way o una relation traen su center, porque
      // `out center` los resume a un punto. Sin punto no hay marcador.
      const lat = el.lat ?? el.center?.lat
      const lon = el.lon ?? el.center?.lon
      if (lat === undefined || lon === undefined) return null

      const properties = {
        nombre: tags.name ?? '',
        clase,
        tipo: PUBLICOS.has(tags['operator:type']) ? 'publico'
          : tags['operator:type'] === 'private' ? 'privado' : 'sin_dato',
        origen: 'osm',
        osmId: `${el.type}/${el.id}`,
        version: 1,
      }
      // Omitido cuando OSM no lo dice: false significaría "no tiene
      // emergencias", que es una afirmación que nadie hizo.
      if (tags.emergency === 'yes') properties.emergencias = true
      else if (tags.emergency === 'no') properties.emergencias = false

      return {
        type: 'Feature',
        id: `osm/${el.type}/${el.id}`,
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties,
      }
    },
  },
}
