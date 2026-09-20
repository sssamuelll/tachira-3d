// Service worker del mapa. Guarda en el navegador lo pesado y estable del
// sitio para que la segunda visita no vuelva a bajar los 13,7 MB del primer
// cuadro: GitHub Pages manda `max-age=600`, así que a los diez minutos la
// caché HTTP ya no sirve y todo vuelve por el cable.
//
// NO GUARDA NADA DE OTRO ORIGEN, y eso no es una simplificación: las teselas
// de la foto satelital son de Esri, cuya licencia permite USAR el servicio y
// no copiarlo ni redistribuirlo (imagenTeselas.ts lo dice en su cabecera).
// Meterlas en una Cache API es hacer una copia. La regla se aplica por
// construcción -- todo lo que no sea este origen se deja pasar sin tocar --
// para que no dependa de acordarse de una lista negra.
//
// La versión llega en la query con la que main.tsx lo registra (?v=__BUILD__):
// cada build estrena nombre de caché, y `activate` borra los viejos. Es lo que
// hace que un despliegue con datos nuevos no quede servido desde el disco para
// siempre -- data/ no lleva hash en el nombre, el bundle sí.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const CACHE = 'tachira-' + VERSION

// Lo horneado y lo empaquetado. Fuera de estas tres carpetas queda
// index.html, que tiene que llegar siempre fresco: es quien nombra el bundle
// con hash, y servirlo viejo congelaría el sitio en la versión anterior.
const GUARDABLE = /\/(data|texturas|assets)\//

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
  await self.clients.claim()
})()))

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (!GUARDABLE.test(url.pathname)) return
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const guardado = await cache.match(req)
    if (guardado) return guardado
    const res = await fetch(req)
    // Solo el 200 limpio. Un 206 (respuesta parcial) no se puede guardar y
    // `cache.put` lanza; un 404 guardado se serviría como 404 para siempre.
    if (res.status === 200) cache.put(req, res.clone())
    return res
  })())
})
