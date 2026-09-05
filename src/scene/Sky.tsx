import { Atmosphere, Sky as TakramSky, SunLight, SkyLight, AerialPerspective } from '@takram/three-atmosphere/r3f'
import { EffectComposer } from '@react-three/postprocessing'
import { ORIGIN } from '../data/constants'

// Nota: <Atmosphere> no expone un prop de origen — su marco de referencia es
// ECEF fijo. ORIGIN se re-exporta aquí (contrato de Task 10) para que la
// Task 11 rebase el terreno/cámara contra el mismo punto que usa el cielo.
export const SKY_ORIGIN = ORIGIN

export function Sky ({ date }: { date: Date }) {
  return (
    <Atmosphere
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
      <SunLight />
      <SkyLight />
      <EffectComposer>
        <AerialPerspective />
      </EffectComposer>
    </Atmosphere>
  )
}
