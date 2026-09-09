// Sistema visual de la capa 2D. Un solo sitio: los paneles flotan sobre un
// lienzo WebGL que no comparte nada con el DOM, así que no hay hoja de
// estilos que herede -- cada componente escribe estilos en línea y todos
// leen de acá.
//
// Tema claro sobre un mapa claro (relieve hipsométrico bajo cielo diurno).
// Los grises van apenas fríos, no neutros puros: contra el verde-ocre del
// terreno un gris exacto se ve sucio.
export const T = {
  fondo: '#ffffff',
  fondoSuave: '#f5f6f7',
  texto: '#1f2124',
  texto2: '#5b6169',
  texto3: '#868c94',
  linea: '#e4e6e9',
  lineaFuerte: '#d0d4d9',

  // Azul petróleo. No compite con la rampa ASTM (verde→rojo) ni con el
  // relieve: es el único color de la interfaz que no significa "estado del
  // pavimento", y por eso puede significar "esto es lo que tocaste".
  acento: '#15607a',
  acentoHover: '#0f4b60',
  acentoSuave: '#e8f1f4',

  aviso: '#7a5200',
  avisoFondo: '#fff4dc',
  avisoLinea: '#f0dcae',

  // Elevación de Material: una sombra de contacto corta y una difusa larga.
  // Una sola sombra sobre un mapa con textura no despega el panel.
  sombra: '0 1px 2px rgba(31,33,36,.22), 0 6px 20px rgba(31,33,36,.14)',
  sombraChica: '0 1px 2px rgba(31,33,36,.24), 0 2px 6px rgba(31,33,36,.10)',

  radio: 8,
  radioChico: 6,
  fuente: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',

  // Ancho del riel izquierdo. Un municipio del Táchira llega a "Pedro María
  // Ureña" y una vía a "Carretera Nacional Vía a Los Llanos": por debajo de
  // ~380 px esos nombres parten en tres líneas y la lista deja de escanearse.
  riel: 400,
} as const

/** [0..1, 0..1, 0..1] (la forma de PCI_RANGES) a un color CSS. */
export const css3 = (c: readonly [number, number, number]) =>
  `rgb(${c.map(v => Math.round(v * 255)).join(',')})`

export const nf = new Intl.NumberFormat('es-VE')
export const km1 = (n: number) => `${n.toFixed(1).replace('.', ',')} km`

// Los valores de `highway` son de OSM y salen crudos en el dato. En pantalla
// van en español; lo que no esté en la tabla se muestra tal cual en vez de
// caer a un genérico que borre la distinción.
const VIAS: Record<string, string> = {
  motorway: 'autopista', motorway_link: 'enlace de autopista',
  trunk: 'troncal', trunk_link: 'enlace de troncal',
  primary: 'vía principal', primary_link: 'enlace principal',
  secondary: 'vía secundaria', secondary_link: 'enlace secundario',
  tertiary: 'vía terciaria', tertiary_link: 'enlace terciario',
  unclassified: 'vía sin clasificar', residential: 'calle',
  living_street: 'calle residencial', service: 'vía de servicio',
  track: 'camino de tierra', path: 'sendero', footway: 'acera',
  pedestrian: 'peatonal', cycleway: 'ciclovía', road: 'vía sin definir',
  busway: 'canal de bus', raceway: 'pista',
}
export const etiquetaVia = (highway: string) => VIAS[highway] ?? highway

// Sin el prefijo "Municipio " que trae la relación de OSM: en una lista de
// municipios la palabra se repite 29 veces y no distingue ninguno.
export const cortoMunicipio = (nombre: string) => nombre.replace(/^Municipio\s+/i, '')

/** Sin tildes y en minúsculas, para comparar lo que el usuario teclea contra
 * el dato. "junin" tiene que encontrar "Junín". */
export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
