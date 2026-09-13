import { useCallback, useLayoutEffect, useRef } from 'react'
import {
  Atmosphere, Sky as TakramSky, SunLight, SkyLight, AerialPerspective,
  type AtmosphereApi,
} from '@takram/three-atmosphere/r3f'
import { EffectComposer, N8AO, ToneMapping, SMAA } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { ORIGIN } from '../data/constants'
import { worldToEcefMatrix } from './sol'

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
// La matriz vive en sol.ts, con la base este/arriba/sur de la que también sale
// la dirección del sol que ilumina el relieve: una sola fuente de verdad para
// las dos. Ver el comentario de allá.

// Lo que hace falta apagarle a N8AO y su componente de r3f no expone. El
// paquete no trae tipos, así que se describe por su forma.
interface PaseAO {
  autoDetectTransparency: boolean
  configuration: { transparencyAware: boolean }
}

export function Sky ({ date }: { date: Date }) {
  const ref = useRef<AtmosphereApi>(null)
  // ORIGIN es constante — se escribe una sola vez. useLayoutEffect (no
  // useEffect) para que quede lista antes del primer frame renderizado;
  // si no, ese primer frame vería todavía la matriz identidad.
  useLayoutEffect(() => {
    ref.current?.worldToECEFMatrix.copy(worldToEcefMatrix())
  }, [])

  // N8AO trae un modo "consciente de la transparencia" que se ENCIENDE SOLO en
  // cuanto encuentra un material transparente en la escena, y las 16 capas de
  // vías lo son todas (LineMaterial con transparent: true). Encendido, cada
  // cuadro hace tres recorridos completos del grafo y DOS renders extra de la
  // escena entera para separar los transparentes. Medido en Chrome sobre el
  // valle de San Cristóbal: 50 fps -> 13. Apagado no se pierde nada aquí: las
  // vías son calcomanías pegadas al relieve, la oclusión que importa es la del
  // relieve que tienen debajo.
  //
  // Va como ref de CALLBACK y no como useRef + useLayoutEffect: <EffectComposer>
  // monta sus hijos por su cuenta y el objeto todavía no está enganchado cuando
  // corren los efectos de este componente (comprobado en Chrome: ao.current era
  // null). Un ref de callback corre justo cuando se engancha, sin adivinar.
  const ajustarAO = useCallback((p: PaseAO | null) => {
    if (!p) return
    p.autoDetectTransparency = false
    p.configuration.transparencyAware = false
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
      {/* visible={false} a propósito, y no quitado: la luz direccional de la
          escena la ponen las cascadas de CSM (una por cascada, TerrainLod.tsx)
          y sumar además esta sería un cuarto sol, sin sombra, doblando la
          iluminación. Pero <SunLight> sigue haciendo falta montado: su
          useFrame llama a SunDirectionalLight.update() sin mirar `visible`, y
          eso es lo que calcula el color del sol contra la transmitancia de la
          atmósfera (getSunLightColor) para esta fecha y esta posición.
          TerrainLod lo busca por su nombre y copia ese color a las cascadas.
          Sin el nombre, la luz del terreno sería un blanco inventado que no
          casaría con el cielo dibujado. */}
      <SunLight name="sol" visible={false} />
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
      {/* multisampling={0} y no el 8 por defecto del paquete
          (node_modules/@react-three/postprocessing/dist/index.js:328,
          `multisampling = 8, frameBufferType = HalfFloatType`). Ocho muestras
          sobre un buffer RGBA16F son ancho x alto x 8 bytes x 8: a 2560x1440,
          236 MB en UN target, y el composer hace ping-pong. En 4 GB, donde ya
          viven 300 teselas de imagen (~105 MB), los chunks de edificios (96
          MiB), el target de picking a resolucion completa y tres shadow maps,
          ese es el presupuesto que faltaba.
          Y ademas MSAA solo toca bordes de geometria: el hormigueo de la
          calzada es aliasing de shader y no lo arreglaba de todos modos.
          SMAA cubre los bordes por un pase de pantalla completa. Calibrable:
          si algo se ve mal, 2 antes que volver a 8. */}
      <EffectComposer multisampling={0}>
        {/* Oclusión ambiental. Va ANTES de AerialPerspective: la oclusión
            oscurece la luz que llega del cielo a los pliegues del relieve, y
            eso pasa en el terreno, antes de que la neblina de la atmósfera se
            sume por delante. Oscurecer después apagaría la neblina, que no
            está ocluida por nada.

            N8AO y no el GTAO del core de three: sobre el relieve, GTAO deja un
            halo claro alrededor de cada cresta contra el cielo (su
            reconstrucción de profundidad no distingue el borde del fondo).
            Es un Pass entero, no un Effect, así que parte la cadena en dos
            EffectPass -- por eso va de primero, donde solo cuesta el corte.

            screenSpaceRadius, y aoRadius en PÍXELES, no en metros de mundo.
            Empezó siendo 60 m de mundo (el orden de una quebrada del Táchira)
            y era insostenible: a 125 m de altura la pantalla entera mide 150 m,
            así que cada muestra iba a buscar un téxel al otro extremo del
            buffer de profundidad y la caché de textura no acertaba una. Medido
            en Chrome a 125 m sobre San Cristóbal, con A/B en la misma sesión y
            el mismo encuadre: 42 fps sin nada -> 23 solo con esa oclusión. En
            píxeles el coste no depende del zoom: 56 -> 53 en la misma prueba.
            Lo que se pierde es que la oclusión ya no mide una quebrada
            concreta sino "lo que se ve a esta distancia", que para un relieve
            sin objetos sueltos es lo que uno quiere de todos modos.

            halfRes y 8 muestras porque la señal es de baja frecuencia y a
            media resolución no se distingue; depthAwareUpsampling apagado por
            lo mismo. Calibrables todos. */}
        <N8AO
          ref={ajustarAO} halfRes screenSpaceRadius aoRadius={32}
          distanceFalloff={1} intensity={1.6}
          aoSamples={8} denoiseSamples={2} denoiseRadius={8} depthAwareUpsampling={false}
        />
        <AerialPerspective />
        <ToneMapping mode={ToneMappingMode.AGX} />
        {/* Ultimo de la cadena, despues del AgX: SMAA busca bordes por
            contraste percibido, y sobre la salida HDR sin mapear los umbrales
            no significan lo mismo. */}
        <SMAA />
      </EffectComposer>
    </Atmosphere>
  )
}
