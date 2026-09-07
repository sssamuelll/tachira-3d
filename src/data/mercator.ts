// Teselas Web Mercator (z/x/y): la misma matemática que scripts/lib/terrarium.mjs,
// que es la que fija dónde cae cada post del DEM. Coordenadas fraccionarias;
// la parte entera es la tesela.
export const xTesela = (lon: number, z: number): number => (lon + 180) / 360 * 2 ** z
export const yTesela = (lat: number, z: number): number => {
  const r = lat * Math.PI / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z
}
export const lonDeTesela = (x: number, z: number): number => x / 2 ** z * 360 - 180
export const latDeTesela = (y: number, z: number): number =>
  Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI
