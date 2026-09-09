import { useCallback, useEffect, useMemo, useRef, type PointerEvent, type RefObject } from 'react'
import * as THREE from 'three'
import { T } from './theme'
import { encajar, relieve, type Mirilla } from './disco'
import { enuOf } from '../scene/Camera'
import { alturaMalla } from '../scene/drape'
import { BBOX } from '../data/constants'
import type { TerrainMeta, Municipio } from '../data/types'

// Diámetro del disco, en píxeles de CSS. A 148 el estado entero mide unos 130
// px de alto: suficiente para reconocer la silueta y para apuntar con el ratón
// a un municipio concreto sin pelear. Más pequeño y deja de ser navegable;
// más grande y empieza a tapar mapa.
const LADO = 148

// Aire entre el borde del disco y el rectángulo del estado. El disco recorta
// las esquinas, así que sin margen las puntas del bbox se pierden.
const MARGEN = 7

const RADIO_PUNTO = 4.5

// El cono de visión, en el azul de la interfaz (T.acento). Va con alfa y no
// con un color sólido porque tiene que dejar ver el relieve de debajo: es una
// indicación de hacia dónde miras, no una mancha.
const CONO = (a: number) => `rgba(21,96,122,${a})`

/**
 * El estado completo en la esquina, con la marca de dónde estás mirando.
 *
 * Pinta el mismo DEM y la misma rampa hipsométrica que el relieve grande, así
 * que es literalmente el mapa que estás mirando visto desde arriba -- lo que
 * hace que la correspondencia entre los dos sea inmediata y no haya que
 * aprenderse un segundo mapa. El relieve se calcula una sola vez por carga y
 * queda en un lienzo aparte; a partir de ahí cada cuadro solo lo copia y le
 * dibuja la mirilla encima.
 */
export function MiniMapa ({ grid, meta, municipios, mirilla, onIr }: {
  grid: Int16Array
  meta: TerrainMeta
  municipios: Municipio[]
  /** Donde la cámara deja su función de aviso -- ver <Vista> en scene/Camera. */
  mirilla: RefObject<((m: Mirilla) => void) | null>
  onIr: (destino: THREE.Vector3) => void
}) {
  const lienzo = useRef<HTMLCanvasElement>(null)
  // El relieve ya pintado. Se arma una vez y se copia en cada cuadro.
  const fondo = useRef<HTMLCanvasElement | null>(null)
  // Lo último que avisó la cámara, y lo último que llegó a dibujarse.
  const estado = useRef<Mirilla | null>(null)
  const pintado = useRef<Mirilla | null>(null)

  // Tope de 2: en una pantalla 3x el relieve saldría de 444 px de lado para
  // enseñarse a 148, y ni se nota ni se paga solo.
  const dpr = useMemo(() => Math.min(2, window.devicePixelRatio || 1), [])
  const L = LADO * dpr
  const encaje = useMemo(() => encajar(BBOX, L, MARGEN * dpr), [L, dpr])

  const dibujar = useCallback(() => {
    const cv = lienzo.current
    const bg = fondo.current
    const ctx = cv?.getContext('2d')
    if (!cv || !bg || !ctx) return
    const r = L / 2
    ctx.clearRect(0, 0, L, L)
    ctx.save()
    ctx.beginPath()
    ctx.arc(r, r, r, 0, Math.PI * 2)
    ctx.clip()
    // Fondo claro bajo la silueta: lo que queda fuera del estado es blanco, y
    // eso es lo que hace legible el contorno del Táchira a este tamaño.
    ctx.fillStyle = T.fondo
    ctx.fillRect(0, 0, L, L)
    ctx.drawImage(bg, encaje.x, encaje.y)

    const m = estado.current
    if (m) {
      const t = encaje.aPixel(m.lat, m.lon)
      const c = encaje.aPixel(m.camLat, m.camLon)
      const dx = t.x - c.x, dy = t.y - c.y
      const dist = Math.hypot(dx, dy)
      // Mirando casi en vertical, la cámara cae encima del punto y el rumbo
      // deja de estar definido: ahí no hay cono que dibujar, solo el punto.
      if (dist > 1) {
        const ang = Math.atan2(dy, dx)
        ctx.beginPath()
        ctx.moveTo(c.x, c.y)
        // Largo generoso a propósito: el cono se recorta contra el disco, no
        // contra su propia punta -- lo que se ve es por dónde entra.
        ctx.arc(c.x, c.y, L * 1.6, ang - m.semi, ang + m.semi)
        ctx.closePath()
        // Tinte plano, no un degradado desde la cámara: en vista del estado la
        // cámara está a 100 km, o sea muy fuera del disco, y un degradado
        // anclado a ella llega al mapa ya apagado. Lo que dibuja el cono son
        // sus dos lados; el relleno solo dice de qué lado caen.
        ctx.fillStyle = CONO(0.16)
        ctx.fill()
        ctx.lineWidth = 1.5 * dpr
        ctx.strokeStyle = CONO(0.55)
        ctx.stroke()
      }
      // El punto va con aro blanco: sobre relieve oscuro un punto azul sin aro
      // desaparece, y es lo único que siempre tiene que verse.
      ctx.beginPath()
      ctx.arc(t.x, t.y, RADIO_PUNTO * dpr, 0, Math.PI * 2)
      ctx.fillStyle = T.acento
      ctx.fill()
      ctx.lineWidth = 2 * dpr
      ctx.strokeStyle = '#fff'
      ctx.stroke()
    }
    ctx.restore()
    // Anillo por dentro del borde: separa el disco del relieve cuando el mapa
    // de debajo también es claro.
    ctx.beginPath()
    ctx.arc(r, r, r - dpr / 2, 0, Math.PI * 2)
    ctx.lineWidth = dpr
    ctx.strokeStyle = T.lineaFuerte
    ctx.stroke()
  }, [L, dpr, encaje])

  // El relieve: una pasada sobre el DEM que ya está en memoria, remuestreado
  // al tamaño del disco. Décimas de milisegundo, una vez por carga.
  useEffect(() => {
    const c = document.createElement('canvas')
    c.width = encaje.w
    c.height = encaje.h
    const cx = c.getContext('2d')
    if (!cx) return
    const img = cx.createImageData(encaje.w, encaje.h)
    img.data.set(relieve(grid, meta, municipios, encaje.w, encaje.h))
    cx.putImageData(img, 0, 0)
    fondo.current = c
    pintado.current = null
    dibujar()
  }, [grid, meta, municipios, encaje, dibujar])

  // Se repinta solo cuando la marca se movería de sitio de verdad. Sin este
  // filtro esto serían sesenta repintados por segundo mientras la cámara está
  // quieta, por el ruido de coma flotante de la reproyección.
  useEffect(() => {
    mirilla.current = (m: Mirilla) => {
      estado.current = m
      const p = pintado.current
      if (p) {
        const a = encaje.aPixel(m.lat, m.lon), b = encaje.aPixel(p.lat, p.lon)
        const c = encaje.aPixel(m.camLat, m.camLon), d = encaje.aPixel(p.camLat, p.camLon)
        if (Math.hypot(a.x - b.x, a.y - b.y) < 0.3 && Math.hypot(c.x - d.x, c.y - d.y) < 0.3 &&
            Math.abs(m.semi - p.semi) < 1e-3) return
      }
      pintado.current = m
      dibujar()
    }
    const ref = mirilla
    return () => { ref.current = null }
  }, [mirilla, encaje, dibujar])

  // Un clic (o un arrastre) manda la vista a ese punto del estado. La altura
  // sale de la misma malla sobre la que se apoyan las vías: sin ella, ir a un
  // páramo de 3.000 m dejaría el centro de la vista a la altura del valle del
  // que venías, y la cámara entraría en el cerro.
  const ir = useCallback((ev: PointerEvent<HTMLCanvasElement>) => {
    const cv = ev.currentTarget
    const r = cv.getBoundingClientRect()
    const g = encaje.aGeo(
      (ev.clientX - r.left) / r.width * L,
      (ev.clientY - r.top) / r.height * L,
    )
    // Acotado al bbox: las esquinas del disco caen fuera del mapa, y un
    // arrastre que se sale de él tiene que seguir llevándote al borde.
    const lat = Math.min(BBOX.n, Math.max(BBOX.s, g.lat))
    const lon = Math.min(BBOX.e, Math.max(BBOX.w, g.lon))
    onIr(enuOf(lat, lon, alturaMalla(grid, meta, lat, lon) ?? 0))
  }, [encaje, L, grid, meta, onIr])

  return (
    <canvas ref={lienzo} width={L} height={L}
      title="El estado completo. Un clic te lleva a ese punto"
      onPointerDown={ev => { ev.currentTarget.setPointerCapture(ev.pointerId); ir(ev) }}
      onPointerMove={ev => { if (ev.buttons & 1) ir(ev) }}
      style={{
        position: 'fixed', top: 12, right: 12, zIndex: 20,
        width: LADO, height: LADO, borderRadius: '50%',
        boxShadow: T.sombra, cursor: 'crosshair', touchAction: 'none',
      }}
    />
  )
}
