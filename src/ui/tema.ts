/**
 * Las dos paletas del chrome y el CSS que las declara.
 *
 * Solo color de CHROME: fondo, textos, líneas, acento, avisos, sombras. El
 * color del DATO -- la rampa del PCI, la hipsometría, el color de cada capa --
 * no vive acá y no cambia con el tema. Un verde que significa "pavimento
 * bueno" tiene que ser el mismo verde de día y de noche, o el mapa miente.
 */

export const TOKENS_CLARO: Record<string, string> = {
  fondo: '#ffffff',
  fondoSuave: '#f5f6f7',
  texto: '#1f2124',
  texto2: '#5b6169',
  texto3: '#868c94',
  linea: '#e4e6e9',
  lineaFuerte: '#d0d4d9',
  acento: '#15607a',
  acentoHover: '#0f4b60',
  acentoSuave: '#e8f1f4',
  aviso: '#7a5200',
  avisoFondo: '#fff4dc',
  avisoLinea: '#f0dcae',
  sombra: '0 1px 2px rgba(31,33,36,.22), 0 6px 20px rgba(31,33,36,.14)',
  sombraChica: '0 1px 2px rgba(31,33,36,.24), 0 2px 6px rgba(31,33,36,.10)',
  // Fondo de la etiqueta flotante de un marcador (CapaPuntos.tsx). Era un
  // blanco fijo: sobre relieve oscuro quedaba un rectángulo blanco pegado al
  // mapa. Chrome, no dato -- el texto encima ya usa `texto`, que sí cambia.
  etiquetaFondo: 'rgba(255,255,255,.82)',
}

/** Azulado y no gris neutro, por la misma razón que el claro: contra el
 *  verde-ocre del terreno un gris exacto se ve sucio. El acento sube de
 *  luminosidad porque el petróleo original es ilegible sobre oscuro, pero
 *  conserva el matiz: sigue sin competir con la rampa verde→rojo. */
export const TOKENS_OSCURO: Record<string, string> = {
  fondo: '#11161c',
  fondoSuave: '#1a212a',
  texto: '#e6ebf2',
  texto2: '#a7b0bb',
  texto3: '#79838f',
  linea: '#232c36',
  lineaFuerte: '#33404e',
  acento: '#4aa8c9',
  acentoHover: '#68bcd9',
  acentoSuave: '#15303c',
  aviso: '#e0b050',
  avisoFondo: '#2e2410',
  avisoLinea: '#4d3d18',
  // En oscuro una sombra no separa del fondo; la que separa es la línea, así
  // que la sombra se mantiene por la forma y el borde hace el trabajo.
  sombra: '0 1px 2px rgba(0,0,0,.5), 0 6px 20px rgba(0,0,0,.4)',
  sombraChica: '0 1px 2px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.3)',
  etiquetaFondo: 'rgba(17,22,28,.82)',
}

const declarar = (t: Record<string, string>) =>
  Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';')

export function cssDeTokens (claro: Record<string, string>, oscuro: Record<string, string>) {
  return `:root{${declarar(claro)}}\n:root[data-tema="oscuro"]{${declarar(oscuro)}}`
}
