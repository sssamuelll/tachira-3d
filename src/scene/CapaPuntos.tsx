import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { cargarCapa, type Capa, type Rasgo } from '../data/capas'
import { alturaGruesa } from '../data/terreno'
import { alturaTerreno } from './distanciaVista'
import { enuOf } from './Camera'
import type { TerrainMeta } from '../data/types'
import { T } from '../ui/theme'

/** A qué distancia de la cámara se vuelve a preguntar por la cota fina. */
const RADIO_APOYO = 3000
/** A qué distancia se escribe el nombre al lado del marcador. */
const RADIO_ETIQUETA = 2000
/**
 * Cuántas etiquetas a la vez. Cada una es un nodo del DOM superpuesto al
 * canvas, y el DOM no escala como la escena.
 * ponytail: techo escrito. Si alguna capa de puntos pasa de unos cientos de
 * rasgos densos, el camino es texto SDF dentro de la escena, no subir esto.
 */
const ETIQUETAS_MAX = 40
/** Cada cuántos cuadros se rehace el apoyo al terreno. */
const CADA = 30
/** Lo que mide el marcador en pantalla, de alto. Como una chincheta de mapa:
 *  suficiente para tocarla con el dedo, no tanto como para tapar la calle. */
const MARCADOR_PX = 28

/**
 * La escala que hay que darle a un sprite para que mida `altoPx` en pantalla.
 *
 * `sizeAttenuation: false` no significa que la escala sean píxeles -- significa
 * casi lo contrario. Cuando USE_SIZEATTENUATION no está definido, el shader de
 * sprites de three multiplica la escala por la profundidad
 * (`scale *= -mvPosition.z`) y la división por w la cancela: el tamaño sale
 * constante en pantalla, pero su valor lo fija la proyección. El alto acaba
 * siendo `escala / tan(fov/2) · altoViewport / 2`, así que despejar da esto.
 *
 * Importa saberlo porque acá había un 14 a secas, que a 45° de campo y 768 px
 * de alto son casi trece mil píxeles: cada marcador tapaba la pantalla entera
 * y, con depthTest apagado, se comía los clics de medio mapa.
 */
export function escalaSprite (altoPx: number, fovGrados: number, altoViewport: number): number {
  return (2 * altoPx * Math.tan((fovGrados * Math.PI) / 360)) / Math.max(1, altoViewport)
}

/** La textura del marcador: un círculo del color de la capa con borde blanco,
 *  que es lo que lo hace legible sobre relieve claro y sobre foto satelital. */
function textura (color: string): THREE.Texture {
  const lado = 64
  const c = document.createElement('canvas')
  c.width = c.height = lado
  const g = c.getContext('2d')!
  g.beginPath()
  g.arc(lado / 2, lado / 2, lado / 2 - 6, 0, Math.PI * 2)
  g.fillStyle = color
  g.fill()
  g.lineWidth = 6
  g.strokeStyle = '#fff'
  g.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * Los rasgos de una capa de puntos, apoyados en el terreno.
 *
 * El apoyo va en dos pasos y el segundo se repite siempre, no solo hasta el
 * primer acierto: el primer impacto puede venir de un nodo grueso provisional
 * y el fino llega después, así que un marcador que se diera por apoyado se
 * quedaría enterrado o flotando.
 *
 * Solo se consultan los rasgos a menos de 3 km de la cámara. Eso NO son cuatro:
 * sobre el dataset real, parado en San Cristóbal, caen 41 hospitales dentro de
 * ese radio, y los 41 se consultan en el MISMO cuadro, uno cada 30. El coste de
 * ese cuadro está sin medir con GPU real -- por software no se puede, el mapa
 * entero corre a 1 fps y ahí todo parece lento. Si algún día una capa densa
 * provoca un tirón, el camino es repartir los raycasts entre cuadros, no
 * agrandar CADA: alargarlo solo haría que el marcador tarde más en apoyarse.
 *
 * A diferencia de las piezas, esto NO demanda teselas del DEM: los puntos se
 * apoyan en lo que el relieve ya cargó para la cámara. Pedir teselas por cada
 * hospital del estado traería el DEM entero.
 */
export function CapaPuntos ({ capa, grid, meta, onElegir, onFallo }: {
  capa: Capa
  grid: Int16Array
  meta: TerrainMeta
  /** La capa viaja con el rasgo: la ficha necesita el catálogo para saber cómo
   *  se llama cada campo, y un rasgo suelto no lo trae. */
  onElegir: (capa: Capa, rasgo: Rasgo) => void
  /** Qué hacer si la capa no carga. `null` quiere decir que ya cargó bien.
   *  Sin esto, el único aviso era un console.warn: el botón quedaba encendido,
   *  el mapa no dibujaba nada, y para el visitante era indistinguible de una
   *  capa sin rasgos cerca. */
  onFallo: (id: string, error: string | null) => void
}) {
  const { scene, camera, size } = useThree()
  const [rasgos, setRasgos] = useState<Rasgo[]>([])
  const grupo = useRef<THREE.Group>(null)
  const mapa = useMemo(() => textura(capa.color), [capa.color])
  useEffect(() => () => mapa.dispose(), [mapa])
  const [cerca, setCerca] = useState<Rasgo[]>([])

  const escala = useMemo(
    () => escalaSprite(MARCADOR_PX, (camera as THREE.PerspectiveCamera).fov ?? 45, size.height),
    [camera, size.height],
  )

  useEffect(() => {
    let vivo = true
    cargarCapa(capa)
      .then(r => { if (vivo) { setRasgos(r); onFallo(capa.id, null) } })
      .catch((e: unknown) => {
        if (!vivo) return
        console.warn(`capa ${capa.id}:`, e)
        onFallo(capa.id, e instanceof Error ? e.message : String(e))
      })
    return () => { vivo = false }
  }, [capa, onFallo])

  // Posición inicial: la cota del DEM grueso, que ya está en memoria. Sirve
  // para que el marcador exista desde el primer cuadro en vez de aparecer
  // cuando el relieve fino llegue a su trozo del estado.
  const sitios = useMemo(() => rasgos.flatMap(r => {
    // validarCapa ya garantizó que una capa 'punto' solo trae Point, pero el
    // tipo es la unión de las tres geometrías: esto es lo que se lo dice a
    // TypeScript sin un `as`.
    if (r.geometry.type !== 'Point') return []
    const [lon, lat] = r.geometry.coordinates
    return [{ rasgo: r, p: enuOf(lat, lon, alturaGruesa(grid, meta, lat, lon)), lat, lon }]
  }), [rasgos, grid, meta])

  const cuadro = useRef(0)
  useFrame(() => {
    const g = grupo.current
    if (!g) return
    if (cuadro.current++ % CADA !== 0) return
    const visibles: { r: Rasgo; d: number }[] = []
    for (let i = 0; i < sitios.length; i++) {
      const s = sitios[i]
      const hijo = g.children[i]
      if (!hijo) continue
      const d = Math.hypot(camera.position.x - hijo.position.x, camera.position.z - hijo.position.z)
      if (d <= RADIO_APOYO) {
        const y = alturaTerreno(hijo.position, scene)
        // Solo se adopta si hubo impacto: sin él, el marcador se queda con la
        // cota gruesa, que es aproximada pero nunca es cero.
        if (y !== null) hijo.position.y = y
      }
      if (d <= RADIO_ETIQUETA) visibles.push({ r: s.rasgo, d })
    }
    visibles.sort((a, b) => a.d - b.d)
    setCerca(visibles.slice(0, ETIQUETAS_MAX).map(v => v.r))
  })

  const conEtiqueta = useMemo(() => new Set(cerca.map(r => r.id)), [cerca])

  return (
    <group ref={grupo} name={`capa:${capa.id}`}>
      {sitios.map(s => (
        <sprite key={s.rasgo.id} position={s.p}
          // El clic en un marcador NO puede llevarse por delante la selección
          // de vías. No se puede arreglar desde onClick: el sintético de r3f
          // sale de `pointerup` y llega DESPUÉS de que el click nativo del
          // Picker ya corrió entero, así que stopPropagation llega tarde.
          // `pointerdown` sí va delante de todos ellos, y ahí se deja la marca
          // de tiempo que el Picker consulta (App.tsx, VIGENCIA_MARCADOR_MS).
          onPointerDown={() => { scene.userData.marcadorTocado = performance.now() }}
          onClick={e => { e.stopPropagation(); onElegir(capa, s.rasgo) }}
          scale={[escala, escala, 1]}>
          {/* sizeAttenuation false: el marcador mide lo mismo en pantalla esté
              donde esté la cámara. Un punto de interés no tiene tamaño real -- es
              una chincheta, no un edificio -- y encogerlo con la distancia lo
              haría desaparecer justo cuando sirve para orientarse. */}
          <spriteMaterial map={mapa} sizeAttenuation={false} depthTest={false} />
          {conEtiqueta.has(s.rasgo.id) && String(s.rasgo.properties.nombre ?? '') !== '' && (
            <Html center style={{
              transform: 'translateY(-18px)', pointerEvents: 'none', userSelect: 'none',
              fontFamily: T.fuente, fontSize: 11, whiteSpace: 'nowrap',
              color: T.texto, background: 'rgba(255,255,255,.82)',
              borderRadius: 3, padding: '1px 5px',
            }}>
              {String(s.rasgo.properties.nombre)}
            </Html>
          )}
        </sprite>
      ))}
    </group>
  )
}
