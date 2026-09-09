import { Matrix4, Vector3 } from 'three'
import { getSunDirectionECEF } from '@takram/three-atmosphere'
import { ORIGIN } from '../data/constants'
import { makeEnuFrame } from '../data/enu'

// La base del mundo local vista desde ECEF. Ejes iguales a los de
// nodoTerreno.ts (mismo ORIGIN): mundo X=este, Y=arriba, Z=-norte, o sea sur.
// East/Up/-North se derivan de los senos/cosenos que ya calcula makeEnuFrame,
// no de Ellipsoid.getEastNorthUpVectors() de takram: da idéntico resultado
// (mismo a/b WGS84, verificado contra
// node_modules/@takram/three-geospatial/src/Ellipsoid.ts), pero reusar nuestro
// propio frame deja una sola fuente de verdad con el terreno en vez de dos
// implementaciones que "deberían" coincidir.
//
// ORIGIN es constante, así que la base se calcula una vez al cargar el módulo.
const f = makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)
const ESTE = new Vector3(-f.sLon, f.cLon, 0)
const ARRIBA = new Vector3(f.cLat * f.cLon, f.cLat * f.sLon, f.sLat)
const SUR = new Vector3(f.sLat * f.cLon, f.sLat * f.sLon, -f.cLat)

/**
 * La matriz mundo -> ECEF que <Atmosphere> necesita para no leer nuestro ENU
 * local como si fueran metros ECEF reales (ver el comentario largo de Sky.tsx).
 * Vive acá y no en Sky.tsx porque direccionSol usa exactamente la misma base:
 * si las dos se separaran, el sol del cielo y el sol del relieve podrían
 * apuntar a sitios distintos sin que nada fallara ruidosamente.
 */
export function worldToEcefMatrix (): Matrix4 {
  const [x, y, z] = f.origin
  return new Matrix4().makeBasis(ESTE, ARRIBA, SUR).setPosition(x, y, z)
}

/**
 * El nombre con el que vive en la escena la cascada de sombra más cercana.
 *
 * Vive acá, y no en TerrainLod.tsx (que la crea) ni en Roads.tsx (que la
 * busca), por la misma razón que vive acá `direccionSol`: es la luz de la
 * escena, no es de ninguno de los dos. Compartir la constante es lo que impide
 * que el nombre se cambie de un lado y el otro deje de encontrar la luz en
 * silencio -- la calzada volvería a salir a pleno sol dentro de la sombra del
 * relieve, sin un solo error en consola.
 *
 * Es la cascada 0 del CSM, la de menos alcance (CSM.js reparte `lights` en el
 * mismo orden que `frustums`). Con los ajustes de TerrainLod.tsx llega a unos
 * 876 m de la cámara, que cubre de sobra el rango donde la calzada dibuja
 * asfalto (~500 m en la Libertador).
 */
export const CASCADA_CERCA = 'cascada-cerca'

/** La fecha con la que arranca la escena si nadie pide otra. Mediodía largo
 *  sobre el Táchira: el sol a 48,8°, que es la luz con la que se leyó el mapa
 *  al calibrar el relieve y el asfalto. */
export const FECHA_POR_DEFECTO = '2026-09-05T14:00:00Z'

/**
 * La fecha de la escena, con `?hora=` de la barra de direcciones pisando el
 * valor por defecto (`?hora=2026-09-05T12:00:00Z` son las 8 de la mañana en el
 * Táchira, con el sol a 19°).
 *
 * Existe por una razón concreta y no por generalidad: de la altura del sol
 * dependen la exposición de la calzada (asfalto.ts, `luzVia`) y si hay sombra
 * proyectada que ver, y las dos cosas solo se pueden juzgar mirándolas. Sin
 * esto, cada comprobación pedía recompilar con otra constante escrita a mano.
 * Una fecha que no se entiende se ignora en silencio: es un parámetro de
 * inspección, no un dato del mapa, y no tiene por qué romper la aplicación.
 */
export function fechaDeEscena (search: string): Date {
  const q = new URLSearchParams(search).get('hora')
  const d = q ? new Date(q) : null
  return d && !Number.isNaN(d.getTime()) ? d : new Date(FECHA_POR_DEFECTO)
}

const ecef = new Vector3()

/**
 * Vector unitario HACIA el sol, en ejes del mundo (X este, Y arriba, Z sur),
 * para la fecha dada. `y` es directamente el seno de la altura solar: positivo
 * de día, negativo de noche.
 *
 * getSunDirectionECEF (astronomy-engine por dentro) es la MISMA función que
 * usa <Atmosphere> para colocar el sol del cielo, así que la sombra del
 * relieve y el disco solar no pueden desalinearse.
 *
 * La vuelta a nuestro marco no necesita invertir nada: la base es ortonormal,
 * así que su inversa es su transpuesta, y multiplicar por la transpuesta es
 * proyectar sobre cada columna -- tres productos punto. Como direcciones, sin
 * la traslación del origen (applyMatrix4 sí la aplicaría y el "sol" saldría
 * apuntando al centro de la Tierra).
 */
export function direccionSol (date: Date, out = new Vector3()): Vector3 {
  getSunDirectionECEF(date, ecef)
  return out.set(ecef.dot(ESTE), ecef.dot(ARRIBA), ecef.dot(SUR)).normalize()
}
