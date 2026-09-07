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
