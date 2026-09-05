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
      // el scattering necesita la altitud real de la cámara aunque la
      // escena esté rebaseada al origen local (ya es el valor por defecto,
      // explícito aquí porque de eso depende la Task 11)
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
