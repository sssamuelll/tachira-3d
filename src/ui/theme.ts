// Sistema visual de la capa 2D. Un solo sitio: los paneles flotan sobre un
// lienzo WebGL que no comparte nada con el DOM, así que no hay hoja de
// estilos que herede -- cada componente escribe estilos en línea y todos
// leen de acá.
//
// El color de T ya no es literal: son variables CSS (`var(--fondo)`, etc).
// Los valores de las dos paletas -- clara y oscura -- viven en `tema.ts`
// (TOKENS_CLARO / TOKENS_OSCURO) y se inyectan como <style> en main.tsx;
// cuál paleta rige lo decide el atributo `data-tema` en la raíz del documento
// (Task 7). Acá solo quedan los nombres de los campos.
//
// La frontera que no se cruza: esto es color de CHROME (fondo, textos,
// líneas, acento, avisos, sombras) y cambia con el tema. El color del DATO
// -- la rampa del PCI, la hipsometría, el color de cada capa -- no vive acá,
// se queda en src/data/constants.ts y en css3() de abajo, y no cambia nunca
// con el tema: un verde que significa "pavimento bueno" tiene que ser el
// mismo verde de día y de noche, o el mapa miente.
export const T = {
  fondo: 'var(--fondo)',
  fondoSuave: 'var(--fondoSuave)',
  texto: 'var(--texto)',
  texto2: 'var(--texto2)',
  texto3: 'var(--texto3)',
  linea: 'var(--linea)',
  lineaFuerte: 'var(--lineaFuerte)',

  // Azul petróleo. No compite con la rampa ASTM (verde→rojo) ni con el
  // relieve: es el único color de la interfaz que no significa "estado del
  // pavimento", y por eso puede significar "esto es lo que tocaste".
  acento: 'var(--acento)',
  acentoHover: 'var(--acentoHover)',
  acentoSuave: 'var(--acentoSuave)',
  // Texto/icono encima de un fondo T.acento -- conmuta con él, a diferencia
  // de un '#fff' fijo (Arreglo 2).
  sobreAcento: 'var(--sobreAcento)',

  aviso: 'var(--aviso)',
  avisoFondo: 'var(--avisoFondo)',
  avisoLinea: 'var(--avisoLinea)',

  // Elevación de Material: una sombra de contacto corta y una difusa larga.
  // Una sola sombra sobre un mapa con textura no despega el panel.
  sombra: 'var(--sombra)',
  sombraChica: 'var(--sombraChica)',

  etiquetaFondo: 'var(--etiquetaFondo)',

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
