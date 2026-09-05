import { useEffect, useRef, useState, type PointerEvent } from 'react'

export type Pt = { x: number; y: number }

// Ray casting (PNPOLY de W. R. Franklin): funciona igual para un lazo cóncavo
// -- ver el test de la muesca en forma de U en lasso.test.ts. Recibe
// coordenadas de pantalla (arriba-izquierda) tal cual las entrega pickRegion
// (PickingPass.tsx) -- no invertir Y acá, eso ya lo resuelve pickRegion.
export function pointInLasso (px: number, py: number, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i].y > py) !== (poly[j].y > py) &&
        px < (poly[j].x - poly[i].x) * (py - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) {
      inside = !inside
    }
  }
  return inside
}

// Vive FUERA del <Canvas>, como SVG superpuesto -- pickRegion vive dentro,
// en el árbol de react-three-fiber (Task 16). El readback de pickRegion lee
// varios MB del framebuffer, así que ocurre solo al soltar (onFinish): acá
// solo se dibuja el polígono en SVG mientras se arrastra, que es gratis.
export function LassoOverlay (
  { active, onFinish }: { active: boolean; onFinish: (p: Pt[]) => void },
) {
  const [pts, setPts] = useState<Pt[]>([])
  const drawing = useRef(false)

  useEffect(() => { if (!active) { setPts([]); drawing.current = false } }, [active])
  if (!active) return null

  const rel = (e: PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const stopDrawing = () => { drawing.current = false; setPts([]) }

  return (
    <svg
      // width/height:100% son imprescindibles, no cosmético: <svg> es un
      // elemento reemplazado (como <img>) -- position:fixed + inset:0 NO lo
      // estira solo, colapsa a su tamaño intrínseco por defecto (300x150,
      // arriba-izquierda). Sin esto el polígono se calcula bien (rel() resta
      // el propio getBoundingClientRect, que en ese cuadro de 300x150 en
      // (0,0) da el mismo número por coincidencia) pero se dibuja fuera del
      // recorte del SVG -- invisible. Lo encontró la verificación visual de
      // esta task, no el predicado (que ya tenía sus tests en verde).
      // position:fixed (no absolute): ancla al viewport sin depender de que
      // ningún ancestro (#root, body) siga sin scroll -- la Task 18 mete un
      // panel de filtros que puede desplazar el layout, y un lazo "casi bien"
      // alineado (corrido unos px) es peor que uno obviamente roto.
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', zIndex: 10 }}
      onPointerDown={e => {
        drawing.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        setPts([rel(e)])
      }}
      onPointerMove={e => {
        if (!drawing.current) return
        // rel(e) se calcula YA, fuera del actualizador: React invalida
        // e.currentTarget en cuanto termina de despachar el evento, y un
        // actualizador funcional (setPts(p => ...)) puede correr más tarde
        // -- leerlo ahí revienta con "Cannot read properties of null"
        // cuando llegan varios mousemove sin que React renderice entre uno
        // y otro (lo disparó un lazo grande arrastrado rápido en el test).
        const pt = rel(e)
        setPts(p => [...p, pt])
      }}
      onPointerUp={() => {
        if (pts.length >= 3) onFinish(pts)
        stopDrawing()
      }}
      // Un atajo del SO, la pestaña perdiendo foco, o el navegador
      // reinterpretando el gesto como scroll cancelan el puntero en vez de
      // soltarlo -- ahí nunca llega pointerup. setPointerCapture solo
      // garantiza el pointerup cuando el gesto termina normal; sin este
      // espejo, drawing.current queda pegado en true y el polígono sigue
      // creciendo con el mouse suelto. No llama a onFinish: un gesto
      // cancelado no es un lazo terminado.
      onPointerCancel={stopDrawing}
    >
      {pts.length > 1 && (
        <polygon
          points={pts.map(p => `${p.x},${p.y}`).join(' ')}
          fill="rgba(120,180,255,0.15)" stroke="#78b4ff" strokeWidth={1.5}
        />
      )}
    </svg>
  )
}
