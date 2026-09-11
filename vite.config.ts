import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` decide de qué ruta cuelga el sitio, y con él el BASE_URL que leen
// urlVersionado y urlGenerado (src/data/rutas.ts). En local es la raíz; la
// Action de despliegue pone BASE_PATH=/tachira-3d/ porque GitHub Pages sirve
// el repo bajo su propio nombre. Con dominio propio, BASE_PATH vuelve a '/'
// y no hay nada más que cambiar.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
