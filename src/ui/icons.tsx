// Íconos de trazo, dibujados acá y no traídos de una fuente tipográfica ni de
// un paquete: son un puñado, heredan currentColor y escalan sin pedirle nada
// al bundle. Rejilla de 24, trazo 1.75, terminaciones redondas -- una sola
// familia para que no se noten dibujados por manos distintas.
const base = {
  width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.75,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
}

export const Lupa = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" />
  </svg>
)

export const Equis = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const Atras = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <path d="M14.5 5L8 12l6.5 7" />
  </svg>
)

/** Lazo: un contorno cerrado a mano alzada, en línea de puntos. El dibujo del
 * nudo con su cabo (la otra opción obvia) sale igual que un globo de diálogo
 * a 20 px: la línea de puntos dice "selección" sin ambigüedad. */
export const Lazo = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden strokeDasharray="2.8 2.6">
    <path d="M11.5 3.8c4.6-.5 8.4 2 8.6 5.6.2 3.7-3 6.9-6.4 8.9-3.5 2-7.6 2.4-9.5-.4-1.9-2.8-1.2-7.3.9-10.4 1.4-2.1 3.6-3.4 6.4-3.7z" />
  </svg>
)

/** Encuadre: las cuatro esquinas de un marco. */
export const Encuadre = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
)

export const Archivo = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <path d="M13 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V9z" />
    <path d="M13 3.5V9h5.5" />
  </svg>
)

/** Vía: dos bordes de calzada con la línea de eje discontinua. */
export const Via = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <path d="M8.5 3.5L5 20.5M15.5 3.5L19 20.5" />
    <path d="M12 5v2.5M12 10.5v3M12 16.5V19" />
  </svg>
)

/** Municipio: perímetro irregular, no un pin de ubicación. Lo que se busca
 * acá es un territorio con frontera, no un punto. */
export const Territorio = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <path d="M4 8.5l5-3 6 2.5 5-2v11l-5 2-6-2.5-5 3z" />
    <path d="M9 5.5v13M15 8v13" />
  </svg>
)

/** Rodadura: capa sobre capa, la sección del pavimento. */
export const Capa = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <path d="M12 3.5l8 4-8 4-8-4z" /><path d="M4 12.5l8 4 8-4" /><path d="M4 16.5l8 4 8-4" />
  </svg>
)

/** Procedencia: un sello. De dónde viene el número, no qué dice. */
export const Sello = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <circle cx="12" cy="9" r="4.5" /><path d="M5.5 20.5h13l-1-3.2a2 2 0 0 0-1.9-1.3H8.4a2 2 0 0 0-1.9 1.3z" />
  </svg>
)

/** Más y menos del zoom. Trazo largo hasta casi el borde de la rejilla: a 40 px
 * de botón, un signo corto se pierde en el aire de alrededor. */
export const Mas = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

/** Imagen satelital: el marco de una foto con un horizonte de montaña dentro
 * y el sol encima. El satélite con sus paneles (la otra opción obvia) dice
 * "de dónde viene" y no "qué vas a ver", y a 20 px es un garabato. */
export const Foto = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.4" />
    <path d="M3.5 16l4.5-4.5 4 4 3-2.5 5 4.5" />
  </svg>
)

export const Menos = (p: { size?: number }) => (
  <svg {...base} width={p.size ?? 20} height={p.size ?? 20} aria-hidden>
    <path d="M5 12h14" />
  </svg>
)
