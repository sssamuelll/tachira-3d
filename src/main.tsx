import { createRoot } from 'react-dom/client'
import App from './App'
import { TOKENS_CLARO, TOKENS_OSCURO, cssDeTokens } from './ui/tema'

const estilo = document.createElement('style')
estilo.textContent = cssDeTokens(TOKENS_CLARO, TOKENS_OSCURO)
document.head.append(estilo)

createRoot(document.getElementById('root')!).render(<App />)

// El service worker guarda los datos horneados y el bundle para que la
// segunda visita no vuelva a bajarlos (public/sw.js explica qué y por qué no
// toca las teselas de Esri). Solo en producción: en dev se interpondría entre
// vite y el HMR. Después de `load` para no competir por red con el primer
// cuadro, que es justo lo que se está intentando acelerar. Si falla, no pasa
// nada -- el sitio funciona igual sin él, así que el error no se propaga.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js?v=${__BUILD__}`)
      .catch(() => {})
  })
}
