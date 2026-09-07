import { useLayoutEffect, useRef } from 'react'
import { Matrix4, Vector3 } from 'three'
import {
  Atmosphere, Sky as TakramSky, SunLight, SkyLight, AerialPerspective,
  type AtmosphereApi,
} from '@takram/three-atmosphere/r3f'
import { EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { ORIGIN } from '../data/constants'
import { makeEnuFrame } from '../data/enu'

// Nota: <Atmosphere> no expone un prop de origen — su marco de referencia es
// ECEF fijo (README, "Limitations": "The reference frame is fixed to ECEF
// and cannot be configured"). ORIGIN se re-exporta aquí (contrato de Task
// 10) para que la Task 11 rebase el terreno/cámara contra el mismo punto
// que usa el cielo.
export const SKY_ORIGIN = ORIGIN

// El escape hatch documentado para esa limitación es worldToECEFMatrix: no
// es un prop de <Atmosphere>, vive en AtmosphereApi (sección "Ref" del
// README) y se comparte por contexto — Sky/SunLight/SkyLight/AerialPerspective
// lo copian solos cada frame (src/r3f/*.tsx del paquete). Sin escribirlo
// arranca en identidad: el mundo de three.js se lee como ECEF real, así que
// una cámara/terreno a decenas de km del origen local cae dentro del
// elipsoide sólido (radio ~6.371 km) y el scattering sale negro — el
// diagnóstico que usó la Task 10 para explicar la pantalla negra de entonces.
//
// Ejes iguales a los de Terrain.tsx (mismo ORIGIN): mundo X=este, Y=arriba,
// Z=-norte. East/Up/-North se derivan de los senos/cosenos que ya calcula
// makeEnuFrame, no de Ellipsoid.getEastNorthUpVectors() de takram: da
// idéntico resultado (mismo a/b WGS84, verificado contra
// node_modules/@takram/three-geospatial/src/Ellipsoid.ts), pero reusar nuestro
// propio frame deja una sola fuente de verdad con el terreno en vez de dos
// implementaciones que "deberían" coincidir.
// Exportada (y no privada como nació) porque la foto trazada necesita la
// MISMA base para llevar la dirección del sol de ECEF a los ejes del mundo:
// getSunDirectionECEF() da un vector en ECEF y el DirectionalLight del
// trazador vive en X=este/Y=arriba/Z=-norte (foto/escena.ts). Rearmar la base
// por segunda vez es exactamente el duplicado que este archivo evita al
// derivarla de makeEnuFrame en vez de Ellipsoid.getEastNorthUpVectors().
export function worldToEcefMatrix (): Matrix4 {
  const f = makeEnuFrame(ORIGIN.lat, ORIGIN.lon, ORIGIN.h)
  const east = new Vector3(-f.sLon, f.cLon, 0)
  const up = new Vector3(f.cLat * f.cLon, f.cLat * f.sLon, f.sLat)
  const south = new Vector3(f.sLat * f.cLon, f.sLat * f.sLon, -f.cLat)
  const [x, y, z] = f.origin
  return new Matrix4().makeBasis(east, up, south).setPosition(x, y, z)
}

export function Sky ({ date }: { date: Date }) {
  const ref = useRef<AtmosphereApi>(null)
  // ORIGIN es constante — se escribe una sola vez. useLayoutEffect (no
  // useEffect) para que quede lista antes del primer frame renderizado;
  // si no, ese primer frame vería todavía la matriz identidad.
  useLayoutEffect(() => {
    ref.current?.worldToECEFMatrix.copy(worldToEcefMatrix())
  }, [])

  return (
    <Atmosphere
      ref={ref}
      date={date}
      // ajusta la esfera interna de la atmósfera para que sea tangente
      // (osculating sphere) al elipsoide WGS84 real en la posición
      // proyectada de la cámara: el elipsoide es oblato y la atmósfera se
      // aproxima con una esfera, la diferencia puede superar 10.000 m.
      // No tiene relación con si la escena está rebaseada a un origen
      // local. Ya es el valor por defecto, lo dejo explícito por claridad.
      correctAltitude
    >
      <TakramSky />
      {/* Sin position: el default local (0,0,0) ya es ORIGIN real una vez
          escrito worldToECEFMatrix arriba (nivel del mar en el centroide
          del Táchira), un punto de referencia razonable para
          transmitancia/irradiancia. SunDirectionalLight.update() y
          SkyLightProbe.update() multiplican la posición mundial del
          target/probe por worldToECEFMatrix — antes del rebase esa
          posición caía en el centro de la Tierra. */}
      <SunLight />
      <SkyLight />
      {/* ToneMapping es obligatorio, no cosmético: EffectComposer fuerza
          gl.toneMapping = NoToneMapping mientras está activo (three.js no
          permite tonemapping sobre render targets intermedios — ver
          EffectComposer.tsx del paquete), así que sin un paso de tonemapping
          en la cadena, la salida HDR de AerialPerspective sale sin mapear:
          cielo apagado/oscuro en vez de la exposición esperada. Los tres
          ejemplos manuales del README de three-atmosphere (post-process,
          light-source, mixed lighting — sección AerialPerspectiveEffect)
          siempre emparejan el efecto con ToneMappingEffect(AGX); acá es
          el mismo par, vía el componente r3f. */}
      <EffectComposer>
        <AerialPerspective />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </Atmosphere>
  )
}
